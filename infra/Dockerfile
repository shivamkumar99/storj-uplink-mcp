# syntax=docker/dockerfile:1.7
# ---------------------------------------------------------------------------
# storj-uplink-mcp — hardened container image
#
# The MCP server speaks JSON-RPC over stdio, so the container is started BY
# the AI client (docker run -i …), not as a long-running daemon.  See
# infra/README.md for the client configuration.
#
# Security properties of this image:
#   • Multi-stage: compilers, npm, curl and dev dependencies never reach the
#     final image.  The runtime is Google's distroless Node.js image — no
#     shell, no package manager, no setuid binaries.
#   • Runs as the unprivileged `nonroot` user (uid 65532).
#   • Base images are pinned by digest, not by mutable tag.
#   • Only dist/, production node_modules and package.json are copied in.
#   • No credentials are baked in.  Pass STORJ_* variables at run time.
#   • Designed to run with --read-only, --cap-drop ALL and
#     --security-opt no-new-privileges (see README / compose file).
#
# Platform: the storj-uplink-nodejs native addon ships a prebuilt binary for
# linux-x64 only, so build with --platform linux/amd64 (emulated on Apple
# Silicon).  On linux-arm64 the addon would have to be compiled from source.
# ---------------------------------------------------------------------------

# ---- Stage 1: build --------------------------------------------------------
FROM --platform=linux/amd64 node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 AS build

# The native dependency's install step downloads the prebuilt addon with curl
# via `make install`.  UPLINK_INSTALL=prebuilt forbids a silent fallback to a
# from-source compile (which would need a toolchain we deliberately omit).
ENV UPLINK_INSTALL=prebuilt \
    UPLINK_LOG_LEVEL=error \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false

# Build-stage tools, version-pinned (hadolint DL3008). These are the bookworm
# versions current for the digest-pinned base image; when Debian publishes a
# point release the old versions leave the archive and this step fails with
# "Version '…' was not found" — refresh the three pins then (see infra/README.md).
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      make=4.3-4.1 \
      curl=7.88.1-10+deb12u15 \
      ca-certificates=20230311+deb12u1 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencies first so this layer is cached until the lockfile changes.
# scripts/ holds this package's own postinstall hook, which npm ci runs.
COPY package.json package-lock.json ./
COPY scripts ./scripts
RUN --mount=type=cache,target=/root/.npm npm ci

# Source, then compile TypeScript and bundle the MCP Apps views.
COPY tsconfig.json ./
COPY src ./src
COPY ui ./ui
RUN npm run build \
 && npm prune --omit=dev \
 && rm -rf src ui scripts tsconfig.json

# ---- Stage 2: runtime ------------------------------------------------------
FROM --platform=linux/amd64 gcr.io/distroless/nodejs22-debian12:nonroot@sha256:13593b7570658e8477de39e2f4a1dd25db2f836d68a0ba771251572d23bb4f8e

ENV NODE_ENV=production \
    UPLINK_LOG_LEVEL=error \
    HOME=/home/nonroot

WORKDIR /app
COPY --from=build --chown=nonroot:nonroot /app/package.json ./package.json
COPY --from=build --chown=nonroot:nonroot /app/node_modules ./node_modules
COPY --from=build --chown=nonroot:nonroot /app/dist ./dist

USER nonroot:nonroot

# Distroless sets ENTRYPOINT to the node binary; only the script goes here.
CMD ["dist/index.js"]

LABEL org.opencontainers.image.title="storj-uplink-mcp" \
      org.opencontainers.image.description="MCP server for Storj decentralized storage (stdio transport)" \
      org.opencontainers.image.source="https://github.com/shivamkumar99/storj-uplink-mcp" \
      org.opencontainers.image.licenses="MIT"
