import picomatch from 'picomatch';

// ---------------------------------------------------------------------------
// Glob (wildcard) matching for bucket names and object keys.
//
// Backed by picomatch — the standard, zero-dependency glob engine used by
// fast-glob, chokidar and micromatch — rather than a hand-rolled matcher.
//
// Three wildcards, with standard shell-glob semantics:
//
//   ?    exactly one character, never '/'
//   *    any run of characters within ONE path segment (never crosses '/')
//   **   any number of whole path segments — only when it is its own segment
//        ("a/**/b", "**/*.log"); glued to text ("a**") it acts like a single '*'
//
//   pattern            matches                 does not match
//   ─────────────────  ──────────────────────  ─────────────────────
//   *.log              a.log                   dir/a.log
//   photos/*.jpg       photos/a.jpg            photos/2024/a.jpg
//   photos/**/*.jpg    photos/2024/a.jpg       (also matches photos/a.jpg)
//   logs-*             logs-2024               log-2024
//   a/*/c              a/b/c                   a/b/x/c
//
// Note: standard globstar means "photos/**" also matches an object literally
// named "photos" (zero segments after the folder).
//
// Bucket names contain no '/', so for them '*' and '**' behave identically —
// one matcher serves both delete_buckets and delete_objects.
// ---------------------------------------------------------------------------

// Restrict picomatch to exactly the three documented wildcards:
//   dot:       object keys are not "hidden files" — '*' must match ".env" too
//   nobrace:   no {a,b} expansion
//   noextglob: no +(x) / !(x) extended globs
//   nonegate:  no leading-'!' negation — a stray '!' in a *delete* pattern
//              would silently invert the selection
const OPTIONS: picomatch.PicomatchOptions = {
  dot: true,
  nobrace: true,
  noextglob: true,
  nonegate: true,
};

/** Does `str` match the glob `pattern`? An empty pattern matches nothing. */
export function matchGlob(str: string, pattern: string): boolean {
  if (!pattern) return false; // callers guard this already; picomatch would throw
  return picomatch(pattern, OPTIONS)(str);
}
