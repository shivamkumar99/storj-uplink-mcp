import { z } from 'zod';
import {
  bucketField, keyField, srcBucketField, srcKeyField, dstBucketField, dstKeyField,
} from '../../shared/fields.js';

export const listObjectsSchema = z.object({
  bucket: bucketField,
  prefix: z.string().optional().describe('Filter objects by this prefix (e.g. "photos/")'),
  recursive: z.boolean().optional().describe('List all objects recursively. Default: false'),
});

export const statObjectSchema = z.object({
  bucket: bucketField,
  key: keyField,
});

export const deleteObjectSchema = z.object({
  bucket: bucketField,
  key: keyField.describe('Object key (path) to delete'),
});

export const copyObjectSchema = z.object({
  src_bucket: srcBucketField,
  src_key: srcKeyField,
  dst_bucket: dstBucketField,
  dst_key: dstKeyField,
});

export const moveObjectSchema = z.object({
  src_bucket: srcBucketField,
  src_key: srcKeyField,
  dst_bucket: dstBucketField,
  dst_key: dstKeyField,
});

export const updateMetadataSchema = z.object({
  bucket: bucketField,
  key: keyField,
  metadata: z.record(z.string()).describe('Key-value metadata pairs to set on the object'),
});

export const deleteObjectsSchema = z.object({
  bucket: bucketField,
  keys: z
    .array(z.string().min(1))
    .optional()
    .describe('Explicit list of object keys to delete, e.g. ["photos/a.jpg", "photos/b.jpg"]'),
  prefix: z
    .string()
    .optional()
    .describe('Delete all objects under this prefix, e.g. "logs/2024/" deletes all objects starting with that path'),
  pattern: z
    .string()
    .optional()
    .describe('Glob pattern to match object keys, e.g. "*.log", "photos/*.jpg", "data/**/temp-*". Supports * (within folder), ** (across folders), ? (single char)'),
  confirm_all: z
    .boolean()
    .optional()
    .describe('Required when neither keys, prefix, nor pattern is provided (i.e. delete ALL objects in the bucket). Set to true to confirm.'),
});
