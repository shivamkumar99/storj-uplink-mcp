import fs from 'node:fs';
import path from 'node:path';

// validateFilePath rejects the OS tmpdir on macOS (/var/... is a system dir),
// so disk-writing tests use a scratch dir inside the project (gitignored).
export function projectTmpDir(): string {
  const base = path.join(process.cwd(), 'test', '.tmp');
  fs.mkdirSync(base, { recursive: true });
  return fs.mkdtempSync(path.join(base, 'case-'));
}

export function removeDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

export const textOf = (r: { content: Array<{ text: string }> }): string => r.content[0].text;
