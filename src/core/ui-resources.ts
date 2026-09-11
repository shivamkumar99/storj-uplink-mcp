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
  /** Storj browser: renders list_buckets and list_objects results, navigates between them. */
  browser: 'ui://storj-uplink-mcp/browser.html',
} as const;

interface View {
  name: string;
  uri: string;
  file: string;
  description: string;
}

const VIEWS: readonly View[] = [
  {
    name: 'Storj browser',
    uri: UI.browser,
    file: 'browser.html',
    description: 'Interactive, sortable view of buckets and objects: open a bucket, walk prefixes, preview files',
  },
];

// src/core/ui-resources.ts and dist/core/ui-resources.js both sit two levels below the package root, and the
// built views live in <root>/dist/ui/ — so this resolves in dev and in prod.
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
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
