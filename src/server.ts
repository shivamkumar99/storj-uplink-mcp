import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTools, type Tool } from './core/registry.js';
import { VERSION } from './core/version.js';
import { registerUiResources } from './core/ui-resources.js';
import { ENV, readDisplayTimeZone } from './core/env.js';
import { isValidTimeZone, setDisplayTimeZone } from './lib/format.js';

import { tools as bucketTools } from './features/buckets/tools.js';
import { tools as objectTools } from './features/objects/tools.js';
import { tools as uploadTools } from './features/upload/tools.js';
import { tools as downloadTools } from './features/download/tools.js';
import { tools as readTools } from './features/read/tools.js';
import { tools as edgeTools } from './features/edge/tools.js';
import { tools as multipartTools } from './features/multipart/tools.js';

// ---------------------------------------------------------------------------
// Composition root.
//
// Each feature folder owns its tool definitions (see ARCHITECTURE.md); this
// file only imports each feature's tools.ts.  Adding a tool to an existing
// feature needs no change here; adding a feature is one import plus one entry
// below.  The order here is the order MCP clients list the tools in.
// ---------------------------------------------------------------------------

const TOOLS: readonly Tool[] = [
  ...bucketTools,
  ...objectTools,
  ...uploadTools,
  ...downloadTools,
  ...readTools,
  ...edgeTools,
  ...multipartTools,
];

/** Honour STORJ_MCP_TIMEZONE for timestamps in tool output; fall back to UTC on nonsense. */
function applyDisplayTimeZone(): void {
  const tz = readDisplayTimeZone();
  if (!tz) return;
  if (isValidTimeZone(tz)) {
    setDisplayTimeZone(tz);
  } else {
    console.error(`[storj-mcp] Ignoring ${ENV.TIMEZONE}="${tz}" (unknown time zone); timestamps stay in UTC`);
  }
}

export function createServer(): McpServer {
  applyDisplayTimeZone();
  const server = new McpServer({
    name: 'storj-uplink-mcp',
    version: VERSION,
  });

  registerTools(server, TOOLS);
  registerUiResources(server);

  return server;
}
