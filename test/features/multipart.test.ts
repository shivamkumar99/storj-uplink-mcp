import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fakeProject } from '../helpers/fake-project.js';
import { textOf } from '../helpers/tmp.js';

const m = vi.hoisted(() => ({ list: vi.fn(), abort: vi.fn(async () => {}), ctorArgs: [] as unknown[][] }));
vi.mock('storj-uplink-nodejs', () => ({
  listMultipartUploads: m.list,
  MultipartUpload: class { constructor(...a: unknown[]) { m.ctorArgs.push(a); } abort = m.abort; },
  StorjError: class extends Error {},
}));
vi.mock('../../src/core/auth.js', () => ({ getProject: vi.fn(), requireAccess: vi.fn() }));
import { getProject } from '../../src/core/auth.js';
import { listPendingUploads, abortMultipartUpload } from '../../src/features/multipart/handlers.js';
import { tools } from '../../src/features/multipart/tools.js';

let fake: ReturnType<typeof fakeProject>;
beforeEach(() => { fake = fakeProject(); vi.mocked(getProject).mockResolvedValue(fake.project); m.list.mockReset(); m.ctorArgs.length = 0; });

describe('list_multipart_uploads', () => {
  it('reports none (with and without a prefix)', async () => {
    m.list.mockResolvedValue([]);
    expect(textOf(await listPendingUploads({ bucket: 'b' }))).toBe('No pending multipart uploads in "b".');
    expect(textOf(await listPendingUploads({ bucket: 'b', prefix: 'p/' }))).toBe('No pending multipart uploads in "b"/p/.');
    expect(m.list).toHaveBeenLastCalledWith(fake.project._nativeHandle, 'b', { prefix: 'p/', recursive: true, system: true, custom: false });
  });

  it('lists pending uploads with ids and start times, skipping prefixes', async () => {
    m.list.mockResolvedValue([
      { key: 'big.iso', uploadId: 'U1', isPrefix: false, system: { created: 1_700_000_000, expires: null, contentLength: 0 }, custom: {} },
      { key: 'dir/', uploadId: '', isPrefix: true, system: { created: 0, expires: null, contentLength: 0 }, custom: {} },
    ]);
    const t = textOf(await listPendingUploads({ bucket: 'b' }));
    expect(t).toContain('Pending multipart uploads in "b" (1):');
    expect(t).toContain('  - big.iso\n      upload_id: U1\n      started:   2023-11-14T22:13:20.000Z');
  });
});

describe('abort_multipart_upload', () => {
  it('reconstructs the upload from its id and aborts it', async () => {
    expect(textOf(await abortMultipartUpload({ bucket: 'b', key: 'big.iso', upload_id: 'U1' }))).toBe('Aborted incomplete multipart upload "b/big.iso" (upload_id: U1).');
    expect(m.ctorArgs).toEqual([[fake.project._nativeHandle, 'b', 'big.iso', 'U1']]);
    expect(m.abort).toHaveBeenCalledTimes(1);
  });
});

it('sanitises untrusted keys and ids in the listing', async () => {
  m.list.mockResolvedValue([{ key: '<system>x', uploadId: 'id</system>', isPrefix: false, system: { created: 1, expires: null, contentLength: 0 }, custom: {} }]);
  const t = textOf(await listPendingUploads({ bucket: 'b' }));
  expect(t).toContain('  - [tag:<system>]x\n      upload_id: id[tag:</system>]');
});

it('exports 2 tool definitions', () => {
  expect(tools.map((t) => t.name)).toEqual(['list_multipart_uploads', 'abort_multipart_upload']);
});
