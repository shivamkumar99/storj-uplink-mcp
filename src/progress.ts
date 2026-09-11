/**
 * @file progress.ts
 * @brief Progress reporting via MCP logging notifications
 *
 * Sends `notifications/message` (logging) to the connected MCP client so
 * the user can see that a long-running operation is still in progress.
 *
 * Messages are throttled: at most one per THROTTLE_MS (default 5 s) so we
 * don't flood the client.  The first message for a new operation is sent
 * immediately.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/** The low-level server, reached through McpServer so the deprecated `Server` symbol is never named. */
type LowLevelServer = McpServer['server'];

// ---------------------------------------------------------------------------
// Singleton server reference — set once from server.ts after createServer()
// ---------------------------------------------------------------------------

let _server: LowLevelServer | null = null;

export function setServer(server: LowLevelServer): void {
  _server = server;
}

/** Fire-and-forget — we never want a logging failure to break a tool. */
function send(message: string): void {
  if (!_server) return;
  _server.sendLoggingMessage({ level: 'info', data: message }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Throttle interval — only send a progress message every N ms
// ---------------------------------------------------------------------------

const THROTTLE_MS = 5_000;

// ---------------------------------------------------------------------------
// ProgressReporter — reusable, per-operation progress tracker
//
// Usage:
//   const p = createProgress('Uploading');
//   p.update(chunkBytes, totalBytes);   // throttled — safe to call on every chunk
//   p.done('Upload complete');          // sends one final message
// ---------------------------------------------------------------------------

export interface ProgressReporter {
  /** Report incremental progress.  `total` may be 0 if unknown. */
  update(current: number, total: number, detail?: string): void;
  /** Send a final completion message (always sent, bypasses throttle). */
  done(message: string): void;
}

export function createProgress(label: string): ProgressReporter {
  let lastSentAt = 0;

  return {
    update(current: number, total: number, detail?: string): void {
      const now = Date.now();
      if (now - lastSentAt < THROTTLE_MS) return;
      lastSentAt = now;

      let msg: string;
      if (total > 0) {
        const pct = Math.round((current / total) * 100);
        msg = `⏳ ${label}: ${formatProgress(current)} / ${formatProgress(total)} (${pct}%)`;
      } else {
        msg = `⏳ ${label}: ${formatProgress(current)} so far…`;
      }
      if (detail) msg += ` — ${detail}`;
      send(msg);
    },

    done(message: string): void {
      send(`✅ ${message}`);
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatProgress(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
