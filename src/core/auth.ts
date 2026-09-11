import { Uplink, type AccessResultStruct, type ProjectResultStruct } from 'storj-uplink-nodejs';
import { loadConfig, configPath, type StorjMcpConfig } from './config.js';
import { ENV, readStorjEnv, hasPassphraseCredentials } from './env.js';

// ---------------------------------------------------------------------------
// Singleton state — lazy-initialized on first tool call
// ---------------------------------------------------------------------------

let _project: ProjectResultStruct | null = null;
let _access: AccessResultStruct | null = null;

// ---------------------------------------------------------------------------
// Credential resolution
//
// Priority (variable names live in env.ts):
//   1. ENV.ACCESS_GRANT
//   2. ENV.SATELLITE + ENV.API_KEY + ENV.PASSPHRASE
//   3. ~/.storj-mcp/config.json (written by setup wizard)
// ---------------------------------------------------------------------------

/** Turn a decrypted config file into an access, whichever auth type it holds. */
function accessFromConfig(uplink: Uplink, config: StorjMcpConfig): Promise<AccessResultStruct> {
  if (config.authType === 'access_grant' && config.accessGrant) {
    return uplink.parseAccess(config.accessGrant);
  }
  if (config.authType === 'passphrase' && config.satellite && config.apiKey && config.passphrase) {
    return uplink.requestAccessWithPassphrase(config.satellite, config.apiKey, config.passphrase);
  }
  throw new Error('Config file exists but is missing required fields. Run: npx storj-uplink-mcp-setup');
}

async function resolveAccess(): Promise<AccessResultStruct> {
  const uplink = new Uplink();
  const env = readStorjEnv();

  // Priority 1: access grant env var
  if (env.accessGrant) {
    console.error(`[storj-mcp] Auth: using ${ENV.ACCESS_GRANT} env var`);
    return uplink.parseAccess(env.accessGrant);
  }

  // Priority 2: satellite + apiKey + passphrase env vars
  if (hasPassphraseCredentials(env)) {
    console.error(`[storj-mcp] Auth: using ${ENV.SATELLITE}/${ENV.API_KEY}/${ENV.PASSPHRASE} env vars`);
    return uplink.requestAccessWithPassphrase(env.satellite, env.apiKey, env.passphrase);
  }

  // Priority 3: config file
  const config = loadConfig();
  if (config) {
    console.error(`[storj-mcp] Auth: using config file (${configPath()})`);
    return accessFromConfig(uplink, config);
  }

  throw new Error(
    'No Storj credentials found.\n' +
      'Run the setup wizard:  npx storj-uplink-mcp-setup\n' +
      `Or set env vars:       ${ENV.ACCESS_GRANT}=<grant>`,
  );
}

// ---------------------------------------------------------------------------
// Public API — getProject() is called by every tool
// ---------------------------------------------------------------------------

export async function getProject(): Promise<ProjectResultStruct> {
  if (_project?.isOpen) {
    return _project;
  }

  // Re-init (first call or project was closed)
  _access = await resolveAccess();
  _project = await _access.openProject();
  console.error('[storj-mcp] Project connection established');
  return _project;
}

// ---------------------------------------------------------------------------
// requireAccess — initializes the connection if needed and returns the
// AccessResultStruct directly.  Use this in tools that need the access grant
// (e.g. edge/sharing tools).
// ---------------------------------------------------------------------------

export async function requireAccess(): Promise<AccessResultStruct> {
  await getProject(); // ensures _access is populated
  if (!_access) throw new Error('Not connected to Storj. No access grant was resolved.');
  return _access;
}

// ---------------------------------------------------------------------------
// Graceful shutdown — exported so index.ts can wire it to process signals.
// Keeping signal handler registration in index.ts maintains SRP: auth.ts
// manages connection state, index.ts manages process lifecycle.
// ---------------------------------------------------------------------------

export async function shutdown(): Promise<void> {
  if (_project?.isOpen) {
    try {
      await _project.close();
      console.error('[storj-mcp] Project connection closed');
    } catch {
      // ignore errors during shutdown
    }
  }
}
