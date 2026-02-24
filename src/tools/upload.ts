import fs from 'node:fs';
import { z } from 'zod';
import { getProject } from '../auth.js';
import { ok, errorResponse, formatBytes, type McpTextResponse } from '../utils.js';

// ---------------------------------------------------------------------------
// upload_text — upload a string/text as an object
// ---------------------------------------------------------------------------

export const uploadTextSchema = z.object({
  bucket: z.string().min(1).describe('Bucket name'),
  key: z.string().min(1).describe('Object key (path), e.g. "notes/hello.txt"'),
  content: z.string().describe('Text content to upload'),
  metadata: z.record(z.string()).optional().describe('Optional custom metadata key-value pairs'),
});

export async function uploadText(
  args: z.infer<typeof uploadTextSchema>,
): Promise<McpTextResponse> {
  try {
    const project = await getProject();
    const data = Buffer.from(args.content, 'utf8');

    const upload = await project.uploadObject(args.bucket, args.key);
    try {
      if (args.metadata) {
        await upload.setCustomMetadata(args.metadata);
      }
      await upload.write(data, data.length);
      await upload.commit();
    } catch (err) {
      await upload.abort();
      throw err;
    }

    return ok(
      `Uploaded "${args.key}" to bucket "${args.bucket}" (${formatBytes(data.length)})`,
    );
  } catch (err) {
    return errorResponse(err);
  }
}

// ---------------------------------------------------------------------------
// upload_file — read a local file and upload it to Storj
// ---------------------------------------------------------------------------

export const uploadFileSchema = z.object({
  bucket: z.string().min(1).describe('Bucket name'),
  key: z.string().min(1).describe('Object key (path) on Storj, e.g. "backups/photo.jpg"'),
  file_path: z.string().min(1).describe('Absolute or relative path to the local file to upload'),
  metadata: z.record(z.string()).optional().describe('Optional custom metadata key-value pairs'),
});

export async function uploadFile(
  args: z.infer<typeof uploadFileSchema>,
): Promise<McpTextResponse> {
  try {
    if (!fs.existsSync(args.file_path)) {
      return errorResponse(new Error(`File not found: ${args.file_path}`));
    }

    const data = fs.readFileSync(args.file_path);
    const project = await getProject();

    const upload = await project.uploadObject(args.bucket, args.key);
    try {
      if (args.metadata) {
        await upload.setCustomMetadata(args.metadata);
      }

      // Write in 1 MB chunks to handle large files
      const CHUNK = 1024 * 1024;
      let offset = 0;
      while (offset < data.length) {
        const end = Math.min(offset + CHUNK, data.length);
        const chunk = data.subarray(offset, end);
        await upload.write(chunk, chunk.length);
        offset = end;
      }
      await upload.commit();
    } catch (err) {
      await upload.abort();
      throw err;
    }

    return ok(
      `Uploaded "${args.file_path}" → "${args.bucket}/${args.key}" (${formatBytes(data.length)})`,
    );
  } catch (err) {
    return errorResponse(err);
  }
}
