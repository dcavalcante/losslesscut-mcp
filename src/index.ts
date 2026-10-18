#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { checkLosslessCutApi } from './api-status.js';

const server = new McpServer({ name: 'losslesscut-mcp', version: '0.1.0' }, { capabilities: { tools: {} } });
const inputSchema = z.object({});
const outputSchema = z.object({ reachable: z.boolean(), address: z.string(), detail: z.string() });

server.registerTool(
  'losslesscut_api_status',
  {
    title: 'Check LosslessCut API',
    description: 'Check whether the experimental LosslessCut HTTP API is responding on loopback. This does not inspect the open file or editor state.',
    inputSchema,
    outputSchema,
  },
  async () => {
    const result = await checkLosslessCutApi();
    return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
  },
);

const handle = serveStdio(async () => server, {
  onerror(error) {
    process.stderr.write(`[losslesscut-mcp] ${error.message}\n`);
  },
});

let stopping: Promise<void> | undefined;
async function shutdown(): Promise<void> {
  if (stopping) return stopping;
  stopping = handle.close();
  return stopping;
}

process.once('SIGINT', () => {
  void shutdown().finally(() => process.exit(0));
});
process.once('SIGTERM', () => {
  void shutdown().finally(() => process.exit(0));
});
process.stdin.once('end', () => {
  void shutdown();
});
process.stdin.once('close', () => {
  void shutdown();
});
