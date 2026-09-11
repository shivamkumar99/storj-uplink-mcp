import { loadConfig, deleteConfig, configPath, configExists } from '../core/config.js';
import { ENV, readStorjEnv, hasPassphraseCredentials } from '../core/env.js';
import { print, hr } from './console.js';

// ---------------------------------------------------------------------------
// --status and --reset
// ---------------------------------------------------------------------------

export function showStatus(): void {
  print();
  print('  Storj MCP Server — Credential Status');
  hr();

  const env = readStorjEnv();
  const hasEnvGrant = Boolean(env.accessGrant);
  const hasEnvPassphrase = hasPassphraseCredentials(env);
  const hasConfigFile = configExists();

  if (hasEnvGrant) {
    print('  Active source : environment variable');
    print(`  Variable      : ${ENV.ACCESS_GRANT}`);
    print('  Auth type     : access_grant');
  } else if (hasEnvPassphrase) {
    print('  Active source : environment variables');
    print(`  Variables     : ${ENV.SATELLITE}, ${ENV.API_KEY}, ${ENV.PASSPHRASE}`);
    print('  Auth type     : passphrase');
  } else if (hasConfigFile) {
    const config = loadConfig();
    if (config) {
      print(`  Active source : config file`);
      print(`  Location      : ${configPath()}`);
      print(`  Auth type     : ${config.authType}`);
      print(`  Encrypted     : yes (AES-256-GCM)`);
    } else {
      print('  Active source : config file (found but cannot decrypt)');
      print(`  Location      : ${configPath()}`);
      print('  Note          : Config may be from a different machine/user.');
      print('  Fix           : Run setup again to reconfigure.');
    }
  } else {
    print('  Active source : none');
    print('  Fix           : Run  npx storj-uplink-mcp-setup  to configure.');
  }

  print();
}

export function resetConfig(): void {
  if (!configExists()) {
    print();
    print('  No config file found. Nothing to reset.');
    print();
    return;
  }
  deleteConfig();
  print();
  print(`  ✓ Config deleted: ${configPath()}`);
  print();
}
