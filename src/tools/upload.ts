import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { getProject } from '../auth.js';
import { ok, safeCall, formatBytes, validateFilePath, expiryDate, type McpTextResponse } from '../utils.js';
import { bucketField, metadataField, chunkSizeField, expiresInHoursField } from './schemas.js';
import { uploadObject, bufferSource, fileSource, type UploadOptions } from './transfer.js';
import { runBatch, formatBatchReport } from './batch.js';

// ---------------------------------------------------------------------------
// The upload algorithm itself (open → write → commit, abort-safe, with
// progress) lives in transfer.ts.  This file only maps tool arguments onto it
// and picks the data source: bufferSource for text, fileSource for files.
// ---------------------------------------------------------------------------

/** Map the shared upload tool arguments onto transfer options. */
function uploadOptionsFrom(args: {
  metadata?: Record<string, string>;
  chunk_size?: number;
  expires_in_hours?: number;
}): UploadOptions {
  return {
    metadata: args.metadata,
    chunkSize: args.chunk_size,
    expires: expiryDate(args.expires_in_hours),
  };
}

// ---------------------------------------------------------------------------
// upload_text — upload a string/text as an object
// ---------------------------------------------------------------------------

export const uploadTextSchema = z.object({
  bucket: bucketField,
  key: z.string().min(1).describe('Object key (path), e.g. "notes/hello.txt"'),
  content: z.string().describe('Text content to upload'),
  metadata: metadataField,
  chunk_size: chunkSizeField,
  expires_in_hours: expiresInHoursField,
});

export function uploadText(
  args: z.infer<typeof uploadTextSchema>,
): Promise<McpTextResponse> {
  return safeCall(async () => {
    const project = await getProject();
    const data = Buffer.from(args.content, 'utf8');
    await uploadObject(
      project, { bucket: args.bucket, key: args.key }, bufferSource(data), uploadOptionsFrom(args),
    );
    return ok(`Uploaded "${args.key}" to bucket "${args.bucket}" (${formatBytes(data.length)})`);
  });
}

// ---------------------------------------------------------------------------
// upload_file — stream a local file to Storj without loading it into RAM
// ---------------------------------------------------------------------------

export const uploadFileSchema = z.object({
  bucket: bucketField,
  key: z.string().min(1).describe('Object key (path) on Storj, e.g. "backups/photo.jpg"'),
  file_path: z.string().min(1).describe('Absolute or relative path to the local file to upload'),
  metadata: metadataField,
  chunk_size: chunkSizeField,
  expires_in_hours: expiresInHoursField,
});

export function uploadFile(
  args: z.infer<typeof uploadFileSchema>,
): Promise<McpTextResponse> {
  return safeCall(async () => {
    validateFilePath(args.file_path);
    const project = await getProject();
    const totalBytes = await uploadObject(
      project, { bucket: args.bucket, key: args.key }, fileSource(args.file_path), uploadOptionsFrom(args),
    );
    return ok(`Uploaded "${args.file_path}" → "${args.bucket}/${args.key}" (${formatBytes(totalBytes)})`);
  });
}

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

/** Maximum number of files a single upload_directory call will transfer */
const MAX_DIR_FILES = 5_000;

/** Recursively collect regular files under `dir`, skipping symlinks. */
function collectFiles(dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (out.length > MAX_DIR_FILES) return; // bounded; caller reports the cap
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;   // never follow symlinks
    if (entry.isDirectory()) collectFiles(full, out);
    else if (entry.isFile()) out.push(full);
  }
}

export const uploadDirectorySchema = z.object({
  bucket: bucketField,
  dir_path: z.string().min(1).describe('Local directory to upload, e.g. "./photos"'),
  prefix: z
    .string()
    .optional()
    .describe('Object key prefix to upload into, e.g. "backup/2024/". Files keep their relative paths under it.'),
  metadata: metadataField,
  chunk_size: chunkSizeField,
  expires_in_hours: expiresInHoursField,
});

export function uploadDirectory(
  args: z.infer<typeof uploadDirectorySchema>,
): Promise<McpTextResponse> {
  return safeCall(async () => {
    validateFilePath(args.dir_path);
    const root = path.resolve(args.dir_path);
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
