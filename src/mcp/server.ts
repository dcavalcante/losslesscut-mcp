import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { AppConfig } from '../config.js';
import { inspectMedia, inspectProject } from '../integration/inspection.js';
import { createProject } from '../integration/projects.js';
import { LosslessCutApi } from '../integration/losslesscut-api.js';
import { exportProjectWorkflow, openProjectWorkflow, toToolError } from '../integration/workflows.js';

const statusSchema = z.object({
  reachable: z.boolean(),
  securityGuard: z.boolean(),
  address: z.string(),
  detail: z.string(),
});

const projectInputSchema = z.object({
  projectPath: z.string().min(1).describe('Path to a LosslessCut LLC v2 project inside an authorized root.'),
  outputDirectory: z.string().min(1).describe('Existing, empty, authorized directory configured as LosslessCut’s custom output directory.'),
});

const createProjectInputSchema = z.object({
  mediaPath: z.string().min(1).describe('Existing media file inside an authorized root.'),
  destinationPath: z.string().min(1).describe('New .llc path whose existing parent directory is inside an authorized root.'),
  segments: z
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
    .min(1),
});

const openOutputSchema = z.object({
  status: z.enum(['unverified', 'error', 'uncertain']),
  message: z.string(),
  code: z.string().optional(),
  projectPath: z.string().optional(),
  mediaPath: z.string().optional(),
  companionProjectPath: z.string().optional(),
  verified: z.boolean().optional(),
});

const exportOutputSchema = z.object({
  status: z.enum(['verified', 'error', 'uncertain']),
  message: z.string(),
  code: z.string().optional(),
  projectPath: z.string().optional(),
  mediaPath: z.string().optional(),
  outputDirectory: z.string().optional(),
  outputs: z.array(z.object({ path: z.string(), duration: z.number(), streams: z.string().array() })).optional(),
  editorStateIntrospectable: z.boolean().optional(),
  eventCorrelation: z.string().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});

const inspectionErrorSchema = z.object({
  status: z.literal('error'),
  message: z.string(),
  code: z.string(),
});

const createProjectOutputSchema = z.union([
  z.object({
    status: z.literal('created'),
    message: z.string(),
    projectPath: z.string(),
    mediaPath: z.string(),
    version: z.literal(2),
    segmentCount: z.number(),
    segments: z.array(
      z.object({ index: z.number(), start: z.number(), end: z.number(), name: z.string(), selected: z.boolean(), tags: z.record(z.string(), z.string()).optional(), kind: z.literal('segment') }),
    ),
  }),
  inspectionErrorSchema,
]);

const mediaInspectionOutputSchema = z.union([
  z.object({
    status: z.literal('verified'),
    message: z.string(),
    path: z.string(),
    formatName: z.string().optional(),
    duration: z.number().optional(),
    sizeBytes: z.number(),
    bitRate: z.number().optional(),
    streams: z.array(
      z.object({
        index: z.number(),
        codecType: z.string().optional(),
        codecName: z.string().optional(),
        codecLongName: z.string().optional(),
        width: z.number().optional(),
        height: z.number().optional(),
        sampleRate: z.string().optional(),
        channels: z.number().optional(),
        channelLayout: z.string().optional(),
      }),
    ),
  }),
  inspectionErrorSchema,
]);

const projectInspectionOutputSchema = z.union([
  z.object({
    status: z.literal('verified'),
    message: z.string(),
    projectPath: z.string(),
    version: z.number(),
    mediaPath: z.string().optional(),
    mediaReferencePresent: z.boolean(),
    segmentCount: z.number(),
    segments: z.array(
      z.object({
        index: z.number(),
        start: z.number(),
        end: z.number().optional(),
        kind: z.enum(['marker', 'segment']),
        name: z.string(),
        selected: z.boolean().optional(),
        tags: z.record(z.string(), z.string()).optional(),
      }),
    ),
  }),
  inspectionErrorSchema,
]);

function toolResult<T extends { status: string; message: string }>(result: T) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(result) }],
    structuredContent: result,
    ...(['error', 'uncertain'].includes(result.status) ? { isError: true } : {}),
  };
}

export function createMcpServer(config: AppConfig): McpServer {
  const server = new McpServer({ name: 'losslesscut-mcp', version: '0.1.0' }, { capabilities: { tools: {} } });
  const api = new LosslessCutApi(config.apiPort, config.apiTimeoutMs);

  server.registerTool(
    'losslesscut_api_status',
    {
      title: 'Check LosslessCut API',
      description: 'Check whether LosslessCut’s experimental HTTP API responds on IPv4 loopback. This does not inspect or mutate editor state.',
      inputSchema: z.object({}),
      outputSchema: statusSchema,
    },
    async () => {
      const result = await api.status();
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], structuredContent: result };
    },
  );

  server.registerTool(
    'losslesscut_inspect_media',
    {
      title: 'Inspect media file',
      description: 'Read-only FFprobe inspection of a media file inside LOSSLESSCUT_ALLOWED_ROOTS. Reports container and stream facts; it does not open or alter LosslessCut editor state.',
      inputSchema: z.object({ path: z.string().min(1).describe('Media file path inside an authorized root.') }),
      outputSchema: mediaInspectionOutputSchema,
    },
    async ({ path }) => {
      try {
        return toolResult(await inspectMedia(config, path));
      } catch (error) {
        return toolResult({ ...toToolError(error) });
      }
    },
  );

  server.registerTool(
    'losslesscut_inspect_project',
    {
      title: 'Inspect LosslessCut project',
      description: 'Read-only inspection of authorized LosslessCut .llc v1/v2 files. Validates segment times and confines referenced media to authorized roots; does not open or modify the project.',
      inputSchema: z.object({ projectPath: z.string().min(1).describe('LLC project path inside an authorized root.') }),
      outputSchema: projectInspectionOutputSchema,
    },
    async ({ projectPath }) => {
      try {
        return toolResult(await inspectProject(config, projectPath));
      } catch (error) {
        return toolResult({ ...toToolError(error) });
      }
    },
  );

  server.registerTool(
    'losslesscut_create_project',
    {
      title: 'Create LLC project',
      description: 'Create a new LLC v2 project referencing an authorized existing media file and validated segment ranges. Refuses overwrite, does not change the source, and does not export.',
      inputSchema: createProjectInputSchema,
      outputSchema: createProjectOutputSchema,
    },
    async ({ mediaPath, destinationPath, segments }) => {
      try {
        return toolResult(
          await createProject(
            config,
            mediaPath,
            destinationPath,
            segments.map(segment => ({
              start: segment.start,
              end: segment.end,
              ...(segment.name == null ? {} : { name: segment.name }),
              ...(segment.tags == null ? {} : { tags: segment.tags }),
              ...(segment.selected == null ? {} : { selected: segment.selected }),
            })),
          ),
        );
      } catch (error) {
        return toolResult({ ...toToolError(error) });
      }
    },
  );

  server.registerTool(
    'losslesscut_open_project',
    {
      title: 'Open a LosslessCut project',
      description:
        'Open an authorized LLC v2 project in the current LosslessCut window. This replaces the active editor state and may create a companion auto-save project in the configured output directory. Upstream can return HTTP 200 after swallowing an action error, so this tool reports an unverified request, not successful loading. Only use after the current session is saved or disposable.',
      inputSchema: projectInputSchema,
      outputSchema: openOutputSchema,
    },
    async ({ projectPath, outputDirectory }) => {
      try {
        return toolResult(await openProjectWorkflow(config, api, projectPath, outputDirectory));
      } catch (error) {
        return toolResult({ ...toToolError(error), projectPath });
      }
    },
  );

  server.registerTool(
    'losslesscut_export_project',
    {
      title: 'Export selected LLC segments',
      description:
        'Open an authorized LLC v2 project, export its selected segments separately through LosslessCut, and verify each new output with FFprobe. Requires the existing LosslessCut config to use the supplied empty custom output directory, disable overwrites and merging, and disable open-file confirmation. It replaces current editor state. If export confirmation is enabled, the call waits for GUI approval and may return uncertain on timeout. Event correlation is limited because upstream has no export IDs; never retry an uncertain result blindly.',
      inputSchema: projectInputSchema,
      outputSchema: exportOutputSchema,
    },
    async ({ projectPath, outputDirectory }) => {
      try {
        return toolResult(await exportProjectWorkflow(config, api, projectPath, outputDirectory));
      } catch (error) {
        return toolResult({ ...toToolError(error), projectPath });
      }
    },
  );

  return server;
}
