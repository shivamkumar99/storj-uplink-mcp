import { describe, it, expect } from 'vitest';
import { runBatch, formatBatchReport, type BatchResult } from '../../src/transfer/batch.js';
import { runWithRequestContext } from '../../src/core/context.js';

describe('runBatch', () => {
  it('runs every item, never stops on a failure, and sums numeric returns', async () => {
    const calls: string[] = [];
    const r = await runBatch(['a', 'b', 'c', 'd'], {
      label: 'L', verb: 'doing', itemName: (x) => x,
      op: async (x) => { calls.push(x); if (x === 'b') throw new Error('boom'); return x === 'd' ? undefined : 10; },
      done: (res) => `done ${res.succeeded.length}/${res.total}`,
    });
    expect(calls).toEqual(['a', 'b', 'c', 'd']);
    expect(r).toEqual({ total: 4, succeeded: ['a', 'c', 'd'], failed: [{ name: 'b', error: 'boom' }], totalBytes: 20 });
  });

  it('stringifies non-Error throwables', async () => {
    const r = await runBatch([1], { label: 'L', verb: 'v', itemName: String, op: async () => { throw 'plain'; }, done: () => 'd' });
    expect(r.failed).toEqual([{ name: '1', error: 'plain' }]);
  });

  it('stops as soon as the client cancels the request', async () => {
    const ac = new AbortController(); const calls: string[] = [];
    const run = runWithRequestContext({ requestId: 1, signal: ac.signal, sendNotification: async () => {} }, () =>
      runBatch(['a', 'b', 'c'], { label: 'L', verb: 'v', itemName: (x) => x, op: async (x) => { calls.push(x); ac.abort(); }, done: () => 'd' }));
    await expect(run).rejects.toThrow('Cancelled by client');
    expect(calls).toEqual(['a']);
  });

  it('handles an empty list', async () => {
    const r = await runBatch([], { label: 'L', verb: 'v', itemName: String, op: async () => 1, done: () => 'd' });
    expect(r).toEqual({ total: 0, succeeded: [], failed: [], totalBytes: 0 });
  });
});

describe('formatBatchReport', () => {
  const del: BatchResult = { total: 3, succeeded: ['x', 'y'], failed: [{ name: 'z', error: 'nope' }], totalBytes: 0 };

  it('lists successes under the label and failures under ❌', () => {
    expect(formatBatchReport(del, { header: 'Deleted 2 of 3 bucket(s):', successLabel: '✅ Deleted:' })).toBe(
      ['Deleted 2 of 3 bucket(s):', '', '✅ Deleted:', '  - x', '  - y', '', '❌ Failed:', '  - z: nope'].join('\n'),
    );
  });

  it('omits the success list when no label is given, and inserts notes after the header', () => {
    const up: BatchResult = { total: 2, succeeded: ['k1'], failed: [{ name: 'k2', error: 'bad' }], totalBytes: 5 };
    expect(formatBatchReport(up, { header: 'H', notes: ['⚠️  capped'] })).toBe(['H', '', '⚠️  capped', '', '❌ Failed:', '  - k2: bad'].join('\n'));
  });

  it('sanitises untrusted names and errors (object keys may carry injection tags)', () => {
    expect(formatBatchReport({ total: 2, succeeded: ['<system>a'], failed: [{ name: 'b</system>', error: '<IMPORTANT>x' }], totalBytes: 0 }, { header: 'H', successLabel: '✅ Deleted:' }))
      .toBe(['H', '', '✅ Deleted:', '  - [tag:<system>]a', '', '❌ Failed:', '  - b[tag:</system>]: [tag:<IMPORTANT>]x'].join('\n'));
  });

  it('never prints a dangling success label or an empty ❌ block', () => {
    expect(formatBatchReport({ total: 1, succeeded: [], failed: [], totalBytes: 0 }, { header: 'H', successLabel: '✅ Deleted:' })).toBe('H');
    expect(formatBatchReport({ total: 1, succeeded: ['q'], failed: [], totalBytes: 0 }, { header: 'H', successLabel: '✅ Deleted:' }))
      .toBe(['H', '', '✅ Deleted:', '  - q'].join('\n'));
  });
});
