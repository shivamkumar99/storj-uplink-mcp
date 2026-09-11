import { defineTool, annotations } from '../../core/registry.js';
import { UI } from '../../core/ui-resources.js';
import { listBucketsOutput } from './output.js';
import {
  listBucketsSchema, createBucketSchema, statBucketSchema, bucketUsageSchema, deleteBucketSchema, deleteBucketsSchema,
} from './schema.js';
import { listBuckets, createBucket, statBucket, bucketUsage, deleteBucket } from './handlers.js';
import { deleteBuckets } from './delete-many.js';

export const tools = [
  defineTool({
    name: 'list_buckets',
    annotations: annotations.readOnly,
    description: 'List all buckets in your Storj project',
    schema: listBucketsSchema,
    outputSchema: listBucketsOutput,
    ui: { resourceUri: UI.browser },
    handler: listBuckets,
  }),
  defineTool({
    name: 'create_bucket',
    annotations: { ...annotations.creates, idempotentHint: true },
    description: 'Create a new bucket in your Storj project (idempotent — safe to call if bucket already exists)',
    schema: createBucketSchema,
    handler: createBucket,
  }),
  defineTool({
    name: 'stat_bucket',
    annotations: annotations.readOnly,
    description: 'Get information about a single Storj bucket (name and creation time). Useful to check whether a bucket exists.',
    schema: statBucketSchema,
    handler: statBucket,
  }),
  defineTool({
    name: 'bucket_usage',
    annotations: annotations.readOnly,
    description: 'Summarize storage usage for a bucket (or a prefix): object count and total bytes stored. Like "du" for Storj.',
    schema: bucketUsageSchema,
    handler: bucketUsage,
  }),
  defineTool({
    name: 'delete_bucket',
    annotations: annotations.deletes,
    description: 'Delete a Storj bucket. By default the bucket must be empty; set with_objects=true to delete all contents too.',
    schema: deleteBucketSchema,
    handler: deleteBucket,
  }),
  defineTool({
    name: 'delete_buckets',
    annotations: annotations.deletes,
    description: 'Batch-delete multiple buckets by name list or glob pattern (e.g. "logs-*", "test-*"). Shows progress and reports per-bucket success/failure.',
    schema: deleteBucketsSchema,
    handler: deleteBuckets,
  }),
];
