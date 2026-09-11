import type { z } from 'zod';
import { getProject } from '../../core/auth.js';
import { ok, safeCall, type McpTextResponse } from '../../lib/response.js';
import { formatBytes, expiryDate } from '../../lib/format.js';
import { validateFilePath } from '../../lib/paths.js';
import { uploadObject, type UploadOptions } from '../../transfer/upload.js';
import { bufferSource, fileSource } from '../../transfer/sources.js';
import type { uploadTextSchema, uploadFileSchema } from './schema.js';

// ---------------------------------------------------------------------------
// The upload algorithm itself (open → write → commit, abort-safe, with
// progress) lives in transfer/upload.ts.  Handlers only map tool arguments
// onto it and pick the data source: bufferSource for text, fileSource for files.
// ---------------------------------------------------------------------------

/** Map the shared upload tool arguments onto transfer options. */
export function uploadOptionsFrom(args: {
  metadata?: Record<string, string>;
  chunk_size?: number;
  expires_in_hours?: number;
}): UploadOptions {
  return {
    metadata: args.metadata,
    chunkSize: args.chunk_size,
    expires: expiryDate(args.expires_in_hours),
  };
}

// ---------------------------------------------------------------------------
// upload_text — upload a string/text as an object
// ---------------------------------------------------------------------------

export function uploadText(
  args: z.infer<typeof uploadTextSchema>,
): Promise<McpTextResponse> {
  return safeCall(async () => {
    const project = await getProject();
    const data = Buffer.from(args.content, 'utf8');
    await uploadObject(
      project, { bucket: args.bucket, key: args.key }, bufferSource(data), uploadOptionsFrom(args),
    );
    return ok(`Uploaded "${args.key}" to bucket "${args.bucket}" (${formatBytes(data.length)})`);
  });
}

// ---------------------------------------------------------------------------
// upload_file — stream a local file to Storj without loading it into RAM
// ---------------------------------------------------------------------------

export function uploadFile(
  args: z.infer<typeof uploadFileSchema>,
): Promise<McpTextResponse> {
  return safeCall(async () => {
    validateFilePath(args.file_path);
    const project = await getProject();
    const totalBytes = await uploadObject(
      project, { bucket: args.bucket, key: args.key }, fileSource(args.file_path), uploadOptionsFrom(args),
    );
    return ok(`Uploaded "${args.file_path}" → "${args.bucket}/${args.key}" (${formatBytes(totalBytes)})`);
  });
}
