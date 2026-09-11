import type { z } from 'zod';
import { getProject } from '../../core/auth.js';
import { ok, safeCall, type McpTextResponse } from '../../lib/response.js';
import { formatBytes } from '../../lib/format.js';
import { sanitizeOutput } from '../../lib/sanitize.js';
import { validateFilePath } from '../../lib/paths.js';
import { downloadObject } from '../../transfer/download.js';
import { memorySink, fileSink } from '../../transfer/sinks.js';
import { MAX_DOWNLOAD_TEXT_BYTES } from './constants.js';
import type { downloadTextSchema, downloadFileSchema } from './schema.js';

// ---------------------------------------------------------------------------
// The download algorithm itself (stat → open → drain → close, with progress)
// lives in transfer/download.ts.  Handlers only map tool arguments onto it and
// pick the destination: memorySink to return content, fileSink to write to disk.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// download_text — download object and return content as text
// ---------------------------------------------------------------------------

export function downloadText(
  args: z.infer<typeof downloadTextSchema>,
): Promise<McpTextResponse> {
  return safeCall(async () => {
    const project = await getProject();

    // Check file size before downloading to prevent OOM
    const info = await project.statObject(args.bucket, args.key);
    const size = info.system.contentLength;
    if (size > MAX_DOWNLOAD_TEXT_BYTES) {
      return ok(
        `File "${args.bucket}/${args.key}" is ${formatBytes(size)} — too large for download_text ` +
        `(limit: ${formatBytes(MAX_DOWNLOAD_TEXT_BYTES)}).\n\n` +
        `Use download_file to save it to disk, or peek_object_head / peek_object_tail to inspect it.`,
      );
    }

    // Intentionally in-memory: the full content must be returned as a string.
    const sink = memorySink();
    await downloadObject(project, { bucket: args.bucket, key: args.key }, sink, args.chunk_size);
    const data = sink.result();
    const text = sanitizeOutput(data.toString('utf8'));
    return ok(
      `--- BEGIN FILE CONTENT: ${args.bucket}/${args.key} (${formatBytes(data.length)}) ---\n` +
      `${text}\n` +
      `--- END FILE CONTENT ---`,
    );
  });
}

// ---------------------------------------------------------------------------
// download_file — stream a Storj object to a local file without buffering
// ---------------------------------------------------------------------------

export function downloadFile(
  args: z.infer<typeof downloadFileSchema>,
): Promise<McpTextResponse> {
  return safeCall(async () => {
    validateFilePath(args.file_path);
    const project = await getProject();
    const totalBytes = await downloadObject(
      project, { bucket: args.bucket, key: args.key }, fileSink(args.file_path), args.chunk_size,
    );
    return ok(
      `Downloaded "${args.bucket}/${args.key}" → "${args.file_path}" (${formatBytes(totalBytes)})`,
    );
  });
}
