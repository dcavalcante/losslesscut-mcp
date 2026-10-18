import { execFile as execFileCallback } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { promisify } from 'node:util';
import JSON5 from 'json5';
import * as z from 'zod/v4';
import type { AppConfig } from '../config.js';
import { IntegrationError } from './errors.js';
import { authorizePath } from './projects.js';

const execFile = promisify(execFileCallback);

const tagsSchema = z.record(z.string(), z.string()).optional();
const v1ProjectSchema = z.object({
  version: z.literal(1),
  mediaFileName: z.string().optional(),
  cutSegments: z.array(
    z.object({
      start: z.number().finite().nonnegative().optional(),
      end: z.number().finite().optional(),
      name: z.string(),
      tags: tagsSchema,
    }),
  ),
});
const v2ProjectSchema = z.object({
  version: z.literal(2),
  mediaFileName: z.string().optional(),
  cutSegments: z.array(
    z.object({
      start: z.number().finite().nonnegative(),
      end: z.number().finite().optional(),
      name: z.string(),
      tags: tagsSchema,
      selected: z.boolean().optional(),
    }),
  ),
});
const projectSchema = z.discriminatedUnion('version', [v1ProjectSchema, v2ProjectSchema]);

const ffprobeSchema = z.object({
  streams: z.array(
    z.object({
      index: z.number().int().nonnegative(),
      codec_type: z.string().optional(),
      codec_name: z.string().optional(),
      codec_long_name: z.string().optional(),
      width: z.number().int().positive().optional(),
      height: z.number().int().positive().optional(),
      sample_rate: z.string().optional(),
      channels: z.number().int().positive().optional(),
      channel_layout: z.string().optional(),
      duration: z.string().optional(),
    }),
  ),
  format: z.object({
    format_name: z.string().optional(),
    duration: z.string().optional(),
    size: z.string().optional(),
    bit_rate: z.string().optional(),
  }),
});

function parseOptionalNumber(value: string | undefined): number | undefined {
  if (value == null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

export async function inspectMedia(config: AppConfig, inputPath: string) {
  const path = await authorizePath(inputPath, config);
  if (!(await stat(path)).isFile()) throw new IntegrationError('invalid_media', `Media path is not a regular file: ${inputPath}`);

  let probeData: z.infer<typeof ffprobeSchema>;
  try {
    const { stdout } = await execFile(config.ffprobePath, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', path], {
      timeout: 30_000,
      maxBuffer: 4_000_000,
    });
    probeData = ffprobeSchema.parse(JSON.parse(stdout));
  } catch (error) {
    throw new IntegrationError('media_probe_failed', `FFprobe could not inspect ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (probeData.streams.length === 0) throw new IntegrationError('media_probe_failed', `FFprobe found no streams in ${path}.`);
  const file = await stat(path);
  const streamDuration = Math.max(0, ...probeData.streams.map(stream => parseOptionalNumber(stream.duration) ?? 0));
  const duration = parseOptionalNumber(probeData.format.duration) ?? (streamDuration > 0 ? streamDuration : undefined);
  return {
    status: 'verified' as const,
    message: 'FFprobe inspected the authorized file. This reports media-container facts, not LosslessCut editor state.',
    path,
    ...(probeData.format.format_name == null ? {} : { formatName: probeData.format.format_name }),
    ...(duration == null ? {} : { duration }),
    sizeBytes: file.size,
    ...(parseOptionalNumber(probeData.format.bit_rate) == null ? {} : { bitRate: parseOptionalNumber(probeData.format.bit_rate) }),
    streams: probeData.streams.map(stream => ({
      index: stream.index,
      ...(stream.codec_type == null ? {} : { codecType: stream.codec_type }),
      ...(stream.codec_name == null ? {} : { codecName: stream.codec_name }),
      ...(stream.codec_long_name == null ? {} : { codecLongName: stream.codec_long_name }),
      ...(stream.width == null ? {} : { width: stream.width }),
      ...(stream.height == null ? {} : { height: stream.height }),
      ...(stream.sample_rate == null ? {} : { sampleRate: stream.sample_rate }),
      ...(stream.channels == null ? {} : { channels: stream.channels }),
      ...(stream.channel_layout == null ? {} : { channelLayout: stream.channel_layout }),
    })),
  };
}

export async function inspectProject(config: AppConfig, inputPath: string) {
  const projectPath = await authorizePath(inputPath, config);
  if (!projectPath.toLowerCase().endsWith('.llc')) throw new IntegrationError('invalid_project', 'Only LosslessCut .llc project files are supported.');
  if (!(await stat(projectPath)).isFile()) throw new IntegrationError('invalid_project', `Project path is not a regular file: ${inputPath}`);

  let project: z.infer<typeof projectSchema>;
  try {
    project = projectSchema.parse(JSON5.parse(await readFile(projectPath, 'utf8')));
  } catch (error) {
    throw new IntegrationError('invalid_project', `Unable to read a valid LosslessCut LLC v1 or v2 project: ${error instanceof Error ? error.message : String(error)}`);
  }

  const segments = project.cutSegments.map((segment, index) => {
    const start = segment.start ?? 0;
    if (segment.end != null && segment.end <= start) {
      throw new IntegrationError('invalid_project', `Segment ${index} has an end time that is not greater than its start time.`);
    }
    return {
      index,
      start,
      ...(segment.end == null ? {} : { end: segment.end }),
      kind: segment.end == null ? ('marker' as const) : ('segment' as const),
      name: segment.name,
      ...('selected' in segment && segment.selected != null ? { selected: segment.selected } : {}),
      ...(segment.tags == null ? {} : { tags: segment.tags }),
    };
  });

  let mediaPath: string | undefined;
  if (project.mediaFileName != null) {
    if (isAbsolute(project.mediaFileName)) throw new IntegrationError('invalid_project', 'Project mediaFileName must be relative to the project file.');
    mediaPath = await authorizePath(resolve(dirname(projectPath), project.mediaFileName), config);
    if (!(await stat(mediaPath)).isFile()) throw new IntegrationError('invalid_project', 'The project media reference does not identify a regular file.');
  }

  return {
    status: 'verified' as const,
    message: 'The LLC structure and any referenced media path were validated without writing to either file.',
    projectPath,
    version: project.version,
    ...(mediaPath == null ? {} : { mediaPath }),
    mediaReferencePresent: project.mediaFileName != null,
    segmentCount: segments.length,
    segments,
  };
}
