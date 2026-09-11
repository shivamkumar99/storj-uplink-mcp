import type { z } from 'zod';
import { listMultipartUploads, MultipartUpload } from 'storj-uplink-nodejs';
import { getProject } from '../../core/auth.js';
import { createProgress } from '../../core/progress.js';
import { ok, safeCall, type McpTextResponse } from '../../lib/response.js';
import { formatTimestamp, optionalPrefix } from '../../lib/format.js';
import { sanitizeOutput } from '../../lib/sanitize.js';
import type { listMultipartUploadsSchema, abortMultipartUploadSchema } from './schema.js';

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
      return ok(`No pending multipart uploads in "${args.bucket}"${optionalPrefix(args.prefix)}.`);
    }

    const rows = pending.map(
      (u) => `  - ${sanitizeOutput(u.key)}\n      upload_id: ${sanitizeOutput(u.uploadId)}\n      started:   ${formatTimestamp(u.system.created)}`,
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
