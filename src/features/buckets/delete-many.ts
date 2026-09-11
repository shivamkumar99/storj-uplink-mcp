import type { z } from 'zod';
import type { ProjectResultStruct } from 'storj-uplink-nodejs';
import { getProject } from '../../core/auth.js';
import { ok, safeCall, type McpTextResponse } from '../../lib/response.js';
import { matchGlob } from '../../lib/glob.js';
import { runBatch, formatBatchReport } from '../../transfer/batch.js';
import type { deleteBucketsSchema } from './schema.js';

// ---------------------------------------------------------------------------
// delete_buckets — batch delete multiple buckets by list or pattern
// ---------------------------------------------------------------------------

/**
 * Resolve which bucket names to target from the user-supplied filters.
 * Names come back in the order Storj lists them (lexicographic by name).
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
    return all.map((b) => b.name).filter((n) => matchGlob(n, pattern));
  }

  // Neither — delete ALL buckets
  const all = await project.listBuckets();
  return all.map((b) => b.name);
}

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

    // Choose the delete operation once, where the user's flag lives
    const remove = args.with_objects
      ? (name: string) => project.deleteBucketWithObjects(name)
      : (name: string) => project.deleteBucket(name);

    const result = await runBatch(targets, {
      label: `Deleting ${targets.length} bucket(s)`,
      verb: 'deleting',
      itemName: (name) => name,
      op: remove,
      done: (r) => `Deleted ${r.succeeded.length}/${r.total} bucket(s)`,
    });

    return ok(formatBatchReport(result, {
      header: `Deleted ${result.succeeded.length} of ${result.total} bucket(s):`,
      successLabel: '✅ Deleted:',
    }));
  });
}
