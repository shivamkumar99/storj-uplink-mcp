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

// ---------------------------------------------------------------------------
// Transfer tuning
// ---------------------------------------------------------------------------

/** Default upload chunk size: 1 MB */
export const DEFAULT_UPLOAD_CHUNK = 1024 * 1024;

/** Default download read buffer: 64 KB */
export const DEFAULT_DOWNLOAD_CHUNK = 64 * 1024;

/** Minimum allowed chunk size: 4 KB */
const MIN_CHUNK = 4 * 1024;

/** Maximum allowed chunk size: 64 MB */
const MAX_CHUNK = 64 * 1024 * 1024;

export const chunkSizeField = z
  .number()
  .int()
  .min(MIN_CHUNK)
  .max(MAX_CHUNK)
  .optional()
  .describe(
    `Buffer/chunk size in bytes for the transfer. ` +
    `Larger values (e.g. 4194304 = 4 MB, 16777216 = 16 MB) improve throughput for big files. ` +
    `Min ${MIN_CHUNK / 1024} KB, max ${MAX_CHUNK / (1024 * 1024)} MB. ` +
    `Defaults to 1 MB for uploads and 64 KB for downloads if omitted.`,
  );
