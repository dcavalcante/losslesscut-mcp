import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import JSON5 from 'json5';
import * as z from 'zod/v4';
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
