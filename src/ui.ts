import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAppResource, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';

// ---------------------------------------------------------------------------
// MCP Apps (extension io.modelcontextprotocol/ui).
//
// A tool can point at a `ui://` HTML resource via `_meta.ui.resourceUri`; hosts
// that support the extension (Claude, Claude Desktop, VS Code, …) render it in
// a sandboxed iframe and push the tool result into it.  Hosts that do not
// simply show the tool's text content, so nothing regresses.
//
// Each view is a single self-contained HTML file built by scripts/build-ui.mjs
// (the host CSP is deny-by-default, so scripts are inlined, never linked).
// ---------------------------------------------------------------------------

/** URIs of the views this server ships.  Referenced from tool definitions. */
export const UI = {
  listObjects: 'ui://storj-uplink-mcp/list-objects.html',
} as const;

interface View {
  name: string;
  uri: string;
  file: string;
  description: string;
}

const VIEWS: readonly View[] = [
  {
    name: 'Storj object browser',
    uri: UI.listObjects,
    file: 'list-objects.html',
    description: 'Interactive, sortable view of list_objects results with folder navigation and file preview',
  },
];

// src/ui.ts and dist/ui.js both sit one level below the package root, and the
// built views live in <root>/dist/ui/ — so this resolves in dev and in prod.
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VIEW_DIR = path.join(PACKAGE_ROOT, 'dist', 'ui');

/** Register every view as an MCP Apps resource (also enables the `resources` capability). */
export function registerUiResources(server: McpServer): void {
  for (const view of VIEWS) {
    registerAppResource(
      server,
      view.name,
      view.uri,
      { description: view.description, mimeType: RESOURCE_MIME_TYPE },
      () => Promise.resolve({
        contents: [{ uri: view.uri, mimeType: RESOURCE_MIME_TYPE, text: readFileSync(path.join(VIEW_DIR, view.file), 'utf8') }],
      }),
    );
  }
}
