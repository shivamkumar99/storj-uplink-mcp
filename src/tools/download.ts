import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { getProject } from '../auth.js';
import { ok, errorResponse, formatBytes, type McpTextResponse } from '../utils.js';

// ---------------------------------------------------------------------------
// Shared: read all bytes from a Storj download into a Buffer
// ---------------------------------------------------------------------------

async function readAll(
  project: Awaited<ReturnType<typeof getProject>>,
  bucket: string,
  key: string,
): Promise<Buffer> {
  const download = await project.downloadObject(bucket, key);
  const chunks: Buffer[] = [];

  try {
    const CHUNK = 64 * 1024; // 64 KB read buffer
    const buf = Buffer.alloc(CHUNK);

    while (true) {
      try {
        const { bytesRead } = await download.read(buf, CHUNK);
        if (bytesRead > 0) chunks.push(Buffer.from(buf.subarray(0, bytesRead)));
        if (bytesRead < CHUNK) break;
      } catch (err: unknown) {
        // EOF is signalled as a thrown error with a bytesRead property
        const e = err as Record<string, unknown>;
        const partial = typeof e['bytesRead'] === 'number' ? (e['bytesRead'] as number) : 0;
        if (partial > 0) chunks.push(Buffer.from(buf.subarray(0, partial)));
        break;
      }
    }
  } finally {
    await download.close();
  }

  return Buffer.concat(chunks);
}

// ---------------------------------------------------------------------------
// download_text — download object and return content as text
// ---------------------------------------------------------------------------

export const downloadTextSchema = z.object({
  bucket: z.string().min(1).describe('Bucket name'),
  key: z.string().min(1).describe('Object key (path) to download'),
});

export async function downloadText(
  args: z.infer<typeof downloadTextSchema>,
): Promise<McpTextResponse> {
  try {
    const project = await getProject();
    const data = await readAll(project, args.bucket, args.key);
    const text = data.toString('utf8');
    return ok(`Content of "${args.bucket}/${args.key}" (${formatBytes(data.length)}):\n\n${text}`);
  } catch (err) {
    return errorResponse(err);
  }
}

// ---------------------------------------------------------------------------
// download_file — download object and save to a local path
// ---------------------------------------------------------------------------

export const downloadFileSchema = z.object({
  bucket: z.string().min(1).describe('Bucket name'),
  key: z.string().min(1).describe('Object key (path) on Storj'),
  file_path: z
    .string()
    .min(1)
    .describe('Local path where the file will be saved, e.g. "/tmp/photo.jpg"'),
});

export async function downloadFile(
  args: z.infer<typeof downloadFileSchema>,
): Promise<McpTextResponse> {
  try {
    const project = await getProject();
    const data = await readAll(project, args.bucket, args.key);

    // Ensure parent directory exists
    const dir = path.dirname(args.file_path);
    fs.mkdirSync(dir, { recursive: true });

    fs.writeFileSync(args.file_path, data);

    return ok(
      `Downloaded "${args.bucket}/${args.key}" → "${args.file_path}" (${formatBytes(data.length)})`,
    );
  } catch (err) {
    return errorResponse(err);
  }
}
