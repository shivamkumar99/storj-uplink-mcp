import { z } from 'zod';
import { getProject } from '../auth.js';
import { ok, errorResponse, formatTimestamp, type McpTextResponse } from '../utils.js';

// ---------------------------------------------------------------------------
// list_buckets
// ---------------------------------------------------------------------------

export const listBucketsSchema = z.object({});

export async function listBuckets(): Promise<McpTextResponse> {
  try {
    const project = await getProject();
    const buckets = await project.listBuckets();
    if (buckets.length === 0) {
      return ok('No buckets found in this project.');
    }
    const rows = buckets.map((b) => `  - ${b.name}  (created: ${formatTimestamp(b.created)})`);
    return ok(`Buckets (${buckets.length}):\n${rows.join('\n')}`);
  } catch (err) {
    return errorResponse(err);
  }
}

// ---------------------------------------------------------------------------
// create_bucket
// ---------------------------------------------------------------------------

export const createBucketSchema = z.object({
  name: z.string().min(1).describe('Bucket name (3-63 lowercase alphanumeric characters and hyphens)'),
});

export async function createBucket(
  args: z.infer<typeof createBucketSchema>,
): Promise<McpTextResponse> {
  try {
    const project = await getProject();
    const bucket = await project.ensureBucket(args.name);
    return ok(`Bucket "${bucket.name}" is ready (created: ${formatTimestamp(bucket.created)})`);
  } catch (err) {
    return errorResponse(err);
  }
}

// ---------------------------------------------------------------------------
// delete_bucket
// ---------------------------------------------------------------------------

export const deleteBucketSchema = z.object({
  name: z.string().min(1).describe('Name of the bucket to delete'),
  with_objects: z
    .boolean()
    .optional()
    .describe('If true, delete the bucket and all its objects. Default: false (bucket must be empty)'),
});

export async function deleteBucket(
  args: z.infer<typeof deleteBucketSchema>,
): Promise<McpTextResponse> {
  try {
    const project = await getProject();
    if (args.with_objects) {
      await project.deleteBucketWithObjects(args.name);
      return ok(`Bucket "${args.name}" and all its objects have been deleted.`);
    } else {
      await project.deleteBucket(args.name);
      return ok(`Bucket "${args.name}" has been deleted.`);
    }
  } catch (err) {
    return errorResponse(err);
  }
}
