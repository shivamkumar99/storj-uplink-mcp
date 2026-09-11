import { AsyncLocalStorage } from 'node:async_hooks';
import type { RequestId, ServerNotification } from '@modelcontextprotocol/sdk/types.js';

// ---------------------------------------------------------------------------
// Per-request context.
//
// The MCP SDK hands every tool callback an `extra` object with the request id,
// an AbortSignal that fires on notifications/cancelled, the client's optional
// progress token, and a way to send notifications on that request's stream.
// Rather than thread that through 28 handler signatures, the registry stores
// it in AsyncLocalStorage for the duration of the call and the cross-cutting
// helpers (progress, batch, transfer, audit) read it from here.
// ---------------------------------------------------------------------------

export interface RequestContext {
  requestId: RequestId;
  /** Aborted when the client cancels the request. */
  signal: AbortSignal;
  /** Present when the client asked for progress updates for this request. */
  progressToken?: string | number;
  sendNotification: (notification: ServerNotification) => Promise<void>;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Run `fn` with `ctx` visible to everything it calls, synchronously or asynchronously. */
export function runWithRequestContext<T>(ctx: RequestContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(ctx, fn);
}

/** The context of the request currently being handled, if any. */
export function currentRequest(): RequestContext | undefined {
  return storage.getStore();
}

/**
 * Throw if the client has cancelled the current request. Called inside long
 * loops so work stops promptly (MCP: servers SHOULD stop processing and free
 * resources on cancellation).
 */
export function throwIfCancelled(): void {
  if (storage.getStore()?.signal.aborted) {
    throw new Error('Cancelled by client');
  }
}
