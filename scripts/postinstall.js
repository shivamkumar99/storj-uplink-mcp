#!/usr/bin/env node

/**
 * postinstall.js — ensure storj-uplink-nodejs native module is ready
 *
 * When storj-uplink-mcp is installed (e.g. via npx or npm install -g),
 * npm sometimes skips lifecycle scripts of transitive dependencies.
 * This script detects that case and runs "make install" inside the
 * storj-uplink-nodejs package to download prebuilt binaries.
 */

import { existsSync } from 'node:fs';
import { join, dirname, resolve, normalize } from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { arch, platform } from 'node:os';

const require = createRequire(import.meta.url);

// Locate storj-uplink-nodejs inside node_modules
let uplinkDir;
try {
  const uplinkPkg = require.resolve('storj-uplink-nodejs/package.json');
  uplinkDir = dirname(uplinkPkg);
} catch {
  console.log('[storj-mcp] storj-uplink-nodejs not found — skipping postinstall.');
  process.exit(0);
}

const platformStr = `${platform()}-${arch()}`;
const prebuiltNode = join(uplinkDir, 'native', 'prebuilds', platformStr, 'uplink_native.node');
const buildNode = join(uplinkDir, 'build', 'Release', 'uplink_native.node');

// Validate resolved paths stay inside uplinkDir (prevent path traversal)
const normalizedRoot = normalize(resolve(uplinkDir));
for (const p of [prebuiltNode, buildNode]) {
  const np = normalize(resolve(p));
  if (!np.startsWith(normalizedRoot)) {
    console.error(`[storj-mcp] ERROR: resolved path escapes package directory: ${np}`);
    process.exit(1);
  }
}

if (existsSync(prebuiltNode) || existsSync(buildNode)) {
  console.log(`[storj-mcp] Native module already present for ${platformStr} — OK`);
  process.exit(0);
}

// Native module is missing — run "make install" in storj-uplink-nodejs
console.log(`[storj-mcp] Native module not found for ${platformStr}.`);
console.log(`[storj-mcp] Running "make install" in storj-uplink-nodejs ...`);

const makefile = join(uplinkDir, 'Makefile');

// Validate Makefile path stays inside uplinkDir (prevent path traversal)
const normalizedMakefile = normalize(resolve(makefile));
if (!normalizedMakefile.startsWith(normalizedRoot)) {
  console.error(`[storj-mcp] ERROR: Makefile path escapes package directory: ${normalizedMakefile}`);
  process.exit(1);
}

if (!existsSync(makefile)) {
  console.error('[storj-mcp] ERROR: Makefile not found in storj-uplink-nodejs.');
  console.error('[storj-mcp] Please reinstall: npm install storj-uplink-nodejs');
  process.exit(1);
}

try {
  execSync('make install VERBOSE=1', {
    cwd: uplinkDir,
    stdio: 'inherit',
    timeout: 300_000, // 5 minutes
  });
  console.log('[storj-mcp] Native module installed successfully.');
} catch (err) {
  console.error('[storj-mcp] ERROR: Failed to build native module.');
  console.error('[storj-mcp] You may need build tools installed:');
  console.error('[storj-mcp]   macOS:   xcode-select --install');
  console.error('[storj-mcp]   Linux:   sudo apt install build-essential curl');
  console.error('[storj-mcp]   Windows: Install MSYS2 (https://www.msys2.org)');
  console.error('');
  console.error('[storj-mcp] Or try manually:');
  console.error(`[storj-mcp]   cd ${uplinkDir}`);
  console.error('[storj-mcp]   make install');
  process.exit(1);
}
