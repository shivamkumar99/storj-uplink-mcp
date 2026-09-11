import type { ProjectResultStruct } from 'storj-uplink-nodejs';
import { createProgress } from '../core/progress.js';
import { throwIfCancelled } from '../core/context.js';
import { formatBytes } from '../lib/format.js';
import { DEFAULT_UPLOAD_CHUNK } from './constants.js';
import type { ObjectRef } from './types.js';
import type { ChunkSource } from './sources.js';

// ---------------------------------------------------------------------------
// Upload — Template Method.  The algorithm (open → optional metadata → stream
// chunks with progress → commit, abort-safe) is written once; the ChunkSource
// Strategy decides where the bytes come from.
// ---------------------------------------------------------------------------

export interface UploadOptions {
  metadata?: Record<string, string>;
  chunkSize?: number;
  expires?: Date;
}

/**
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
      throwIfCancelled();
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
