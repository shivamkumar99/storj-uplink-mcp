import { z } from 'zod';
import { MIN_CHUNK, MAX_CHUNK } from '../transfer/constants.js';

// ---------------------------------------------------------------------------
// Shared Zod field definitions
//
// Input fields used by more than one feature.  Feature-specific fields stay
// in that feature's schema.ts.  Import these instead of
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

export const expiresInHoursField = z
  .number()
  .positive()
  .optional()
  .describe('Auto-expire after this many hours (Storj deletes it automatically). Omit for no expiry.');

// ---------------------------------------------------------------------------
// Transfer tuning field (limits live in transfer/constants.ts)
// ---------------------------------------------------------------------------

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
