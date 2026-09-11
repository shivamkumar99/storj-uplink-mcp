import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTools, type Tool } from './registry.js';

import { tools as bucketTools } from './tools/buckets.js';
import { tools as objectTools } from './tools/objects.js';
import { tools as uploadTools } from './tools/upload.js';
import { tools as downloadTools } from './tools/download.js';
import { tools as smartReadTools } from './tools/smart_read.js';
import { tools as edgeTools } from './tools/edge.js';
import { tools as multipartTools } from './tools/multipart.js';

// ---------------------------------------------------------------------------
// Composition root.
//
// Each tool module owns its own tool definitions (see registry.ts), so adding
// a tool to an existing module needs no change here.  Adding a whole new
// module is one import plus one entry below.  The order here is the order
// MCP clients list the tools in.
// ---------------------------------------------------------------------------

const TOOLS: readonly Tool[] = [
  ...bucketTools,
  ...objectTools,
  ...uploadTools,
  ...downloadTools,
  ...smartReadTools,
  ...edgeTools,
  ...multipartTools,
];

export function createServer(): McpServer {
  const server = new McpServer({
    name: 'storj-uplink-mcp',
    version: '1.0.0',
  });

  registerTools(server, TOOLS);

  return server;
}
