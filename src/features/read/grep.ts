import type { z } from 'zod';
import { getProject } from '../../core/auth.js';
import { createProgress } from '../../core/progress.js';
import { ok, safeCall, type McpTextResponse } from '../../lib/response.js';
import { formatBytes } from '../../lib/format.js';
import { MAX_GREP_MATCHES, MAX_CONTEXT_LINES } from './constants.js';
import { LISTING_HEADER } from './stream.js';
import { scanForMatches, formatGrepLines } from './grep-scan.js';
import type { grepObjectSchema } from './schema.js';

// ---------------------------------------------------------------------------
// grep_object — streaming keyword search
// ---------------------------------------------------------------------------

export function grepObject(
  args: z.infer<typeof grepObjectSchema>,
): Promise<McpTextResponse> {
  return safeCall(async () => {
    const project    = await getProject();
    const maxMatches = Math.min(args.max_matches, MAX_GREP_MATCHES);
    const ctxLines   = Math.min(args.context_lines, MAX_CONTEXT_LINES);
    const needle     = args.query.toLowerCase();

    const info = await project.statObject(args.bucket, args.key);
    const totalSize = info.system.contentLength;

    if (totalSize === 0) {
      return ok(`"${args.bucket}/${args.key}" is empty.`);
    }

    const progress = createProgress(`Searching "${args.key}" for "${args.query}"`);
    const download = await project.downloadObject(args.bucket, args.key, { offset: 0 });
    const { results, matchCount, truncated, bytesScanned } =
      await scanForMatches(download, needle, ctxLines, maxMatches);

    const matchWord = matchCount === 1 ? 'match' : 'matches';
    progress.done(
      `Found ${matchCount} ${matchWord} in "${args.key}" (${formatBytes(bytesScanned)} scanned)`,
    );

    if (matchCount === 0) {
      return ok(
        `No matches for "${args.query}" in "${args.bucket}/${args.key}" ` +
        `(${formatBytes(bytesScanned)} scanned).`,
      );
    }

    const scannedNote = truncated
      ? `⚠  Stopped after ${maxMatches} matches — ${formatBytes(bytesScanned)} of ${formatBytes(totalSize)} scanned.`
      : `${matchCount} ${matchWord} found — ${formatBytes(bytesScanned)} scanned (full file).`;

    return ok(
      `grep "${args.query}" in "${args.bucket}/${args.key}":\n\n` +
      LISTING_HEADER +
      formatGrepLines(results, args.query).join('\n') + '\n' +
      `───────┴${'─'.repeat(60)}\n` +
      scannedNote,
    );
  });
}
