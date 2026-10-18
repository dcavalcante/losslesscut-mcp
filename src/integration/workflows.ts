import { execFile as execFileCallback } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import { promisify } from 'node:util';
import { basename, join, resolve } from 'node:path';
import JSON5 from 'json5';
import type { AppConfig } from '../config.js';
import { IntegrationError } from './errors.js';
import type { LosslessCutApi } from './losslesscut-api.js';
import { authorizeOutputDirectory, authorizePath, isPathWithinDirectory, loadProject, type ProjectInfo } from './projects.js';

const execFile = promisify(execFileCallback);
let operationTail: Promise<void> = Promise.resolve();

async function withEditorLock<T>(operation: () => Promise<T>): Promise<T> {
  const result = operationTail.then(operation, operation);
  operationTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function ensureSafeOutputSettings(config: AppConfig, outputDirectory: string): Promise<void> {
  if (!config.configDir) throw new IntegrationError('configuration_not_verified', 'Set LOSSLESSCUT_CONFIG_DIR to the config directory used by LosslessCut before exporting.');
  let appSettings: Record<string, unknown>;
  try {
    appSettings = JSON5.parse(await readFile(join(config.configDir, 'config.json'), 'utf8')) as Record<string, unknown>;
  } catch {
    throw new IntegrationError('configuration_not_verified', 'Cannot read LosslessCut config.json; refusing an export whose overwrite and output settings cannot be checked.');
  }
  const configuredOutput = appSettings['recentCustomOutDirs'];
  const outputMatches = Array.isArray(configuredOutput) && typeof configuredOutput[0] === 'string' && resolve(configuredOutput[0]) === outputDirectory;
  const safe =
    appSettings['enableOverwriteOutput'] === false &&
    appSettings['enableCustomOutDir'] === true &&
    appSettings['autoMerge'] === false &&
    appSettings['invertCutSegments'] === false &&
    appSettings['segmentsToChaptersOnly'] === false &&
    appSettings['enableAskForFileOpenAction'] === false &&
    appSettings['askBeforeClose'] === true &&
    appSettings['storeProjectInWorkingDir'] === true &&
    (appSettings['cleanupChoices'] as { cleanupAfterExport?: unknown } | undefined)?.cleanupAfterExport !== true &&
    outputMatches;
  if (!safe) {
    throw new IntegrationError(
      'unsafe_export_configuration',
      'LosslessCut must use this empty output directory, disable overwrite, export selected segments separately, disable open confirmation, and leave cleanup-after-export off.',
    );
  }
}

async function requireEmptyDirectory(path: string): Promise<void> {
  const entries = await readdir(path);
  if (entries.length !== 0) throw new IntegrationError('output_directory_not_empty', `Output directory must be empty to prevent overwrites: ${path}`);
}

async function probeMedia(path: string, ffprobePath: string) {
  try {
    const { stdout } = await execFile(ffprobePath, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', path], { timeout: 30_000, maxBuffer: 2_000_000 });
    const data = JSON.parse(stdout) as { format?: { duration?: string }; streams?: Array<{ codec_type?: string; codec_name?: string }> };
    const streams = data.streams ?? [];
    if (streams.length === 0 || !streams.some(stream => stream.codec_type === 'video' || stream.codec_type === 'audio')) {
      throw new IntegrationError('media_verification_failed', `FFprobe found no audio or video streams in ${path}.`);
    }
    const duration = Number(data.format?.duration);
    if (!Number.isFinite(duration) || duration <= 0) throw new IntegrationError('media_verification_failed', `FFprobe found no valid duration in ${path}.`);
    return { path, duration, streams: streams.map(stream => `${stream.codec_type ?? 'unknown'}:${stream.codec_name ?? 'unknown'}`) };
  } catch (error) {
    if (error instanceof IntegrationError) throw error;
    throw new IntegrationError('media_verification_failed', `FFprobe could not verify ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function checkOutputDirectoryEmptyBeforeOpen(config: AppConfig, project: ProjectInfo, outputDirectory: string): Promise<void> {
  if (isPathWithinDirectory(outputDirectory, project.projectPath) || isPathWithinDirectory(outputDirectory, project.mediaPath)) {
    throw new IntegrationError('unsafe_output_directory', 'The output directory must be separate from the project and input media.');
  }
  await requireEmptyDirectory(outputDirectory);
  await ensureSafeOutputSettings(config, outputDirectory);
}

async function openProject(api: LosslessCutApi, project: ProjectInfo): Promise<void> {
  await api.requireRequestGuard();
  await api.action('openFiles', [project.projectPath]);
}

export async function openProjectWorkflow(config: AppConfig, api: LosslessCutApi, projectPath: string, outputPath: string) {
  return withEditorLock(async () => {
    const project = await loadProject(projectPath, config);
    const outputDirectory = await authorizeOutputDirectory(outputPath, config);
    await checkOutputDirectoryEmptyBeforeOpen(config, project, outputDirectory);
    await openProject(api, project);
    const companionPath = join(outputDirectory, `${basename(project.mediaPath).replace(/\.[^.]+$/, '')}-proj.llc`);
    const companionExists = await stat(companionPath).then(
      () => true,
      () => false,
    );
    return {
      status: 'unverified' as const,
      message:
        'LosslessCut returned HTTP 200 for the project-open action. Upstream may swallow action errors and exposes no editor state; an LLC auto-save may be written to the configured output directory.',
      projectPath: project.projectPath,
      mediaPath: project.mediaPath,
      companionProjectPath: companionExists ? companionPath : undefined,
      verified: false,
    };
  });
}

export async function exportProjectWorkflow(config: AppConfig, api: LosslessCutApi, projectPath: string, outputPath: string) {
  return withEditorLock(async () => {
    const project = await loadProject(projectPath, config);
    const outputDirectory = await authorizeOutputDirectory(outputPath, config);
    await checkOutputDirectoryEmptyBeforeOpen(config, project, outputDirectory);
    await openProject(api, project);

    const currentProject = await loadProject(project.projectPath, config);
    await ensureSafeOutputSettings(config, outputDirectory);
    await api.requireRequestGuard();
    const beforeExport = new Set(await readdir(outputDirectory));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('export-timeout')), config.exportTimeoutMs);
    const startPromise = api.awaitExportStart(controller.signal);
    const completePromise = api.awaitExportComplete(controller.signal);
    const eventPromises = Promise.all([startPromise, completePromise]);
    try {
      await api.action('export');
      const [started, completed] = await eventPromises;
      if (started.path !== currentProject.mediaPath) {
        throw new IntegrationError('export_session_mismatch', 'An export-start event was observed for a different media file; the result is uncertain.', 'uncertain');
      }
      if (!completed.paths || completed.paths.length === 0) {
        throw new IntegrationError('export_failed', 'LosslessCut reported export-complete without output paths; the native export failed.');
      }
      if (completed.paths.length !== currentProject.selectedSegments.length) {
        throw new IntegrationError(
          'export_result_mismatch',
          `Expected ${currentProject.selectedSegments.length} separate outputs for the selected project segments, received ${completed.paths.length}.`,
          'uncertain',
        );
      }
      const outputs = [];
      for (const reportedPath of completed.paths) {
        const output = await authorizePath(reportedPath, config);
        if (!isPathWithinDirectory(outputDirectory, output)) {
          throw new IntegrationError('unexpected_output_path', `LosslessCut exported outside the required output directory: ${reportedPath}`, 'uncertain');
        }
        if (output === currentProject.mediaPath || output === currentProject.projectPath) {
          throw new IntegrationError('input_overwrite_prevented', 'LosslessCut reported the source media or project as an export output; refusing to treat it as successful.');
        }
        if (beforeExport.has(basename(output))) {
          throw new IntegrationError('output_preexisted', `LosslessCut reported a path already present before export: ${reportedPath}`, 'uncertain');
        }
        if (!(await stat(output)).isFile()) throw new IntegrationError('output_missing', `LosslessCut reported an output that is not a regular file: ${reportedPath}`, 'uncertain');
        outputs.push(await probeMedia(output, config.ffprobePath));
      }
      return {
        status: 'verified' as const,
        message: 'LosslessCut reported export completion and every new output passed FFprobe stream and duration checks.',
        projectPath: currentProject.projectPath,
        mediaPath: currentProject.mediaPath,
        outputDirectory,
        outputs,
        editorStateIntrospectable: false,
        eventCorrelation: 'Serialized MCP operations observed matching export-start and export-complete events; upstream provides no export ID or listener-registration acknowledgement.',
      };
    } catch (error) {
      controller.abort(error);
      if (error instanceof IntegrationError) throw error;
      if (controller.signal.aborted) {
        throw new IntegrationError(
          'export_outcome_uncertain',
          'Timed out while waiting for LosslessCut export events. The native operation may still be running; do not retry until outputs are reconciled.',
          'uncertain',
        );
      }
      throw new IntegrationError('export_outcome_uncertain', `LosslessCut export outcome is uncertain: ${error instanceof Error ? error.message : String(error)}`, 'uncertain');
    } finally {
      clearTimeout(timeout);
      controller.abort();
    }
  });
}

export function toToolError(error: unknown) {
  const integrationError = error instanceof IntegrationError ? error : new IntegrationError('internal_error', error instanceof Error ? error.message : String(error));
  return {
    status: integrationError.outcome === 'uncertain' ? ('uncertain' as const) : ('error' as const),
    code: integrationError.code,
    message: integrationError.message,
  };
}
