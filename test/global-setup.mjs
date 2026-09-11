// Build the MCP App views before the suite runs, so tests that read the
// ui:// resources over the protocol are self-sufficient.
import { buildUi } from '../scripts/build-ui.mjs';
export default async function setup() { await buildUi(); }
