import { createProgress } from '../progress.js';
import { throwIfCancelled } from '../context.js';
import { sanitizeOutput } from '../utils.js';

// ---------------------------------------------------------------------------
// Batch execution — Template Method for "do X to each of N items".
//
// Every batch tool (delete_buckets, delete_objects, upload_directory,
// download_prefix) previously hand-rolled the same loop: report progress per
// item, run the operation, collect successes and per-item failures, then
// render a ✅/❌ report.  That loop and its report now live here once; each
// tool supplies only the parts that vary.
// ---------------------------------------------------------------------------

interface BatchFailure {
  name: string;
  error: string;
}

export interface BatchResult {
  /** Number of items attempted. */
  total: number;
  /** Display names of items that succeeded, in order. */
  succeeded: string[];
  /** Items that failed, with the error message. */
  failed: BatchFailure[];
  /** Sum of bytes returned by `op` (0 when ops return nothing). */
  totalBytes: number;
}

export interface BatchSpec<T> {
  /** Progress label, e.g. `Deleting 3 bucket(s)`. */
  label: string;
  /** Present-participle verb for per-item progress, e.g. "deleting". */
  verb: string;
  /** Display name for an item (used in progress and the report). */
  itemName: (item: T) => string;
  /** The operation.  May return bytes transferred, which are summed. */
  op: (item: T) => Promise<number | void>;
  /** Final progress message once all items are processed. */
  done: (result: BatchResult) => string;
}

/**
 * Run `spec.op` over every item, never letting one failure stop the rest.
 * Failures are captured per item; the caller decides how to present them.
 */
export async function runBatch<T>(items: T[], spec: BatchSpec<T>): Promise<BatchResult> {
  const progress = createProgress(spec.label);
  const result: BatchResult = { total: items.length, succeeded: [], failed: [], totalBytes: 0 };

  for (let i = 0; i < items.length; i++) {
    throwIfCancelled();
    const item = items[i];
    const name = spec.itemName(item);
    progress.update(i, items.length, `${spec.verb} "${name}"…`);
    try {
      const bytes = await spec.op(item);
      if (typeof bytes === 'number') result.totalBytes += bytes;
      result.succeeded.push(name);
    } catch (err: unknown) {
      result.failed.push({ name, error: err instanceof Error ? err.message : String(err) });
    }
  }

  progress.done(spec.done(result));
  return result;
}

export interface BatchReportOptions {
  /** First line of the report. */
  header: string;
  /** When set (e.g. "✅ Deleted:"), successful items are listed under it. */
  successLabel?: string;
  /** Extra lines inserted after the header (e.g. a "results were capped" warning). */
  notes?: string[];
}

/** Render a BatchResult as the standard multi-line ✅/❌ report. */
export function formatBatchReport(result: BatchResult, opts: BatchReportOptions): string {
  const lines: string[] = [opts.header];
  for (const note of opts.notes ?? []) {
    lines.push('', note);
  }
  if (opts.successLabel && result.succeeded.length > 0) {
    lines.push('', opts.successLabel);
    for (const name of result.succeeded) lines.push(`  - ${sanitizeOutput(name)}`);
  }
  if (result.failed.length > 0) {
    lines.push('', '❌ Failed:');
    for (const f of result.failed) lines.push(`  - ${sanitizeOutput(f.name)}: ${sanitizeOutput(f.error)}`);
  }
  return lines.join('\n');
}
