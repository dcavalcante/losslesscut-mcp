#!/usr/bin/env node
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { readConfig } from './config.js';
import { createMcpServer } from './mcp/server.js';

const server = createMcpServer(readConfig());

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
