import { z } from 'zod';
import { defineTool, annotations } from '../registry.js';
import { getProject } from '../auth.js';
import { ok, okStructured, safeCall, formatBytes, formatTimestamp, optionalPrefix, sanitizeOutput, sanitizeRecord, type McpTextResponse } from '../utils.js';
import { UI } from '../ui.js';
import { listObjectsOutput, type ListObjectsResult } from './objects.output.js';
import { createProgress } from '../progress.js';
import {
  bucketField,
  keyField,
  srcBucketField,
  srcKeyField,
  dstBucketField,
  dstKeyField,
} from './schemas.js';
import { matchGlob } from './glob.js';
import { runBatch, formatBatchReport } from './batch.js';
import type { ProjectResultStruct } from 'storj-uplink-nodejs';

/**
 * Resolve which object keys to delete.
 * Keys come back in the order Storj lists them (lexicographic by key).
 */
async function resolveObjectKeys(
  project: ProjectResultStruct,
  bucket: string,
  keys?: string[],
  prefix?: string,
  pattern?: string,
): Promise<string[]> {
  // Explicit key list — return as-is
  if (keys && keys.length > 0) return [...keys];

  // Prefix and/or pattern — list objects then filter
  const objects = await project.listObjects(bucket, {
    prefix: prefix ?? '',
    recursive: true,
    system: false,
    custom: false,
  });

  let names = objects.filter((o) => !o.isPrefix).map((o) => o.key);
  if (pattern) {
    names = names.filter((k) => matchGlob(k, pattern));
  }
  return names;
}

// ---------------------------------------------------------------------------
// list_objects
// ---------------------------------------------------------------------------

export const listObjectsSchema = z.object({
  bucket: bucketField,
  prefix: z.string().optional().describe('Filter objects by this prefix (e.g. "photos/")'),
  recursive: z.boolean().optional().describe('List all objects recursively. Default: false'),
});

export function listObjects(
  args: z.infer<typeof listObjectsSchema>,
): Promise<McpTextResponse> {
  return safeCall(async () => {
    const project = await getProject();
    const progress = createProgress(`Listing objects in "${args.bucket}"`);
    progress.update(0, 0, 'querying…');
    const recursive = args.recursive ?? false;
    const objects = await project.listObjects(args.bucket, {
      prefix: args.prefix,
      recursive,
      system: true,
      custom: false,
    });

    // Structured result for clients/apps; keys are untrusted so they are sanitised.
    const structured: ListObjectsResult = {
      bucket: args.bucket,
      prefix: args.prefix ?? '',
      recursive,
      objects: objects.map((o) => ({
        key: sanitizeOutput(o.key),
        is_prefix: o.isPrefix,
        ...(o.isPrefix ? {} : { size_bytes: o.system.contentLength, created: formatTimestamp(o.system.created) }),
      })),
    };

    if (objects.length === 0) {
      return okStructured(`No objects found in "${args.bucket}"${optionalPrefix(args.prefix)}.`, structured);
    }
    progress.done(`Listed ${objects.length} objects in "${args.bucket}"`);
    const rows = structured.objects.map((o) =>
      o.is_prefix ? `  📁 ${o.key}` : `  📄 ${o.key}  (${formatBytes(o.size_bytes ?? 0)}, created: ${o.created ?? 'none'})`,
    );
    return okStructured(`Objects in "${args.bucket}" (${objects.length}):\n${rows.join('\n')}`, structured);
  });
}

// ---------------------------------------------------------------------------
// stat_object
// ---------------------------------------------------------------------------

export const statObjectSchema = z.object({
  bucket: bucketField,
  key: keyField,
});

export function statObject(
  args: z.infer<typeof statObjectSchema>,
): Promise<McpTextResponse> {
  return safeCall(async () => {
    const project = await getProject();
    const info = await project.statObject(args.bucket, args.key);
    const result = {
      key: sanitizeOutput(info.key),
      bucket: args.bucket,
      size: formatBytes(info.system.contentLength),
      size_bytes: info.system.contentLength,
      created: formatTimestamp(info.system.created),
      expires: formatTimestamp(info.system.expires),
      metadata: sanitizeRecord(info.custom),
    };
    return ok(result);
  });
}

// ---------------------------------------------------------------------------
// delete_object
// ---------------------------------------------------------------------------

export const deleteObjectSchema = z.object({
  bucket: bucketField,
  key: keyField.describe('Object key (path) to delete'),
});

export function deleteObject(
  args: z.infer<typeof deleteObjectSchema>,
): Promise<McpTextResponse> {
  return safeCall(async () => {
    const project = await getProject();
    await project.deleteObject(args.bucket, args.key);
    return ok(`Object "${args.key}" deleted from bucket "${args.bucket}".`);
  });
}

// ---------------------------------------------------------------------------
// copy_object
// ---------------------------------------------------------------------------

export const copyObjectSchema = z.object({
  src_bucket: srcBucketField,
  src_key: srcKeyField,
  dst_bucket: dstBucketField,
  dst_key: dstKeyField,
});

export function copyObject(
  args: z.infer<typeof copyObjectSchema>,
): Promise<McpTextResponse> {
  return safeCall(async () => {
    const project = await getProject();
    const info = await project.copyObject(args.src_bucket, args.src_key, args.dst_bucket, args.dst_key);
    return ok(`Copied "${args.src_bucket}/${args.src_key}" → "${args.dst_bucket}/${info.key}"`);
  });
}

// ---------------------------------------------------------------------------
// move_object
// ---------------------------------------------------------------------------

export const moveObjectSchema = z.object({
  src_bucket: srcBucketField,
  src_key: srcKeyField,
  dst_bucket: dstBucketField,
  dst_key: dstKeyField,
});

export function moveObject(
  args: z.infer<typeof moveObjectSchema>,
): Promise<McpTextResponse> {
  return safeCall(async () => {
    const project = await getProject();
    await project.moveObject(args.src_bucket, args.src_key, args.dst_bucket, args.dst_key);
    return ok(`Moved "${args.src_bucket}/${args.src_key}" → "${args.dst_bucket}/${args.dst_key}"`);
  });
}

// ---------------------------------------------------------------------------
// update_metadata
// ---------------------------------------------------------------------------

export const updateMetadataSchema = z.object({
  bucket: bucketField,
  key: keyField,
  metadata: z.record(z.string()).describe('Key-value metadata pairs to set on the object'),
});

export function updateMetadata(
  args: z.infer<typeof updateMetadataSchema>,
): Promise<McpTextResponse> {
  return safeCall(async () => {
    const project = await getProject();
    await project.updateObjectMetadata(args.bucket, args.key, args.metadata);
    return ok(`Metadata updated for "${args.bucket}/${args.key}":\n${JSON.stringify(args.metadata, null, 2)}`);
  });
}

// ---------------------------------------------------------------------------
// delete_objects — batch delete multiple objects by list, prefix, or pattern
// ---------------------------------------------------------------------------

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

export function deleteObjects(
  args: z.infer<typeof deleteObjectsSchema>,
): Promise<McpTextResponse> {
  return safeCall(async () => {
    // Safety: if no keys, no prefix, and no pattern → deleting ALL objects, require confirm
    if (!args.keys?.length && !args.prefix && !args.pattern && !args.confirm_all) {
      return ok(
        `WARNING: No keys, prefix, or pattern specified — this would delete ALL objects in bucket "${args.bucket}". ` +
        'Set confirm_all=true to proceed, or provide keys, a prefix, or a pattern.',
      );
    }

    const project = await getProject();
    const targets = await resolveObjectKeys(
      project, args.bucket, args.keys, args.prefix, args.pattern,
    );

    if (targets.length === 0) {
      let filter = 'the specified filters';
      if (args.pattern) filter = `pattern "${args.pattern}"`;
      else if (args.prefix) filter = `prefix "${args.prefix}"`;
      return ok(`No objects matched ${filter} in bucket "${args.bucket}".`);
    }

    const result = await runBatch(targets, {
      label: `Deleting ${targets.length} object(s) from "${args.bucket}"`,
      verb: 'deleting',
      itemName: (key) => key,
      op: async (key) => { await project.deleteObject(args.bucket, key); },
      done: (r) => `Deleted ${r.succeeded.length}/${r.total} object(s) from "${args.bucket}"`,
    });

    return ok(formatBatchReport(result, {
      header: `Deleted ${result.succeeded.length} of ${result.total} object(s) from "${args.bucket}":`,
      successLabel: '✅ Deleted:',
    }));
  });
}

// ---------------------------------------------------------------------------
// Tool registry for this module (see registry.ts)
// ---------------------------------------------------------------------------

export const tools = [
  defineTool({
    name: 'list_objects',
    annotations: annotations.readOnly,
    description: 'List objects in a Storj bucket, optionally filtered by prefix',
    schema: listObjectsSchema,
    outputSchema: listObjectsOutput,
    ui: { resourceUri: UI.listObjects },
    handler: listObjects,
  }),
  defineTool({
    name: 'stat_object',
    annotations: annotations.readOnly,
    description: 'Get information about a Storj object: size, creation date, expiry, and custom metadata',
    schema: statObjectSchema,
    handler: statObject,
  }),
  defineTool({
    name: 'delete_object',
    annotations: annotations.deletes,
    description: 'Delete an object from a Storj bucket',
    schema: deleteObjectSchema,
    handler: deleteObject,
  }),
  defineTool({
    name: 'delete_objects',
    annotations: annotations.deletes,
    description: 'Batch-delete multiple objects by key list, prefix, or glob pattern (e.g. "*.log", "photos/**/*.tmp"). Shows progress and reports per-object success/failure.',
    schema: deleteObjectsSchema,
    handler: deleteObjects,
  }),
  defineTool({
    name: 'copy_object',
    annotations: annotations.overwrites,
    description: 'Copy an object to a new key or bucket on Storj',
    schema: copyObjectSchema,
    handler: copyObject,
  }),
  defineTool({
    name: 'move_object',
    annotations: annotations.deletes,
    description: 'Move or rename an object on Storj',
    schema: moveObjectSchema,
    handler: moveObject,
  }),
  defineTool({
    name: 'update_metadata',
    annotations: annotations.overwrites,
    description: 'Update custom metadata key-value pairs on an existing Storj object',
    schema: updateMetadataSchema,
    handler: updateMetadata,
  }),
];
