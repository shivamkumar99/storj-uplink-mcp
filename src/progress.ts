/**
 * @file progress.ts
 * @brief Progress reporting for long-running tool calls.
 *
 * Two channels, both throttled to one message per THROTTLE_MS:
 *   • stderr — the recommended log channel for stdio MCP servers.
 *   • MCP `notifications/progress` — sent only when the client supplied a
 *     progressToken for the current request. Clients render these as progress
 *     bars and may reset their request timeout while work is visibly moving.
 *
 * (Earlier versions used the Logging feature's `notifications/message`, which
 * is now deprecated in MCP and was never delivered anyway because the server
 * did not declare the logging capability.)
 */

import { currentRequest } from './context.js';
import { formatBytes } from './utils.js';

/** Only send a progress message every N ms so we never flood the client. */
const THROTTLE_MS = 5_000;

export interface ProgressReporter {
  /** Report incremental progress.  `total` may be 0 if unknown. */
  update(current: number, total: number, detail?: string): void;
  /** Send a final completion message (always sent, bypasses throttle). */
  done(message: string): void;
}

export function createProgress(label: string): ProgressReporter {
  const ctx = currentRequest();
  let lastSentAt = 0;
  let lastProgress = -1;
  let lastTotal = 0;

  function emit(current: number, total: number, message: string): void {
    console.error(`[storj-mcp] ${message}`);
    if (ctx?.progressToken === undefined) return;

    // The spec requires `progress` to increase with every notification, even
    // when the total is unknown (e.g. "listing…" ticks that report 0 of 0).
    const progress = Math.max(current, lastProgress + 1);
    lastProgress = progress;
    if (total > 0) lastTotal = Math.max(total, progress);

    ctx
      .sendNotification({
        method: 'notifications/progress',
        params: { progressToken: ctx.progressToken, progress, ...(lastTotal > 0 ? { total: lastTotal } : {}), message },
      })
      .catch(() => {}); // never let a notification failure break a tool
  }

  return {
    update(current, total, detail) {
      const now = Date.now();
      if (now - lastSentAt < THROTTLE_MS) return;
      lastSentAt = now;

      const body = total > 0
        ? `${formatBytes(current)} / ${formatBytes(total)} (${Math.round((current / total) * 100)}%)`
        : `${formatBytes(current)} so far…`;
      const suffix = detail ? ` — ${detail}` : '';
      emit(current, total, `⏳ ${label}: ${body}${suffix}`);
    },

    done(message) {
      // Final notification lands on the total when one was reported.
      emit(Math.max(lastTotal, lastProgress + 1), lastTotal, `✅ ${message}`);
    },
  };
}
