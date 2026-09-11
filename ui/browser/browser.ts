// Storj browser — the MCP App rendered for list_buckets and list_objects.
//
// The host pushes the tool's structuredContent in; the shape tells us which
// listing we are showing.  Navigation calls back into the server:
// list_buckets ⇄ list_objects for folders, peek_object_head for previews.
// Every value goes through textContent — keys and names are untrusted.

import { App } from '@modelcontextprotocol/ext-apps';
import type { ListBucketsResult } from '../../src/features/buckets/output.js';
import type { ListObjectsResult } from '../../src/features/objects/output.js';

type Entry = ListObjectsResult['objects'][number];
type Bucket = ListBucketsResult['buckets'][number];
type State =
  | { mode: 'buckets'; buckets: Bucket[] }
  | { mode: 'objects'; bucket: string; prefix: string; objects: Entry[] };
type Column = { key: string; label: string; numeric?: boolean };
type Value = string | number | undefined;

const BUCKET_COLUMNS: Column[] = [{ key: 'name', label: 'Bucket' }, { key: 'created', label: 'Created' }];
const OBJECT_COLUMNS: Column[] = [{ key: 'key', label: 'Name' }, { key: 'size_bytes', label: 'Size', numeric: true }, { key: 'created', label: 'Created' }];

const app = new App({ name: 'Storj browser', version: '1.0.1' });

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const head = el<HTMLTableSectionElement>('head');
const rows = el<HTMLTableSectionElement>('rows');
const crumb = el<HTMLDivElement>('crumb');
const filterInput = el<HTMLInputElement>('filter');
const upButton = el<HTMLButtonElement>('up');
const count = el<HTMLDivElement>('count');
const status = el<HTMLSpanElement>('status');
const preview = el<HTMLElement>('preview');
const previewTitle = el<HTMLSpanElement>('preview-title');
const previewBody = el<HTMLPreElement>('preview-body');

let state: State | null = null;
let sortKey = 'key';
let ascending = true;

function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function cell(text: string, className?: string): HTMLTableCellElement {
  const td = document.createElement('td');
  td.textContent = text;
  if (className) td.className = className;
  return td;
}

function compareValues(a: Value, b: Value): number {
  const av = a ?? '', bv = b ?? '';
  let order = 0;
  if (av < bv) order = -1;
  else if (av > bv) order = 1;
  return ascending ? order : -order;
}

function renderHeader(columns: Column[]): void {
  head.textContent = '';
  const tr = document.createElement('tr');
  for (const col of columns) {
    const th = document.createElement('th');
    th.textContent = col.label;
    if (col.numeric) th.style.textAlign = 'right';
    th.classList.toggle('sorted', col.key === sortKey);
    th.classList.toggle('asc', col.key === sortKey && ascending);
    th.addEventListener('click', () => {
      ascending = sortKey === col.key ? !ascending : true;
      sortKey = col.key;
      render();
    });
    tr.append(th);
  }
  head.append(tr);
}

function setCrumb(parts: Array<{ text: string; onClick?: () => void }>): void {
  crumb.textContent = '';
  parts.forEach((part, i) => {
    if (i > 0) crumb.append(' / ');
    if (part.onClick) {
      const a = document.createElement('a');
      a.textContent = part.text;
      a.addEventListener('click', part.onClick);
      crumb.append(a);
    } else {
      const span = document.createElement('span');
      span.textContent = part.text;
      crumb.append(span);
    }
  });
}

function renderBuckets(s: Extract<State, { mode: 'buckets' }>, needle: string): void {
  renderHeader(BUCKET_COLUMNS);
  setCrumb([{ text: 'Buckets' }]);
  upButton.disabled = true;
  const visible = s.buckets
    .filter((b) => b.name.toLowerCase().includes(needle))
    .sort((a, b) => compareValues(a[sortKey as keyof Bucket], b[sortKey as keyof Bucket]));
  for (const b of visible) {
    const tr = document.createElement('tr');
    tr.className = 'bucket';
    tr.append(cell(`🪣 ${b.name}`, 'key'), cell(b.created));
    tr.addEventListener('click', () => { void openBucket(b.name, ''); });
    rows.append(tr);
  }
  count.textContent = `${visible.length} of ${s.buckets.length} bucket(s)`;
}

function renderObjects(s: Extract<State, { mode: 'objects' }>, needle: string): void {
  renderHeader(OBJECT_COLUMNS);
  setCrumb([
    { text: 'Buckets', onClick: () => { void openBuckets(); } },
    { text: s.bucket, onClick: s.prefix ? () => { void openBucket(s.bucket, ''); } : undefined },
    ...(s.prefix ? [{ text: s.prefix }] : []),
  ]);
  upButton.disabled = false;
  const display = (o: Entry): string => (o.key.startsWith(s.prefix) ? o.key.slice(s.prefix.length) : o.key);
  const visible = s.objects
    .filter((o) => display(o).toLowerCase().includes(needle))
    .sort((a, b) => {
      if (a.is_prefix !== b.is_prefix) return a.is_prefix ? -1 : 1; // folders first
      return compareValues(a[sortKey as keyof Entry] as Value, b[sortKey as keyof Entry] as Value);
    });
  for (const o of visible) {
    const tr = document.createElement('tr');
    tr.className = o.is_prefix ? 'dir' : 'file';
    tr.append(cell(`${o.is_prefix ? '📁' : '📄'} ${display(o)}`, 'key'), cell(formatBytes(o.size_bytes), 'num'), cell(o.created ?? '—'));
    tr.addEventListener('click', () => { void (o.is_prefix ? openBucket(s.bucket, o.key) : showPreview(s.bucket, o.key)); });
    rows.append(tr);
  }
  count.textContent = `${visible.length} of ${s.objects.length} item(s)`;
}

function render(): void {
  if (!state) return;
  rows.textContent = '';
  const needle = filterInput.value.trim().toLowerCase();
  if (state.mode === 'buckets') renderBuckets(state, needle);
  else renderObjects(state, needle);
}

function showText(content: Array<{ type: string; text?: string }> | undefined): void {
  rows.textContent = '';
  count.textContent = content?.find((c) => c.type === 'text')?.text ?? 'No content';
}

/** Turn a tool result into view state; falls back to its text when there is no structured payload. */
function accept(result: { structuredContent?: unknown; content?: unknown }): void {
  const sc = result.structuredContent as Partial<ListBucketsResult & ListObjectsResult> | undefined;
  if (sc && Array.isArray(sc.buckets)) {
    state = { mode: 'buckets', buckets: sc.buckets };
    sortKey = 'name';
  } else if (sc && Array.isArray(sc.objects) && typeof sc.bucket === 'string') {
    state = { mode: 'objects', bucket: sc.bucket, prefix: sc.prefix ?? '', objects: sc.objects };
    sortKey = 'key';
  } else {
    showText(result.content as Array<{ type: string; text?: string }>);
    return;
  }
  ascending = true;
  render();
}

async function busy<T>(label: string, work: () => Promise<T>): Promise<T> {
  status.textContent = label;
  try { return await work(); } finally { status.textContent = ''; }
}

async function openBuckets(): Promise<void> {
  accept(await busy('Loading…', () => app.callServerTool({ name: 'list_buckets', arguments: {} })));
}

async function openBucket(bucket: string, prefix: string): Promise<void> {
  accept(await busy('Loading…', () => app.callServerTool({ name: 'list_objects', arguments: { bucket, prefix, recursive: false } })));
}

async function showPreview(bucket: string, key: string): Promise<void> {
  const result = await busy('Loading preview…', () => app.callServerTool({ name: 'peek_object_head', arguments: { bucket, key, lines: 40 } }));
  previewTitle.textContent = key;
  previewBody.textContent = result.content.find((c) => c.type === 'text')?.text ?? '';
  preview.style.display = 'block';
}

function goUp(): void {
  if (!state || state.mode === 'buckets') return;
  if (state.prefix === '') { void openBuckets(); return; }
  const trimmed = state.prefix.endsWith('/') ? state.prefix.slice(0, -1) : state.prefix;
  const i = trimmed.lastIndexOf('/');
  void openBucket(state.bucket, i === -1 ? '' : trimmed.slice(0, i + 1));
}

filterInput.addEventListener('input', render);
upButton.addEventListener('click', goUp);
el<HTMLButtonElement>('preview-close').addEventListener('click', () => { preview.style.display = 'none'; });

// Handlers must be registered before connect() so no notification is missed.
app.ontoolresult = (params) => { accept(params); };

try {
  await app.connect();
} catch (err: unknown) {
  status.textContent = `Could not connect to host: ${String(err)}`;
}
