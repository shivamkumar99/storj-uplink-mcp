#!/usr/bin/env node
// End-to-end check of the MCP server against the LOCAL storj-up network.
//
// Runs the production image inside the cluster network (docker compose run)
// and drives it over stdio exactly like an AI client, exercising the full
// bucket → upload → list → read → download → delete lifecycle.  Nothing here
// touches the real Storj network.  Requires: infra/dev/storj-local.sh up
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const compose = ['compose', '-f', path.join(here, 'docker-compose.yaml'), '-f', path.join(here, 'docker-compose.mcp.yml')];
const bucket = `mcp-e2e-${Date.now().toString(36)}`;

const p = spawn('docker', [...compose, 'run', '--rm', '-T', 'mcp'], { stdio: ['pipe', 'pipe', 'pipe'] });
let buf = '';
const pending = new Map();
p.stdout.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    let m; try { m = JSON.parse(line); } catch { continue; }
    if (m.id !== undefined && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  }
});
let stderr = ''; p.stderr.on('data', (d) => (stderr += d));

let nextId = 1;
function request(method, params, timeoutMs = 120_000) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { pending.delete(id); reject(new Error(`timeout waiting for ${method} (id ${id})`)); }, timeoutMs);
    pending.set(id, (m) => { clearTimeout(t); m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result); });
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}
const notify = (method, params) => p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
const call = async (name, args = {}) => {
  const r = await request('tools/call', { name, arguments: args });
  const text = r.content?.find((c) => c.type === 'text')?.text ?? '';
  if (r.isError) throw new Error(`${name} failed: ${text}`);
  return { text, structured: r.structuredContent };
};
const assert = (cond, msg) => { if (!cond) throw new Error(`assertion failed: ${msg}`); };
const step = async (label, fn) => { const t0 = Date.now(); const v = await fn(); console.log(`  ✓ ${label} (${Date.now() - t0} ms)`); return v; };

let failed = false;
try {
  console.log(`e2e against local storj-up network — bucket "${bucket}"`);
  await step('initialize', async () => {
    const r = await request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'e2e', version: '0' } });
    assert(r.serverInfo?.name === 'storj-uplink-mcp', 'serverInfo');
    notify('notifications/initialized');
  });
  await step('tools/list has 28 tools', async () => { const r = await request('tools/list'); assert(r.tools.length === 28, `got ${r.tools.length}`); });
  await step('create_bucket', async () => assert((await call('create_bucket', { name: bucket })).text.includes('is ready'), 'create'));
  await step('stat_bucket', async () => assert((await call('stat_bucket', { name: bucket })).text.includes(bucket), 'stat'));
  const content = Array.from({ length: 50 }, (_, i) => `line ${i + 1}: ${i % 7 === 0 ? 'ERROR needle' : 'ok'}`).join('\n');
  await step('upload_text (2 objects + metadata)', async () => {
    await call('upload_text', { bucket, key: 'logs/app.log', content, metadata: { source: 'e2e' } });
    await call('upload_text', { bucket, key: 'docs/readme.txt', content: 'hello storj' });
  });
  await step('list_objects returns structuredContent', async () => {
    const { structured } = await call('list_objects', { bucket, recursive: true });
    const keys = structured.objects.map((o) => o.key);
    assert(keys.includes('logs/app.log') && keys.includes('docs/readme.txt'), `keys: ${keys}`);
    assert(structured.objects.find((o) => o.key === 'docs/readme.txt').size_bytes === 11, 'size');
  });
  await step('list_objects non-recursive shows prefixes', async () => {
    const { structured } = await call('list_objects', { bucket });
    assert(structured.objects.some((o) => o.is_prefix && o.key === 'logs/'), 'prefix logs/');
  });
  await step('stat_object with metadata', async () => {
    const { text } = await call('stat_object', { bucket, key: 'logs/app.log' });
    assert(text.includes('"source": "e2e"'), 'metadata round-trip');
  });
  await step('peek_object_head', async () => assert((await call('peek_object_head', { bucket, key: 'logs/app.log', lines: 3 })).text.includes('line 3'), 'head'));
  await step('peek_object_tail', async () => assert((await call('peek_object_tail', { bucket, key: 'logs/app.log', lines: 2 })).text.includes('line 50'), 'tail'));
  await step('grep_object', async () => {
    const { text } = await call('grep_object', { bucket, key: 'logs/app.log', query: 'needle', max_matches: 3 });
    assert(text.includes('«needle»') && text.includes('Stopped after 3'), 'grep highlight + cap');
  });
  await step('download_text round-trip', async () => assert((await call('download_text', { bucket, key: 'docs/readme.txt' })).text.includes('hello storj'), 'content'));
  await step('copy_object + move_object', async () => {
    await call('copy_object', { src_bucket: bucket, src_key: 'docs/readme.txt', dst_bucket: bucket, dst_key: 'docs/copy.txt' });
    await call('move_object', { src_bucket: bucket, src_key: 'docs/copy.txt', dst_bucket: bucket, dst_key: 'docs/moved.txt' });
    const { structured } = await call('list_objects', { bucket, prefix: 'docs/' });
    const keys = structured.objects.map((o) => o.key);
    assert(keys.includes('docs/moved.txt') && !keys.includes('docs/copy.txt'), `keys: ${keys}`);
  });
  await step('bucket_usage', async () => assert((await call('bucket_usage', { bucket })).text.includes('"object_count": 3'), 'count'));
  await step('download_file + upload_file via /data volume', async () => {
    await call('download_file', { bucket, key: 'docs/readme.txt', file_path: '/data/e2e-readme.txt' });
    await call('upload_file', { bucket, key: 'docs/from-disk.txt', file_path: '/data/e2e-readme.txt' });
    assert((await call('download_text', { bucket, key: 'docs/from-disk.txt' })).text.includes('hello storj'), 'file round-trip');
  });
  await step('delete_objects by pattern', async () => {
    const { text } = await call('delete_objects', { bucket, pattern: 'docs/*.txt' });
    assert(text.includes('Deleted 3 of 3'), text.split('\n')[0]);
  });
  await step('share_access (restricted grant)', async () => assert((await call('share_access', { bucket, allow_upload: false })).text.includes('Access Grant:'), 'grant'));
  await step('delete_bucket with_objects', async () => assert((await call('delete_bucket', { name: bucket, with_objects: true })).text.includes('deleted'), 'delete'));
  await step('bucket is gone', async () => {
    const r = await request('tools/call', { name: 'stat_bucket', arguments: { name: bucket } });
    assert(r.isError === true, 'stat after delete should be an error');
  });
  console.log('\nALL PASSED');
} catch (err) {
  failed = true;
  console.error(`\nFAILED: ${err.message}`);
  if (stderr.trim()) console.error('--- server stderr (tail) ---\n' + stderr.trim().split('\n').slice(-15).join('\n'));
  // best-effort cleanup so a re-run starts clean
  try { await call('delete_bucket', { name: bucket, with_objects: true }); } catch { /* ignore */ }
} finally {
  p.stdin.end(); p.kill();
}
process.exit(failed ? 1 : 0);
