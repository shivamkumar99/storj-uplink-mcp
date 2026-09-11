import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fakeProject } from '../helpers/fake-project.js';
import { textOf } from '../helpers/tmp.js';

vi.mock('../../src/auth.js', () => ({ getProject: vi.fn(), requireAccess: vi.fn() }));
import { getProject } from '../../src/auth.js';
import { listObjects, statObject, deleteObject, deleteObjects, copyObject, moveObject, updateMetadata, tools } from '../../src/tools/objects.js';

let fake: ReturnType<typeof fakeProject>;
beforeEach(() => {
  fake = fakeProject({ objects: {
    'b/a.log': { data: Buffer.from('aaaa'), custom: { owner: 'me' } },
    'b/photos/p1.jpg': { data: Buffer.from('jpg1') },
    'b/photos/2024/p2.jpg': { data: Buffer.from('jpg22') },
    'b/notes.txt': { data: Buffer.from('n') },
  } });
  vi.mocked(getProject).mockResolvedValue(fake.project);
});

describe('list / stat', () => {
  it('lists with sizes, filters by prefix, and reports none', async () => {
    const t = textOf(await listObjects({ bucket: 'b', prefix: 'photos/', recursive: true }));
    expect(t).toContain('Objects in "b" (2):');
    expect(t).toContain('  📄 photos/p1.jpg  (4 B, created: 2023-11-14T22:13:20.000Z)');
    expect(textOf(await listObjects({ bucket: 'b', prefix: 'nothing/' }))).toBe('No objects found in "b"/nothing/.');
    expect(textOf(await listObjects({ bucket: 'empty' }))).toBe('No objects found in "empty".');
  });

  it('always returns structuredContent alongside the text', async () => {
    const res = await listObjects({ bucket: 'b', prefix: 'photos/', recursive: true });
    expect(res.structuredContent).toMatchObject({ bucket: 'b', prefix: 'photos/', recursive: true });
    expect((res.structuredContent as { objects: unknown[] }).objects).toHaveLength(2);
    expect((await listObjects({ bucket: 'empty' })).structuredContent).toEqual({ bucket: 'empty', prefix: '', recursive: false, objects: [] });
  });

  it('stats an object with metadata', async () => {
    expect(JSON.parse(textOf(await statObject({ bucket: 'b', key: 'a.log' })))).toEqual({
      key: 'a.log', bucket: 'b', size: '4 B', size_bytes: 4, created: '2023-11-14T22:13:20.000Z', expires: 'none', metadata: { owner: 'me' },
    });
  });
});

describe('single-object mutations', () => {
  it('delete / copy / move / update_metadata', async () => {
    expect(textOf(await deleteObject({ bucket: 'b', key: 'notes.txt' }))).toBe('Object "notes.txt" deleted from bucket "b".');
    expect(textOf(await copyObject({ src_bucket: 'b', src_key: 'a.log', dst_bucket: 'c', dst_key: 'copy.log' }))).toBe('Copied "b/a.log" → "c/copy.log"');
    expect(textOf(await moveObject({ src_bucket: 'c', src_key: 'copy.log', dst_bucket: 'c', dst_key: 'moved.log' }))).toBe('Moved "c/copy.log" → "c/moved.log"');
    expect(fake.store.has('c/moved.log')).toBe(true);
    expect(textOf(await updateMetadata({ bucket: 'b', key: 'a.log', metadata: { x: '1' } }))).toBe('Metadata updated for "b/a.log":\n{\n  "x": "1"\n}');
    expect(fake.store.get('b/a.log')?.custom).toEqual({ x: '1' });
    expect(textOf(await deleteObject({ bucket: 'b', key: 'ghost' }))).toBe('Error: object not found: b/ghost');
  });
});

describe('delete_objects', () => {
  it('requires confirm_all when unfiltered', async () => {
    expect(textOf(await deleteObjects({ bucket: 'b' }))).toContain('this would delete ALL objects in bucket "b"');
    expect(fake.store.size).toBe(4);
  });

  it.each([
    [{ pattern: '*.zzz' }, 'No objects matched pattern "*.zzz" in bucket "b".'],
    [{ prefix: 'zzz/' }, 'No objects matched prefix "zzz/" in bucket "b".'],
    [{ prefix: 'zzz/', pattern: '*' }, 'No objects matched pattern "*" in bucket "b".'],
  ])('explains an empty match for %o', async (filter, msg) => {
    expect(textOf(await deleteObjects({ bucket: 'b', ...filter }))).toBe(msg);
  });

  it('deletes by glob (recursive) and by prefix, sorted alphabetically', async () => {
    expect(textOf(await deleteObjects({ bucket: 'b', pattern: 'photos/**/*.jpg' }))).toBe(
      'Deleted 2 of 2 object(s) from "b":\n\n✅ Deleted:\n  - photos/2024/p2.jpg\n  - photos/p1.jpg');
    expect(textOf(await deleteObjects({ bucket: 'b', prefix: 'a.' }))).toContain('  - a.log');
  });

  it('reports per-key failures and honours confirm_all', async () => {
    expect(textOf(await deleteObjects({ bucket: 'b', keys: ['notes.txt', 'ghost'] }))).toBe(
      'Deleted 1 of 2 object(s) from "b":\n\n✅ Deleted:\n  - notes.txt\n\n❌ Failed:\n  - ghost: object not found: b/ghost');
    expect(textOf(await deleteObjects({ bucket: 'b', confirm_all: true }))).toContain('Deleted 3 of 3 object(s)');
    expect(fake.store.size).toBe(0);
  });
});

describe('output sanitisation', () => {
  it('neutralises injection tags in object keys and metadata before they reach the model', async () => {
    fake.store.set('b/<system>evil.txt', { data: Buffer.from('x'), custom: { '<IMPORTANT>k': 'v</system>' } });
    expect(textOf(await listObjects({ bucket: 'b', prefix: '<system>' }))).toContain('  📄 [tag:<system>]evil.txt');
    const stat = JSON.parse(textOf(await statObject({ bucket: 'b', key: '<system>evil.txt' })));
    expect(stat.key).toBe('[tag:<system>]evil.txt');
    expect(stat.metadata).toEqual({ '[tag:<IMPORTANT>]k': 'v[tag:</system>]' });
  });
});

it('exports 7 tool definitions', () => {
  expect(tools.map((t) => t.name)).toEqual(['list_objects', 'stat_object', 'delete_object', 'delete_objects', 'copy_object', 'move_object', 'update_metadata']);
});
