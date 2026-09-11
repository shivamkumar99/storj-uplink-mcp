import type { z } from 'zod';
import { getProject } from '../../core/auth.js';
import { createProgress } from '../../core/progress.js';
import { ok, safeCall, type McpTextResponse } from '../../lib/response.js';
import { formatBytes } from '../../lib/format.js';
import { sanitizeOutput } from '../../lib/sanitize.js';
import { MAX_PEEK_LINES, TAIL_SCAN_BYTES } from './constants.js';
import { drainChunked, fmtLineNo, LISTING_HEADER } from './stream.js';
import type { peekObjectTailSchema } from './schema.js';

// ---------------------------------------------------------------------------
// peek_object_tail — last N lines
// ---------------------------------------------------------------------------

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
    const footer = `(showing last ${result.length} lines — file is ${formatBytes(totalSize)})`;

    const body = result
      .map((l, i) => `${fmtLineNo(i + 1, offset > 0)} │ ${sanitizeOutput(l)}`)
      .join('\n');

    return ok(`TAIL "${args.bucket}/${args.key}" ${footer}:\n\n${LISTING_HEADER}${body}`);
  });
}
