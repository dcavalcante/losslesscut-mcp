import { execFile as execFileCallback } from 'node:child_process';
import { open, readFile, realpath, stat, unlink, type FileHandle } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import JSON5 from 'json5';
import * as z from 'zod/v4';
import { promisify } from 'node:util';
import type { AppConfig } from '../config.js';
import { IntegrationError } from './errors.js';

const projectSchema = z.object({
  version: z.literal(2),
  mediaFileName: z.string().min(1),
  cutSegments: z.array(
    z.object({
      start: z.number().finite().nonnegative(),
      end: z.number().finite().positive().optional(),
      name: z.string(),
      selected: z.boolean().optional(),
      tags: z.record(z.string(), z.string()).optional(),
    }),
  ),
});
const execFile = promisify(execFileCallback);

export interface ProjectInfo {
  projectPath: string;
  mediaPath: string;
  selectedSegments: Array<{ start: number; end: number; name: string }>;
}

function isWithin(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

export async function authorizePath(path: string, config: AppConfig): Promise<string> {
  if (config.allowedRoots.length === 0) throw new IntegrationError('authorization_not_configured', 'Set LOSSLESSCUT_ALLOWED_ROOTS before using file tools.');
  let canonical: string;
  try {
    canonical = await realpath(resolve(path));
  } catch {
    throw new IntegrationError('path_not_found', `File or directory does not exist: ${path}`);
  }
  const roots = await Promise.all(
    config.allowedRoots.map(async root => {
      try {
        return await realpath(root);
      } catch {
        return resolve(root);
      }
    }),
  );
  if (!roots.some(root => isWithin(root, canonical))) throw new IntegrationError('path_not_authorized', `Path is outside the configured authorized roots: ${path}`);
  return canonical;
}

export async function loadProject(path: string, config: AppConfig): Promise<ProjectInfo> {
  const projectPath = await authorizePath(path, config);
  if (!projectPath.toLowerCase().endsWith('.llc')) throw new IntegrationError('invalid_project', 'Only LosslessCut .llc projects are supported by this tool.');
  try {
    if (!(await stat(projectPath)).isFile()) throw new Error('not a file');
    const parsed = projectSchema.safeParse(JSON5.parse(await readFile(projectPath, 'utf8')));
    if (!parsed.success) throw new Error(z.prettifyError(parsed.error));
    if (isAbsolute(parsed.data.mediaFileName)) throw new Error('mediaFileName must be relative to the project file');
    const mediaPath = await authorizePath(resolve(dirname(projectPath), parsed.data.mediaFileName), config);
    if (!(await stat(mediaPath)).isFile()) throw new Error('referenced media is not a file');
    const selectedSegments = parsed.data.cutSegments.flatMap(segment => {
      if (segment.selected !== true) return [];
      if (segment.end == null || segment.end <= segment.start) throw new Error(`Selected segment "${segment.name}" needs an end time greater than its start time`);
      return [{ start: segment.start, end: segment.end, name: segment.name }];
    });
    if (selectedSegments.length === 0) throw new Error('The project contains no selected export segments');
    return { projectPath, mediaPath, selectedSegments };
  } catch (error) {
    if (error instanceof IntegrationError) throw error;
    throw new IntegrationError('invalid_project', `Unable to read a valid LosslessCut LLC v2 project: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function createProject(
  config: AppConfig,
  mediaInputPath: string,
  destinationInputPath: string,
  segments: Array<{ start: number; end: number; name?: string; tags?: Record<string, string>; selected?: boolean }>,
) {
  if (!destinationInputPath.toLowerCase().endsWith('.llc')) throw new IntegrationError('invalid_project_path', 'Project destination must end in .llc.');
  if (segments.length === 0) throw new IntegrationError('invalid_segments', 'At least one segment is required.');
  const mediaPath = await authorizePath(mediaInputPath, config);
  if (!(await stat(mediaPath)).isFile()) throw new IntegrationError('invalid_media', 'Media source must be a regular file.');
  let mediaDuration: number;
  try {
    const { stdout } = await execFile(config.ffprobePath, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', mediaPath], { timeout: 30_000, maxBuffer: 1_000_000 });
    mediaDuration = Number((JSON.parse(stdout) as { format?: { duration?: string } }).format?.duration);
    if (!Number.isFinite(mediaDuration) || mediaDuration <= 0) throw new Error('media has no finite positive duration');
  } catch (error) {
    throw new IntegrationError('media_probe_failed', `FFprobe could not validate segment bounds for ${mediaPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const destinationDirectory = await authorizePath(dirname(resolve(destinationInputPath)), config);
  if (!(await stat(destinationDirectory)).isDirectory()) throw new IntegrationError('invalid_project_path', 'Project destination parent must be a directory.');
  const projectPath = resolve(destinationDirectory, basename(destinationInputPath));
  if (projectPath === mediaPath) throw new IntegrationError('invalid_project_path', 'Project destination cannot be the source media file.');
  const parsedSegments = z
    .array(
      z
        .object({
          start: z.number().finite().nonnegative(),
          end: z.number().finite().positive(),
          name: z.string().trim().min(1).optional(),
          tags: z.record(z.string(), z.string()).optional(),
          selected: z.boolean().optional(),
        })
        .refine(segment => segment.end > segment.start, 'end must be greater than start'),
    )
    .safeParse(segments);
  if (!parsedSegments.success) throw new IntegrationError('invalid_segments', `Invalid segment ranges or metadata: ${z.prettifyError(parsedSegments.error)}`);
  const outsideDuration = parsedSegments.data.find(segment => segment.end > mediaDuration);
  if (outsideDuration) throw new IntegrationError('invalid_segments', `Segment end ${outsideDuration.end} exceeds source duration ${mediaDuration}.`);
  const mediaFileName = relative(destinationDirectory, mediaPath);
  if (!mediaFileName || isAbsolute(mediaFileName)) throw new IntegrationError('invalid_project_path', 'Unable to create a relative media reference from the project destination.');
  const project = {
    version: 2,
    mediaFileName,
    cutSegments: parsedSegments.data.map((segment, index) => ({
      start: segment.start,
      end: segment.end,
      name: segment.name ?? `Segment ${index + 1}`,
      selected: segment.selected ?? true,
      ...(segment.tags == null ? {} : { tags: segment.tags }),
    })),
  };
  // wx makes creation atomic with respect to existing files and symlinks.
  let handle: FileHandle | undefined;
  try {
    handle = await open(projectPath, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(project, null, 2)}\n`, 'utf8');
    await handle.sync();
  } catch (error) {
    await handle?.close().catch(() => undefined);
    if (handle) {
      await unlink(projectPath).catch(() => undefined);
    }
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new IntegrationError('project_already_exists', `Refusing to overwrite existing project: ${projectPath}`);
    throw new IntegrationError('project_write_failed', `Could not create project ${projectPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  await handle.close();
  return {
    status: 'created' as const,
    message: 'Created an LLC v2 project for review. No media was changed and no export was started.',
    projectPath,
    mediaPath,
    version: 2,
    segmentCount: project.cutSegments.length,
    segments: project.cutSegments.map((segment, index) => ({ index, ...segment, kind: 'segment' as const })),
  };
}

export async function authorizeOutputDirectory(path: string, config: AppConfig): Promise<string> {
  const outputDirectory = await authorizePath(path, config);
  try {
    if (!(await stat(outputDirectory)).isDirectory()) throw new Error('not a directory');
  } catch {
    throw new IntegrationError('invalid_output_directory', `Output path is not a directory: ${path}`);
  }
  return outputDirectory;
}

export function isPathWithinDirectory(directory: string, path: string): boolean {
  return isWithin(directory, path);
}
