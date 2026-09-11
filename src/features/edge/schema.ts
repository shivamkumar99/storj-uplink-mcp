import { z } from 'zod';
import { bucketField, keyField, expiresInHoursField } from '../../shared/fields.js';

const regionField = z
  .enum(['US1', 'EU1', 'AP1'])
  .optional()
  .describe('Storj region for the edge service. Default: US1');

/** The allow_* flags shared by get_s3_credentials and share_access. */
const permissionFields = {
  allow_download: z.boolean().optional().describe('Allow downloading (GET) objects. Default: true'),
  allow_upload: z.boolean().optional().describe('Allow uploading (PUT) objects. Default: false'),
  allow_list: z.boolean().optional().describe('Allow listing objects. Default: true'),
  allow_delete: z.boolean().optional().describe('Allow deleting objects. Default: false'),
};

export const generateShareUrlSchema = z.object({
  bucket: bucketField,
  key: keyField,
  region: regionField,
  raw: z
    .boolean()
    .optional()
    .describe('If true, URL serves the file directly (for images, videos). Default: true'),
  expires_in_hours: expiresInHoursField.describe(
    'Make the share link stop working after this many hours. Omit for a link that never expires.',
  ),
});

export const getS3CredentialsSchema = z.object({
  bucket: bucketField.describe('Bucket the credentials may access'),
  prefix: z.string().optional().describe('Restrict access to objects under this prefix. Omit for the whole bucket.'),
  ...permissionFields,
  region: regionField.describe('Storj region for the edge auth service. Default: US1'),
  expires_in_hours: expiresInHoursField.describe(
    'Credentials stop working after this many hours. Strongly recommended. Omit for non-expiring credentials.',
  ),
});

export const shareAccessSchema = z.object({
  bucket: bucketField.describe('Bucket to grant access to'),
  prefix: z.string().optional().describe('Limit access to objects with this prefix. Omit for full bucket access'),
  ...permissionFields,
  expires_in_hours: expiresInHoursField.describe(
    'Access grant expires after this many hours. Omit for no expiry',
  ),
});

export const serializeAccessSchema = z.object({});
