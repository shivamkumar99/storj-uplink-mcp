// ---------------------------------------------------------------------------
// Glob matching for bucket names and object keys.
//
// Supports:
//   *   any characters within one path segment (never crosses '/')
//   **  any characters across path segments (crosses '/')
//   ?   exactly one non-'/' character
//
// Bucket names contain no '/', so for them '*' and '**' behave identically —
// this single matcher therefore serves both bucket and object patterns.
//
// Implemented as iterative character matching rather than RegExp so
// user-supplied patterns can never trigger catastrophic backtracking (ReDoS).
// ---------------------------------------------------------------------------

/** Match `str` against a glob `pattern`. */
export function matchGlob(str: string, pattern: string): boolean {
  return globMatch(str, 0, pattern, 0);
}

function globMatch(str: string, si: number, pat: string, pi: number): boolean {
  while (pi < pat.length) {
    // '**' — matches across path segments (including '/')
    if (pat[pi] === '*' && pi + 1 < pat.length && pat[pi + 1] === '*') {
      pi += 2;
      // Skip trailing slash after '**' if present
      if (pi < pat.length && pat[pi] === '/') pi++;
      if (pi === pat.length) return true;
      for (let i = si; i <= str.length; i++) {
        if (globMatch(str, i, pat, pi)) return true;
      }
      return false;
    }
    // '*' — matches within one path segment (no '/')
    if (pat[pi] === '*') {
      pi++;
      if (pi === pat.length) {
        // '*' at end: match rest if no '/' remains
        return str.indexOf('/', si) === -1;
      }
      for (let i = si; i <= str.length; i++) {
        if (str[i] === '/') break; // '*' cannot cross '/'
        if (globMatch(str, i, pat, pi)) return true;
      }
      return false;
    }
    // '?' — matches exactly one non-'/' character
    if (pat[pi] === '?') {
      if (si >= str.length || str[si] === '/') return false;
      si++;
      pi++;
      continue;
    }
    // Literal character
    if (si >= str.length || str[si] !== pat[pi]) return false;
    si++;
    pi++;
  }
  return si === str.length;
}
