import type { z } from 'zod';
import { getProject } from '../../core/auth.js';
import { createProgress } from '../../core/progress.js';
import { ok, okStructured, safeCall, type McpTextResponse } from '../../lib/response.js';
import { formatBytes, formatTimestamp, optionalPrefix } from '../../lib/format.js';
import { sanitizeOutput, sanitizeRecord } from '../../lib/sanitize.js';
import type { ListObjectsResult } from './output.js';
import type {
  listObjectsSchema, statObjectSchema, deleteObjectSchema, copyObjectSchema, moveObjectSchema, updateMetadataSchema,
} from './schema.js';

// ---------------------------------------------------------------------------
// list_objects — text for every client, structuredContent for the object
// browser app (see output.ts and ui/objects/).
// ---------------------------------------------------------------------------

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

export function updateMetadata(
  args: z.infer<typeof updateMetadataSchema>,
): Promise<McpTextResponse> {
  return safeCall(async () => {
    const project = await getProject();
    await project.updateObjectMetadata(args.bucket, args.key, args.metadata);
    return ok(`Metadata updated for "${args.bucket}/${args.key}":\n${JSON.stringify(args.metadata, null, 2)}`);
  });
}
