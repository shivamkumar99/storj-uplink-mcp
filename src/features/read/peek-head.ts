import type { z } from 'zod';
import { getProject } from '../../core/auth.js';
import { createProgress } from '../../core/progress.js';
import { ok, safeCall, type McpTextResponse } from '../../lib/response.js';
import { formatBytes } from '../../lib/format.js';
import { sanitizeOutput } from '../../lib/sanitize.js';
import { MAX_PEEK_LINES, TAIL_SCAN_BYTES } from './constants.js';
import { drainChunked, splitLines, fmtLineNo, LISTING_HEADER } from './stream.js';
import type { peekObjectHeadSchema } from './schema.js';

// ---------------------------------------------------------------------------
// peek_object_head — first N lines
// ---------------------------------------------------------------------------

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

    const lineWord = result.length === 1 ? 'line' : 'lines';
    const footer =
      result.length < wantLines
        ? `(file has ${result.length} ${lineWord} total)`
        : `(showing first ${result.length} lines — file is ${formatBytes(totalSize)})`;

    const body = result
      .map((l, i) => `${fmtLineNo(i + 1)} │ ${sanitizeOutput(l)}`)
      .join('\n');

    return ok(`HEAD "${args.bucket}/${args.key}" ${footer}:\n\n${LISTING_HEADER}${body}`);
  });
}
