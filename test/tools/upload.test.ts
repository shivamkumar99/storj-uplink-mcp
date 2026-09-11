import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fakeProject } from '../helpers/fake-project.js';
import { projectTmpDir, removeDir, textOf } from '../helpers/tmp.js';

vi.mock('../../src/auth.js', () => ({ getProject: vi.fn(), requireAccess: vi.fn() }));
import { getProject } from '../../src/auth.js';
import { uploadText, uploadFile, uploadDirectory, tools } from '../../src/tools/upload.js';

let fake: ReturnType<typeof fakeProject>; let dir: string;
beforeEach(() => { fake = fakeProject(); vi.mocked(getProject).mockResolvedValue(fake.project); dir = projectTmpDir(); });
afterEach(() => removeDir(dir));

describe('upload_text', () => {
  it('uploads with metadata and expiry', async () => {
    expect(textOf(await uploadText({ bucket: 'b', key: 'notes/h.txt', content: 'hello', metadata: { a: '1' }, expires_in_hours: 1 }))).toBe('Uploaded "notes/h.txt" to bucket "b" (5 B)');
    const [u] = fake.uploads;
    expect(u).toMatchObject({ bucket: 'b', key: 'notes/h.txt', committed: true, metadata: { a: '1' } });
    expect(u.data.toString()).toBe('hello');
    const exp = (u.opts as { expires: Date }).expires;
    expect(Math.abs(exp.getTime() - (Date.now() + 3600_000))).toBeLessThan(1000);
  });
});

describe('upload_file', () => {
  it('streams a local file and refuses unsafe paths', async () => {
    const f = path.join(dir, 'photo.bin'); fs.writeFileSync(f, Buffer.alloc(10_000, 7));
    expect(textOf(await uploadFile({ bucket: 'b', key: 'backups/photo.bin', file_path: f, chunk_size: 4096 }))).toBe(`Uploaded "${f}" → "b/backups/photo.bin" (9.8 KB)`);
    expect(fake.uploads[0].data).toHaveLength(10_000);
    expect(textOf(await uploadFile({ bucket: 'b', key: 'k', file_path: '../../etc/passwd' }))).toContain('Path rejected: contains ".." traversal');
    expect(fake.uploads).toHaveLength(1);
  });
});

describe('upload_directory', () => {
  it('rejects a missing dir and reports an empty one', async () => {
    expect(textOf(await uploadDirectory({ bucket: 'b', dir_path: path.join(dir, 'missing') }))).toBe(`"${path.join(dir, 'missing')}" is not an existing directory.`);
    expect(textOf(await uploadDirectory({ bucket: 'b', dir_path: dir }))).toBe(`No files found under "${dir}".`);
  });

  it('uploads recursively under a prefix with POSIX keys, skips symlinks, and reports failures', async () => {
    fs.mkdirSync(path.join(dir, 'sub', 'deep'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'root.txt'), 'r');
    fs.writeFileSync(path.join(dir, 'sub', 'deep', 'leaf.txt'), 'leaf');
    fs.writeFileSync(path.join(dir, 'sub', '.env'), 'SECRET=1');           // sensitive → per-file failure
    fs.symlinkSync(path.join(dir, 'root.txt'), path.join(dir, 'link.txt'));  // skipped

    const t = textOf(await uploadDirectory({ bucket: 'b', dir_path: dir, prefix: 'backup/' }));
    expect(t).toContain('Uploaded 2 of 3 file(s) to "b" (5 B):');
    expect(t).toContain('❌ Failed:');
    expect(t).toContain('backup/sub/.env: Path rejected: sensitive file ".env"');
    expect(fake.uploads.filter((u) => u.committed).map((u) => u.key).sort()).toEqual(['backup/root.txt', 'backup/sub/deep/leaf.txt']);
  });
});

it('exports 3 tool definitions', () => {
  expect(tools.map((t) => t.name)).toEqual(['upload_text', 'upload_file', 'upload_directory']);
});
