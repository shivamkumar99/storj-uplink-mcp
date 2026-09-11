import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ENV } from '../src/env.js';

const m = vi.hoisted(() => ({
  parseAccess: vi.fn(),
  requestAccessWithPassphrase: vi.fn(),
  loadConfig: vi.fn(),
}));
vi.mock('storj-uplink-nodejs', () => ({
  Uplink: class { parseAccess = m.parseAccess; requestAccessWithPassphrase = m.requestAccessWithPassphrase; },
  StorjError: class extends Error {},
}));
vi.mock('../src/config.js', () => ({ loadConfig: m.loadConfig, configPath: () => '/fake/config.json' }));

const makeProject = () => ({ isOpen: true, close: vi.fn(async () => {}) });
const makeAccess = (project = makeProject()) => ({ project, openProject: vi.fn(async () => project), satelliteAddress: async () => 'sat' });
const load = async () => { vi.resetModules(); return import('../src/auth.js'); };

beforeEach(() => {
  for (const k of Object.values(ENV)) vi.stubEnv(k, '');
  m.parseAccess.mockReset(); m.requestAccessWithPassphrase.mockReset(); m.loadConfig.mockReset().mockReturnValue(null);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('credential resolution priority', () => {
  it('1. STORJ_ACCESS_GRANT env var', async () => {
    vi.stubEnv(ENV.ACCESS_GRANT, 'env-grant');
    const access = makeAccess(); m.parseAccess.mockResolvedValue(access);
    const auth = await load();
    expect(await auth.getProject()).toBe(access.project);
    expect(m.parseAccess).toHaveBeenCalledWith('env-grant');
    expect(console.error).toHaveBeenCalledWith('[storj-mcp] Auth: using STORJ_ACCESS_GRANT env var');
  });

  it('2. satellite + api key + passphrase env vars', async () => {
    vi.stubEnv(ENV.SATELLITE, 'sat'); vi.stubEnv(ENV.API_KEY, 'k'); vi.stubEnv(ENV.PASSPHRASE, 'p');
    const access = makeAccess(); m.requestAccessWithPassphrase.mockResolvedValue(access);
    const auth = await load();
    expect(await auth.getProject()).toBe(access.project);
    expect(m.requestAccessWithPassphrase).toHaveBeenCalledWith('sat', 'k', 'p');
  });

  it('3a. config file with an access grant', async () => {
    m.loadConfig.mockReturnValue({ authType: 'access_grant', accessGrant: 'cfg-grant' });
    const access = makeAccess(); m.parseAccess.mockResolvedValue(access);
    expect(await (await load()).getProject()).toBe(access.project);
    expect(m.parseAccess).toHaveBeenCalledWith('cfg-grant');
  });

  it('3b. config file with passphrase credentials', async () => {
    m.loadConfig.mockReturnValue({ authType: 'passphrase', satellite: 's', apiKey: 'k', passphrase: 'p' });
    const access = makeAccess(); m.requestAccessWithPassphrase.mockResolvedValue(access);
    expect(await (await load()).getProject()).toBe(access.project);
    expect(m.requestAccessWithPassphrase).toHaveBeenCalledWith('s', 'k', 'p');
  });

  it('rejects an incomplete config file with a setup hint', async () => {
    m.loadConfig.mockReturnValue({ authType: 'passphrase', satellite: 's' });
    await expect((await load()).getProject()).rejects.toThrow('missing required fields. Run: npx storj-uplink-mcp-setup');
  });

  it('rejects when nothing is configured', async () => {
    await expect((await load()).getProject()).rejects.toThrow('No Storj credentials found');
  });
});

describe('connection lifecycle', () => {
  it('caches the open project and re-resolves once it is closed', async () => {
    vi.stubEnv(ENV.ACCESS_GRANT, 'g');
    const access = makeAccess(); m.parseAccess.mockResolvedValue(access);
    const auth = await load();
    await auth.getProject(); await auth.getProject();
    expect(m.parseAccess).toHaveBeenCalledTimes(1);
    access.project.isOpen = false;
    await auth.getProject();
    expect(m.parseAccess).toHaveBeenCalledTimes(2);
  });

  it('requireAccess exposes the resolved access grant', async () => {
    vi.stubEnv(ENV.ACCESS_GRANT, 'g');
    const access = makeAccess(); m.parseAccess.mockResolvedValue(access);
    expect(await (await load()).requireAccess()).toBe(access);
  });

  it('shutdown closes an open project, tolerates errors, and is a no-op when never connected', async () => {
    const auth1 = await load();
    await expect(auth1.shutdown()).resolves.toBeUndefined();

    vi.stubEnv(ENV.ACCESS_GRANT, 'g');
    const access = makeAccess(); m.parseAccess.mockResolvedValue(access);
    const auth2 = await load();
    await auth2.getProject();
    await auth2.shutdown();
    expect(access.project.close).toHaveBeenCalledTimes(1);

    access.project.close.mockRejectedValueOnce(new Error('already closed'));
    await expect(auth2.shutdown()).resolves.toBeUndefined();
  });
});
