import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { getProject } from '../auth.js';
import { ok, safeCall, formatBytes, validateFilePath, expiryDate, type McpTextResponse } from '../utils.js';
import { createProgress } from '../progress.js';
import { bucketField, metadataField, chunkSizeField, expiresInHoursField, DEFAULT_UPLOAD_CHUNK } from './schemas.js';
import type { ProjectResultStruct, UploadResultStruct } from 'storj-uplink-nodejs';

// ---------------------------------------------------------------------------
// runUpload — owns the upload lifecycle: open → optional metadata → write → commit.
//
// Accepts a `writer` callback that performs the actual data writes.  On any
// error (from metadata, writer, or commit) the upload is aborted so partial
// objects are never left dangling on Storj.
//
// Both uploadFromBuffer and uploadFromFile delegate here — the commit /
// abort-on-error boilerplate lives in exactly one place.
// ---------------------------------------------------------------------------

async function runUpload(
  project: ProjectResultStruct,
  bucket: string,
  key: string,
  metadata: Record<string, string> | undefined,
  writer: (upload: UploadResultStruct) => Promise<void>,
  expires?: Date,
): Promise<void> {
  const upload = await project.uploadObject(bucket, key, expires ? { expires } : undefined);
  try {
    if (metadata) await upload.setCustomMetadata(metadata);
    await writer(upload);
    await upload.commit();
  } catch (err) {
    await upload.abort();
    throw err;
  }
}

// ---------------------------------------------------------------------------
// uploadFromBuffer — used by uploadText (data already fully in memory)
//
// Slices the buffer into CHUNK_SIZE pieces so native write calls stay bounded.
// ---------------------------------------------------------------------------

async function uploadFromBuffer(
  project: ProjectResultStruct,
  bucket: string,
  key: string,
  data: Buffer,
  metadata?: Record<string, string>,
  chunkSize: number = DEFAULT_UPLOAD_CHUNK,
  expires?: Date,
): Promise<void> {
  const progress = createProgress(`Uploading "${key}" (chunk ${formatBytes(chunkSize)})`);
  await runUpload(project, bucket, key, metadata, async (upload) => {
    let offset = 0;
    while (offset < data.length) {
      const end = Math.min(offset + chunkSize, data.length);
      const chunk = data.subarray(offset, end);
      await upload.write(chunk, chunk.length);
      offset = end;
      progress.update(offset, data.length);
    }
  }, expires);
  progress.done(`Uploaded "${key}" (${formatBytes(data.length)})`);
}

// ---------------------------------------------------------------------------
// uploadFromFile — used by uploadFile (true streaming, no readFileSync)
//
// Uses fs.createReadStream so only one CHUNK_SIZE block is ever in RAM.
// GB-scale files do not cause OOM — process memory stays flat throughout.
// ---------------------------------------------------------------------------

async function uploadFromFile(
  project: ProjectResultStruct,
  bucket: string,
  key: string,
  filePath: string,
  metadata?: Record<string, string>,
  chunkSize: number = DEFAULT_UPLOAD_CHUNK,
  expires?: Date,
): Promise<number> {
  // Get file size upfront for progress percentage
  const fileSize = fs.statSync(filePath).size;
  const progress = createProgress(`Uploading "${key}" (chunk ${formatBytes(chunkSize)})`);
  let totalBytes = 0;
  await runUpload(project, bucket, key, metadata, async (upload) => {
    for await (const chunk of fs.createReadStream(filePath, { highWaterMark: chunkSize })) {
      const buf = chunk as Buffer;
      await upload.write(buf, buf.length);
      totalBytes += buf.length;
      progress.update(totalBytes, fileSize);
    }
  }, expires);
  progress.done(`Uploaded "${key}" (${formatBytes(totalBytes)})`);
  return totalBytes;
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
    await uploadFromBuffer(
      project, args.bucket, args.key, data, args.metadata, args.chunk_size,
      expiryDate(args.expires_in_hours),
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
    const totalBytes = await uploadFromFile(
      project, args.bucket, args.key, args.file_path, args.metadata, args.chunk_size,
      expiryDate(args.expires_in_hours),
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
    const expires = expiryDate(args.expires_in_hours);
    const prefix = args.prefix ?? '';
    const progress = createProgress(`Uploading ${targets.length} file(s) from "${args.dir_path}"`);

    const uploaded: string[] = [];
    const failed: Array<{ key: string; error: string }> = [];
    let totalBytes = 0;

    for (let i = 0; i < targets.length; i++) {
      const file = targets[i];
      // POSIX-style key: prefix + path relative to root
      const rel = path.relative(root, file).split(path.sep).join('/');
      const key = `${prefix}${rel}`;
      progress.update(i, targets.length, `uploading "${key}"…`);
      try {
        validateFilePath(file); // defence in depth — re-check each file
        const bytes = await uploadFromFile(
          project, args.bucket, key, file, args.metadata, args.chunk_size, expires,
        );
        totalBytes += bytes;
        uploaded.push(key);
      } catch (err: unknown) {
        failed.push({ key, error: err instanceof Error ? err.message : String(err) });
      }
    }

    progress.done(`Uploaded ${uploaded.length}/${targets.length} file(s) (${formatBytes(totalBytes)})`);

    const lines: string[] = [];
    lines.push(`Uploaded ${uploaded.length} of ${targets.length} file(s) to "${args.bucket}" (${formatBytes(totalBytes)}):`);
    if (capped) {
      lines.push('');
      lines.push(`⚠️  Directory contains more than ${MAX_DIR_FILES} files — only the first ${MAX_DIR_FILES} were uploaded.`);
    }
    if (failed.length > 0) {
      lines.push('');
      lines.push('❌ Failed:');
      for (const f of failed) lines.push(`  - ${f.key}: ${f.error}`);
    }
    return ok(lines.join('\n'));
  });
}
