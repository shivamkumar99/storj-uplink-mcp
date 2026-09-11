import { defineTool, annotations } from '../../core/registry.js';
import { listMultipartUploadsSchema, abortMultipartUploadSchema } from './schema.js';
import { listPendingUploads, abortMultipartUpload } from './handlers.js';

export const tools = [
  defineTool({
    name: 'list_multipart_uploads',
    annotations: annotations.readOnly,
    description: 'List pending (incomplete) multipart uploads in a bucket. These are invisible to list_objects but still consume storage until aborted or committed.',
    schema: listMultipartUploadsSchema,
    handler: listPendingUploads,
  }),
  defineTool({
    name: 'abort_multipart_upload',
    annotations: annotations.deletes,
    description: 'Abort and discard one incomplete multipart upload (identified by key + upload_id from list_multipart_uploads), freeing the storage it holds.',
    schema: abortMultipartUploadSchema,
    handler: abortMultipartUpload,
  }),
];
