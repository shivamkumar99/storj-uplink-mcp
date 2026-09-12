#!/usr/bin/env node
// Bundle each MCP App view into one self-contained HTML file under dist/ui/.
// Hosts render views under a deny-by-default CSP, so the script is inlined.
//
// The page is assembled with an HTML parser/serializer rather than string
// concatenation: the template's placeholder comment is replaced by a <script>
// node whose text is the bundle.  esbuild already escapes "</script" inside
// JS string literals; the check below guarantees it for the whole bundle.
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse, serialize } from 'parse5';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLACEHOLDER = '__APP_SCRIPT__';
const SCRIPT_ELEMENT_NAMESPACE = 'http://www.w3.org/1999/xhtml';

const VIEWS = [
  { entry: 'ui/browser/browser.ts', template: 'ui/browser/browser.html', out: 'dist/ui/browser.html' },
];

/** Depth-first search for the placeholder comment; returns it with its parent. */
function findPlaceholder(node) {
  for (const child of node.childNodes ?? []) {
    if (child.nodeName === '#comment' && child.data.trim() === PLACEHOLDER) return { parent: node, node: child };
    const found = findPlaceholder(child);
    if (found) return found;
  }
  return null;
}

/** Bundle one entry point to a single ES-module string safe to inline. */
async function bundle(entry) {
  const result = await build({
    entryPoints: [entry], bundle: true, format: 'esm', platform: 'browser',
    target: ['es2022'], minify: true, write: false, logLevel: 'silent',
  });
  const code = result.outputFiles[0].text;
  if (/<\/script/i.test(code)) throw new Error(`${entry}: bundle contains "</script", which would end the inline tag early`);
  return code;
}

/** Build a <script type="module"> element node carrying the bundle as its text. */
function scriptNode(parent, code) {
  const script = { nodeName: 'script', tagName: 'script', namespaceURI: SCRIPT_ELEMENT_NAMESPACE, attrs: [{ name: 'type', value: 'module' }], childNodes: [], parentNode: parent };
  script.childNodes.push({ nodeName: '#text', value: code, parentNode: script });
  return script;
}

export async function buildUi() {
  mkdirSync(path.join(root, 'dist', 'ui'), { recursive: true });
  for (const view of VIEWS) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- build-time script; paths come from the VIEWS table above, not from input
    const document = parse(readFileSync(path.join(root, view.template), 'utf8'));
    const slot = findPlaceholder(document);
    if (!slot) throw new Error(`${view.template}: missing <!-- ${PLACEHOLDER} --> placeholder`);
    const code = await bundle(path.join(root, view.entry));
    slot.parent.childNodes.splice(slot.parent.childNodes.indexOf(slot.node), 1, scriptNode(slot.parent, code));
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- build-time script; output path comes from the VIEWS table above
    writeFileSync(path.join(root, view.out), serialize(document));
  }
  return VIEWS.map((v) => v.out);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const outs = await buildUi();
  console.log(`built ${outs.length} UI view(s): ${outs.join(', ')}`);
}
