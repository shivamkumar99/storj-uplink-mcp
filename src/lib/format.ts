// ---------------------------------------------------------------------------
// Small pure formatters shared by tool output.
// ---------------------------------------------------------------------------

/** Convert an "expires in N hours" value to an absolute Date, or undefined. */
export function expiryDate(hours?: number): Date | undefined {
  if (hours === undefined) return undefined;
  return new Date(Date.now() + hours * 3600 * 1000);
}

/**
 * Render an optional key prefix as a "/prefix" message suffix, or "" when absent.
 * Keeps call sites free of nested template literals (SonarQube S4624).
 */
export function optionalPrefix(prefix?: string): string {
  return prefix ? `/${prefix}` : '';
}

/** Format bytes to a human-readable string. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Format a Unix timestamp (seconds) to an ISO string, or 'none'. */
export function formatTimestamp(ts: number | null): string {
  if (!ts) return 'none';
  return new Date(ts * 1000).toISOString();
}
