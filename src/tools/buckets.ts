import { z } from 'zod';
import { defineTool } from '../registry.js';
import { getProject } from '../auth.js';
import { ok, safeCall, formatBytes, formatTimestamp, type McpTextResponse } from '../utils.js';
import { createProgress } from '../progress.js';
import { bucketField } from './schemas.js';
import { matchGlob } from './glob.js';
import { runBatch, formatBatchReport } from './batch.js';
import type { ProjectResultStruct } from 'storj-uplink-nodejs';

/**
 * Resolve which bucket names to target from the user-supplied filters.
 * Returns the matched names sorted alphabetically.
 */
async function resolveBucketNames(
  project: ProjectResultStruct,
  names?: string[],
  pattern?: string,
): Promise<string[]> {
  // Explicit list — return as-is (no need to list all buckets)
  if (names && names.length > 0) return [...names];

  // Pattern — list all buckets and filter
  if (pattern) {
    const all = await project.listBuckets();
    return all.map((b) => b.name).filter((n) => matchGlob(n, pattern)).sort();
  }

  // Neither — delete ALL buckets
  const all = await project.listBuckets();
  return all.map((b) => b.name).sort();
}

/** Delete a bucket, optionally emptying it first. Shared by the single and batch tools. */
function deleteOneBucket(
  project: ProjectResultStruct,
  name: string,
  withObjects: boolean,
): Promise<void> {
  return withObjects ? project.deleteBucketWithObjects(name) : project.deleteBucket(name);
}

// ---------------------------------------------------------------------------
// list_buckets
// ---------------------------------------------------------------------------

export const listBucketsSchema = z.object({});

export function listBuckets(): Promise<McpTextResponse> {
  return safeCall(async () => {
    const project = await getProject();
    const buckets = await project.listBuckets();
    if (buckets.length === 0) {
      return ok('No buckets found in this project.');
    }
    const rows = buckets.map((b) => `  - ${b.name}  (created: ${formatTimestamp(b.created)})`);
    return ok(`Buckets (${buckets.length}):\n${rows.join('\n')}`);
  });
}

// ---------------------------------------------------------------------------
// create_bucket
// ---------------------------------------------------------------------------

export const createBucketSchema = z.object({
  name: z.string().min(1).describe('Bucket name (3-63 lowercase alphanumeric characters and hyphens)'),
});

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

export const statBucketSchema = z.object({
  name: bucketField.describe('Name of the bucket to inspect'),
});

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

export const bucketUsageSchema = z.object({
  bucket: bucketField,
  prefix: z
    .string()
    .optional()
    .describe('Limit the calculation to objects under this prefix, e.g. "logs/2024/". Omit for the whole bucket.'),
});

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

export const deleteBucketSchema = z.object({
  name: bucketField.describe('Name of the bucket to delete'),
  with_objects: z
    .boolean()
    .optional()
    .describe('If true, delete the bucket and all its objects. Default: false (bucket must be empty)'),
});

export function deleteBucket(
  args: z.infer<typeof deleteBucketSchema>,
): Promise<McpTextResponse> {
  return safeCall(async () => {
    const project = await getProject();
    if (args.with_objects) {
      const progress = createProgress(`Deleting bucket "${args.name}" with all objects`);
      progress.update(0, 0, 'deleting objects…');
      await deleteOneBucket(project, args.name, true);
      progress.done(`Bucket "${args.name}" and all its objects have been deleted`);
      return ok(`Bucket "${args.name}" and all its objects have been deleted.`);
    }
    await deleteOneBucket(project, args.name, false);
    return ok(`Bucket "${args.name}" has been deleted.`);
  });
}

// ---------------------------------------------------------------------------
// delete_buckets — batch delete multiple buckets by list or pattern
// ---------------------------------------------------------------------------

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

export function deleteBuckets(
  args: z.infer<typeof deleteBucketsSchema>,
): Promise<McpTextResponse> {
  return safeCall(async () => {
    // Safety: if no names and no pattern → deleting ALL buckets, require explicit confirm
    if (!args.names?.length && !args.pattern && !args.confirm_all) {
      return ok(
        'WARNING: No names or pattern specified — this would delete ALL buckets. ' +
        'Set confirm_all=true to proceed, or provide names or a pattern.',
      );
    }

    const project = await getProject();
    const targets = await resolveBucketNames(project, args.names, args.pattern);

    if (targets.length === 0) {
      return ok(
        args.pattern
          ? `No buckets matched the pattern "${args.pattern}".`
          : 'No buckets found to delete.',
      );
    }

    const result = await runBatch(targets, {
      label: `Deleting ${targets.length} bucket(s)`,
      verb: 'deleting',
      itemName: (name) => name,
      op: (name) => deleteOneBucket(project, name, args.with_objects ?? false),
      done: (r) => `Deleted ${r.succeeded.length}/${r.total} bucket(s)`,
    });

    return ok(formatBatchReport(result, {
      header: `Deleted ${result.succeeded.length} of ${result.total} bucket(s):`,
      successLabel: '✅ Deleted:',
    }));
  });
}

// ---------------------------------------------------------------------------
// Tool registry for this module (see registry.ts)
// ---------------------------------------------------------------------------

export const tools = [
  defineTool({
    name: 'list_buckets',
    description: 'List all buckets in your Storj project',
    schema: listBucketsSchema,
    handler: listBuckets,
  }),
  defineTool({
    name: 'create_bucket',
    description: 'Create a new bucket in your Storj project (idempotent — safe to call if bucket already exists)',
    schema: createBucketSchema,
    handler: createBucket,
  }),
  defineTool({
    name: 'stat_bucket',
    description: 'Get information about a single Storj bucket (name and creation time). Useful to check whether a bucket exists.',
    schema: statBucketSchema,
    handler: statBucket,
  }),
  defineTool({
    name: 'bucket_usage',
    description: 'Summarize storage usage for a bucket (or a prefix): object count and total bytes stored. Like "du" for Storj.',
    schema: bucketUsageSchema,
    handler: bucketUsage,
  }),
  defineTool({
    name: 'delete_bucket',
    description: 'Delete a Storj bucket. By default the bucket must be empty; set with_objects=true to delete all contents too.',
    schema: deleteBucketSchema,
    handler: deleteBucket,
  }),
  defineTool({
    name: 'delete_buckets',
    description: 'Batch-delete multiple buckets by name list or glob pattern (e.g. "logs-*", "test-*"). Shows progress and reports per-bucket success/failure.',
    schema: deleteBucketsSchema,
    handler: deleteBuckets,
  }),
];
