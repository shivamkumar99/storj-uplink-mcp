import { Uplink, type AccessResultStruct, type ProjectResultStruct } from 'storj-uplink-nodejs';
import { loadConfig, configPath } from './config.js';

// ---------------------------------------------------------------------------
// Singleton state — lazy-initialized on first tool call
// ---------------------------------------------------------------------------

let _project: ProjectResultStruct | null = null;
let _access: AccessResultStruct | null = null;

// ---------------------------------------------------------------------------
// Credential resolution
//
// Priority:
//   1. STORJ_ACCESS_GRANT env var
//   2. STORJ_SATELLITE + STORJ_API_KEY + STORJ_PASSPHRASE env vars
//   3. ~/.storj-mcp/config.json (written by setup wizard)
// ---------------------------------------------------------------------------

async function resolveAccess(): Promise<AccessResultStruct> {
  const uplink = new Uplink();

  // Priority 1: access grant env var
  const accessGrant = process.env['STORJ_ACCESS_GRANT'];
  if (accessGrant) {
    console.error('[storj-mcp] Auth: using STORJ_ACCESS_GRANT env var');
    return uplink.parseAccess(accessGrant);
  }

  // Priority 2: satellite + apiKey + passphrase env vars
  const satellite = process.env['STORJ_SATELLITE'];
  const apiKey = process.env['STORJ_API_KEY'];
  const passphrase = process.env['STORJ_PASSPHRASE'];
  if (satellite && apiKey && passphrase) {
    console.error('[storj-mcp] Auth: using STORJ_SATELLITE/API_KEY/PASSPHRASE env vars');
    return uplink.requestAccessWithPassphrase(satellite, apiKey, passphrase);
  }

  // Priority 3: config file
  const config = loadConfig();
  if (config) {
    console.error(`[storj-mcp] Auth: using config file (${configPath()})`);
    if (config.authType === 'access_grant' && config.accessGrant) {
      return uplink.parseAccess(config.accessGrant);
    }
    if (
      config.authType === 'passphrase' &&
      config.satellite &&
      config.apiKey &&
      config.passphrase
    ) {
      return uplink.requestAccessWithPassphrase(config.satellite, config.apiKey, config.passphrase);
    }
    throw new Error('Config file exists but is missing required fields. Run: npx storj-uplink-mcp-setup');
  }

  throw new Error(
    'No Storj credentials found.\n' +
      'Run the setup wizard:  npx storj-uplink-mcp-setup\n' +
      'Or set env vars:       STORJ_ACCESS_GRANT=<grant>',
  );
}

// ---------------------------------------------------------------------------
// Public API — getProject() is called by every tool
// ---------------------------------------------------------------------------

export async function getProject(): Promise<ProjectResultStruct> {
  if (_project && _project.isOpen) {
    return _project;
  }

  // Re-init (first call or project was closed)
  _access = await resolveAccess();
  _project = await _access.openProject();
  console.error('[storj-mcp] Project connection established');
  return _project;
}

export function getAccess(): AccessResultStruct | null {
  return _access;
}

// ---------------------------------------------------------------------------
// Graceful shutdown — close project on process exit
// ---------------------------------------------------------------------------

async function shutdown(): Promise<void> {
  if (_project && _project.isOpen) {
    try {
      await _project.close();
      console.error('[storj-mcp] Project connection closed');
    } catch {
      // ignore errors during shutdown
    }
  }
}

process.on('SIGINT', () => { void shutdown().then(() => process.exit(0)); });
process.on('SIGTERM', () => { void shutdown().then(() => process.exit(0)); });
