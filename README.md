# storj-uplink-mcp

[![CI](https://github.com/shivamkumar99/storj-uplink-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/shivamkumar99/storj-uplink-mcp/actions/workflows/ci.yml)
[![Release](https://github.com/shivamkumar99/storj-uplink-mcp/actions/workflows/release.yml/badge.svg)](https://github.com/shivamkumar99/storj-uplink-mcp/actions/workflows/release.yml)
[![npm version](https://img.shields.io/npm/v/storj-uplink-mcp.svg)](https://www.npmjs.com/package/storj-uplink-mcp)
[![npm downloads](https://img.shields.io/npm/dt/storj-uplink-mcp.svg)](https://www.npmjs.com/package/storj-uplink-mcp)
[![Node.js](https://img.shields.io/node/v/storj-uplink-mcp.svg)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

**MCP server for [Storj](https://storj.io) decentralized storage** — upload, download, list, share, and manage files on Storj using natural language from Claude Desktop, Cursor, Windsurf, VS Code Copilot, and any MCP-compatible AI client.

> *"Upload this file to my photos bucket"*  
> *"List all objects in my backup bucket"*  
> *"Generate a share link for report.pdf"*

## Features

- 🪣 **Bucket management** — create, list, stat, usage summary, delete (single or batch with glob patterns)
- 📁 **Object operations** — upload, download, copy, move, delete, stat, update metadata
- 🗂️ **Bulk transfers** — upload a whole directory or download a whole prefix, streamed with per-file progress
- 🔍 **Smart reading of large files** — `peek_object_head`, `peek_object_tail` and `grep_object` fetch only the bytes they need, so a multi-GB log never enters the AI's context
- 🗑️ **Batch delete** — delete multiple buckets or objects by name list, prefix, or glob pattern (`*.log`, `tmp-*`)
- 🔗 **Sharing** — public URLs, restricted access grants, and S3-compatible credentials (least privilege, time-limited, prefix-scoped)
- 🧹 **Multipart housekeeping** — find and abort incomplete multipart uploads that still cost storage
- 🖼️ **Interactive object browser** — hosts that support [MCP Apps](https://modelcontextprotocol.io/extensions/apps) render `list_objects` as a sortable, filterable file browser with folder navigation and previews; other hosts get the same result as text
- ⚡ **Configurable chunk size** — tune upload/download buffer size (4 KB – 64 MB) for optimal performance
- 📊 **Progress and cancellation** — MCP progress notifications for long operations; client cancellation stops transfers mid-stream
- 🛡️ **Hardened by default** — path-traversal and Zip-Slip guards, symlink-safe directory walks, prompt-injection sanitising of untrusted keys and content, secret redaction, audit log on stderr
- 🔐 **Encrypted credentials** — AES-256-GCM encryption with machine-specific key, `chmod 600`
- 🐳 **Docker** — hardened distroless image and a compose file (see [infra/](infra/))
- 🖥️ **Multi-client** — works with Claude Desktop, Cursor, Windsurf, VS Code Copilot, and any MCP client
- 🌍 **Cross-platform** — macOS, Linux, Windows

## Quick Start

### Step 1 — Install and run the setup wizard

#### Global install:
```bash
npm install -g storj-uplink-mcp   # Install globally
storj-uplink-mcp-setup            # Run setup wizard
```

#### Local install:
```bash
npm install storj-uplink-mcp      # Install locally
npx storj-uplink-mcp-setup        # Run setup wizard (recommended)
# Or:
./node_modules/.bin/storj-uplink-mcp-setup
```

The wizard will ask for your Storj credentials (Access Grant or Satellite + API Key + Passphrase) and save them **encrypted** on your machine. You only need to do this once.

> **Get an Access Grant:** Log in to [Storj Console](https://console.storj.io) → Access → Create Access Grant → select permissions → copy the grant string.


### Step 2 — Add to your AI client config

> **💡 Tip:** Not sure where the config file is? Run the helper command for your client to find or open it:
>
> | Client | Find config path |
> |--------|-----------------|
> | **Claude Desktop** | macOS: `open ~/Library/Application\ Support/Claude/` <br> Windows: `explorer %APPDATA%\Claude\` |
> | **Cursor** | `cursor --locate-mcp-config` or check `~/.cursor/mcp.json` |
> | **Windsurf** | Check `~/.codeium/windsurf/mcp_config.json` |
> | **VS Code** | Create `.vscode/mcp.json` in your workspace, or open User Settings JSON (`Cmd+Shift+P` → "Open User Settings (JSON)") |
>
> Config paths vary by OS and version. When in doubt, check your client's official docs.

#### Claude Desktop
Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "storj": {
      "command": "storj-uplink-mcp",
      "args": []
    }
  }
}
```

If you installed globally, use `"command": "storj-uplink-mcp"`. If you prefer npx, use:
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

#### Cursor
Edit `~/.cursor/mcp.json`:
```json
{
  "mcpServers": {
    "storj": {
      "command": "storj-uplink-mcp",
      "args": []
    }
  }
}
```

#### Windsurf
Edit `~/.codeium/windsurf/mcp_config.json`:
```json
{
  "mcpServers": {
    "storj": {
      "command": "storj-uplink-mcp",
      "args": []
    }
  }
}
```

#### VS Code (Copilot)
Create `.vscode/mcp.json` in your workspace:
```json
{
  "servers": {
    "storj": {
      "type": "stdio",
      "command": "npx",
      "args": ["storj-uplink-mcp"]
    }
  }
}
```
Or add to your User Settings JSON (`Cmd+Shift+P` → "Preferences: Open User Settings (JSON)"):
```json
{
  "mcp": {
    "servers": {
      "storj": {
        "type": "stdio",
        "command": "npx",
        "args": ["storj-uplink-mcp"]
      }
    }
  }
}
```

### Step 3 — Restart your AI client

Fully quit and reopen Claude, Cursor, or Windsurf. Then try:

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

#### Global install:
```bash
storj-uplink-mcp-setup            # Setup/reconfigure
storj-uplink-mcp-setup --status   # Check credential source
storj-uplink-mcp-setup --reset    # Delete saved config
```

#### Local install:
```bash
npx storj-uplink-mcp-setup            # Setup/reconfigure
npx storj-uplink-mcp-setup --status   # Check credential source
npx storj-uplink-mcp-setup --reset    # Delete saved config
# Or:
./node_modules/.bin/storj-uplink-mcp-setup --reset
```

Credentials are stored encrypted at `~/.storj-mcp/config.json` using AES-256-GCM with a machine-specific key. The file is only readable by your user account (`chmod 600`).

---

## Available Tools

28 tools. Every tool declares MCP annotations (read-only / destructive / idempotent) so clients can ask before destructive calls.

**Buckets**

| Tool | Description |
|------|-------------|
| `list_buckets` | List all buckets in your project |
| `create_bucket` | Create a bucket (idempotent) |
| `stat_bucket` | Name and creation time of one bucket; cheap existence check |
| `bucket_usage` | Object count and total bytes for a bucket or prefix, like `du` |
| `delete_bucket` | Delete a bucket (optionally with all objects) |
| `delete_buckets` | Delete multiple buckets by name list or glob pattern |

**Objects**

| Tool | Description |
|------|-------------|
| `list_objects` | List objects in a bucket, with optional prefix filter. Returns structured output and renders as an interactive browser in MCP Apps hosts |
| `stat_object` | Object info: size, creation date, expiry, metadata |
| `delete_object` | Delete an object |
| `delete_objects` | Delete multiple objects by key list, prefix, or glob pattern |
| `copy_object` | Copy an object to a new key or bucket |
| `move_object` | Move or rename an object |
| `update_metadata` | Update custom metadata on an object |

**Upload and download**

| Tool | Description |
|------|-------------|
| `upload_text` | Upload text/string content as an object (optional metadata, expiry, chunk size) |
| `upload_file` | Stream a local file to Storj without loading it into memory |
| `upload_directory` | Recursively upload a folder under a key prefix; skips symlinks and sensitive paths |
| `download_text` | Download an object and return its content as text (50 MB limit) |
| `download_file` | Stream an object to a local path |
| `download_prefix` | Download every object under a prefix (or a whole bucket) to a folder, preserving layout |

**Reading large files without downloading them**

| Tool | Description |
|------|-------------|
| `peek_object_head` | First N lines of an object (CSV headers, JSON structure, config files) |
| `peek_object_tail` | Last N lines of an object, fetching only the final 512 KB (recent log entries) |
| `grep_object` | Stream-search an object for a keyword with optional context lines; stops at `max_matches` |

**Sharing and access**

| Tool | Description |
|------|-------------|
| `generate_share_url` | Public linkshare URL for an object, optionally expiring |
| `get_s3_credentials` | S3-compatible access key, secret and endpoint for rclone, aws-cli or any S3 SDK, scoped to a bucket/prefix with least-privilege permissions |
| `share_access` | Restricted, serialized access grant (permissions, prefix, expiry) |
| `serialize_access` | Serialize the current access grant to a string |

**Multipart housekeeping**

| Tool | Description |
|------|-------------|
| `list_multipart_uploads` | Pending (incomplete) multipart uploads that still consume storage |
| `abort_multipart_upload` | Abort one incomplete multipart upload and free its storage |

---

## Running in Docker

A hardened image (multi-stage, distroless, non-root, pinned base digests) and a compose file with read-only rootfs, dropped capabilities and resource limits live in [infra/](infra/). Build with `npm run docker:build` and point your MCP client at `docker run -i …` as shown in [infra/README.md](infra/README.md).

---

## Development

```bash
npm test              # unit + protocol tests (Vitest, in-memory MCP transport)
npm run lint          # ESLint (type-aware) incl. the 200-line file limit
npm run typecheck
npm run knip          # unused exports / dependencies
npm run inspect       # MCP Inspector against the built server
npm run dev:storj up  # private Storj network in Docker (storj-up) for testing
npm run test:e2e      # full tool lifecycle against that local network
```

The code is organised as vertical slices (one folder per feature with `schema.ts`, `handlers.ts`, `tools.ts`); see [ARCHITECTURE.md](ARCHITECTURE.md). The local Storj network for testing without touching the real network is documented in [infra/dev/README.md](infra/dev/README.md).

---

## Uninstalling

### 1. Remove the MCP server config from your AI client

Remove the `"storj"` entry from the config file you added it to:

| Client | Config location |
|--------|----------------|
| **Claude Desktop** | macOS: `~/Library/Application Support/Claude/claude_desktop_config.json` <br> Windows: `%APPDATA%\Claude\claude_desktop_config.json` |
| **Cursor** | `~/.cursor/mcp.json` |
| **Windsurf** | `~/.codeium/windsurf/mcp_config.json` |
| **VS Code** | `.vscode/mcp.json` in your workspace, or User Settings JSON |

### 2. Delete saved credentials

```bash
# Using the setup CLI:
storj-uplink-mcp-setup --reset
# Or npx:
npx storj-uplink-mcp-setup --reset

# Or manually remove the config directory:
rm -rf ~/.storj-mcp
```

### 3. Uninstall the package

```bash
# If installed globally:
npm uninstall -g storj-uplink-mcp

# If installed locally in a project:
npm uninstall storj-uplink-mcp
```

### 4. Verify removal

```bash
# Should return nothing / "not found":
which storj-uplink-mcp
npm list -g storj-uplink-mcp
```

---

## Why Storj?

[Storj](https://storj.io) is a decentralized cloud storage platform that provides:

- **S3-compatible** — drop-in replacement for Amazon S3
- **End-to-end encryption** — data is encrypted client-side before upload
- **Distributed** — files are split, encrypted, and stored across a global network of nodes
- **No egress fees** — predictable pricing with no surprise bandwidth charges
- **99.95% availability** — built-in redundancy across thousands of nodes
- **Open source** — fully open-source storage infrastructure

## Requirements

- **Node.js 18+**
- A [Storj account](https://storj.io) with an API key or Access Grant (free tier available — 25 GB storage, 25 GB bandwidth/month)

## Contributing

Issues and pull requests are welcome! See the [GitHub repository](https://github.com/shivamkumar99/storj-uplink-mcp).

## License

[MIT](https://opensource.org/licenses/MIT) © Shivam Kumar
