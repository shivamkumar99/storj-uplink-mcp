import { describe, it, expect } from 'vitest';
import { expiryDate, formatBytes, formatTimestamp, optionalPrefix, setDisplayTimeZone, getDisplayTimeZone, isValidTimeZone } from '../../src/lib/format.js';

describe('small formatters', () => {
  it('expiryDate', () => {
    expect(expiryDate(undefined)).toBeUndefined();
    const d = expiryDate(2)!;
    expect(Math.abs(d.getTime() - (Date.now() + 2 * 3600_000))).toBeLessThan(1000);
  });
  it('formatBytes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
    expect(formatBytes(2.5 * 1024 ** 3)).toBe('2.50 GB');
  });
  it('formatTimestamp', () => {
    expect(formatTimestamp(null)).toBe('none');
    expect(formatTimestamp(0)).toBe('none');
    expect(formatTimestamp(1_700_000_000)).toBe('2023-11-14T22:13:20.000Z');
  });

  it('formatTimestamp honours the display time zone with a numeric offset', () => {
    try {
      setDisplayTimeZone('Asia/Kolkata');
      expect(getDisplayTimeZone()).toBe('Asia/Kolkata');
      expect(formatTimestamp(1_700_000_000)).toBe('2023-11-15T03:43:20+05:30');
      setDisplayTimeZone('America/New_York');
      expect(formatTimestamp(1_700_000_000)).toBe('2023-11-14T17:13:20-05:00');
      setDisplayTimeZone('Etc/GMT');
      expect(formatTimestamp(1_700_000_000)).toBe('2023-11-14T22:13:20+00:00');
      expect(formatTimestamp(null)).toBe('none');
    } finally {
      setDisplayTimeZone('UTC');
    }
    expect(isValidTimeZone('Asia/Kolkata')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(() => setDisplayTimeZone('Mars/Olympus')).toThrow(/Unknown time zone/);
    expect(getDisplayTimeZone()).toBe('UTC');
  });
  it('optionalPrefix', () => {
    expect(optionalPrefix(undefined)).toBe('');
    expect(optionalPrefix('')).toBe('');
    expect(optionalPrefix('p/')).toBe('/p/');
  });
});
