import type { z } from 'zod';
import { getProject } from '../../core/auth.js';
import { ok, safeCall, type McpTextResponse } from '../../lib/response.js';
import { formatBytes, optionalPrefix } from '../../lib/format.js';
import { validateFilePath, resolveWithinDir } from '../../lib/paths.js';
import { downloadObject } from '../../transfer/download.js';
import { fileSink } from '../../transfer/sinks.js';
import { runBatch, formatBatchReport } from '../../transfer/batch.js';
import { MAX_PREFIX_OBJECTS } from './constants.js';
import type { downloadPrefixSchema } from './schema.js';

// ---------------------------------------------------------------------------
// download_prefix — bulk-download every object under a prefix to a local dir
//
// Security:
//   • Object keys are untrusted (a shared bucket may contain hostile keys like
//     "../../etc/passwd").  resolveWithinDir enforces "Zip Slip" containment so
//     no file can be written outside dest_dir.
//   • validateFilePath additionally blocks sensitive targets within dest_dir.
//   • A hard cap (MAX_PREFIX_OBJECTS) bounds resource use.
// The prefix is stripped from each key so the local layout mirrors the prefix
// root rather than re-nesting it under dest_dir.
// ---------------------------------------------------------------------------

export function downloadPrefix(
  args: z.infer<typeof downloadPrefixSchema>,
): Promise<McpTextResponse> {
  return safeCall(async () => {
    validateFilePath(args.dest_dir);
    const project = await getProject();
    const prefix = args.prefix ?? '';

    const objects = await project.listObjects(args.bucket, {
      prefix,
      recursive: true,
      system: false,
      custom: false,
    });
    const keys = objects.filter((o) => !o.isPrefix).map((o) => o.key);

    if (keys.length === 0) {
      return ok(`No objects found in "${args.bucket}"${optionalPrefix(prefix)}.`);
    }

    const capped = keys.length > MAX_PREFIX_OBJECTS;
    const targets = capped ? keys.slice(0, MAX_PREFIX_OBJECTS) : keys;

    const result = await runBatch(targets, {
      label: `Downloading ${targets.length} object(s) from "${args.bucket}"`,
      verb: 'downloading',
      itemName: (key) => key,
      op: async (key) => {
        // Strip the prefix so local layout mirrors the prefix root
        const rel = prefix && key.startsWith(prefix) ? key.slice(prefix.length) : key;
        const dest = resolveWithinDir(args.dest_dir, rel); // Zip-Slip guard
        validateFilePath(dest);                            // defence in depth
        return downloadObject(project, { bucket: args.bucket, key }, fileSink(dest), args.chunk_size);
      },
      done: (r) => `Downloaded ${r.succeeded.length}/${r.total} object(s) (${formatBytes(r.totalBytes)})`,
    });

    return ok(formatBatchReport(result, {
      header: `Downloaded ${result.succeeded.length} of ${result.total} object(s) → "${args.dest_dir}" (${formatBytes(result.totalBytes)}):`,
      notes: capped
        ? [`⚠️  More than ${MAX_PREFIX_OBJECTS} objects matched — only the first ${MAX_PREFIX_OBJECTS} were downloaded.`]
        : undefined,
    }));
  });
}
