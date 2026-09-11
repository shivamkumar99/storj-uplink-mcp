import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setServer, createProgress } from '../src/progress.js';

type Sent = { level: string; data: string };

describe('createProgress', () => {
  const sent: Sent[] = [];
  const server = { sendLoggingMessage: vi.fn(async (m: Sent) => { sent.push(m); }) };

  beforeEach(() => { sent.length = 0; vi.useFakeTimers(); vi.setSystemTime(1_000_000); setServer(server as never); });
  afterEach(() => { vi.useRealTimers(); setServer(null as never); });

  it('sends the first update immediately, throttles for 5 s, then sends again', () => {
    const p = createProgress('Uploading "k"');
    p.update(1024, 4096);
    vi.advanceTimersByTime(4_999);
    p.update(2048, 4096);                 // dropped — inside the throttle window
    vi.advanceTimersByTime(1);
    p.update(4096, 4096, 'almost');       // 5 s elapsed — sent, with detail
    expect(sent.map((m) => m.data)).toEqual([
      '⏳ Uploading "k": 1.0 KB / 4.0 KB (25%)',
      '⏳ Uploading "k": 4.0 KB / 4.0 KB (100%) — almost',
    ]);
    expect(sent.every((m) => m.level === 'info')).toBe(true);
  });

  it('shows a running total when the total is unknown', () => {
    createProgress('Listing').update(300, 0, 'querying…');
    expect(sent[0].data).toBe('⏳ Listing: 300 B so far… — querying…');
  });

  it('done() always sends, bypassing the throttle', () => {
    const p = createProgress('L');
    p.update(1, 10);
    p.done('finished');
    expect(sent.map((m) => m.data)).toEqual(['⏳ L: 1 B / 10 B (10%)', '✅ finished']);
  });

  it('is a silent no-op with no server and swallows send failures', () => {
    setServer(null as never);
    expect(() => createProgress('x').done('y')).not.toThrow();
    setServer({ sendLoggingMessage: () => Promise.reject(new Error('offline')) } as never);
    expect(() => createProgress('x').done('y')).not.toThrow();
  });
});
