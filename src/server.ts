import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTools, type Tool } from './core/registry.js';
import { registerUiResources } from './core/ui-resources.js';

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

export function createServer(): McpServer {
  const server = new McpServer({
    name: 'storj-uplink-mcp',
    version: '1.0.1',
  });

  registerTools(server, TOOLS);
  registerUiResources(server);

  return server;
}
