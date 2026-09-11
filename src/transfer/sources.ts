import fs from 'node:fs';

// ---------------------------------------------------------------------------
// Upload Strategy: where the bytes come from.
// ---------------------------------------------------------------------------

/** Strategy: supplies the bytes to upload in bounded chunks. */
export interface ChunkSource {
  /** Total size in bytes, known upfront so progress can show a percentage. */
  readonly size: number;
  chunks(chunkSize: number): Iterable<Buffer> | AsyncIterable<Buffer>;
}

/** Data already fully in memory — sliced so each native write stays bounded. */
export function bufferSource(data: Buffer): ChunkSource {
  return {
    size: data.length,
    *chunks(chunkSize) {
      for (let offset = 0; offset < data.length; offset += chunkSize) {
        yield data.subarray(offset, Math.min(offset + chunkSize, data.length));
      }
    },
  };
}

/**
 * A local file, streamed with fs.createReadStream so only one chunk is ever
 * in RAM — GB-scale files do not grow process memory.
 */
export function fileSource(filePath: string): ChunkSource {
  return {
    size: fs.statSync(filePath).size,
    async *chunks(chunkSize) {
      for await (const chunk of fs.createReadStream(filePath, { highWaterMark: chunkSize })) {
        yield chunk as Buffer;
      }
    },
  };
}
