import { z } from 'zod';
import { bucketField } from '../../shared/fields.js';

export const listBucketsSchema = z.object({});

export const createBucketSchema = z.object({
  name: z.string().min(1).describe('Bucket name (3-63 lowercase alphanumeric characters and hyphens)'),
});

export const statBucketSchema = z.object({
  name: bucketField.describe('Name of the bucket to inspect'),
});

export const bucketUsageSchema = z.object({
  bucket: bucketField,
  prefix: z
    .string()
    .optional()
    .describe('Limit the calculation to objects under this prefix, e.g. "logs/2024/". Omit for the whole bucket.'),
});

export const deleteBucketSchema = z.object({
  name: bucketField.describe('Name of the bucket to delete'),
  with_objects: z
    .boolean()
    .optional()
    .describe('If true, delete the bucket and all its objects. Default: false (bucket must be empty)'),
});

export const deleteBucketsSchema = z.object({
  names: z
    .array(z.string().min(1))
    .optional()
    .describe('Explicit list of bucket names to delete, e.g. ["logs-2024", "tmp-data"]'),
  pattern: z
    .string()
    .optional()
    .describe('Glob pattern to match bucket names, e.g. "logs-*", "test-??-*", "temp*". Supports * (any chars) and ? (single char)'),
  with_objects: z
    .boolean()
    .optional()
    .describe('If true, delete each bucket and all its objects. Default: false (buckets must be empty)'),
  confirm_all: z
    .boolean()
    .optional()
    .describe('Required when neither names nor pattern is provided (i.e. delete ALL buckets). Set to true to confirm.'),
});
