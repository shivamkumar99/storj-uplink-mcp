import { describe, it, expect } from 'vitest';
import { runWithRequestContext, currentRequest, throwIfCancelled, type RequestContext } from '../src/context.js';

const ctx = (over: Partial<RequestContext> = {}): RequestContext => ({
  requestId: 42, signal: new AbortController().signal, sendNotification: async () => {}, ...over,
});

describe('request context', () => {
  it('is visible across awaits inside the run, and absent outside it', async () => {
    expect(currentRequest()).toBeUndefined();
    const seen = await runWithRequestContext(ctx({ progressToken: 'tok' }), async () => {
      await new Promise((r) => setTimeout(r, 1));
      return currentRequest();
    });
    expect(seen).toMatchObject({ requestId: 42, progressToken: 'tok' });
    expect(currentRequest()).toBeUndefined();
  });

  it('throwIfCancelled throws only when the request signal is aborted', async () => {
    expect(() => throwIfCancelled()).not.toThrow();                    // no context
    const ac = new AbortController();
    await runWithRequestContext(ctx({ signal: ac.signal }), async () => {
      expect(() => throwIfCancelled()).not.toThrow();
      ac.abort();
      expect(() => throwIfCancelled()).toThrow('Cancelled by client');
    });
  });
});
