import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { getProject } from '../auth.js';
import { ok, safeCall, formatBytes, type McpTextResponse } from '../utils.js';
import { bucketField, keyField } from './schemas.js';
import type { ProjectResultStruct, DownloadResultStruct } from 'storj-uplink-nodejs';

const READ_CHUNK = 64 * 1024; // 64 KB read buffer

// ---------------------------------------------------------------------------
// drainDownload — read a Storj download handle chunk-by-chunk.
//
// Calls onChunk(buf, bytesRead) for every non-empty block, then closes the
// handle (in its finally block, so cleanup always happens).
//
// The Storj SDK signals EOF by *throwing* an error that has a `bytesRead`
// property attached.  This helper encapsulates that quirk so neither readAll
// nor downloadToFile ever has to deal with it directly.
// ---------------------------------------------------------------------------

async function drainDownload(
  download: DownloadResultStruct,
  onChunk: (buf: Buffer, bytesRead: number) => void,
): Promise<void> {
  const buf = Buffer.alloc(READ_CHUNK);
  try {
    while (true) {
      let bytesRead: number;
      try {
        ({ bytesRead } = await download.read(buf, READ_CHUNK));
      } catch (err: unknown) {
        // EOF arrives as a thrown error with an optional bytesRead property
        const e = err as Record<string, unknown>;
        bytesRead = typeof e['bytesRead'] === 'number' ? (e['bytesRead'] as number) : 0;
      }
      if (bytesRead > 0) onChunk(buf, bytesRead);
      if (bytesRead < READ_CHUNK) break;
    }
  } finally {
    await download.close();
  }
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
): Promise<Buffer> {
  const download = await project.downloadObject(bucket, key);
  const chunks: Buffer[] = [];
  await drainDownload(download, (buf, n) => chunks.push(Buffer.from(buf.subarray(0, n))));
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
): Promise<number> {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const download = await project.downloadObject(bucket, key);
  const fd = fs.openSync(filePath, 'w');
  let totalBytes = 0;
  try {
    await drainDownload(download, (buf, n) => {
      fs.writeSync(fd, buf, 0, n);
      totalBytes += n;
    });
  } finally {
    fs.closeSync(fd);
  }
  return totalBytes;
}

// ---------------------------------------------------------------------------
// download_text — download object and return content as text
// ---------------------------------------------------------------------------

export const downloadTextSchema = z.object({
  bucket: bucketField,
  key: keyField.describe('Object key (path) to download'),
});

export function downloadText(
  args: z.infer<typeof downloadTextSchema>,
): Promise<McpTextResponse> {
  return safeCall(async () => {
    const project = await getProject();
    const data = await readAll(project, args.bucket, args.key);
    const text = data.toString('utf8');
    return ok(`Content of "${args.bucket}/${args.key}" (${formatBytes(data.length)}):\n\n${text}`);
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
});

export function downloadFile(
  args: z.infer<typeof downloadFileSchema>,
): Promise<McpTextResponse> {
  return safeCall(async () => {
    const project = await getProject();
    const totalBytes = await downloadToFile(project, args.bucket, args.key, args.file_path);
    return ok(
      `Downloaded "${args.bucket}/${args.key}" → "${args.file_path}" (${formatBytes(totalBytes)})`,
    );
  });
}
