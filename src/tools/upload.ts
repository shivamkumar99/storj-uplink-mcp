import fs from 'node:fs';
import { z } from 'zod';
import { getProject } from '../auth.js';
import { ok, safeCall, formatBytes, type McpTextResponse } from '../utils.js';
import { createProgress } from '../progress.js';
import { bucketField, metadataField, chunkSizeField, DEFAULT_UPLOAD_CHUNK } from './schemas.js';
import type { ProjectResultStruct, UploadResultStruct } from 'storj-uplink-nodejs';

// ---------------------------------------------------------------------------
// runUpload — owns the upload lifecycle: open → optional metadata → write → commit.
//
// Accepts a `writer` callback that performs the actual data writes.  On any
// error (from metadata, writer, or commit) the upload is aborted so partial
// objects are never left dangling on Storj.
//
// Both uploadFromBuffer and uploadFromFile delegate here — the commit /
// abort-on-error boilerplate lives in exactly one place.
// ---------------------------------------------------------------------------

async function runUpload(
  project: ProjectResultStruct,
  bucket: string,
  key: string,
  metadata: Record<string, string> | undefined,
  writer: (upload: UploadResultStruct) => Promise<void>,
): Promise<void> {
  const upload = await project.uploadObject(bucket, key);
  try {
    if (metadata) await upload.setCustomMetadata(metadata);
    await writer(upload);
    await upload.commit();
  } catch (err) {
    await upload.abort();
    throw err;
  }
}

// ---------------------------------------------------------------------------
// uploadFromBuffer — used by uploadText (data already fully in memory)
//
// Slices the buffer into CHUNK_SIZE pieces so native write calls stay bounded.
// ---------------------------------------------------------------------------

async function uploadFromBuffer(
  project: ProjectResultStruct,
  bucket: string,
  key: string,
  data: Buffer,
  metadata?: Record<string, string>,
  chunkSize: number = DEFAULT_UPLOAD_CHUNK,
): Promise<void> {
  const progress = createProgress(`Uploading "${key}" (chunk ${formatBytes(chunkSize)})`);
  await runUpload(project, bucket, key, metadata, async (upload) => {
    let offset = 0;
    while (offset < data.length) {
      const end = Math.min(offset + chunkSize, data.length);
      const chunk = data.subarray(offset, end);
      await upload.write(chunk, chunk.length);
      offset = end;
      progress.update(offset, data.length);
    }
  });
  progress.done(`Uploaded "${key}" (${formatBytes(data.length)})`);
}

// ---------------------------------------------------------------------------
// uploadFromFile — used by uploadFile (true streaming, no readFileSync)
//
// Uses fs.createReadStream so only one CHUNK_SIZE block is ever in RAM.
// GB-scale files do not cause OOM — process memory stays flat throughout.
// ---------------------------------------------------------------------------

async function uploadFromFile(
  project: ProjectResultStruct,
  bucket: string,
  key: string,
  filePath: string,
  metadata?: Record<string, string>,
  chunkSize: number = DEFAULT_UPLOAD_CHUNK,
): Promise<number> {
  // Get file size upfront for progress percentage
  const fileSize = fs.statSync(filePath).size;
  const progress = createProgress(`Uploading "${key}" (chunk ${formatBytes(chunkSize)})`);
  let totalBytes = 0;
  await runUpload(project, bucket, key, metadata, async (upload) => {
    for await (const chunk of fs.createReadStream(filePath, { highWaterMark: chunkSize })) {
      const buf = chunk as Buffer;
      await upload.write(buf, buf.length);
      totalBytes += buf.length;
      progress.update(totalBytes, fileSize);
    }
  });
  progress.done(`Uploaded "${key}" (${formatBytes(totalBytes)})`);
  return totalBytes;
}

// ---------------------------------------------------------------------------
// upload_text — upload a string/text as an object
// ---------------------------------------------------------------------------

export const uploadTextSchema = z.object({
  bucket: bucketField,
  key: z.string().min(1).describe('Object key (path), e.g. "notes/hello.txt"'),
  content: z.string().describe('Text content to upload'),
  metadata: metadataField,
  chunk_size: chunkSizeField,
});

export function uploadText(
  args: z.infer<typeof uploadTextSchema>,
): Promise<McpTextResponse> {
  return safeCall(async () => {
    const project = await getProject();
    const data = Buffer.from(args.content, 'utf8');
    await uploadFromBuffer(project, args.bucket, args.key, data, args.metadata, args.chunk_size);
    return ok(`Uploaded "${args.key}" to bucket "${args.bucket}" (${formatBytes(data.length)})`);
  });
}

// ---------------------------------------------------------------------------
// upload_file — stream a local file to Storj without loading it into RAM
// ---------------------------------------------------------------------------

export const uploadFileSchema = z.object({
  bucket: bucketField,
  key: z.string().min(1).describe('Object key (path) on Storj, e.g. "backups/photo.jpg"'),
  file_path: z.string().min(1).describe('Absolute or relative path to the local file to upload'),
  metadata: metadataField,
  chunk_size: chunkSizeField,
});

export function uploadFile(
  args: z.infer<typeof uploadFileSchema>,
): Promise<McpTextResponse> {
  return safeCall(async () => {
    const project = await getProject();
    const totalBytes = await uploadFromFile(
      project, args.bucket, args.key, args.file_path, args.metadata, args.chunk_size,
    );
    return ok(`Uploaded "${args.file_path}" → "${args.bucket}/${args.key}" (${formatBytes(totalBytes)})`);
  });
}
