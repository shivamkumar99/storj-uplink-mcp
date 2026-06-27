import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { getProject } from '../auth.js';
import { ok, safeCall, formatBytes, validateFilePath, resolveWithinDir, sanitizeOutput, type McpTextResponse } from '../utils.js';
import { createProgress, type ProgressReporter } from '../progress.js';
import { bucketField, keyField, chunkSizeField, DEFAULT_DOWNLOAD_CHUNK } from './schemas.js';
import type { ProjectResultStruct, DownloadResultStruct } from 'storj-uplink-nodejs';

// ---------------------------------------------------------------------------
// drainDownload — read a Storj download handle chunk-by-chunk.
//
// Calls onChunk(buf, bytesRead) for every non-empty block, then closes the
// handle (in its finally block, so cleanup always happens).
//
// The Storj SDK signals EOF by *throwing* an error that has a `bytesRead`
// property attached.  This helper encapsulates that quirk so neither readAll
// nor downloadToFile ever has to deal with it directly.
//
// If a ProgressReporter is provided, it receives update() calls with the
// running byte total after every chunk.
// ---------------------------------------------------------------------------

async function drainDownload(
  download: DownloadResultStruct,
  onChunk: (buf: Buffer, bytesRead: number) => void,
  progress?: ProgressReporter,
  totalSize?: number,
  readChunk: number = DEFAULT_DOWNLOAD_CHUNK,
): Promise<number> {
  const buf = Buffer.alloc(readChunk);
  let downloaded = 0;
  try {
    while (true) {
      let bytesRead: number;
      try {
        ({ bytesRead } = await download.read(buf, readChunk));
      } catch (err: unknown) {
        // EOF arrives as a thrown error with an optional bytesRead property
        const e = err as Record<string, unknown>;
        bytesRead = typeof e['bytesRead'] === 'number' ? (e['bytesRead'] as number) : 0;
      }
      if (bytesRead > 0) {
        onChunk(buf, bytesRead);
        downloaded += bytesRead;
        if (progress) progress.update(downloaded, totalSize ?? 0);
      }
      if (bytesRead < readChunk) break;
    }
  } finally {
    await download.close();
  }
  return downloaded;
}

// ---------------------------------------------------------------------------
// readAll — accumulate all bytes into a Buffer (used only by downloadText)
//
// Intentionally in-memory: downloadText must return the full file content as
// a string, so there is no way to avoid holding it in RAM.
// ---------------------------------------------------------------------------

async function readAll(
  project: ProjectResultStruct,
  bucket: string,
  key: string,
  chunkSize: number = DEFAULT_DOWNLOAD_CHUNK,
): Promise<Buffer> {
  const progress = createProgress(`Downloading "${key}" (chunk ${formatBytes(chunkSize)})`);
  // Get content length from object info for progress percentage
  const info = await project.statObject(bucket, key);
  const totalSize = info.system.contentLength;
  const download = await project.downloadObject(bucket, key);
  const chunks: Buffer[] = [];
  const downloaded = await drainDownload(
    download,
    (buf, n) => chunks.push(Buffer.from(buf.subarray(0, n))),
    progress,
    totalSize,
    chunkSize,
  );
  progress.done(`Downloaded "${key}" (${formatBytes(downloaded)})`);
  return Buffer.concat(chunks);
}

// ---------------------------------------------------------------------------
// downloadToFile — stream directly to disk, one READ_CHUNK at a time.
//
// Each chunk is written to an open file descriptor immediately after it is
// read from Storj — only READ_CHUNK bytes are ever in RAM.  The fd is closed
// in this function's finally; drainDownload closes the download handle in its
// own finally, so both resources are always cleaned up regardless of errors.
// ---------------------------------------------------------------------------

async function downloadToFile(
  project: ProjectResultStruct,
  bucket: string,
  key: string,
  filePath: string,
  chunkSize: number = DEFAULT_DOWNLOAD_CHUNK,
): Promise<number> {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const progress = createProgress(`Downloading "${key}" (chunk ${formatBytes(chunkSize)})`);
  // Get content length from object info for progress percentage
  const info = await project.statObject(bucket, key);
  const totalSize = info.system.contentLength;
  const download = await project.downloadObject(bucket, key);
  const fd = fs.openSync(filePath, 'w');
  let totalBytes = 0;
  try {
    totalBytes = await drainDownload(
      download,
      (buf, n) => { fs.writeSync(fd, buf, 0, n); },
      progress,
      totalSize,
      chunkSize,
    );
  } finally {
    fs.closeSync(fd);
  }
  progress.done(`Downloaded "${key}" → "${filePath}" (${formatBytes(totalBytes)})`);
  return totalBytes;
}

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

    const data = await readAll(project, args.bucket, args.key, args.chunk_size);
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
    const totalBytes = await downloadToFile(
      project, args.bucket, args.key, args.file_path, args.chunk_size,
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

    const progress = createProgress(`Downloading ${targets.length} object(s) from "${args.bucket}"`);
    const downloaded: string[] = [];
    const failed: Array<{ key: string; error: string }> = [];
    let totalBytes = 0;

    for (let i = 0; i < targets.length; i++) {
      const key = targets[i];
      // Strip the prefix so local layout mirrors the prefix root
      const rel = prefix && key.startsWith(prefix) ? key.slice(prefix.length) : key;
      progress.update(i, targets.length, `downloading "${key}"…`);
      try {
        const dest = resolveWithinDir(args.dest_dir, rel); // Zip-Slip guard
        validateFilePath(dest);                            // defence in depth
        const bytes = await downloadToFile(project, args.bucket, key, dest, args.chunk_size);
        totalBytes += bytes;
        downloaded.push(key);
      } catch (err: unknown) {
        failed.push({ key, error: err instanceof Error ? err.message : String(err) });
      }
    }

    progress.done(`Downloaded ${downloaded.length}/${targets.length} object(s) (${formatBytes(totalBytes)})`);

    const lines: string[] = [];
    lines.push(`Downloaded ${downloaded.length} of ${targets.length} object(s) → "${args.dest_dir}" (${formatBytes(totalBytes)}):`);
    if (capped) {
      lines.push('');
      lines.push(`⚠️  More than ${MAX_PREFIX_OBJECTS} objects matched — only the first ${MAX_PREFIX_OBJECTS} were downloaded.`);
    }
    if (failed.length > 0) {
      lines.push('');
      lines.push('❌ Failed:');
      for (const f of failed) lines.push(`  - ${f.key}: ${f.error}`);
    }
    return ok(lines.join('\n'));
  });
}
