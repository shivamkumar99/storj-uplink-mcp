import type { ProjectResultStruct, DownloadResultStruct } from 'storj-uplink-nodejs';
import { createProgress } from '../core/progress.js';
import { throwIfCancelled } from '../core/context.js';
import { formatBytes } from '../lib/format.js';
import { DEFAULT_DOWNLOAD_CHUNK } from './constants.js';
import type { ObjectRef } from './types.js';
import type { ChunkSink } from './sinks.js';

// ---------------------------------------------------------------------------
// Download — Template Method.  The algorithm (stat for progress % → open →
// drain into the sink → close) is written once; the ChunkSink Strategy
// decides where the bytes go.
// ---------------------------------------------------------------------------

/** Returns the number of bytes received. */
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
      throwIfCancelled();
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
