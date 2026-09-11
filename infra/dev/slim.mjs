#!/usr/bin/env node
// Post-process a freshly generated storj-up docker-compose.yaml into the slim
// layout used here: 5 storage nodes instead of 10.  The satellite is told to
// erasure-code with RS 1/2/3/4 (min/repair/success/total) so uploads need only
// 4 nodes; storj-up's `scale` subcommand cannot scale *down*, hence this file.
// Invoked by storj-local.sh regenerate.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KEEP_NODES = 5;
const file = path.join(path.dirname(fileURLToPath(import.meta.url)), 'docker-compose.yaml');
let text = fs.readFileSync(file, 'utf8');

const nodes = [...text.matchAll(/^  storagenode(\d+):$/gm)].map((m) => Number(m[1]));
for (const n of nodes.filter((n) => n > KEEP_NODES)) {
  // remove the whole indented service block for storagenodeN
  text = text.replace(new RegExp(`^  storagenode${n}:\\n(?:    .*\\n|\\n)*?(?=^  \\S|^networks:|$(?![\\r\\n]))`, 'm'), '');
}
// storj-up writes absolute host paths into bind mounts; make them relative to
// this directory so the file is portable and safe to commit.
const here = path.dirname(file);
text = text.replaceAll(here + '/', './').replaceAll(here, '.');
if (text.includes('/Users/') || text.includes('/home/')) { console.error('[slim] ERROR: absolute host path still present'); process.exit(1); }

fs.writeFileSync(file, text);
const left = (text.match(/^  storagenode\d+:$/gm) || []).length;
const rs = ['MIN', 'REPAIR', 'SUCCESS', 'TOTAL'].map((k) => (text.match(new RegExp(`STORJ_METAINFO_RS_${k}: "(\\d+)"`)) || [])[1] ?? '?');
console.log(`[slim] storagenodes ${nodes.length} → ${left}; satellite RS ${rs.join('/')}`);
if (left < Number(rs[3])) { console.error(`[slim] ERROR: ${left} nodes < RS total ${rs[3]}`); process.exit(1); }
