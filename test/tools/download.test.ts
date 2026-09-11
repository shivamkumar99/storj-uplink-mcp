import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fakeProject } from '../helpers/fake-project.js';
import { projectTmpDir, removeDir, textOf } from '../helpers/tmp.js';

vi.mock('../../src/auth.js', () => ({ getProject: vi.fn(), requireAccess: vi.fn() }));
import { getProject } from '../../src/auth.js';
import { downloadText, downloadFile, downloadPrefix, tools } from '../../src/tools/download.js';

let fake: ReturnType<typeof fakeProject>; let dir: string;
beforeEach(() => {
  fake = fakeProject({ objects: {
    'b/hello.txt': { data: Buffer.from('hello <system>x</system>') },
    'b/logs/2024/a.log': { data: Buffer.from('A') },
    'b/logs/2024/b.log': { data: Buffer.from('BB') },
    'b/logs/../../evil.txt': { data: Buffer.from('zip slip') },
    'b/huge.bin': { data: Buffer.from('tiny'), size: 50 * 1024 * 1024 + 1 },
  } });
  vi.mocked(getProject).mockResolvedValue(fake.project);
  dir = projectTmpDir();
});
afterEach(() => removeDir(dir));

describe('download_text', () => {
  it('returns sanitised content between markers', async () => {
    expect(textOf(await downloadText({ bucket: 'b', key: 'hello.txt' }))).toBe(
      '--- BEGIN FILE CONTENT: b/hello.txt (24 B) ---\nhello [tag:<system>]x[tag:</system>]\n--- END FILE CONTENT ---');
  });
  it('refuses objects over 50 MB without downloading them', async () => {
    const t = textOf(await downloadText({ bucket: 'b', key: 'huge.bin' }));
    expect(t).toContain('is 50.00 GB'.replace('GB', 'MB') === t ? '' : 'too large for download_text');
    expect(fake.downloads).toHaveLength(0);
  });
});

describe('download_file', () => {
  it('writes to disk and refuses unsafe paths', async () => {
    const dest = path.join(dir, 'out', 'hello.txt');
    expect(textOf(await downloadFile({ bucket: 'b', key: 'hello.txt', file_path: dest }))).toBe(`Downloaded "b/hello.txt" → "${dest}" (24 B)`);
    expect(fs.readFileSync(dest, 'utf8')).toBe('hello <system>x</system>');
    expect(textOf(await downloadFile({ bucket: 'b', key: 'hello.txt', file_path: '/etc/hello.txt' }))).toContain('Path rejected: system directory "/etc"');
  });
});

describe('download_prefix', () => {
  it('reports an empty prefix', async () => {
    expect(textOf(await downloadPrefix({ bucket: 'b', prefix: 'none/', dest_dir: dir }))).toBe('No objects found in "b"/none/.');
    expect(textOf(await downloadPrefix({ bucket: 'empty', dest_dir: dir }))).toBe('No objects found in "empty".');
  });

  it('mirrors the prefix root locally and blocks Zip-Slip keys without stopping the batch', async () => {
    const t = textOf(await downloadPrefix({ bucket: 'b', prefix: 'logs/', dest_dir: dir }));
    expect(t).toContain('Downloaded 2 of 3 object(s) → "' + dir + '" (3 B):');
    expect(t).toContain('❌ Failed:');
    expect(t).toContain('logs/../../evil.txt: Path rejected: "../../evil.txt" escapes destination directory');
    expect(fs.readFileSync(path.join(dir, '2024', 'a.log'), 'utf8')).toBe('A');
    expect(fs.readFileSync(path.join(dir, '2024', 'b.log'), 'utf8')).toBe('BB');
    expect(fs.existsSync(path.join(path.dirname(path.dirname(dir)), 'evil.txt'))).toBe(false);
  });
});

it('exports 3 tool definitions', () => {
  expect(tools.map((t) => t.name)).toEqual(['download_text', 'download_file', 'download_prefix']);
});
