import { z } from 'zod';
import { bucketField, keyField } from '../../shared/fields.js';

export const listMultipartUploadsSchema = z.object({
  bucket: bucketField,
  prefix: z.string().optional().describe('Only list pending uploads whose key starts with this prefix'),
});

export const abortMultipartUploadSchema = z.object({
  bucket: bucketField,
  key: keyField.describe('Object key of the incomplete upload'),
  upload_id: z.string().min(1).describe('Upload ID from list_multipart_uploads'),
});
