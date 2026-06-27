import { z } from 'zod';
import { listMultipartUploads, MultipartUpload } from 'storj-uplink-nodejs';
import { getProject } from '../auth.js';
import { ok, safeCall, formatTimestamp, type McpTextResponse } from '../utils.js';
import { createProgress } from '../progress.js';
import { bucketField, keyField } from './schemas.js';

// ---------------------------------------------------------------------------
// Multipart upload housekeeping.
//
// Incomplete multipart uploads are invisible to list_objects but still consume
// storage (and therefore cost money) until they are committed or aborted.
// These two tools let a user find and clean them up.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// list_multipart_uploads — show pending (incomplete) multipart uploads
// ---------------------------------------------------------------------------

export const listMultipartUploadsSchema = z.object({
  bucket: bucketField,
  prefix: z.string().optional().describe('Only list pending uploads whose key starts with this prefix'),
});

export function listPendingUploads(
  args: z.infer<typeof listMultipartUploadsSchema>,
): Promise<McpTextResponse> {
  return safeCall(async () => {
    const project = await getProject();
    const uploads = await listMultipartUploads(project._nativeHandle, args.bucket, {
      prefix: args.prefix ?? '',
      recursive: true,
      system: true,
      custom: false,
    });

    const pending = uploads.filter((u) => !u.isPrefix);
    if (pending.length === 0) {
      return ok(`No pending multipart uploads in "${args.bucket}"${args.prefix ? `/${args.prefix}` : ''}.`);
    }

    const rows = pending.map(
      (u) => `  - ${u.key}\n      upload_id: ${u.uploadId}\n      started:   ${formatTimestamp(u.system.created)}`,
    );
    return ok(
      `Pending multipart uploads in "${args.bucket}" (${pending.length}):\n` +
        `These are incomplete uploads still consuming storage — abort them with abort_multipart_upload.\n\n` +
        rows.join('\n'),
    );
  });
}

// ---------------------------------------------------------------------------
// abort_multipart_upload — discard one incomplete multipart upload
// ---------------------------------------------------------------------------

export const abortMultipartUploadSchema = z.object({
  bucket: bucketField,
  key: keyField.describe('Object key of the incomplete upload'),
  upload_id: z.string().min(1).describe('Upload ID from list_multipart_uploads'),
});

export function abortMultipartUpload(
  args: z.infer<typeof abortMultipartUploadSchema>,
): Promise<McpTextResponse> {
  return safeCall(async () => {
    const project = await getProject();
    const progress = createProgress(`Aborting multipart upload "${args.key}"`);
    progress.update(0, 0, 'aborting…');

    const upload = new MultipartUpload(project._nativeHandle, args.bucket, args.key, args.upload_id);
    await upload.abort();

    progress.done(`Aborted multipart upload "${args.key}"`);
    return ok(`Aborted incomplete multipart upload "${args.bucket}/${args.key}" (upload_id: ${args.upload_id}).`);
  });
}
