import type { z } from 'zod';
import type { ProjectResultStruct } from 'storj-uplink-nodejs';
import { getProject } from '../../core/auth.js';
import { ok, safeCall, type McpTextResponse } from '../../lib/response.js';
import { matchGlob } from '../../lib/glob.js';
import { runBatch, formatBatchReport } from '../../transfer/batch.js';
import type { deleteObjectsSchema } from './schema.js';

// ---------------------------------------------------------------------------
// delete_objects — batch delete multiple objects by list, prefix, or pattern
// ---------------------------------------------------------------------------

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
