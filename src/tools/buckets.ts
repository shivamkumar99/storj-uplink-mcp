import { z } from 'zod';
import { getProject } from '../auth.js';
import { ok, safeCall, formatTimestamp, type McpTextResponse } from '../utils.js';
import { createProgress } from '../progress.js';
import { bucketField } from './schemas.js';
import type { ProjectResultStruct } from 'storj-uplink-nodejs';

/**
 * Match a name against a filter that can be a glob-like pattern or plain string.
 * Supports: * (any chars), ? (single char). No regex — safe for user input.
 *
 * Uses iterative character matching instead of RegExp to avoid ReDoS.
 */
function matchPattern(name: string, pattern: string): boolean {
  return globMatch(name, 0, pattern, 0);
}

/** Recursive glob matcher — no RegExp, no ReDoS risk. */
function globMatch(str: string, si: number, pat: string, pi: number): boolean {
  while (pi < pat.length) {
    const pc = pat[pi];
    if (pc === '*') {
      // Skip consecutive stars (treat "**" the same as "*" for flat names)
      while (pi < pat.length && pat[pi] === '*') pi++;
      // '*' at end matches everything remaining
      if (pi === pat.length) return true;
      // Try matching the rest of the pattern at every remaining position
      for (let i = si; i <= str.length; i++) {
        if (globMatch(str, i, pat, pi)) return true;
      }
      return false;
    } else if (pc === '?') {
      if (si >= str.length) return false;
      si++;
      pi++;
    } else {
      if (si >= str.length || str[si] !== pc) return false;
      si++;
      pi++;
    }
  }
  return si === str.length;
}

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
    return all.map((b) => b.name).filter((n) => matchPattern(n, pattern)).sort();
  }

  // Neither — delete ALL buckets
  const all = await project.listBuckets();
  return all.map((b) => b.name).sort();
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
      await project.deleteBucketWithObjects(args.name);
      progress.done(`Bucket "${args.name}" and all its objects have been deleted`);
      return ok(`Bucket "${args.name}" and all its objects have been deleted.`);
    }
    await project.deleteBucket(args.name);
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

    const progress = createProgress(`Deleting ${targets.length} bucket(s)`);
    const deleted: string[] = [];
    const failed: Array<{ name: string; error: string }> = [];

    for (let i = 0; i < targets.length; i++) {
      const name = targets[i];
      progress.update(i, targets.length, `deleting "${name}"…`);
      try {
        if (args.with_objects) {
          await project.deleteBucketWithObjects(name);
        } else {
          await project.deleteBucket(name);
        }
        deleted.push(name);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        failed.push({ name, error: msg });
      }
    }

    progress.done(`Deleted ${deleted.length}/${targets.length} bucket(s)`);

    const lines: string[] = [];
    lines.push(`Deleted ${deleted.length} of ${targets.length} bucket(s):`);
    if (deleted.length > 0) {
      lines.push('');
      lines.push('✅ Deleted:');
      for (const n of deleted) lines.push(`  - ${n}`);
    }
    if (failed.length > 0) {
      lines.push('');
      lines.push('❌ Failed:');
      for (const f of failed) lines.push(`  - ${f.name}: ${f.error}`);
    }
    return ok(lines.join('\n'));
  });
}
