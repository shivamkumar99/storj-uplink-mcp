import fs from 'node:fs';
import path from 'node:path';
import type { z } from 'zod';
import { getProject } from '../../core/auth.js';
import { ok, safeCall, type McpTextResponse } from '../../lib/response.js';
import { formatBytes } from '../../lib/format.js';
import { validateFilePath } from '../../lib/paths.js';
import { uploadObject } from '../../transfer/upload.js';
import { fileSource } from '../../transfer/sources.js';
import { runBatch, formatBatchReport } from '../../transfer/batch.js';
import { MAX_DIR_FILES } from './constants.js';
import { uploadOptionsFrom } from './handlers.js';
import type { uploadDirectorySchema } from './schema.js';

// ---------------------------------------------------------------------------
// upload_directory — recursively upload a local folder to a key prefix
//
// Security:
//   • Every file is run through validateFilePath (blocks sensitive paths).
//   • Symlinks are skipped (lstat) so the walk cannot escape the source tree
//     into, e.g., ~/.ssh via a planted symlink.
//   • A hard cap (MAX_DIR_FILES) bounds resource use / runaway uploads.
// Object keys are POSIX-joined (prefix + relative path) regardless of host OS.
// ---------------------------------------------------------------------------

/** Recursively collect regular files under `dir`, skipping symlinks. */
function collectFiles(dir: string, out: string[]): void {
// eslint-disable-next-line security/detect-non-literal-fs-filename -- root validated by validateFilePath; symlinks are never followed
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (out.length > MAX_DIR_FILES) return; // bounded; caller reports the cap
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;   // never follow symlinks
    if (entry.isDirectory()) collectFiles(full, out);
    else if (entry.isFile()) out.push(full);
  }
}

export function uploadDirectory(
  args: z.infer<typeof uploadDirectorySchema>,
): Promise<McpTextResponse> {
  return safeCall(async () => {
    validateFilePath(args.dir_path);
    const root = path.resolve(args.dir_path);
// eslint-disable-next-line security/detect-non-literal-fs-filename -- validated on the line above
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
      return ok(`"${args.dir_path}" is not an existing directory.`);
    }

    const files: string[] = [];
    collectFiles(root, files);
    const capped = files.length > MAX_DIR_FILES;
    const targets = capped ? files.slice(0, MAX_DIR_FILES) : files;

    if (targets.length === 0) {
      return ok(`No files found under "${args.dir_path}".`);
    }

    const project = await getProject();
    const opts = uploadOptionsFrom(args);
    const prefix = args.prefix ?? '';

    // POSIX-style key: prefix + path relative to root
    const items = targets.map((file) => ({
      file,
      key: `${prefix}${path.relative(root, file).split(path.sep).join('/')}`,
    }));

    const result = await runBatch(items, {
      label: `Uploading ${items.length} file(s) from "${args.dir_path}"`,
      verb: 'uploading',
      itemName: (it) => it.key,
      op: async (it) => {
        validateFilePath(it.file); // defence in depth — re-check each file
        return uploadObject(project, { bucket: args.bucket, key: it.key }, fileSource(it.file), opts);
      },
      done: (r) => `Uploaded ${r.succeeded.length}/${r.total} file(s) (${formatBytes(r.totalBytes)})`,
    });

    return ok(formatBatchReport(result, {
      header: `Uploaded ${result.succeeded.length} of ${result.total} file(s) to "${args.bucket}" (${formatBytes(result.totalBytes)}):`,
      notes: capped
        ? [`⚠️  Directory contains more than ${MAX_DIR_FILES} files — only the first ${MAX_DIR_FILES} were uploaded.`]
        : undefined,
    }));
  });
}
