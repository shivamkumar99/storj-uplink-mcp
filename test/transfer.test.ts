import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bufferSource, fileSource, memorySink, fileSink, uploadObject, downloadObject } from '../src/tools/transfer.js';
import { fakeProject } from './helpers/fake-project.js';
import { runWithRequestContext } from '../src/context.js';

const cancelling = (ac: AbortController) => ({ requestId: 1, signal: ac.signal, sendNotification: async () => {} });

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'transfer-'));
const collect = async (it: Iterable<Buffer> | AsyncIterable<Buffer>) => { const out: Buffer[] = []; for await (const c of it) out.push(c); return out; };

describe('sources', () => {
  it('bufferSource yields bounded, lossless chunks', async () => {
    const data = Buffer.from('x'.repeat(10_000));
    const parts = await collect(bufferSource(data).chunks(4096));
    expect(parts.map((p) => p.length)).toEqual([4096, 4096, 1808]);
    expect(Buffer.concat(parts).equals(data)).toBe(true);
    expect(bufferSource(data).size).toBe(10_000);
  });

  it('fileSource streams a file in bounded chunks', async () => {
    const dir = tmp(); const file = path.join(dir, 'f.bin');
    fs.writeFileSync(file, Buffer.from('y'.repeat(5_000)));
    const src = fileSource(file);
    expect(src.size).toBe(5_000);
    const parts = await collect(src.chunks(2048));
    expect(parts.map((p) => p.length)).toEqual([2048, 2048, 904]);
  });
});

describe('sinks', () => {
  it('memorySink honours bytesRead and round-trips', () => {
    const sink = memorySink(); sink.open();
    sink.write(Buffer.from('hello world'), 5); sink.write(Buffer.from('!'), 1); sink.close();
    expect(sink.result().toString()).toBe('hello!');
    expect(sink.label).toBeUndefined();
  });

  it('fileSink creates parent dirs and only opens the file on open()', () => {
    const dest = path.join(tmp(), 'nested', 'dir', 'out.txt');
    const sink = fileSink(dest);
    expect(sink.label).toBe(dest);
    expect(fs.existsSync(dest)).toBe(false);   // nothing touched yet
    sink.close();                              // closing an unopened sink is a no-op
    sink.open(); sink.write(Buffer.from('abcdef'), 3); sink.close();
    expect(fs.readFileSync(dest, 'utf8')).toBe('abc');
  });
});

describe('uploadObject', () => {
  it('writes chunks, sets metadata, passes expiry, commits, and returns bytes sent', async () => {
    const { project, uploads, store } = fakeProject();
    const expires = new Date('2030-01-01T00:00:00Z');
    const sent = await uploadObject(project, { bucket: 'b', key: 'k' }, bufferSource(Buffer.from('0123456789')), { chunkSize: 4096, metadata: { a: '1' }, expires });
    expect(sent).toBe(10);
    expect(uploads[0]).toMatchObject({ bucket: 'b', key: 'k', committed: true, aborted: false, metadata: { a: '1' }, opts: { expires } });
    expect(store.get('b/k')?.data.toString()).toBe('0123456789');
  });

  it('passes no options when there is no expiry', async () => {
    const { project, uploads } = fakeProject();
    await uploadObject(project, { bucket: 'b', key: 'k' }, bufferSource(Buffer.from('z')));
    expect(uploads[0].opts).toBeUndefined();
  });

  it('aborts the Storj upload when the client cancels mid-stream', async () => {
    const { project, uploads } = fakeProject(); const ac = new AbortController();
    const src = { size: 2, async *chunks() { yield Buffer.from('a'); ac.abort(); yield Buffer.from('b'); } };
    await expect(runWithRequestContext(cancelling(ac), () => uploadObject(project, { bucket: 'b', key: 'k' }, src))).rejects.toThrow('Cancelled by client');
    expect(uploads[0]).toMatchObject({ committed: false, aborted: true });
  });

  it('aborts (never commits) when the source fails mid-stream', async () => {
    const { project, uploads } = fakeProject();
    const failing = { size: 3, async *chunks() { yield Buffer.from('a'); throw new Error('disk gone'); } };
    await expect(uploadObject(project, { bucket: 'b', key: 'k' }, failing)).rejects.toThrow('disk gone');
    expect(uploads[0]).toMatchObject({ committed: false, aborted: true });
  });
});

describe('downloadObject', () => {
  it('drains into the sink, closes both ends, and returns bytes received', async () => {
    const data = Buffer.from('a'.repeat(10_000));
    const { project, downloads } = fakeProject({ objects: { 'b/k': { data } } });
    const sink = memorySink();
    const got = await downloadObject(project, { bucket: 'b', key: 'k' }, sink, 4096); // short final read ends the loop
    expect(got).toBe(10_000);
    expect(sink.result().equals(data)).toBe(true);
    expect(downloads[0].closed).toBe(true);
  });

  it('handles the SDK EOF-by-throw quirk when the size is an exact multiple of the chunk', async () => {
    const data = Buffer.from('b'.repeat(8192));
    const { project } = fakeProject({ objects: { 'b/k': { data } } });
    const sink = memorySink();
    expect(await downloadObject(project, { bucket: 'b', key: 'k' }, sink, 4096)).toBe(8192); // last full read → next read throws EOF
    expect(sink.result().equals(data)).toBe(true);
  });

  it('stops reading and closes both ends when the client cancels', async () => {
    const { project, downloads } = fakeProject({ objects: { 'b/k': { data: Buffer.from('c'.repeat(10_000)) } } }); const ac = new AbortController();
    const sink = { open() {}, write() { ac.abort(); }, close: vi.fn() };
    await expect(runWithRequestContext(cancelling(ac), () => downloadObject(project, { bucket: 'b', key: 'k' }, sink, 4096))).rejects.toThrow('Cancelled by client');
    expect(downloads[0].closed).toBe(true);
    expect(sink.close).toHaveBeenCalledTimes(1);
  });

  it('never creates the destination file when the object is missing', async () => {
    const { project } = fakeProject();
    const dest = path.join(tmp(), 'missing.txt');
    await expect(downloadObject(project, { bucket: 'b', key: 'nope' }, fileSink(dest))).rejects.toThrow('object not found');
    expect(fs.existsSync(dest)).toBe(false);
  });

  it('writes to disk through fileSink', async () => {
    const { project } = fakeProject({ objects: { 'b/k': { data: Buffer.from('on disk') } } });
    const dest = path.join(tmp(), 'out.txt');
    expect(await downloadObject(project, { bucket: 'b', key: 'k' }, fileSink(dest))).toBe(7);
    expect(fs.readFileSync(dest, 'utf8')).toBe('on disk');
  });
});
