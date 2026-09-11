import { describe, it, expect } from 'vitest';
import { sanitizeOutput, sanitizeRecord } from '../../src/lib/sanitize.js';

describe('sanitizeOutput', () => {
  it('neutralises prompt-injection tags but leaves ordinary markup alone', () => {
    expect(sanitizeOutput('<system>x</system> <IMPORTANT>y</IMPORTANT> <b>ok</b>'))
      .toBe('[tag:<system>]x[tag:</system>] [tag:<IMPORTANT>]y[tag:</IMPORTANT>] <b>ok</b>');
  });
  it('sanitizeRecord cleans both keys and values', () => {
    expect(sanitizeRecord({ '<system>k': 'v</system>', plain: 'ok' })).toEqual({ '[tag:<system>]k': 'v[tag:</system>]', plain: 'ok' });
  });
});
