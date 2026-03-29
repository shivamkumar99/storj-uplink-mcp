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
    if (value === undefined) continue;

    if (REDACTED_FIELDS.has(key)) {
      parts.push(`${key}=[REDACTED]`);
    } else if (typeof value === 'string' && value.length > 100) {
      parts.push(`${key}="${value.slice(0, 50)}…" (${value.length} chars)`);
    } else if (typeof value === 'string') {
      parts.push(`${key}="${value}"`);
    } else if (typeof value === 'boolean' || typeof value === 'number') {
      parts.push(`${key}=${String(value)}`);
    } else if (Array.isArray(value)) {
      parts.push(`${key}=[${value.length} items]`);
    } else {
      parts.push(`${key}={…}`);
    }
  }

  const paramStr = parts.length > 0 ? ` ${parts.join(' ')}` : '';
  console.error(`[storj-mcp] AUDIT: ${tool}${paramStr}`);
}
