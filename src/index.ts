#!/usr/bin/env node

/**
 * storj-uplink-mcp — MCP server entry point
 *
 * IMPORTANT: Never use console.log() here — it writes to stdout and
 * corrupts the JSON-RPC protocol. Use console.error() for all logging.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';
import { shutdown } from './auth.js';

// ---------------------------------------------------------------------------
// Process lifecycle — signal handlers live here (SRP: index owns process
// lifecycle; auth.ts owns connection state)
// ---------------------------------------------------------------------------

process.on('SIGINT', () => { void shutdown().then(() => process.exit(0)); });
process.on('SIGTERM', () => { void shutdown().then(() => process.exit(0)); });

async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[storj-mcp] Server running — waiting for requests');
}

main().catch((err: unknown) => {
  console.error('[storj-mcp] Fatal error:', err);
  process.exit(1);
});
