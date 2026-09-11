import type { z } from 'zod';
import { getProject } from '../../core/auth.js';
import { createProgress } from '../../core/progress.js';
import { ok, okStructured, safeCall, type McpTextResponse } from '../../lib/response.js';
import { formatBytes, formatTimestamp } from '../../lib/format.js';
import type { listBucketsSchema, createBucketSchema, statBucketSchema, bucketUsageSchema, deleteBucketSchema } from './schema.js';
import type { ListBucketsResult } from './output.js';

// ---------------------------------------------------------------------------
// list_buckets
// ---------------------------------------------------------------------------

export function listBuckets(
  args: z.infer<typeof listBucketsSchema> = {},
): Promise<McpTextResponse> {
  return safeCall(async () => {
    const project = await getProject();
    const buckets = await project.listBuckets(); // Storj's own order: by name
    // Only re-order when asked; ties keep Storj's name order (sort is stable).
    if (args.sort_by === 'created') buckets.sort((a, b) => a.created - b.created);

    // Structured result for clients and the browser view (bucket names are user-chosen, not untrusted).
    const structured: ListBucketsResult = {
      buckets: buckets.map((b) => ({ name: b.name, created: formatTimestamp(b.created) })),
    };
    if (buckets.length === 0) {
      return okStructured('No buckets found in this project.', structured);
    }
    const rows = structured.buckets.map((b) => `  - ${b.name}  (created: ${b.created})`);
    return okStructured(`Buckets (${buckets.length}):\n${rows.join('\n')}`, structured);
  });
}

// ---------------------------------------------------------------------------
// create_bucket
// ---------------------------------------------------------------------------

export function createBucket(
  args: z.infer<typeof createBucketSchema>,
): Promise<McpTextResponse> {
  return safeCall(async () => {
    const project = await getProject();
    const bucket = await project.ensureBucket(args.name);
    return ok(`Bucket "${bucket.name}" is ready (created: ${formatTimestamp(bucket.created)})`);
  });
}

// ---------------------------------------------------------------------------
// stat_bucket — get information about a single bucket
// ---------------------------------------------------------------------------

export function statBucket(
  args: z.infer<typeof statBucketSchema>,
): Promise<McpTextResponse> {
  return safeCall(async () => {
    const project = await getProject();
    const bucket = await project.statBucket(args.name);
    return ok({
      name: bucket.name,
      created: formatTimestamp(bucket.created),
    });
  });
}

// ---------------------------------------------------------------------------
// bucket_usage — du-style storage summary (object count + total bytes)
//
// Read-only.  Lists recursively and aggregates in memory.  No native
// "usage" call exists, so this composes on listObjects.
// ---------------------------------------------------------------------------

export function bucketUsage(
  args: z.infer<typeof bucketUsageSchema>,
): Promise<McpTextResponse> {
  return safeCall(async () => {
    const project = await getProject();
    const progress = createProgress(`Calculating usage for "${args.bucket}"`);
    progress.update(0, 0, 'listing objects…');

    const objects = await project.listObjects(args.bucket, {
      prefix: args.prefix ?? '',
      recursive: true,
      system: true,
      custom: false,
    });

    const files = objects.filter((o) => !o.isPrefix);
    const totalBytes = files.reduce((sum, o) => sum + o.system.contentLength, 0);
    progress.done(`Usage calculated for "${args.bucket}"`);

    const scope = args.prefix ? `${args.bucket}/${args.prefix}` : args.bucket;
    return ok({
      scope,
      object_count: files.length,
      total_size: formatBytes(totalBytes),
      total_size_bytes: totalBytes,
      average_size: files.length > 0 ? formatBytes(Math.round(totalBytes / files.length)) : '0 B',
    });
  });
}

// ---------------------------------------------------------------------------
// delete_bucket
// ---------------------------------------------------------------------------

export function deleteBucket(
  args: z.infer<typeof deleteBucketSchema>,
): Promise<McpTextResponse> {
  return safeCall(async () => {
    const project = await getProject();
    if (args.with_objects) {
      const progress = createProgress(`Deleting bucket "${args.name}" with all objects`);
      progress.update(0, 0, 'deleting objects…');
      await project.deleteBucketWithObjects(args.name);
      progress.done(`Bucket "${args.name}" and all its objects have been deleted`);
      return ok(`Bucket "${args.name}" and all its objects have been deleted.`);
    }
    await project.deleteBucket(args.name);
    return ok(`Bucket "${args.name}" has been deleted.`);
  });
}
