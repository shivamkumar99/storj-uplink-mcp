import { describe, it, expect } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { StorjError } from 'storj-uplink-nodejs';
import {
  ok, errorResponse, safeCall, sanitizeOutput, withTimeout, validateFilePath, resolveWithinDir,
  expiryDate, formatBytes, formatTimestamp, optionalPrefix, toError,
  TIMEOUT_METADATA_MS, TIMEOUT_TRANSFER_MS,
} from '../src/utils.js';
import { textOf } from './helpers/tmp.js';

describe('ok / errorResponse / safeCall', () => {
  it('ok passes strings through and pretty-prints objects', () => {
    expect(textOf(ok('hi'))).toBe('hi');
    expect(textOf(ok({ a: 1 }))).toBe('{\n  "a": 1\n}');
  });

  it('formats Error, non-Error and StorjError (with details)', () => {
    expect(textOf(errorResponse(new Error('boom')))).toBe('Error: boom');
    expect(textOf(errorResponse('plain'))).toBe('Error: plain');
    const se = new StorjError('nope', 2, 'more info');
    expect(textOf(errorResponse(se))).toBe('StorjError: nope: more info\nDetails: more info');
  });

  it('redacts access-grant-like tokens and key=value secrets in error text', () => {
    const grant = '1'.repeat(120);
    const t = textOf(errorResponse(new Error(`failed with grant ${grant} and api_key: abc123 and token=xyz`)));
    expect(t).not.toContain(grant);
    expect(t).not.toContain('abc123');
    expect(t).not.toContain('xyz');
    expect(t).toContain('[REDACTED]');
    expect(t).toContain('api_key: [REDACTED]');
  });

  it('safeCall returns the value or an error response, never throws', async () => {
    expect(textOf(await safeCall(async () => ok('fine')))).toBe('fine');
    expect(textOf(await safeCall(async () => { throw new Error('bad'); }))).toBe('Error: bad');
  });
});

describe('sanitizeOutput', () => {
  it('neutralises prompt-injection tags but leaves ordinary markup alone', () => {
    expect(sanitizeOutput('<system>x</system> <IMPORTANT>y</IMPORTANT> <b>ok</b>'))
      .toBe('[tag:<system>]x[tag:</system>] [tag:<IMPORTANT>]y[tag:</IMPORTANT>] <b>ok</b>');
  });
});

describe('withTimeout / toError', () => {
  it('resolves in time, times out otherwise, and normalises rejections to Errors', async () => {
    await expect(withTimeout(Promise.resolve(1), 100, 'x')).resolves.toBe(1);
    await expect(withTimeout(new Promise(() => {}), 10, 'slow op')).rejects.toThrow('Operation timed out after 0.01s: slow op');
    await expect(withTimeout(Promise.reject('str'), 100, 'x')).rejects.toBeInstanceOf(Error);
    expect(TIMEOUT_METADATA_MS).toBe(30_000);
    expect(TIMEOUT_TRANSFER_MS).toBe(300_000);
  });

  it('toError keeps Errors by identity and wraps primitives', () => {
    const e = new Error('x');
    expect(toError(e)).toBe(e);
    expect(toError('s')).toBeInstanceOf(Error);
    expect(toError(42).message).toBe('42');
  });
});

describe('validateFilePath', () => {
  it('allows an ordinary path', () => {
    expect(() => validateFilePath(path.resolve('ok.txt'))).not.toThrow();
  });
  it.each([
    ['a/../b', '".." traversal'],
    [path.join(os.homedir(), 'x', '.ssh', 'id_rsa'), 'sensitive directory ".ssh"'],
    [path.join(os.homedir(), 'proj', '.env'), 'sensitive file ".env"'],
    ['/etc/passwd', 'system directory "/etc"'],
    ['/etc', 'system directory "/etc"'],
  ])('rejects %s', (p, why) => {
    expect(() => validateFilePath(p)).toThrow(why);
  });
});

describe('resolveWithinDir', () => {
  it('keeps paths inside the base and rejects escapes (Zip Slip)', () => {
    expect(resolveWithinDir('/base', 'a/b')).toBe(path.resolve('/base/a/b'));
    expect(resolveWithinDir('/base', '')).toBe(path.resolve('/base'));
    expect(() => resolveWithinDir('/base', '../x')).toThrow('escapes destination directory');
    expect(() => resolveWithinDir('/base', '/etc/passwd')).toThrow('escapes destination directory');
  });
});

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
  it('optionalPrefix', () => {
    expect(optionalPrefix(undefined)).toBe('');
    expect(optionalPrefix('')).toBe('');
    expect(optionalPrefix('p/')).toBe('/p/');
  });
});
