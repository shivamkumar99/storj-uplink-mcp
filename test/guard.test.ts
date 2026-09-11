import { describe, it, expect } from 'vitest';
import { guard } from '../src/guard.js';

function deferred<T>() {
  let resolve!: (v: T) => void; let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('guard', () => {
  it('runs at most 5 at once, queues up to 20, rejects beyond that, and drains the queue', async () => {
    const gates = Array.from({ length: 25 }, () => deferred<number>());
    let started = 0;
    const results = gates.map((g, i) => guard(() => { started++; return g.promise.then(() => i); }));

    expect(started).toBe(5);                                   // 5 active, 20 queued
    await expect(guard(async () => 0)).rejects.toThrow('Too many concurrent operations (5 active, 20 queued)');

    gates[0].resolve(0);
    await results[0];
    expect(started).toBe(6);                                   // one queued op started

    gates.forEach((g) => g.resolve(1));
    await Promise.all(results);
    expect(started).toBe(25);
  });

  it('propagates failures as Errors', async () => {
    await expect(guard(async () => { throw new Error('real'); })).rejects.toThrow('real');
    await expect(guard(() => Promise.reject('plain'))).rejects.toBeInstanceOf(Error);
    await expect(guard(async () => 'after')).resolves.toBe('after');   // slot released after failures
  });
});
