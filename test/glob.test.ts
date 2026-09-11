import { describe, it, expect } from 'vitest';
import { matchGlob } from '../src/tools/glob.js';

// The two hand-rolled matchers picomatch replaced, kept as fixtures so the
// migration's guarantees stay executable.
function oldFlat(str: string, si: number, pat: string, pi: number): boolean {
  while (pi < pat.length) {
    const pc = pat[pi];
    if (pc === '*') { while (pi < pat.length && pat[pi] === '*') pi++; if (pi === pat.length) return true;
      for (let i = si; i <= str.length; i++) if (oldFlat(str, i, pat, pi)) return true; return false; }
    else if (pc === '?') { if (si >= str.length) return false; si++; pi++; }
    else { if (si >= str.length || str[si] !== pc) return false; si++; pi++; }
  }
  return si === str.length;
}
function oldPath(str: string, si: number, pat: string, pi: number): boolean {
  while (pi < pat.length) {
    if (pat[pi] === '*' && pi + 1 < pat.length && pat[pi + 1] === '*') { pi += 2; if (pi < pat.length && pat[pi] === '/') pi++;
      if (pi === pat.length) return true; for (let i = si; i <= str.length; i++) if (oldPath(str, i, pat, pi)) return true; return false; }
    if (pat[pi] === '*') { pi++; if (pi === pat.length) return str.indexOf('/', si) === -1;
      for (let i = si; i <= str.length; i++) { if (str[i] === '/') break; if (oldPath(str, i, pat, pi)) return true; } return false; }
    if (pat[pi] === '?') { if (si >= str.length || str[si] === '/') return false; si++; pi++; continue; }
    if (si >= str.length || str[si] !== pat[pi]) return false; si++; pi++;
  }
  return si === str.length;
}

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

  it('fixes the old bug where "*" directly before "/" could never match', () => {
    for (const [s, p] of [['a/b/c', 'a/*/c'], ['logs/2024/error.log', 'logs/*/error.log'], ['x/y', '*/y']]) {
      expect(oldPath(s, 0, p, 0)).toBe(false);
      expect(matchGlob(s, p)).toBe(true);
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

  it('is identical to the original flat matcher for bucket names (no "/")', () => {
    const names = ['logs-2024', 'logs', 'test-ab-x', 'temp', 'temporary', 'prod', 'a', 'ab', 'abc', 'log', 'logs-', 'x-logs-2024', '.dot'];
    const pats = ['logs-*', 'test-??-*', 'temp*', '*', '**', '?', '??', '*logs*', 'logs', '*-*', 'log?', 'a*c', '*z', '.*', '*dot'];
    for (const n of names) for (const p of pats) expect(matchGlob(n, p), `${n} ~ ${p}`).toBe(oldFlat(n, 0, p, 0));
  });

  it('differs from the original path matcher only in the accepted categories', () => {
    const accepted = (s: string, p: string) =>
      p === '' || s === '' || /[^/]\*\*|\*\*[^/]/.test(p) || /(^|[^*])\*\//.test(p) || s.endsWith('/') || (p.endsWith('/**') && s === p.slice(0, -3));
    const keys = ['', 'a', 'ab', 'a/b', 'a/b/c', 'a/b/x/c', 'a.log', 'd/a.log', 'photos', 'photos/', 'photos/a.jpg', 'photos/2024/a.jpg',
      'data/x/temp-1', 'data/temp-1', 'logs-2024', 'a//b', '/a', 'a/', 'aXb', 'a/Xb', 'x/y/z.tmp', 'y.tmp', '.hidden', 'dir/.hidden', 'a.b.c'];
    const pats = ['', '*', '**', '?', '??', 'a', 'a*', '*a', '*.log', '**.log', '**/*.log', 'photos/*.jpg', 'photos/**/*.jpg', 'photos/**',
      'photos/*', 'photos', 'data/**/temp-*', 'logs-*', 'a?b', 'a/?b', '**/z.tmp', '*/*/z.tmp', '**/**', 'a/**', 'a**', '**a', '*/', '/*',
      '**/*', '*.*', '?*', 'a/*/c', '*/y', '.*', 'a.b.*'];
    const unexpected: string[] = [];
    for (const s of keys) for (const p of pats) {
      const n = matchGlob(s, p), o = oldPath(s, 0, p, 0);
      if (n !== o && !accepted(s, p)) unexpected.push(`${JSON.stringify(s)} ~ ${JSON.stringify(p)}: old=${o} new=${n}`);
    }
    expect(unexpected).toEqual([]);
  });
});
