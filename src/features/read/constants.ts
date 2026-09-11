// All tuned to protect the AI context window.

/** Read buffer for streaming line-based operations */
export const LINE_CHUNK = 64 * 1024; // 64 KB per read

/** How many bytes before EOF we start reading for peek_tail.
 *  512 KB comfortably covers 200 typical log lines even with long lines. */
export const TAIL_SCAN_BYTES = 512 * 1024;

/** Hard cap on lines returned by peek_head / peek_tail */
export const MAX_PEEK_LINES = 500;

/** Hard cap on matching lines returned by grep_object */
export const MAX_GREP_MATCHES = 200;

/** Hard cap on context lines around each grep match */
export const MAX_CONTEXT_LINES = 10;
