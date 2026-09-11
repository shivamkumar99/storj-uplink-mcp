/**
 * @file audit.ts
 * @brief Audit logging for MCP tool invocations.
 *
 * Logs every tool call to stderr with tool name, key parameters,
 * and timestamp.  Sensitive fields (access grants, file content)
 * are redacted.  OWASP MCP: monitoring & auditing.
 */

// ---------------------------------------------------------------------------
// Fields that should never appear in audit logs
// ---------------------------------------------------------------------------

const REDACTED_FIELDS = new Set([
  'content',         // upload_text content
  'access_grant',    // serialized grants
  'passphrase',
  'api_key',
]);

/** Strings longer than this are logged as a preview rather than in full. */
const MAX_INLINE_STRING = 100;

/** How many characters of a long string to keep in the preview. */
const PREVIEW_CHARS = 50;

// ---------------------------------------------------------------------------
// Parameter formatting — Chain of Responsibility.
//
// Each formatter either handles a (key, value) entry by returning its
// `key=value` text, or declines by returning undefined so the next one is
// tried.  The order is deliberate:
//   1. redaction is decided before anything looks at the value, so a secret
//      can never leak through a later formatter;
//   2. the long-string preview is checked before the plain-string case.
// Adding a new value kind (Date, Buffer, …) is one new entry — the dispatch
// loop and auditLog() never change.
// ---------------------------------------------------------------------------

type ParamFormatter = (key: string, value: unknown) => string | undefined;

const FORMATTERS: readonly ParamFormatter[] = [
  // Secrets — matched on the field name, whatever the value is
  (key) => (REDACTED_FIELDS.has(key) ? `${key}=[REDACTED]` : undefined),

  // Long strings — a preview plus the true length
  (key, value) =>
    typeof value === 'string' && value.length > MAX_INLINE_STRING
      ? `${key}="${value.slice(0, PREVIEW_CHARS)}…" (${value.length} chars)`
      : undefined,

  // Short strings — logged in full
  (key, value) => (typeof value === 'string' ? `${key}="${value}"` : undefined),

  // Numbers and booleans
  (key, value) =>
    typeof value === 'boolean' || typeof value === 'number' ? `${key}=${String(value)}` : undefined,

  // Arrays — length only, never the elements
  (key, value) => (Array.isArray(value) ? `${key}=[${value.length} items]` : undefined),
];

/** Objects, null, and anything no formatter claims are summarised, never dumped. */
function formatParam(key: string, value: unknown): string {
  for (const tryFormat of FORMATTERS) {
    const text = tryFormat(key, value);
    if (text !== undefined) return text;
  }
  return `${key}={…}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Log a tool invocation to stderr.
 *
 * @param tool   - The MCP tool name (e.g. "upload_text", "delete_bucket")
 * @param params - The raw tool parameters (sensitive fields are redacted)
 */
export function auditLog(tool: string, params: Record<string, unknown> = {}): void {
  const parts: string[] = [];

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue; // omitted optional arguments are not logged
    parts.push(formatParam(key, value));
  }

  const paramStr = parts.length > 0 ? ` ${parts.join(' ')}` : '';
  console.error(`[storj-mcp] AUDIT: ${tool}${paramStr}`);
}
