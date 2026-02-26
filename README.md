# storj-uplink-mcp

MCP server for [Storj](https://storj.io) decentralized storage — use Storj directly from Claude Desktop, Cursor, Windsurf, and any MCP-compatible AI client.

## Quick Start

### Step 1 — Run the setup wizard

```bash
npx storj-uplink-mcp-setup
```

The wizard will ask for your Storj credentials (Access Grant or Satellite + API Key + Passphrase) and save them **encrypted** on your machine. You only need to do this once.

> **Get an Access Grant:** Log in to [Storj Console](https://console.storj.io) → Access → Create Access Grant → select permissions → copy the grant string.

### Step 2 — Add to your AI client config

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS, `%APPDATA%\Claude\claude_desktop_config.json` on Windows):

```json
{
  "mcpServers": {
    "storj": {
      "command": "npx",
      "args": ["storj-uplink-mcp"]
    }
  }
}
```

**Cursor** (`~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "storj": {
      "command": "npx",
      "args": ["storj-uplink-mcp"]
    }
  }
}
```

**Windsurf** (`~/.windsurf/mcp.json`): same format as above.

### Step 3 — Restart your AI client

Fully quit and reopen the app. Then try:

> *"List my Storj buckets"*
> *"Upload this text as notes/todo.txt in my bucket"*
> *"Generate a share URL for bucket/photo.jpg"*

---

## Alternative: Environment Variables

If you prefer not to use the setup wizard (useful for CI, Docker, or power users):

```json
{
  "mcpServers": {
    "storj": {
      "command": "npx",
      "args": ["storj-uplink-mcp"],
      "env": {
        "STORJ_ACCESS_GRANT": "your-access-grant-string"
      }
    }
  }
}
```

Or with individual credentials:

```json
{
  "env": {
    "STORJ_SATELLITE": "us1.storj.io:7777",
    "STORJ_API_KEY": "your-api-key",
    "STORJ_PASSPHRASE": "your-passphrase"
  }
}
```

Env vars take priority over the config file.

---

## Managing Credentials

```bash
# Reconfigure or replace credentials
npx storj-uplink-mcp-setup

# Check which credential source is active (never shows secrets)
npx storj-uplink-mcp-setup --status

# Delete saved config (clean slate)
npx storj-uplink-mcp-setup --reset
```

Credentials are stored encrypted at `~/.storj-mcp/config.json` using AES-256-GCM with a machine-specific key. The file is only readable by your user account (`chmod 600`).

---

## Available Tools

| Tool | Description |
|------|-------------|
| `list_buckets` | List all buckets in your project |
| `create_bucket` | Create a new bucket |
| `delete_bucket` | Delete a bucket (optionally with all objects) |
| `list_objects` | List objects in a bucket, with optional prefix filter |
| `stat_object` | Get object info: size, creation date, metadata |
| `delete_object` | Delete an object |
| `copy_object` | Copy an object to a new key or bucket |
| `move_object` | Move or rename an object |
| `update_metadata` | Update custom metadata on an object |
| `upload_text` | Upload text/string content as an object |
| `upload_file` | Upload a local file to Storj |
| `download_text` | Download an object and return content as text |
| `download_file` | Download an object and save to a local path |
| `generate_share_url` | Create a public shareable URL for an object |
| `share_access` | Create a restricted access grant (read-only, time-limited, prefix-scoped) |
| `serialize_access` | Serialize the current access grant to a string |

---

## Requirements

- Node.js 18+
- A [Storj account](https://storj.io) with an API key or Access Grant

## License

MIT
# storj-uplink-mcp
