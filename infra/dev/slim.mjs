#!/usr/bin/env node
// Post-process a freshly generated storj-up docker-compose.yaml into the slim
// layout used here: 5 storage nodes instead of 10, and bind-mount paths made
// relative so the file is portable and safe to commit.  The satellite is told
// to erasure-code with RS 1/2/3/4 (min/repair/success/total) so uploads need
// only 4 nodes; storj-up's `scale` subcommand cannot scale *down*, hence this.
// Invoked by storj-local.sh regenerate.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KEEP_NODES = 5;
const file = path.join(path.dirname(fileURLToPath(import.meta.url)), 'docker-compose.yaml');
const here = path.dirname(file);

const SERVICE_LINE = /^ {2}storagenode(\d+):$/;   // top-level service key for a storage node
const NESTED_LINE = /^ {4}/;                      // any line inside a service block

/** Drop the whole block of every storagenodeN with N > KEEP_NODES. */
function dropExtraNodes(lines) {
  const kept = [];
  let skipping = false;
  for (const line of lines) {
    const service = SERVICE_LINE.exec(line);
    if (service) skipping = Number(service[1]) > KEEP_NODES;
    else if (skipping && !(NESTED_LINE.test(line) || line === '')) skipping = false;
    if (!skipping) kept.push(line);
  }
  return kept;
}

/** Value of `      STORJ_METAINFO_RS_<key>: "<n>"` or '?' when absent. */
function rsValue(lines, key) {
  const prefix = `STORJ_METAINFO_RS_${key}:`;
  const line = lines.find((l) => l.trim().startsWith(prefix));
  return line ? line.trim().slice(prefix.length).trim().replaceAll('"', '') : '?';
}

let text = fs.readFileSync(file, 'utf8');
const before = text.split('\n').filter((l) => SERVICE_LINE.test(l)).length;
const lines = dropExtraNodes(text.split('\n'));
// storj-up writes absolute host paths into bind mounts
text = lines.join('\n').replaceAll(`${here}/`, './').replaceAll(here, '.');
if (text.includes('/Users/') || text.includes('/home/')) { console.error('[slim] ERROR: absolute host path still present'); process.exit(1); }
fs.writeFileSync(file, text);

const left = lines.filter((l) => SERVICE_LINE.test(l)).length;
const rs = ['MIN', 'REPAIR', 'SUCCESS', 'TOTAL'].map((k) => rsValue(lines, k));
console.log(`[slim] storagenodes ${before} → ${left}; satellite RS ${rs.join('/')}`);
if (left < Number(rs[3])) { console.error(`[slim] ERROR: ${left} nodes < RS total ${rs[3]}`); process.exit(1); }
