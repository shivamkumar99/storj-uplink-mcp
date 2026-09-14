# Running storj-uplink-mcp in Docker

The server uses the MCP **stdio** transport: the AI client starts the process
and talks JSON-RPC over stdin/stdout. In Docker that means the client runs
`docker run -i …` for each session; there is no daemon and no open port.

## Build

The native `storj-uplink-nodejs` addon ships a prebuilt binary for linux-x64
only, so the image is built for `linux/amd64` (emulated on Apple Silicon,
which is slower but works):

```bash
npm run docker:build
```

That is equivalent to:

```bash
docker build --platform linux/amd64 -f infra/Dockerfile -t storj-uplink-mcp:local .
```

## Credentials

Copy `infra/.env.example` to `infra/.env`, fill in either `STORJ_ACCESS_GRANT`
or the satellite/API key/passphrase trio, and restrict the file:

```bash
chmod 600 infra/.env
```

`infra/.env` is git-ignored. Nothing is baked into the image.

## Run from an MCP client

Claude Desktop (`claude_desktop_config.json`), Cursor and Windsurf all take a
command plus arguments:

```json
{
  "mcpServers": {
    "storj": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "--platform", "linux/amd64",
        "--read-only",
        "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=64m",
        "--cap-drop", "ALL",
        "--security-opt", "no-new-privileges",
        "--pids-limit", "128",
        "--memory", "512m",
        "--env-file", "/absolute/path/to/storj-uplink-mcp/infra/.env",
        "storj-uplink-mcp:local"
      ]
    }
  }
}
```

Or, with the same hardening captured in the compose file:

```json
{
  "mcpServers": {
    "storj": {
      "command": "docker",
      "args": ["compose", "-f", "/absolute/path/to/storj-uplink-mcp/infra/docker-compose.yml",
               "run", "--rm", "storj-mcp"]
    }
  }
}
```

Tools that read or write **local** files (`upload_file`, `upload_directory`,
`download_file`, `download_prefix`) see the container's filesystem, which is
read-only apart from `/tmp`. Mount a host folder if you need them, e.g.
`-v "$HOME/storj-exchange:/data"`, and refer to `/data/...` in prompts.

## Security properties

| Control | Where |
|---|---|
| Both stages are [Docker Hardened Images](https://docs.docker.com/dhi/) (`dhi.io/node`): SBOM and VEX attested, near-zero known CVEs, patched by Docker | `Dockerfile` |
| Multi-stage build; no compiler, npm, curl or dev dependencies in the final image | `Dockerfile` |
| Hardened runtime: no shell, no package manager, non-root by default | `Dockerfile` |
| Unprivileged user `node` (uid 1000) | `Dockerfile`, compose `user` |
| Base images pinned by digest | `Dockerfile` |
| Read-only root filesystem, `noexec` tmpfs for `/tmp` | run flags / compose |
| All Linux capabilities dropped, `no-new-privileges` | run flags / compose |
| Process, memory and file-descriptor limits | run flags / compose |
| No published ports; outbound only (Storj satellites and storage nodes) | compose |
| Credentials only via environment at run time; never in the image or logs | `.env`, server redacts secrets |

Things the container does **not** protect against: a leaked `infra/.env`
(rotate the access grant if that happens), and `docker inspect` on a running
container, which shows environment variables to anyone with Docker socket
access. Docker socket access is root-equivalent; keep it to yourself.

## Verify

Send an MCP handshake by hand and check the tool list comes back:

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
| docker run -i --rm --platform linux/amd64 --read-only --cap-drop ALL \
    --security-opt no-new-privileges storj-uplink-mcp:local
```

Scan the image before shipping it:

```bash
docker scout cves storj-uplink-mcp:local
```

## Updating the pinned apt packages

The build stage pins `make`, `curl` and `ca-certificates` to exact Debian
versions. After a Debian point release the build fails with
`Version '…' was not found`; look up the current versions and update the
three pins in `infra/Dockerfile`:

```bash
# Docker Hardened Images serve their own "+dhiN" package builds; pin those versions.
docker run --rm --platform linux/amd64 --entrypoint sh dhi.io/node:22-debian13-dev -c \
  'apt-get update -qq >/dev/null; apt-cache policy make curl ca-certificates | grep -E "^[a-z]|Candidate"'
```

## Updating the base images

The `FROM` lines pin a digest. To move to a newer patch release:

```bash
docker buildx imagetools inspect dhi.io/node:22-debian13-dev | awk '/^Digest:/{print $2}'
docker buildx imagetools inspect dhi.io/node:22-debian13 | awk '/^Digest:/{print $2}'
```

Paste the new digests into `infra/Dockerfile` and rebuild.
