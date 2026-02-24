#!/usr/bin/env node

/**
 * storj-uplink-mcp-setup — interactive credential setup wizard
 *
 * Usage:
 *   npx storj-uplink-mcp-setup           interactive wizard
 *   npx storj-uplink-mcp-setup --reset   delete config and exit
 *   npx storj-uplink-mcp-setup --status  show active credential source
 */

import readline from 'node:readline';
import os from 'node:os';
import {
  saveConfig,
  loadConfig,
  deleteConfig,
  configPath,
  configExists,
  type StorjMcpConfig,
} from './config.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function print(msg = ''): void {
  console.log(msg);
}

function hr(): void {
  console.log('─'.repeat(50));
}

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

// ---------------------------------------------------------------------------
// --status flag
// ---------------------------------------------------------------------------

function showStatus(): void {
  print();
  print('  Storj MCP Server — Credential Status');
  hr();

  const hasEnvGrant = Boolean(process.env['STORJ_ACCESS_GRANT']);
  const hasEnvPassphrase =
    Boolean(process.env['STORJ_SATELLITE']) &&
    Boolean(process.env['STORJ_API_KEY']) &&
    Boolean(process.env['STORJ_PASSPHRASE']);
  const hasConfigFile = configExists();

  if (hasEnvGrant) {
    print('  Active source : environment variable');
    print('  Variable      : STORJ_ACCESS_GRANT');
    print('  Auth type     : access_grant');
  } else if (hasEnvPassphrase) {
    print('  Active source : environment variables');
    print('  Variables     : STORJ_SATELLITE, STORJ_API_KEY, STORJ_PASSPHRASE');
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

// ---------------------------------------------------------------------------
// --reset flag
// ---------------------------------------------------------------------------

function resetConfig(): void {
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

// ---------------------------------------------------------------------------
// Interactive wizard
// ---------------------------------------------------------------------------

async function runWizard(): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    print();
    print('  Storj MCP Server — Setup Wizard');
    hr();
    print();

    // If config already exists, offer options
    if (configExists()) {
      const existing = loadConfig();
      if (existing) {
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
          rl.close();
          showStatus();
          return;
        }
        if (choice === '3') {
          rl.close();
          resetConfig();
          return;
        }
        if (choice === '4' || choice === '') {
          rl.close();
          print('  No changes made.');
          print();
          return;
        }
        // choice === '1' falls through to wizard below
      }
    }

    // Auth type selection
    print('  How do you want to connect to Storj?');
    print('    1) Access Grant  (recommended — one string, get it from Storj Console)');
    print('    2) Satellite + API Key + Passphrase');
    print();
    const authChoice = await ask(rl, '  Enter choice [1-2]: ');
    print();

    let config: StorjMcpConfig;

    if (authChoice === '2') {
      // Passphrase mode
      const satellite = await ask(rl, '  Satellite address (e.g. us1.storj.io:7777): ');
      const apiKey = await ask(rl, '  API Key: ');
      const passphrase = await ask(rl, '  Passphrase: ');

      if (!satellite || !apiKey || !passphrase) {
        print();
        print('  ✗ All fields are required. Setup cancelled.');
        print();
        rl.close();
        return;
      }

      config = { authType: 'passphrase', satellite, apiKey, passphrase };
    } else {
      // Access grant mode (default)
      const accessGrant = await ask(rl, '  Paste your Access Grant: ');
      if (!accessGrant) {
        print();
        print('  ✗ Access Grant is required. Setup cancelled.');
        print();
        rl.close();
        return;
      }
      config = { authType: 'access_grant', accessGrant };
    }

    // Save
    saveConfig(config);
    rl.close();

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
  } catch (err) {
    rl.close();
    console.error('Setup error:', err);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

if (args.includes('--reset')) {
  resetConfig();
} else if (args.includes('--status')) {
  showStatus();
} else {
  void runWizard();
}
