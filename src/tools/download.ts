import { z } from 'zod';
import { getProject } from '../auth.js';
import { ok, safeCall, formatBytes, validateFilePath, resolveWithinDir, sanitizeOutput, type McpTextResponse } from '../utils.js';
import { bucketField, keyField, chunkSizeField } from './schemas.js';
import { downloadObject, memorySink, fileSink } from './transfer.js';
import { runBatch, formatBatchReport } from './batch.js';

// ---------------------------------------------------------------------------
// The download algorithm itself (stat → open → drain → close, with progress)
// lives in transfer.ts.  This file only maps tool arguments onto it and picks
// the destination: memorySink to return content, fileSink to write to disk.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// download_text — download object and return content as text
// ---------------------------------------------------------------------------

export const downloadTextSchema = z.object({
  bucket: bucketField,
  key: keyField.describe('Object key (path) to download'),
  chunk_size: chunkSizeField,
});

/** Maximum file size for download_text (50 MB) — prevents OOM and context flooding */
const MAX_DOWNLOAD_TEXT_BYTES = 50 * 1024 * 1024;

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

export const downloadFileSchema = z.object({
  bucket: bucketField,
  key: keyField.describe('Object key (path) on Storj'),
  file_path: z
    .string()
    .min(1)
    .describe('Local path where the file will be saved, e.g. "/tmp/photo.jpg"'),
  chunk_size: chunkSizeField,
});

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

// ---------------------------------------------------------------------------
// download_prefix — bulk-download every object under a prefix to a local dir
//
// Security:
//   • Object keys are untrusted (a shared bucket may contain hostile keys like
//     "../../etc/passwd").  resolveWithinDir enforces "Zip Slip" containment so
//     no file can be written outside dest_dir.
//   • validateFilePath additionally blocks sensitive targets within dest_dir.
//   • A hard cap (MAX_PREFIX_OBJECTS) bounds resource use.
// The prefix is stripped from each key so the local layout mirrors the prefix
// root rather than re-nesting it under dest_dir.
// ---------------------------------------------------------------------------

/** Maximum number of objects a single download_prefix call will transfer */
const MAX_PREFIX_OBJECTS = 5_000;

export const downloadPrefixSchema = z.object({
  bucket: bucketField,
  prefix: z
    .string()
    .optional()
    .describe('Download all objects under this prefix, e.g. "photos/2024/". Omit to download the whole bucket.'),
  dest_dir: z.string().min(1).describe('Local directory to save files into, e.g. "./restore"'),
  chunk_size: chunkSizeField,
});

export function downloadPrefix(
  args: z.infer<typeof downloadPrefixSchema>,
): Promise<McpTextResponse> {
  return safeCall(async () => {
    validateFilePath(args.dest_dir);
    const project = await getProject();
    const prefix = args.prefix ?? '';

    const objects = await project.listObjects(args.bucket, {
      prefix,
      recursive: true,
      system: false,
      custom: false,
    });
    const keys = objects.filter((o) => !o.isPrefix).map((o) => o.key);

    if (keys.length === 0) {
      return ok(`No objects found in "${args.bucket}"${prefix ? `/${prefix}` : ''}.`);
    }

    const capped = keys.length > MAX_PREFIX_OBJECTS;
    const targets = capped ? keys.slice(0, MAX_PREFIX_OBJECTS) : keys;

    const result = await runBatch(targets, {
      label: `Downloading ${targets.length} object(s) from "${args.bucket}"`,
      verb: 'downloading',
      itemName: (key) => key,
      op: async (key) => {
        // Strip the prefix so local layout mirrors the prefix root
        const rel = prefix && key.startsWith(prefix) ? key.slice(prefix.length) : key;
        const dest = resolveWithinDir(args.dest_dir, rel); // Zip-Slip guard
        validateFilePath(dest);                            // defence in depth
        return downloadObject(project, { bucket: args.bucket, key }, fileSink(dest), args.chunk_size);
      },
      done: (r) => `Downloaded ${r.succeeded.length}/${r.total} object(s) (${formatBytes(r.totalBytes)})`,
    });

    return ok(formatBatchReport(result, {
      header: `Downloaded ${result.succeeded.length} of ${result.total} object(s) → "${args.dest_dir}" (${formatBytes(result.totalBytes)}):`,
      notes: capped
        ? [`⚠️  More than ${MAX_PREFIX_OBJECTS} objects matched — only the first ${MAX_PREFIX_OBJECTS} were downloaded.`]
        : undefined,
    }));
  });
}
