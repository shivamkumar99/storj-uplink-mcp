/**
 * @file guard.ts
 * @brief In-process concurrency limiter for MCP tool operations.
 *
 * Prevents runaway tool calls from overwhelming the Storj connection
 * or local disk.  OWASP MCP: resource controls / rate limiting.
 *
 * Usage:
 *   const result = await guard(() => myToolHandler(args));
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Maximum number of tool operations running concurrently */
const MAX_CONCURRENT = 5;

/** Maximum queued operations before rejecting */
const MAX_QUEUED = 20;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let _active = 0;
const _queue: Array<() => void> = [];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run `fn` with concurrency limiting.
 *
 * - If fewer than MAX_CONCURRENT operations are running, `fn` starts immediately.
 * - Otherwise it is queued.  If the queue exceeds MAX_QUEUED, the call is rejected.
 */
export function guard<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      _active++;
      fn().then(
        (val) => { _active--; drain(); resolve(val); },
        (err: unknown) => { _active--; drain(); reject(err); },
      );
    };

    if (_active < MAX_CONCURRENT) {
      run();
    } else if (_queue.length < MAX_QUEUED) {
      _queue.push(run);
    } else {
      reject(new Error(
        `Too many concurrent operations (${_active} active, ${_queue.length} queued). ` +
        'Please wait for current operations to complete.',
      ));
    }
  });
}

function drain(): void {
  if (_queue.length > 0 && _active < MAX_CONCURRENT) {
    const next = _queue.shift();
    if (next) next();
  }
}
