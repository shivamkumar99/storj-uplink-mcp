import { describe, it, expect } from 'vitest';
import { StorjError } from 'storj-uplink-nodejs';
import { ok, okStructured, errorResponse, safeCall, toError } from '../../src/lib/response.js';
import { textOf } from '../helpers/tmp.js';

describe('ok / errorResponse / safeCall', () => {
  it('ok passes strings through and pretty-prints objects', () => {
    expect(textOf(ok('hi'))).toBe('hi');
    expect(textOf(ok({ a: 1 }))).toBe('{\n  "a": 1\n}');
  });

  it('okStructured carries structuredContent with the text', () => {
    expect(okStructured('t', { n: 1 })).toEqual({ content: [{ type: 'text', text: 't' }], structuredContent: { n: 1 } });
  });

  it('formats Error, non-Error and StorjError (with details)', () => {
    expect(textOf(errorResponse(new Error('boom')))).toBe('Error: boom');
    expect(errorResponse(new Error('boom')).isError).toBe(true);
    expect(ok('fine').isError).toBeUndefined();
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

describe('toError', () => {
  it('keeps Errors by identity and wraps primitives', () => {
    const e = new Error('x');
    expect(toError(e)).toBe(e);
    expect(toError('s')).toBeInstanceOf(Error);
    expect(toError(42).message).toBe('42');
  });
});
