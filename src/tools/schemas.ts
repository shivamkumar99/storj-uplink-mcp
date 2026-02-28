import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared Zod field definitions
//
// Centralises the repeated z.string().min(1).describe(...) patterns that
// appeared verbatim across all tool schema files.  Import these instead of
// re-declaring the same validator + description every time.
// ---------------------------------------------------------------------------

export const bucketField = z.string().min(1).describe('Bucket name');

export const keyField = z.string().min(1).describe('Object key (path)');

export const srcBucketField = z.string().min(1).describe('Source bucket name');
export const srcKeyField = z.string().min(1).describe('Source object key');

export const dstBucketField = z.string().min(1).describe('Destination bucket name');
export const dstKeyField = z.string().min(1).describe('Destination object key');

export const metadataField = z
  .record(z.string())
  .optional()
  .describe('Optional custom metadata key-value pairs');
