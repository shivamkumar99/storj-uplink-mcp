import { StorjError } from 'storj-uplink-nodejs';

// ---------------------------------------------------------------------------
// MCP tool responses — building them, and turning errors into them.
// ---------------------------------------------------------------------------

export interface McpTextResponse {
  [key: string]: unknown;
  content: Array<{ type: 'text'; text: string }>;
  /** Set on tool execution failures so clients and the model can tell them from normal output. */
  isError?: boolean;
}

/** A successful text response; objects are pretty-printed as JSON. */
export function ok(data: unknown): McpTextResponse {
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  return { content: [{ type: 'text', text }] };
}

/**
 * A text response that also carries `structuredContent` — for tools that
 * declare an outputSchema (clients validate it) and for MCP Apps views.
 */
export function okStructured(text: string, structuredContent: Record<string, unknown>): McpTextResponse {
  return { ...ok(text), structuredContent };
}

// ---------------------------------------------------------------------------
// Secrets redaction — strip access grants, API keys, and long base58 tokens
// from error messages before they reach the LLM.
// ---------------------------------------------------------------------------

/** Matches base58/base64 tokens >= 100 chars (typical Storj access grants) */
const ACCESS_GRANT_RE = /[1-9A-HJ-NP-Za-km-z]{100,}/g;

/** Matches common secret env var patterns leaked in errors */
const SECRET_PATTERN_RE = /(?:api[_-]?key|passphrase|secret|token|password|access[_-]?grant)\s*[:=]\s*\S+/gi;

function redactSecrets(text: string): string {
  return text
    .replace(ACCESS_GRANT_RE, '[REDACTED]')
    .replace(SECRET_PATTERN_RE, (match) => {
      const sep = match.includes('=') ? '=' : ':';
      const key = match.slice(0, match.indexOf(sep) + 1);
      return `${key} [REDACTED]`;
    });
}

/** Normalise any thrown value to an Error so promise rejections always carry one. */
export function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

/**
 * Format any error into a readable string and return it as an MCP error
 * response.  Never throws — the model sees the message instead of a crash.
 * Secrets are redacted before returning.
 */
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

  return { content: [{ type: 'text', text: redactSecrets(message) }], isError: true };
}

/**
 * Wrap a tool handler so any thrown error is caught and returned as text.
 * Use this in every tool function instead of a manual try/catch block.
 */
export function safeCall(
  fn: () => Promise<McpTextResponse>,
): Promise<McpTextResponse> {
  return fn().catch((err: unknown) => errorResponse(err));
}
