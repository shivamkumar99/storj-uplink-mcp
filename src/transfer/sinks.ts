import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Download Strategy: where the bytes go.
// ---------------------------------------------------------------------------

/**
 * Strategy: receives downloaded bytes.  `open()` is called only after the
 * download handle is established, so a missing object never leaves an empty
 * file behind; `close()` always runs (finally).
 */
export interface ChunkSink {
  /** Shown in the completion message, e.g. the destination path. */
  readonly label?: string;
  open(): void;
  write(buf: Buffer, bytesRead: number): void;
  close(): void;
}

/** Accumulate everything in memory — for callers that need the full content. */
export function memorySink(): ChunkSink & { result(): Buffer } {
  const parts: Buffer[] = [];
  return {
    open() {},
    write(buf, n) { parts.push(Buffer.from(buf.subarray(0, n))); },
    close() {},
    result() { return Buffer.concat(parts); },
  };
}

/** Write straight to disk, one chunk at a time — only one chunk ever in RAM. */
export function fileSink(filePath: string): ChunkSink {
  let fd = -1;
  return {
    label: filePath,
    open() {
// eslint-disable-next-line security/detect-non-literal-fs-filename -- path validated by validateFilePath / resolveWithinDir at the tool boundary
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
// eslint-disable-next-line security/detect-non-literal-fs-filename -- same validated path
      fd = fs.openSync(filePath, 'w');
    },
    write(buf, n) { fs.writeSync(fd, buf, 0, n); },
    close() { if (fd !== -1) fs.closeSync(fd); },
  };
}
