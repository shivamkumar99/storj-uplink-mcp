import readline from 'node:readline';
import os from 'node:os';
import { saveConfig, loadConfig, configPath, configExists, type StorjMcpConfig } from '../core/config.js';
import { print, hr, ask } from './console.js';
import { showStatus, resetConfig } from './status.js';

// ---------------------------------------------------------------------------
// Interactive wizard
// ---------------------------------------------------------------------------

/**
 * Menu shown when a config already exists.
 * Returns true when the user chose to reconfigure, false when the wizard should stop.
 */
async function offerExistingConfigMenu(rl: readline.Interface, existing: StorjMcpConfig): Promise<boolean> {
  print(`  ⚠  Existing config found: ${configPath()}`);
  print(`     Auth type: ${existing.authType}`);
  print();
  print('  What would you like to do?');
  print('    1) Reconfigure (replace credentials)');
  print('    2) Show status');
  print('    3) Delete config and exit');
  print('    4) Exit (keep existing config)');
  print();

  const choice = await ask(rl, '  Enter choice [1-4]: ');
  print();

  if (choice === '2') {
    showStatus();
    return false;
  }
  if (choice === '3') {
    resetConfig();
    return false;
  }
  if (choice === '4' || choice === '') {
    print('  No changes made.');
    print();
    return false;
  }
  return true; // '1' — reconfigure
}

/** Ask for credentials. Returns null (after explaining why) if a required field was left blank. */
async function promptForConfig(rl: readline.Interface): Promise<StorjMcpConfig | null> {
  print('  How do you want to connect to Storj?');
  print('    1) Access Grant  (recommended — one string, get it from Storj Console)');
  print('    2) Satellite + API Key + Passphrase');
  print();
  const authChoice = await ask(rl, '  Enter choice [1-2]: ');
  print();

  if (authChoice === '2') {
    const satellite = await ask(rl, '  Satellite address (e.g. us1.storj.io:7777): ');
    const apiKey = await ask(rl, '  API Key: ');
    const passphrase = await ask(rl, '  Passphrase: ');

    if (!satellite || !apiKey || !passphrase) {
      print();
      print('  ✗ All fields are required. Setup cancelled.');
      print();
      return null;
    }
    return { authType: 'passphrase', satellite, apiKey, passphrase };
  }

  // Access grant mode (default)
  const accessGrant = await ask(rl, '  Paste your Access Grant: ');
  if (!accessGrant) {
    print();
    print('  ✗ Access Grant is required. Setup cancelled.');
    print();
    return null;
  }
  return { authType: 'access_grant', accessGrant };
}

/** Confirmation plus the client-config snippet shown after a successful save. */
function printNextSteps(): void {
  print();
  print(`  ✓ Config saved to: ${configPath()}`);
  print(`  ✓ Encrypted with AES-256-GCM (tied to ${os.hostname()}/${os.userInfo().username})`);
  print();
  hr();
  print();
  print('  Add this to your Claude Desktop config:');
  print('  (~/Library/Application Support/Claude/claude_desktop_config.json)');
  print();
  print('  {');
  print('    "mcpServers": {');
  print('      "storj": {');
  print('        "command": "npx",');
  print('        "args": ["storj-uplink-mcp"]');
  print('      }');
  print('    }');
  print('  }');
  print();
  print('  For Cursor: ~/.cursor/mcp.json  (same format)');
  print('  For Windsurf: ~/.windsurf/mcp.json  (same format)');
  print();
  hr();
  print();
  print('  Restart your AI client and you\'re ready!');
  print('  Try: "List my Storj buckets"');
  print();
}

export async function runWizard(): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    print();
    print('  Storj MCP Server — Setup Wizard');
    hr();
    print();

    // If a readable config already exists, offer to keep/inspect/delete it first
    const existing = configExists() ? loadConfig() : null;
    if (existing && !(await offerExistingConfigMenu(rl, existing))) return;

    const config = await promptForConfig(rl);
    if (!config) return;

    saveConfig(config);
    printNextSteps();
  } catch (err) {
    console.error('Setup error:', err);
    process.exit(1);
  } finally {
    rl.close();
  }
}
