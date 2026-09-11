import fs from 'node:fs';
import path from 'node:path';
import { createProgress } from '../progress.js';
import { formatBytes } from '../utils.js';
import { DEFAULT_UPLOAD_CHUNK, DEFAULT_DOWNLOAD_CHUNK } from './schemas.js';
import type { ProjectResultStruct, DownloadResultStruct } from 'storj-uplink-nodejs';

// ---------------------------------------------------------------------------
// Object transfer — Template Method + Strategy.
//
// The upload and download *algorithms* (open → move bytes with progress →
// commit/close, abort-safe) are written exactly once below.  What varies —
// where upload bytes come from and where download bytes go — is a small
// Strategy object:
//
//   ChunkSource  bufferSource(data) | fileSource(path)
//   ChunkSink    memorySink()       | fileSink(path)
//
// Previously upload.ts and download.ts each carried two near-identical copies
// of their algorithm differing only in that endpoint.
// ---------------------------------------------------------------------------

/** An object's location on Storj. */
export interface ObjectRef {
  bucket: string;
  key: string;
}

// ===========================================================================
// Upload
// ===========================================================================

/** Strategy: supplies the bytes to upload in bounded chunks. */
export interface ChunkSource {
  /** Total size in bytes, known upfront so progress can show a percentage. */
  readonly size: number;
  chunks(chunkSize: number): Iterable<Buffer> | AsyncIterable<Buffer>;
}

/** Data already fully in memory — sliced so each native write stays bounded. */
export function bufferSource(data: Buffer): ChunkSource {
  return {
    size: data.length,
    *chunks(chunkSize) {
      for (let offset = 0; offset < data.length; offset += chunkSize) {
        yield data.subarray(offset, Math.min(offset + chunkSize, data.length));
      }
    },
  };
}

/**
 * A local file, streamed with fs.createReadStream so only one chunk is ever
 * in RAM — GB-scale files do not grow process memory.
 */
export function fileSource(filePath: string): ChunkSource {
  return {
    size: fs.statSync(filePath).size,
    async *chunks(chunkSize) {
      for await (const chunk of fs.createReadStream(filePath, { highWaterMark: chunkSize })) {
        yield chunk as Buffer;
      }
    },
  };
}

export interface UploadOptions {
  metadata?: Record<string, string>;
  chunkSize?: number;
  expires?: Date;
}

/**
 * Upload template: open → optional metadata → stream chunks → commit.
 * On any error the upload is aborted so partial objects never linger on Storj.
 * Returns the number of bytes sent.
 */
export async function uploadObject(
  project: ProjectResultStruct,
  ref: ObjectRef,
  source: ChunkSource,
  opts: UploadOptions = {},
): Promise<number> {
  const chunkSize = opts.chunkSize ?? DEFAULT_UPLOAD_CHUNK;
  const progress = createProgress(`Uploading "${ref.key}" (chunk ${formatBytes(chunkSize)})`);
  const upload = await project.uploadObject(
    ref.bucket, ref.key, opts.expires ? { expires: opts.expires } : undefined,
  );

  let sent = 0;
  try {
    if (opts.metadata) await upload.setCustomMetadata(opts.metadata);
    for await (const chunk of source.chunks(chunkSize)) {
      await upload.write(chunk, chunk.length);
      sent += chunk.length;
      progress.update(sent, source.size);
    }
    await upload.commit();
  } catch (err) {
    await upload.abort();
    throw err;
  }

  progress.done(`Uploaded "${ref.key}" (${formatBytes(sent)})`);
  return sent;
}

// ===========================================================================
// Download
// ===========================================================================

/**
 * Strategy: receives downloaded bytes.  `open()` is called only after the
 * download handle is established, so a missing object never leaves an empty
 * file behind; `close()` always runs (finally).
 */
export interface ChunkSink {
  /** Shown in the completion message, e.g. the destination path. */
  readonly label?: string;
  open(): void;
  write(buf: Buffer, bytesRead: number): void;
  close(): void;
}

/** Accumulate everything in memory — for callers that need the full content. */
export function memorySink(): ChunkSink & { result(): Buffer } {
  const parts: Buffer[] = [];
  return {
    open() {},
    write(buf, n) { parts.push(Buffer.from(buf.subarray(0, n))); },
    close() {},
    result() { return Buffer.concat(parts); },
  };
}

/** Write straight to disk, one chunk at a time — only one chunk ever in RAM. */
export function fileSink(filePath: string): ChunkSink {
  let fd = -1;
  return {
    label: filePath,
    open() {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fd = fs.openSync(filePath, 'w');
    },
    write(buf, n) { fs.writeSync(fd, buf, 0, n); },
    close() { if (fd !== -1) fs.closeSync(fd); },
  };
}

/**
 * Download template: stat (for progress %) → open → drain into the sink → done.
 * Returns the number of bytes received.
 */
export async function downloadObject(
  project: ProjectResultStruct,
  ref: ObjectRef,
  sink: ChunkSink,
  chunkSize: number = DEFAULT_DOWNLOAD_CHUNK,
): Promise<number> {
  const progress = createProgress(`Downloading "${ref.key}" (chunk ${formatBytes(chunkSize)})`);
  const totalSize = (await project.statObject(ref.bucket, ref.key)).system.contentLength;
  const download = await project.downloadObject(ref.bucket, ref.key);

  sink.open();
  let received = 0;
  try {
    received = await drainDownload(download, chunkSize, (buf, n) => {
      sink.write(buf, n);
      received += n;
      progress.update(received, totalSize);
    });
  } finally {
    sink.close();
  }

  const dest = sink.label ? ` → "${sink.label}"` : '';
  progress.done(`Downloaded "${ref.key}"${dest} (${formatBytes(received)})`);
  return received;
}

/**
 * Read a download handle chunk-by-chunk until EOF, then close it.
 *
 * The Storj SDK signals EOF by *throwing* an error that carries a `bytesRead`
 * property.  That quirk is contained entirely here.
 */
async function drainDownload(
  download: DownloadResultStruct,
  chunkSize: number,
  onChunk: (buf: Buffer, bytesRead: number) => void,
): Promise<number> {
  const buf = Buffer.alloc(chunkSize);
  let downloaded = 0;
  try {
    while (true) {
      let bytesRead: number;
      try {
        ({ bytesRead } = await download.read(buf, chunkSize));
      } catch (err: unknown) {
        const e = err as Record<string, unknown>;
        bytesRead = typeof e['bytesRead'] === 'number' ? e['bytesRead'] : 0;
      }
      if (bytesRead > 0) {
        onChunk(buf, bytesRead);
        downloaded += bytesRead;
      }
      if (bytesRead < chunkSize) break;
    }
  } finally {
    await download.close();
  }
  return downloaded;
}
