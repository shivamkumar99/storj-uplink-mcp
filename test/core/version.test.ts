import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { VERSION } from '../../src/core/version.js';
import { createServer } from '../../src/server.js';

const require = createRequire(import.meta.url);
const manifest = require('../../package.json') as { version: string };

describe('version reporting', () => {
  it('exports the version from package.json', () => {
    expect(VERSION).toBe(manifest.version);
  });

  it('advertises that version to MCP clients', () => {
    const server = createServer();
    // The SDK keeps serverInfo on the underlying Server instance.
    const info = (server.server as unknown as { _serverInfo: { name: string; version: string } })._serverInfo;
    expect(info.name).toBe('storj-uplink-mcp');
    expect(info.version).toBe(manifest.version);
  });

  it('leaves no hardcoded version behind in the sources', () => {
    for (const file of ['../../src/server.ts', '../../ui/browser/browser.ts']) {
      const src = readFileSync(new URL(file, import.meta.url), 'utf8');
      expect(src).not.toMatch(/version: ['"]\d+\.\d+\.\d+['"]/);
    }
  });
});
