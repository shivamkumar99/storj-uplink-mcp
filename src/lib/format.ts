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

// ---------------------------------------------------------------------------
// Timestamps.  Storj reports Unix seconds; they are rendered as ISO-8601 in a
// configurable display time zone (default UTC, set once at startup from
// STORJ_MCP_TIMEZONE).  In UTC the output is the familiar "…Z" form; in any
// other zone it carries the numeric offset, e.g. 2026-09-11T21:19:28+05:30,
// so the value stays unambiguous wherever it is pasted.
// ---------------------------------------------------------------------------

let displayTimeZone = 'UTC';

/** True when `tz` is an IANA time-zone name this runtime knows (e.g. "Asia/Kolkata"). */
export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Set the zone used by formatTimestamp.  Call once at startup; UTC by default. */
export function setDisplayTimeZone(tz: string): void {
  if (!isValidTimeZone(tz)) throw new Error(`Unknown time zone: "${tz}"`);
  displayTimeZone = tz;
}

export function getDisplayTimeZone(): string {
  return displayTimeZone;
}

function isoInTimeZone(date: Date, tz: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      timeZoneName: 'longOffset',
    }).formatToParts(date).map((p) => [p.type, p.value]),
  );
  // "GMT+05:30" → "+05:30"; plain "GMT" (zero offset) → "+00:00"
  const offset = parts.timeZoneName === 'GMT' ? '+00:00' : parts.timeZoneName.replace('GMT', '');
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`;
}

/** Format a Unix timestamp (seconds) as ISO-8601 in the display time zone, or 'none'. */
export function formatTimestamp(ts: number | null): string {
  if (!ts) return 'none';
  const date = new Date(ts * 1000);
  return displayTimeZone === 'UTC' ? date.toISOString() : isoInTimeZone(date, displayTimeZone);
}
