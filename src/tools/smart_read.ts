import { z } from 'zod';
import { getProject } from '../auth.js';
import { ok, safeCall, formatBytes, sanitizeOutput, type McpTextResponse } from '../utils.js';
import { createProgress } from '../progress.js';
import { bucketField, keyField } from './schemas.js';
import type { DownloadResultStruct } from 'storj-uplink-nodejs';

// ---------------------------------------------------------------------------
// Constants — all tuned to protect the AI context window
// ---------------------------------------------------------------------------

/** Read buffer for streaming line-based operations */
const LINE_CHUNK = 64 * 1024; // 64 KB per read

/** How many bytes before EOF we start reading for peek_tail.
 *  512 KB comfortably covers 200 typical log lines even with long lines. */
const TAIL_SCAN_BYTES = 512 * 1024;

/** Hard cap on lines returned by peek_head / peek_tail */
const MAX_PEEK_LINES = 500;

/** Hard cap on matching lines returned by grep_object */
const MAX_GREP_MATCHES = 200;

// ---------------------------------------------------------------------------
// drainChunked — stream a Storj download handle in LINE_CHUNK-sized pieces.
//
// Calls onChunk(slice) for every non-empty block.
// Returning false from onChunk aborts the loop early (used by peek_head and grep).
// Always closes the download handle whether we finish or abort.
// ---------------------------------------------------------------------------

async function drainChunked(
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
        bytesRead = typeof e['bytesRead'] === 'number' ? (e['bytesRead'] as number) : 0;
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

// ---------------------------------------------------------------------------
// splitLines — split incoming text keeping the incomplete trailing fragment.
//
// When a 64 KB chunk boundary falls mid-line the last partial line must be
// carried forward and prepended to the next chunk.  This helper does that.
// ---------------------------------------------------------------------------

function splitLines(
  leftover: string,
  incoming: string,
): { lines: string[]; leftover: string } {
  const combined = leftover + incoming;
  const parts = combined.split('\n');
  const newLeftover = parts.pop() ?? ''; // always the incomplete tail
  return { lines: parts, leftover: newLeftover };
}

// ---------------------------------------------------------------------------
// formatLineNumber — right-align a line number in a fixed column
// ---------------------------------------------------------------------------

function fmtLineNo(n: number, approx = false): string {
  return `${approx ? '~' : ' '}${String(n).padStart(6, ' ')}`;
}

// ===========================================================================
// peek_object_head — first N lines
// ===========================================================================

export const peekObjectHeadSchema = z.object({
  bucket: bucketField,
  key:    keyField.describe('Object key to inspect'),
  lines:  z
    .number().int().min(1).max(MAX_PEEK_LINES)
    .default(20)
    .describe(
      `How many lines to return from the start of the file. ` +
      `Default 20, max ${MAX_PEEK_LINES}. ` +
      `Great for CSV headers, JSON structure, config files.`,
    ),
});

export function peekObjectHead(
  args: z.infer<typeof peekObjectHeadSchema>,
): Promise<McpTextResponse> {
  return safeCall(async () => {
    const project  = await getProject();
    const wantLines = Math.min(args.lines, MAX_PEEK_LINES);

    // Stat to know the total size (shown in output footer)
    const info = await project.statObject(args.bucket, args.key);
    const totalSize = info.system.contentLength;

    if (totalSize === 0) {
      return ok(`"${args.bucket}/${args.key}" is empty.`);
    }

    const progress = createProgress(`Reading head of "${args.key}"`);

    // Cap the download to TAIL_SCAN_BYTES so we never pull more than needed
    const fetchBytes = Math.min(totalSize, TAIL_SCAN_BYTES);
    const download = await project.downloadObject(args.bucket, args.key, {
      offset: 0,
      length: fetchBytes,
    });

    const collected: string[] = [];
    let leftover = '';

    await drainChunked(download, (chunk) => {
      const { lines, leftover: lo } = splitLines(leftover, chunk.toString('utf8'));
      leftover = lo;
      for (const line of lines) {
        collected.push(line);
        if (collected.length >= wantLines) return false; // abort stream early
      }
      return true;
    });

    // Flush leftover text that had no trailing newline
    if (leftover.length > 0 && collected.length < wantLines) {
      collected.push(leftover);
    }

    const result = collected.slice(0, wantLines);
    progress.done(`Read ${result.length} lines from head of "${args.key}"`);

    const footer =
      result.length < wantLines
        ? `(file has ${result.length} line${result.length === 1 ? '' : 's'} total)`
        : `(showing first ${result.length} lines — file is ${formatBytes(totalSize)})`;

    const body = result
      .map((l, i) => `${fmtLineNo(i + 1)} │ ${sanitizeOutput(l)}`)
      .join('\n');

    return ok(
      `HEAD "${args.bucket}/${args.key}" ${footer}:\n\n` +
      `${'       │ line content'}\n` +
      `${'───────┼' + '─'.repeat(60)}\n` +
      body,
    );
  });
}

// ===========================================================================
// peek_object_tail — last N lines
// ===========================================================================

export const peekObjectTailSchema = z.object({
  bucket: bucketField,
  key:    keyField.describe('Object key to inspect'),
  lines:  z
    .number().int().min(1).max(MAX_PEEK_LINES)
    .default(20)
    .describe(
      `How many lines to return from the end of the file. ` +
      `Default 20, max ${MAX_PEEK_LINES}. ` +
      `Great for recent log entries, last rows of a CSV.`,
    ),
});

export function peekObjectTail(
  args: z.infer<typeof peekObjectTailSchema>,
): Promise<McpTextResponse> {
  return safeCall(async () => {
    const project   = await getProject();
    const wantLines = Math.min(args.lines, MAX_PEEK_LINES);

    const info = await project.statObject(args.bucket, args.key);
    const totalSize = info.system.contentLength;

    if (totalSize === 0) {
      return ok(`"${args.bucket}/${args.key}" is empty.`);
    }

    const progress = createProgress(`Reading tail of "${args.key}"`);

    // Only fetch the last TAIL_SCAN_BYTES — for a 10 GB log we skip 99.99% of the file
    const scanBytes = Math.min(totalSize, TAIL_SCAN_BYTES);
    const offset    = totalSize - scanBytes;

    const download = await project.downloadObject(args.bucket, args.key, {
      offset,
      length: scanBytes,
    });

    const chunks: Buffer[] = [];
    await drainChunked(download, (chunk) => {
      chunks.push(chunk);
      return true; // always read the full scan window
    });

    const text     = Buffer.concat(chunks).toString('utf8');
    const allLines = text.split('\n');

    // If we started mid-file the very first fragment is a partial line — discard it
    const lines = offset > 0 ? allLines.slice(1) : allLines;

    // Remove trailing empty string left by a final '\n'
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

    const result = lines.slice(-wantLines);
    progress.done(`Read ${result.length} lines from tail of "${args.key}"`);

    // Approximate absolute line numbers (we don't know how many lines preceded the scan window)
    const approxStartLine = offset > 0 ? '~' : '';
    const footer = `(showing last ${result.length} lines — file is ${formatBytes(totalSize)})`;

    const body = result
      .map((l, i) => `${fmtLineNo(i + 1, offset > 0)} │ ${sanitizeOutput(l)}`)
      .join('\n');

    return ok(
      `TAIL "${args.bucket}/${args.key}" ${footer}:\n\n` +
      `${'       │ line content'}\n` +
      `${'───────┼' + '─'.repeat(60)}\n` +
      body,
    );
  });
}

// ===========================================================================
// grep_object — streaming keyword search
// ===========================================================================

export const grepObjectSchema = z.object({
  bucket: bucketField,
  key:    keyField.describe('Object key to search through'),

  query: z
    .string().min(1).max(200)
    .describe('Text to search for. Case-insensitive substring match.'),

  context_lines: z
    .number().int().min(0).max(10)
    .default(0)
    .describe(
      'Number of surrounding lines to show around each match (like grep -C). ' +
      'Default 0. Max 10.',
    ),

  max_matches: z
    .number().int().min(1).max(MAX_GREP_MATCHES)
    .default(50)
    .describe(
      `Stop after this many matching lines. ` +
      `Default 50, max ${MAX_GREP_MATCHES}. ` +
      `Search aborts early to save bandwidth once the limit is hit.`,
    ),
});

export function grepObject(
  args: z.infer<typeof grepObjectSchema>,
): Promise<McpTextResponse> {
  return safeCall(async () => {
    const project     = await getProject();
    const maxMatches  = Math.min(args.max_matches, MAX_GREP_MATCHES);
    const ctxLines    = Math.min(args.context_lines, 10);
    const needle      = args.query.toLowerCase();

    const info = await project.statObject(args.bucket, args.key);
    const totalSize = info.system.contentLength;

    if (totalSize === 0) {
      return ok(`"${args.bucket}/${args.key}" is empty.`);
    }

    const progress = createProgress(`Searching "${args.key}" for "${args.query}"`);

    const download = await project.downloadObject(args.bucket, args.key, { offset: 0 });

    // ── rolling state ──────────────────────────────────────────────────────
    // pre-context:  ring buffer of the last `ctxLines` lines before current
    // post-context: countdown of lines still to emit after a match
    // results:      final ordered list — each entry knows whether it's a match
    // ───────────────────────────────────────────────────────────────────────
    interface ResultLine { lineNo: number; text: string; isMatch: boolean }

    const pre: Array<{ lineNo: number; text: string }> = [];
    const results: ResultLine[] = [];
    let leftover      = '';
    let lineNo        = 0;
    let pendingAfter  = 0;
    let matchCount    = 0;
    let truncated     = false;
    let bytesScanned  = 0;

    await drainChunked(download, (chunk) => {
      bytesScanned += chunk.length;
      const { lines, leftover: lo } = splitLines(leftover, chunk.toString('utf8'));
      leftover = lo;

      for (const text of lines) {
        lineNo++;
        const isMatch = text.toLowerCase().includes(needle);

        if (isMatch) {
          // Emit pre-context lines (avoid duplicating lines already in results)
          const alreadyEmitted = new Set(results.map((r) => r.lineNo));
          for (const prev of pre) {
            if (!alreadyEmitted.has(prev.lineNo)) {
              results.push({ lineNo: prev.lineNo, text: prev.text, isMatch: false });
            }
          }
          results.push({ lineNo, text, isMatch: true });
          matchCount++;
          pendingAfter = ctxLines;
        } else if (pendingAfter > 0) {
          results.push({ lineNo, text, isMatch: false });
          pendingAfter--;
        }

        // Maintain pre-context ring buffer
        pre.push({ lineNo, text });
        if (pre.length > ctxLines) pre.shift();

        if (matchCount >= maxMatches) {
          truncated = true;
          return false; // abort stream — we have enough
        }
      }
      return true;
    });

    // Flush last partial line (file with no trailing newline)
    if (leftover.length > 0) {
      lineNo++;
      const isMatch = leftover.toLowerCase().includes(needle);
      if (isMatch || pendingAfter > 0) {
        results.push({ lineNo, text: leftover, isMatch });
        if (isMatch) matchCount++;
      }
    }

    progress.done(
      `Found ${matchCount} match${matchCount === 1 ? '' : 'es'} in "${args.key}" ` +
      `(${formatBytes(bytesScanned)} scanned)`,
    );

    if (matchCount === 0) {
      return ok(
        `No matches for "${args.query}" in "${args.bucket}/${args.key}" ` +
        `(${formatBytes(bytesScanned)} scanned).`,
      );
    }

    // ── format output ──────────────────────────────────────────────────────
    // Match lines are prefixed with ► and their text highlighted by wrapping
    // the search term in «...» markers (pure text, works in any MCP client).
    // ───────────────────────────────────────────────────────────────────────
    function highlight(text: string): string {
      // Case-insensitive replace that preserves original casing
      const re = new RegExp(
        args.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        'gi',
      );
      return text.replace(re, (m) => `«${m}»`);
    }

    // Insert a separator between non-consecutive result blocks
    const lines: string[] = [];
    let prevLineNo = -2;
    for (const r of results) {
      if (r.lineNo > prevLineNo + 1 && prevLineNo !== -2) {
        lines.push(`${'─'.repeat(8)} ┼ ${'─'.repeat(52)}`);
      }
      const marker = r.isMatch ? '►' : ' ';
      const text   = r.isMatch ? highlight(sanitizeOutput(r.text)) : sanitizeOutput(r.text);
      lines.push(`${marker}${fmtLineNo(r.lineNo)} │ ${text}`);
      prevLineNo = r.lineNo;
    }

    const scannedNote = truncated
      ? `⚠  Stopped after ${maxMatches} matches — ${formatBytes(bytesScanned)} of ${formatBytes(totalSize)} scanned.`
      : `${matchCount} match${matchCount === 1 ? '' : 'es'} found — ${formatBytes(bytesScanned)} scanned (full file).`;

    return ok(
      `grep "${args.query}" in "${args.bucket}/${args.key}":\n\n` +
      `       │ line content\n` +
      `───────┼${'─'.repeat(60)}\n` +
      lines.join('\n') + '\n' +
      `───────┴${'─'.repeat(60)}\n` +
      scannedNote,
    );
  });
}
