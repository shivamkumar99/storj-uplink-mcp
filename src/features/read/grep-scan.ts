import type { DownloadResultStruct } from 'storj-uplink-nodejs';
import { sanitizeOutput } from '../../lib/sanitize.js';
import { drainChunked, splitLines, fmtLineNo } from './stream.js';

// ---------------------------------------------------------------------------
// Streaming grep: the scan state machine and the result renderer.
// Kept separate from the tool handler so the algorithm reads top to bottom.
// ---------------------------------------------------------------------------

export interface ResultLine { lineNo: number; text: string; isMatch: boolean }

/** Mutable state carried through a streaming grep. */
interface ScanState {
  /** Ring buffer of the last `ctxLines` lines before the current one (pre-context). */
  pre: Array<{ lineNo: number; text: string }>;
  /** Final ordered output — each entry knows whether it is a match. */
  results: ResultLine[];
  /** Countdown of lines still to emit after the most recent match (post-context). */
  pendingAfter: number;
  matchCount: number;
  lineNo: number;
}

export interface GrepScan {
  results: ResultLine[];
  matchCount: number;
  truncated: boolean;
  bytesScanned: number;
}

/** Emit the buffered pre-context lines, skipping any already present in results. */
function emitPreContext(state: ScanState): void {
  const alreadyEmitted = new Set(state.results.map((r) => r.lineNo));
  for (const prev of state.pre) {
    if (!alreadyEmitted.has(prev.lineNo)) {
      state.results.push({ lineNo: prev.lineNo, text: prev.text, isMatch: false });
    }
  }
}

/** Process one line: record it if it matches or falls within post-match context, and maintain the pre-context ring. */
function consumeLine(state: ScanState, text: string, needle: string, ctxLines: number): void {
  state.lineNo++;
  const isMatch = text.toLowerCase().includes(needle);

  if (isMatch) {
    emitPreContext(state);
    state.results.push({ lineNo: state.lineNo, text, isMatch: true });
    state.matchCount++;
    state.pendingAfter = ctxLines;
  } else if (state.pendingAfter > 0) {
    state.results.push({ lineNo: state.lineNo, text, isMatch: false });
    state.pendingAfter--;
  }

  state.pre.push({ lineNo: state.lineNo, text });
  if (state.pre.length > ctxLines) state.pre.shift();
}

/**
 * Stream the object collecting matching lines (plus `ctxLines` of context on
 * either side) and stop reading as soon as `maxMatches` is reached.
 */
export async function scanForMatches(
  download: DownloadResultStruct,
  needle: string,
  ctxLines: number,
  maxMatches: number,
): Promise<GrepScan> {
  const state: ScanState = { pre: [], results: [], pendingAfter: 0, matchCount: 0, lineNo: 0 };
  let leftover = '';
  let truncated = false;
  let bytesScanned = 0;

  await drainChunked(download, (chunk) => {
    bytesScanned += chunk.length;
    const { lines, leftover: lo } = splitLines(leftover, chunk.toString('utf8'));
    leftover = lo;

    for (const text of lines) {
      consumeLine(state, text, needle, ctxLines);
      if (state.matchCount >= maxMatches) {
        truncated = true;
        return false; // abort stream — we have enough
      }
    }
    return true;
  });

  // Flush last partial line (file with no trailing newline)
  if (leftover.length > 0) {
    state.lineNo++;
    const isMatch = leftover.toLowerCase().includes(needle);
    if (isMatch || state.pendingAfter > 0) {
      state.results.push({ lineNo: state.lineNo, text: leftover, isMatch });
      if (isMatch) state.matchCount++;
    }
  }

  return { results: state.results, matchCount: state.matchCount, truncated, bytesScanned };
}

/**
 * Render result lines as a numbered listing. Match lines are prefixed with ►
 * and the search term is wrapped in «...» (pure text, works in any MCP client);
 * a separator is inserted between non-consecutive blocks.
 */
/** Wrap every case-insensitive occurrence of `needle` in «…», keeping the original casing. */
function highlight(text: string, needle: string): string {
  const haystack = text.toLowerCase();
  const target = needle.toLowerCase();
  if (target.length === 0) return text;
  let out = '';
  let from = 0;
  for (let at = haystack.indexOf(target, from); at !== -1; at = haystack.indexOf(target, from)) {
    out += `${text.slice(from, at)}«${text.slice(at, at + target.length)}»`;
    from = at + target.length;
  }
  return out + text.slice(from);
}

export function formatGrepLines(results: ResultLine[], query: string): string[] {

  const lines: string[] = [];
  let prevLineNo = -2;
  for (const r of results) {
    if (r.lineNo > prevLineNo + 1 && prevLineNo !== -2) {
      lines.push(`${'─'.repeat(8)} ┼ ${'─'.repeat(52)}`);
    }
    const marker = r.isMatch ? '►' : ' ';
    const text   = r.isMatch ? highlight(sanitizeOutput(r.text), query) : sanitizeOutput(r.text);
    lines.push(`${marker}${fmtLineNo(r.lineNo)} │ ${text}`);
    prevLineNo = r.lineNo;
  }
  return lines;
}
