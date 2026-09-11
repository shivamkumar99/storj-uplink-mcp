import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Point HOME at a scratch dir so tests never touch the real ~/.storj-mcp.
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os') & { default: typeof import('node:os') }>();
  const home = `${actual.tmpdir()}/storj-mcp-cfg-${process.pid}`;
  return { ...actual, default: { ...actual.default, homedir: () => home }, homedir: () => home };
});

const { saveConfig, loadConfig, deleteConfig, configExists, configPath } = await import('../../src/core/config.js');
const HOME = os.homedir();

beforeEach(() => { fs.rmSync(HOME, { recursive: true, force: true }); fs.mkdirSync(HOME, { recursive: true }); });
afterAll(() => fs.rmSync(HOME, { recursive: true, force: true }));

describe('config', () => {
  it('reports the path and absence before anything is saved', () => {
    expect(configPath()).toBe(path.join(HOME, '.storj-mcp', 'config.json'));
    expect(configExists()).toBe(false);
    expect(loadConfig()).toBeNull();
    expect(() => deleteConfig()).not.toThrow();
  });

  it.each([
    { authType: 'access_grant' as const, accessGrant: 'GRANT-123' },
    { authType: 'passphrase' as const, satellite: 'us1', apiKey: 'key', passphrase: 'pass' },
  ])('round-trips %o encrypted with mode 0600 and no plaintext on disk', (config) => {
    saveConfig(config);
    expect(configExists()).toBe(true);
    expect(fs.statSync(configPath()).mode & 0o777).toBe(0o600);
    const raw = fs.readFileSync(configPath(), 'utf8');
    for (const secret of ['GRANT-123', 'key', 'pass']) expect(raw).not.toContain(`"${secret}"`);
    expect(JSON.parse(raw)).toMatchObject({ authType: config.authType });
    expect(loadConfig()).toEqual(config);
  });

  it('returns null for unreadable JSON or a tampered ciphertext', () => {
    fs.mkdirSync(path.dirname(configPath()), { recursive: true });
    fs.writeFileSync(configPath(), 'not json');
    expect(loadConfig()).toBeNull();

    saveConfig({ authType: 'access_grant', accessGrant: 'x' });
    const file = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
    file.ciphertext = 'ff'.repeat(16);
    fs.writeFileSync(configPath(), JSON.stringify(file));
    expect(loadConfig()).toBeNull();
  });

  it('deleteConfig removes the file', () => {
    saveConfig({ authType: 'access_grant', accessGrant: 'x' });
    deleteConfig();
    expect(configExists()).toBe(false);
  });
});
