import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { auditLog } from '../src/audit.js';
import { runWithRequestContext } from '../src/context.js';

const T = '2026-09-11T10:00:00.000Z';
const capture = (tool: string, params?: Record<string, unknown>): string => {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  try { auditLog(tool, params); return String(spy.mock.calls[0]?.[0]); } finally { spy.mockRestore(); }
};

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(T)); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('auditLog', () => {
  it('stamps every line with the time and, inside a request, the MCP request id', async () => {
    expect(capture('list_buckets')).toBe(`[storj-mcp] AUDIT ${T} list_buckets`);
    expect(capture('list_buckets', {})).toBe(`[storj-mcp] AUDIT ${T} list_buckets`);
    const line = await runWithRequestContext({ requestId: 'abc', signal: new AbortController().signal, sendNotification: async () => {} }, async () => capture('t', { a: 1 }));
    expect(line).toBe(`[storj-mcp] AUDIT ${T} [req abc] t a=1`);
  });

  it('formats each value kind', () => {
    expect(capture('t', { bucket: 'b', n: 0, f: false, y: true, neg: -1.5, arr: [1, 2, 3], empty: [], obj: { a: 1 }, nul: null, d: new Date(0) }))
      .toBe(`[storj-mcp] AUDIT ${T} t bucket="b" n=0 f=false y=true neg=-1.5 arr=[3 items] empty=[0 items] obj={…} nul={…} d={…}`);
  });

  it('previews strings longer than 100 chars but logs exactly 100 in full', () => {
    expect(capture('t', { s: 'x'.repeat(101) })).toBe(`[storj-mcp] AUDIT ${T} t s="${'x'.repeat(50)}…" (101 chars)`);
    expect(capture('t', { s: 'x'.repeat(100) })).toBe(`[storj-mcp] AUDIT ${T} t s="${'x'.repeat(100)}"`);
  });

  it('skips undefined values while keeping insertion order', () => {
    expect(capture('t', { u: undefined, v: 'x', w: undefined, z: 1 })).toBe(`[storj-mcp] AUDIT ${T} t v="x" z=1`);
  });

  it.each(['content', 'access_grant', 'passphrase', 'api_key'])('redacts %s whatever its value', (field) => {
    for (const value of ['SUPERSECRET', 'x'.repeat(200), 12345, ['SUPERSECRET']]) {
      const line = capture('t', { [field]: value });
      expect(line).toBe(`[storj-mcp] AUDIT ${T} t ${field}=[REDACTED]`);
      expect(line).not.toContain('SUPERSECRET');
    }
  });

  it('does not log an undefined value even for a redacted field', () => {
    expect(capture('t', { content: undefined })).toBe(`[storj-mcp] AUDIT ${T} t`);
  });
});
