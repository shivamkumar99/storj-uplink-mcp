// ---------------------------------------------------------------------------
// Glob (wildcard) matching for bucket names and object keys.
//
// Three wildcards, mirroring shell globs:
//
//   ?    exactly one character, never '/'
//   *    any run of characters within ONE path segment (never crosses '/')
//   **   any run of characters across ANY number of segments (crosses '/')
//
//   pattern            matches                 does not match
//   ─────────────────  ──────────────────────  ─────────────────────
//   *.log              a.log                   dir/a.log
//   photos/*.jpg       photos/a.jpg            photos/2024/a.jpg
//   photos/**/*.jpg    photos/2024/a.jpg       (also matches photos/a.jpg)
//   logs-*             logs-2024               log-2024
//   a/*/c              a/b/c                   a/b/x/c
//
// Bucket names contain no '/', so for them '*' and '**' behave identically —
// one matcher serves both delete_buckets and delete_objects.
//
// Implemented as plain recursive descent rather than a RegExp so a
// user-supplied pattern is never handed to a regex engine.
// ---------------------------------------------------------------------------

/** Does `str` match the glob `pattern`? */
export function matchGlob(str: string, pattern: string): boolean {
  return match(str, pattern);
}

/**
 * Recursive descent: look at the first character(s) of the pattern, decide
 * what they may consume from the front of `str`, and recurse on the rest.
 */
function match(str: string, pat: string): boolean {
  // Both exhausted together → match.  Pattern exhausted with input left → no.
  if (pat === '') return str === '';

  if (pat.startsWith('**')) return matchDoubleStar(str, pat);
  if (pat.startsWith('*')) return matchStar(str, pat);
  if (pat.startsWith('?')) return matchQuestion(str, pat);
  return matchLiteral(str, pat);
}

/** '**' — may swallow anything, including '/'. Try every possible split point. */
function matchDoubleStar(str: string, pat: string): boolean {
  // "a/**/b" should also match "a/b", so fold in the '/' that follows '**'.
  const rest = pat.slice(pat.startsWith('**/') ? 3 : 2);
  if (rest === '') return true; // trailing '**' matches everything remaining

  for (let i = 0; i <= str.length; i++) {
    if (match(str.slice(i), rest)) return true;
  }
  return false;
}

/** '*' — may swallow anything up to (but not past) the next '/'. */
function matchStar(str: string, pat: string): boolean {
  const rest = pat.slice(1);
  const segmentEnd = firstSlash(str);

  // Trailing '*' matches the remainder only if it stays within this segment.
  if (rest === '') return segmentEnd === str.length;

  // Let '*' consume 0..segmentEnd characters and see if the rest matches.
  for (let i = 0; i <= segmentEnd; i++) {
    if (match(str.slice(i), rest)) return true;
  }
  return false;
}

/** '?' — exactly one character that is not '/'. */
function matchQuestion(str: string, pat: string): boolean {
  return str !== '' && str[0] !== '/' && match(str.slice(1), pat.slice(1));
}

/** Any other character must match itself. */
function matchLiteral(str: string, pat: string): boolean {
  return str !== '' && str[0] === pat[0] && match(str.slice(1), pat.slice(1));
}

/** Index of the first '/', or the string length if there is none. */
function firstSlash(str: string): number {
  const i = str.indexOf('/');
  return i === -1 ? str.length : i;
}
