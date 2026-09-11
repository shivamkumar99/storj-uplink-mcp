import type { DownloadResultStruct } from 'storj-uplink-nodejs';
import { LINE_CHUNK } from './constants.js';

// ---------------------------------------------------------------------------
// Line-oriented streaming helpers shared by peek_head, peek_tail and grep.
// ---------------------------------------------------------------------------

/**
 * Stream a Storj download handle in LINE_CHUNK-sized pieces.
 *
 * Calls onChunk(slice) for every non-empty block.  Returning false from
 * onChunk aborts the loop early (used by peek_head and grep).  Always closes
 * the download handle whether we finish or abort.
 */
export async function drainChunked(
  download: DownloadResultStruct,
  onChunk: (slice: Buffer) => boolean,
): Promise<void> {
  const buf = Buffer.alloc(LINE_CHUNK);
  try {
    while (true) {
      let bytesRead: number;
      try {
        ({ bytesRead } = await download.read(buf, LINE_CHUNK));
      } catch (err: unknown) {
        // Storj SDK signals EOF by throwing — extract any partial bytes
        const e = err as Record<string, unknown>;
        bytesRead = typeof e['bytesRead'] === 'number' ? e['bytesRead'] : 0;
      }
      if (bytesRead > 0) {
        const shouldContinue = onChunk(Buffer.from(buf.subarray(0, bytesRead)));
        if (!shouldContinue) break;
      }
      if (bytesRead < LINE_CHUNK) break; // EOF
    }
  } finally {
    await download.close();
  }
}

/**
 * Split incoming text keeping the incomplete trailing fragment.
 *
 * When a chunk boundary falls mid-line the last partial line must be carried
 * forward and prepended to the next chunk.
 */
export function splitLines(
  leftover: string,
  incoming: string,
): { lines: string[]; leftover: string } {
  const combined = leftover + incoming;
  const parts = combined.split('\n');
  const newLeftover = parts.pop() ?? ''; // always the incomplete tail
  return { lines: parts, leftover: newLeftover };
}

/** Right-align a line number in a fixed column ("~" marks an approximate number). */
export function fmtLineNo(n: number, approx = false): string {
  return `${approx ? '~' : ' '}${String(n).padStart(6, ' ')}`;
}

/** Column header shared by every listing. */
export const LISTING_HEADER = `       │ line content\n───────┼${'─'.repeat(60)}\n`;
