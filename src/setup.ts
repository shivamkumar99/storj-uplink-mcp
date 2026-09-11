#!/usr/bin/env node

/**
 * storj-uplink-mcp-setup — interactive credential setup wizard
 *
 * Usage:
 *   npx storj-uplink-mcp-setup           interactive wizard
 *   npx storj-uplink-mcp-setup --reset   delete config and exit
 *   npx storj-uplink-mcp-setup --status  show active credential source
 *
 * The implementation lives in src/cli/; this file only parses the flags.
 */

import { showStatus, resetConfig } from './cli/status.js';
import { runWizard } from './cli/wizard.js';

const args = new Set(process.argv.slice(2));

if (args.has('--reset')) {
  resetConfig();
} else if (args.has('--status')) {
  showStatus();
} else {
  await runWizard();
}
