import { z } from 'zod';
import { getProject } from '../auth.js';
import { ok, safeCall, formatBytes, formatTimestamp, type McpTextResponse } from '../utils.js';
import { createProgress } from '../progress.js';
import {
  bucketField,
  keyField,
  srcBucketField,
  srcKeyField,
  dstBucketField,
  dstKeyField,
  metadataField,
} from './schemas.js';
import type { ProjectResultStruct } from 'storj-uplink-nodejs';

/**
 * Match a key against a glob-like pattern.
 * Supports: * (within one path segment), ? (single char), ** (any path segments).
 *
 * Uses iterative character matching instead of RegExp to avoid ReDoS.
 */
function matchPattern(key: string, pattern: string): boolean {
  return globMatch(key, 0, pattern, 0);
}

/** Recursive glob matcher — no RegExp, no ReDoS risk. */
function globMatch(str: string, si: number, pat: string, pi: number): boolean {
  while (pi < pat.length) {
    // Handle '**' — matches across path segments (including '/')
    if (pat[pi] === '*' && pi + 1 < pat.length && pat[pi + 1] === '*') {
      pi += 2;
      // Skip trailing slash after '**' if present
      if (pi < pat.length && pat[pi] === '/') pi++;
      if (pi === pat.length) return true;
      for (let i = si; i <= str.length; i++) {
        if (globMatch(str, i, pat, pi)) return true;
      }
      return false;
    }
    // Handle '*' — matches within one path segment (no '/')
    if (pat[pi] === '*') {
      pi++;
      if (pi === pat.length) {
        // '*' at end: match rest if no '/' remains
        return str.indexOf('/', si) === -1;
      }
      for (let i = si; i <= str.length; i++) {
        if (str[i] === '/') break; // '*' cannot cross '/'
        if (globMatch(str, i, pat, pi)) return true;
      }
      return false;
    }
    // Handle '?' — matches exactly one non-'/' character
    if (pat[pi] === '?') {
      if (si >= str.length || str[si] === '/') return false;
      si++;
      pi++;
      continue;
    }
    // Literal character
    if (si >= str.length || str[si] !== pat[pi]) return false;
    si++;
    pi++;
  }
  return si === str.length;
}

/**
 * Resolve which object keys to delete.
 * Returns the matched keys sorted alphabetically.
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
    names = names.filter((k) => matchPattern(k, pattern));
  }
  return names.sort();
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
    const objects = await project.listObjects(args.bucket, {
      prefix: args.prefix,
      recursive: args.recursive ?? false,
      system: true,
      custom: false,
    });
    if (objects.length === 0) {
      return ok(`No objects found in "${args.bucket}"${args.prefix ? `/${args.prefix}` : ''}.`);
    }
    progress.done(`Listed ${objects.length} objects in "${args.bucket}"`);
    const rows = objects.map((o) => {
      if (o.isPrefix) return `  📁 ${o.key}`;
      return `  📄 ${o.key}  (${formatBytes(o.system.contentLength)}, created: ${formatTimestamp(o.system.created)})`;
    });
    return ok(`Objects in "${args.bucket}" (${objects.length}):\n${rows.join('\n')}`);
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
      key: info.key,
      bucket: args.bucket,
      size: formatBytes(info.system.contentLength),
      size_bytes: info.system.contentLength,
      created: formatTimestamp(info.system.created),
      expires: formatTimestamp(info.system.expires),
      metadata: info.custom,
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
      const filter = args.pattern
        ? `pattern "${args.pattern}"`
        : args.prefix
          ? `prefix "${args.prefix}"`
          : 'the specified filters';
      return ok(`No objects matched ${filter} in bucket "${args.bucket}".`);
    }

    const progress = createProgress(`Deleting ${targets.length} object(s) from "${args.bucket}"`);
    const deleted: string[] = [];
    const failed: Array<{ key: string; error: string }> = [];

    for (let i = 0; i < targets.length; i++) {
      const key = targets[i];
      progress.update(i, targets.length, `deleting "${key}"…`);
      try {
        await project.deleteObject(args.bucket, key);
        deleted.push(key);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        failed.push({ key, error: msg });
      }
    }

    progress.done(`Deleted ${deleted.length}/${targets.length} object(s) from "${args.bucket}"`);

    const lines: string[] = [];
    lines.push(`Deleted ${deleted.length} of ${targets.length} object(s) from "${args.bucket}":`);
    if (deleted.length > 0) {
      lines.push('');
      lines.push('✅ Deleted:');
      for (const k of deleted) lines.push(`  - ${k}`);
    }
    if (failed.length > 0) {
      lines.push('');
      lines.push('❌ Failed:');
      for (const f of failed) lines.push(`  - ${f.key}: ${f.error}`);
    }
    return ok(lines.join('\n'));
  });
}
