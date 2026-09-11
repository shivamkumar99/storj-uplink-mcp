import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createProgress } from '../src/progress.js';
import { runWithRequestContext, type RequestContext } from '../src/context.js';
import type { ServerNotification } from '@modelcontextprotocol/sdk/types.js';

type Params = { progressToken: string | number; progress: number; total?: number; message: string };

describe('createProgress', () => {
  const sent: Params[] = [];
  const stderr: string[] = [];
  const ctx = (progressToken?: string): RequestContext => ({
    requestId: 1, signal: new AbortController().signal, progressToken,
    sendNotification: vi.fn(async (n: ServerNotification) => { sent.push(n.params as unknown as Params); }),
  });
  const inCtx = (token: string | undefined, fn: () => void) => runWithRequestContext(ctx(token), async () => fn());

  beforeEach(() => {
    sent.length = 0; stderr.length = 0;
    vi.useFakeTimers(); vi.setSystemTime(1_000_000);
    vi.spyOn(console, 'error').mockImplementation((m: string) => { stderr.push(m); });
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('sends notifications/progress with the client token, throttled to one per 5 s, plus stderr', async () => {
    await inCtx('tok', () => {
      const p = createProgress('Uploading "k"');
      p.update(1024, 4096);
      vi.advanceTimersByTime(4_999);
      p.update(2048, 4096);                 // dropped — inside the throttle window
      vi.advanceTimersByTime(1);
      p.update(4096, 4096, 'almost');
    });
    expect(sent).toEqual([
      { progressToken: 'tok', progress: 1024, total: 4096, message: '⏳ Uploading "k": 1.0 KB / 4.0 KB (25%)' },
      { progressToken: 'tok', progress: 4096, total: 4096, message: '⏳ Uploading "k": 4.0 KB / 4.0 KB (100%) — almost' },
    ]);
    expect(stderr).toEqual(['[storj-mcp] ⏳ Uploading "k": 1.0 KB / 4.0 KB (25%)', '[storj-mcp] ⏳ Uploading "k": 4.0 KB / 4.0 KB (100%) — almost']);
  });

  it('keeps progress strictly increasing even for unknown-total ticks, and done() lands on the total', async () => {
    await inCtx('tok', () => {
      const p = createProgress('Listing');
      p.update(0, 0, 'querying…');
      vi.advanceTimersByTime(5_000);
      p.update(0, 0, 'still querying…');
      p.done('listed 3 objects');
    });
    expect(sent.map((s) => s.progress)).toEqual([0, 1, 2]);         // 0 → 1 → 2, never repeats
    expect(sent.map((s) => s.total)).toEqual([undefined, undefined, undefined]);
    expect(sent.at(-1)?.message).toBe('✅ listed 3 objects');

    sent.length = 0;
    await inCtx('tok', () => { const p = createProgress('Up'); p.update(10, 100); p.done('ok'); });
    expect(sent.map((s) => [s.progress, s.total])).toEqual([[10, 100], [100, 100]]);
  });

  it('done() always sends, bypassing the throttle', async () => {
    await inCtx('tok', () => { const p = createProgress('L'); p.update(1, 10); p.done('finished'); });
    expect(sent.map((s) => s.message)).toEqual(['⏳ L: 1 B / 10 B (10%)', '✅ finished']);
  });

  it('only logs to stderr when the client sent no progress token or there is no request', async () => {
    await inCtx(undefined, () => createProgress('x').done('y'));
    createProgress('x').done('z');                                    // outside any request
    expect(sent).toEqual([]);
    expect(stderr).toEqual(['[storj-mcp] ✅ y', '[storj-mcp] ✅ z']);
  });

  it('swallows notification failures', async () => {
    const failing: RequestContext = { ...ctx('tok'), sendNotification: () => Promise.reject(new Error('offline')) };
    await expect(runWithRequestContext(failing, async () => { createProgress('x').done('y'); })).resolves.toBeUndefined();
  });
});
