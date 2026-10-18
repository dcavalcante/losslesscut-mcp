import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { AppConfig } from '../config.js';
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
});

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
