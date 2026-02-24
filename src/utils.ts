import { StorjError } from 'storj-uplink-nodejs';

// ---------------------------------------------------------------------------
// MCP tool response type
// ---------------------------------------------------------------------------

export interface McpTextResponse {
  [key: string]: unknown;
  content: Array<{ type: 'text'; text: string }>;
}

// ---------------------------------------------------------------------------
// Build a successful text response
// ---------------------------------------------------------------------------

export function ok(data: unknown): McpTextResponse {
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  return { content: [{ type: 'text', text }] };
}

// ---------------------------------------------------------------------------
// Format any error into a readable string and return as MCP response.
// Never throws — Claude sees the error message instead of a crash.
// ---------------------------------------------------------------------------

export function errorResponse(err: unknown): McpTextResponse {
  let message: string;

  if (err instanceof StorjError) {
    message = `${err.constructor.name}: ${err.message}`;
    if (err.details) message += `\nDetails: ${err.details}`;
  } else if (err instanceof Error) {
    message = `Error: ${err.message}`;
  } else {
    message = `Error: ${String(err)}`;
  }

  return { content: [{ type: 'text', text: message }] };
}

// ---------------------------------------------------------------------------
// Wrap a tool handler so any thrown error is caught and returned as text
// ---------------------------------------------------------------------------

export function safeCall<T>(
  fn: () => Promise<McpTextResponse>,
): Promise<McpTextResponse> {
  return fn().catch((err: unknown) => errorResponse(err));
}

// ---------------------------------------------------------------------------
// Format bytes to a human-readable string
// ---------------------------------------------------------------------------

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// ---------------------------------------------------------------------------
// Format a Unix timestamp (seconds) to ISO string, or 'none'
// ---------------------------------------------------------------------------

export function formatTimestamp(ts: number | null): string {
  if (!ts) return 'none';
  return new Date(ts * 1000).toISOString();
}
