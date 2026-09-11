// Storj object browser — the MCP App rendered for list_objects.
//
// Receives the tool's structuredContent from the host, renders a sortable,
// filterable table, and calls back into the server (list_objects for folder
// navigation, peek_object_head for previews).  All data is inserted via
// textContent — object keys are untrusted and must never reach innerHTML.

import { App } from '@modelcontextprotocol/ext-apps';
import type { ListObjectsResult } from '../src/tools/objects.output.js';

type Entry = ListObjectsResult['objects'][number];
type SortKey = 'key' | 'size_bytes' | 'created';

const app = new App({ name: 'Storj object browser', version: '1.0.0' });

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const rows = el<HTMLTableSectionElement>('rows');
const crumb = el<HTMLDivElement>('crumb');
const filterInput = el<HTMLInputElement>('filter');
const upButton = el<HTMLButtonElement>('up');
const count = el<HTMLDivElement>('count');
const status = el<HTMLSpanElement>('status');
const preview = el<HTMLElement>('preview');
const previewTitle = el<HTMLSpanElement>('preview-title');
const previewBody = el<HTMLPreElement>('preview-body');

let state: ListObjectsResult | null = null;
let sortKey: SortKey = 'key';
let ascending = true;

function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function displayName(entry: Entry, prefix: string): string {
  return entry.key.startsWith(prefix) ? entry.key.slice(prefix.length) : entry.key;
}

function compare(a: Entry, b: Entry): number {
  if (a.is_prefix !== b.is_prefix) return a.is_prefix ? -1 : 1; // folders first
  const av = a[sortKey] ?? '', bv = b[sortKey] ?? '';
  let order = 0;
  if (av < bv) order = -1;
  else if (av > bv) order = 1;
  return ascending ? order : -order;
}

function cell(text: string, className?: string): HTMLTableCellElement {
  const td = document.createElement('td');
  td.textContent = text;
  if (className) td.className = className;
  return td;
}

function render(): void {
  if (!state) return;
  const { bucket, prefix } = state;
  crumb.textContent = '';
  crumb.append(bucket, ' / ');
  const p = document.createElement('span'); p.textContent = prefix; crumb.append(p);
  upButton.disabled = prefix === '';

  const needle = filterInput.value.trim().toLowerCase();
  const visible = state.objects.filter((o) => displayName(o, prefix).toLowerCase().includes(needle)).sort(compare);

  rows.textContent = '';
  for (const entry of visible) {
    const tr = document.createElement('tr');
    tr.className = entry.is_prefix ? 'dir' : 'file';
    tr.append(
      cell(`${entry.is_prefix ? '📁' : '📄'} ${displayName(entry, prefix)}`, 'key'),
      cell(formatBytes(entry.size_bytes), 'num'),
      cell(entry.created ?? '—'),
    );
    tr.addEventListener('click', () => { void (entry.is_prefix ? navigate(entry.key) : showPreview(entry.key)); });
    rows.append(tr);
  }
  count.textContent = `${visible.length} of ${state.objects.length} item(s)`;
  for (const th of document.querySelectorAll<HTMLTableCellElement>('th[data-sort]')) {
    th.classList.toggle('sorted', th.dataset.sort === sortKey);
    th.classList.toggle('asc', th.dataset.sort === sortKey && ascending);
  }
}

function showText(content: Array<{ type: string; text?: string }> | undefined): void {
  rows.textContent = '';
  count.textContent = content?.find((c) => c.type === 'text')?.text ?? 'No content';
}

async function navigate(prefix: string): Promise<void> {
  if (!state) return;
  status.textContent = 'Loading…';
  try {
    const result = await app.callServerTool({ name: 'list_objects', arguments: { bucket: state.bucket, prefix, recursive: false } });
    if (result.structuredContent) { state = result.structuredContent as ListObjectsResult; render(); }
    else showText(result.content);
  } finally {
    status.textContent = '';
  }
}

async function showPreview(key: string): Promise<void> {
  if (!state) return;
  status.textContent = 'Loading preview…';
  try {
    const result = await app.callServerTool({ name: 'peek_object_head', arguments: { bucket: state.bucket, key, lines: 40 } });
    previewTitle.textContent = key;
    previewBody.textContent = result.content.find((c) => c.type === 'text')?.text ?? '';
    preview.style.display = 'block';
  } finally {
    status.textContent = '';
  }
}

function parentPrefix(prefix: string): string {
  const trimmed = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
  const i = trimmed.lastIndexOf('/');
  return i === -1 ? '' : trimmed.slice(0, i + 1);
}

// Wire up the UI
filterInput.addEventListener('input', render);
upButton.addEventListener('click', () => { if (state) void navigate(parentPrefix(state.prefix)); });
el<HTMLButtonElement>('preview-close').addEventListener('click', () => { preview.style.display = 'none'; });
for (const th of document.querySelectorAll<HTMLTableCellElement>('th[data-sort]')) {
  th.addEventListener('click', () => {
    const key = th.dataset.sort as SortKey;
    ascending = sortKey === key ? !ascending : true;
    sortKey = key;
    render();
  });
}

// Handlers must be registered before connect() so no notification is missed.
app.ontoolresult = (params) => {
  if (params.structuredContent) { state = params.structuredContent as ListObjectsResult; render(); }
  else showText(params.content);
};

try {
  await app.connect();
} catch (err: unknown) {
  status.textContent = `Could not connect to host: ${String(err)}`;
}
