import { z } from 'zod';
import { getProject } from '../auth.js';
import { ok, errorResponse, formatBytes, formatTimestamp, type McpTextResponse } from '../utils.js';

// ---------------------------------------------------------------------------
// list_objects
// ---------------------------------------------------------------------------

export const listObjectsSchema = z.object({
  bucket: z.string().min(1).describe('Bucket name'),
  prefix: z.string().optional().describe('Filter objects by this prefix (e.g. "photos/")'),
  recursive: z.boolean().optional().describe('List all objects recursively. Default: false'),
});

export async function listObjects(
  args: z.infer<typeof listObjectsSchema>,
): Promise<McpTextResponse> {
  try {
    const project = await getProject();
    const objects = await project.listObjects(args.bucket, {
      prefix: args.prefix,
      recursive: args.recursive ?? false,
      system: true,
      custom: false,
    });
    if (objects.length === 0) {
      return ok(`No objects found in "${args.bucket}"${args.prefix ? `/${args.prefix}` : ''}.`);
    }
    const rows = objects.map((o) => {
      if (o.isPrefix) return `  📁 ${o.key}`;
      return `  📄 ${o.key}  (${formatBytes(o.system.contentLength)}, created: ${formatTimestamp(o.system.created)})`;
    });
    return ok(`Objects in "${args.bucket}" (${objects.length}):\n${rows.join('\n')}`);
  } catch (err) {
    return errorResponse(err);
  }
}

// ---------------------------------------------------------------------------
// stat_object
// ---------------------------------------------------------------------------

export const statObjectSchema = z.object({
  bucket: z.string().min(1).describe('Bucket name'),
  key: z.string().min(1).describe('Object key (path)'),
});

export async function statObject(
  args: z.infer<typeof statObjectSchema>,
): Promise<McpTextResponse> {
  try {
    const project = await getProject();
    const info = await project.statObject(args.bucket, args.key);
    const result = {
      key: info.key,
      bucket: args.bucket,
      size: formatBytes(info.system.contentLength),
      size_bytes: info.system.contentLength,
      created: formatTimestamp(info.system.created),
      expires: formatTimestamp(info.system.expires),
      metadata: info.custom,
    };
    return ok(result);
  } catch (err) {
    return errorResponse(err);
  }
}

// ---------------------------------------------------------------------------
// delete_object
// ---------------------------------------------------------------------------

export const deleteObjectSchema = z.object({
  bucket: z.string().min(1).describe('Bucket name'),
  key: z.string().min(1).describe('Object key (path) to delete'),
});

export async function deleteObject(
  args: z.infer<typeof deleteObjectSchema>,
): Promise<McpTextResponse> {
  try {
    const project = await getProject();
    await project.deleteObject(args.bucket, args.key);
    return ok(`Object "${args.key}" deleted from bucket "${args.bucket}".`);
  } catch (err) {
    return errorResponse(err);
  }
}

// ---------------------------------------------------------------------------
// copy_object
// ---------------------------------------------------------------------------

export const copyObjectSchema = z.object({
  src_bucket: z.string().min(1).describe('Source bucket name'),
  src_key: z.string().min(1).describe('Source object key'),
  dst_bucket: z.string().min(1).describe('Destination bucket name'),
  dst_key: z.string().min(1).describe('Destination object key'),
});

export async function copyObject(
  args: z.infer<typeof copyObjectSchema>,
): Promise<McpTextResponse> {
  try {
    const project = await getProject();
    const info = await project.copyObject(args.src_bucket, args.src_key, args.dst_bucket, args.dst_key);
    return ok(`Copied "${args.src_bucket}/${args.src_key}" → "${args.dst_bucket}/${info.key}"`);
  } catch (err) {
    return errorResponse(err);
  }
}

// ---------------------------------------------------------------------------
// move_object
// ---------------------------------------------------------------------------

export const moveObjectSchema = z.object({
  src_bucket: z.string().min(1).describe('Source bucket name'),
  src_key: z.string().min(1).describe('Source object key'),
  dst_bucket: z.string().min(1).describe('Destination bucket name'),
  dst_key: z.string().min(1).describe('Destination object key'),
});

export async function moveObject(
  args: z.infer<typeof moveObjectSchema>,
): Promise<McpTextResponse> {
  try {
    const project = await getProject();
    await project.moveObject(args.src_bucket, args.src_key, args.dst_bucket, args.dst_key);
    return ok(`Moved "${args.src_bucket}/${args.src_key}" → "${args.dst_bucket}/${args.dst_key}"`);
  } catch (err) {
    return errorResponse(err);
  }
}

// ---------------------------------------------------------------------------
// update_metadata
// ---------------------------------------------------------------------------

export const updateMetadataSchema = z.object({
  bucket: z.string().min(1).describe('Bucket name'),
  key: z.string().min(1).describe('Object key'),
  metadata: z.record(z.string()).describe('Key-value metadata pairs to set on the object'),
});

export async function updateMetadata(
  args: z.infer<typeof updateMetadataSchema>,
): Promise<McpTextResponse> {
  try {
    const project = await getProject();
    await project.updateObjectMetadata(args.bucket, args.key, args.metadata);
    return ok(`Metadata updated for "${args.bucket}/${args.key}":\n${JSON.stringify(args.metadata, null, 2)}`);
  } catch (err) {
    return errorResponse(err);
  }
}
