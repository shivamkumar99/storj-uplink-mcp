import { describe, it, expect } from 'vitest';
import { matchGlob } from '../../src/lib/glob.js';

describe('matchGlob', () => {
  it.each([
    ['a.log', '*.log', true], ['dir/a.log', '*.log', false],
    ['photos/a.jpg', 'photos/*.jpg', true], ['photos/2024/a.jpg', 'photos/*.jpg', false],
    ['photos/2024/a.jpg', 'photos/**/*.jpg', true], ['photos/a.jpg', 'photos/**/*.jpg', true],
    ['logs-2024', 'logs-*', true], ['log-2024', 'logs-*', false],
    ['a/b/c', 'a/*/c', true], ['a/b/x/c', 'a/*/c', false],
    ['a/b', 'a?b', false], ['.env', '*', true], ['dir/.hidden', 'dir/*', true],
    ['photos', 'photos/**', true],
  ])('%j ~ %j → %s', (str, pattern, want) => {
    expect(matchGlob(str, pattern)).toBe(want);
  });

  it('matches "*" directly before "/" (the hand-rolled matcher this replaced never did)', () => {
    for (const [s, p] of [['a/b/c', 'a/*/c'], ['logs/2024/error.log', 'logs/*/error.log'], ['x/y', '*/y']]) {
      expect(matchGlob(s, p), `${s} ~ ${p}`).toBe(true);
    }
  });

  it('matches nothing for an empty pattern instead of throwing', () => {
    expect(matchGlob('anything', '')).toBe(false);
  });

  it('is restricted to the three documented wildcards — no braces, extglobs or negation', () => {
    expect(matchGlob('a', '{a,b}')).toBe(false);
    expect(matchGlob('{a,b}', '{a,b}')).toBe(true);
    expect(matchGlob('b', '!a')).toBe(false);
    expect(matchGlob('!a', '!a')).toBe(true);
    expect(matchGlob('ab', '+(a|b)')).toBe(false);
  });

  // Bucket names never contain "/". This table is the complete truth table of
  // the flat matcher picomatch replaced (13 names × 15 patterns): for each
  // name, exactly these patterns match and no others.
  const PATTERNS = ['logs-*', 'test-??-*', 'temp*', '*', '**', '?', '??', '*logs*', 'logs', '*-*', 'log?', 'a*c', '*z', '.*', '*dot'];
  it.each([
    ['logs-2024', ['logs-*', '*', '**', '*logs*', '*-*']],
    ['logs', ['*', '**', '*logs*', 'logs', 'log?']],
    ['test-ab-x', ['test-??-*', '*', '**', '*-*']],
    ['temp', ['temp*', '*', '**']],
    ['temporary', ['temp*', '*', '**']],
    ['prod', ['*', '**']],
    ['a', ['*', '**', '?']],
    ['ab', ['*', '**', '??']],
    ['abc', ['*', '**', 'a*c']],
    ['log', ['*', '**']],
    ['logs-', ['logs-*', '*', '**', '*logs*', '*-*']],
    ['x-logs-2024', ['*', '**', '*logs*', '*-*']],
    ['.dot', ['*', '**', '.*', '*dot']],
  ])('bucket name %j matches exactly %j', (name, matching) => {
    expect(PATTERNS.filter((p) => matchGlob(name, p))).toEqual(matching);
  });

  // Object keys contain "/". Documented behaviour at the edges that differ
  // from a naive matcher: empty inputs, "**" adjacency, empty segments and trailing slashes.
  it.each([
    ['', '*', false], ['a', '', false], ['', '', false],
    ['a/b', 'a**', false], ['a/b', '**a', false],
    ['photos/', 'photos/*', false], ['photos', 'photos/**', true], ['photos/a.jpg', 'photos/**', true],
    ['a//b', 'a/*/b', true], ['/a', '/*', true], ['a/', '*/', true],
    ['x/y/z.tmp', '**/z.tmp', true], ['x/y/z.tmp', '*/*/z.tmp', true], ['y.tmp', '**/z.tmp', false],
  ])('%j ~ %j → %s', (str, pattern, want) => {
    expect(matchGlob(str, pattern)).toBe(want);
  });
});
