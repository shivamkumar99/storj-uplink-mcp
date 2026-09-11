#!/usr/bin/env node
// Bundle each MCP App view into one self-contained HTML file under dist/ui/.
// Hosts render views under a deny-by-default CSP, so the script is inlined.
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const VIEWS = [
  { entry: 'ui/objects/list-objects.ts', template: 'ui/objects/list-objects.html', out: 'dist/ui/list-objects.html' },
];

export async function buildUi() {
  mkdirSync(path.join(root, 'dist', 'ui'), { recursive: true });
  for (const view of VIEWS) {
    const result = await build({
      entryPoints: [path.join(root, view.entry)],
      bundle: true,
      format: 'esm',
      platform: 'browser',
      target: ['es2022'],
      minify: true,
      write: false,
      logLevel: 'silent',
    });
    // A "</script" inside the bundle would end the inline tag early.
    const js = result.outputFiles[0].text.replaceAll('</script', '<\\/script');
    const html = readFileSync(path.join(root, view.template), 'utf8')
      .replace("<!-- __APP_SCRIPT__ -->", () => `<script type="module">${js}</script>`);
    writeFileSync(path.join(root, view.out), html);
  }
  return VIEWS.map((v) => v.out);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const outs = await buildUi();
  console.log(`built ${outs.length} UI view(s): ${outs.join(', ')}`);
}
