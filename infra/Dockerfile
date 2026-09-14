# syntax=docker/dockerfile:1.7
# ---------------------------------------------------------------------------
# storj-uplink-mcp — hardened container image
#
# The MCP server speaks JSON-RPC over stdio, so the container is started BY
# the AI client (docker run -i …), not as a long-running daemon.  See
# infra/README.md for the client configuration.
#
# Security properties of this image:
#   • Both stages use Docker Hardened Images (dhi.io/node): the `-dev` variant
#     to build (shell + apt, root), the runtime variant to run — no shell, no
#     package manager, non-root by default, SBOM/VEX-attested, patched by Docker.
#   • Multi-stage: compilers, npm, curl and dev dependencies never reach the
#     final image.
#   • Runs as the unprivileged `node` user (uid 1000), the image default.
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
FROM --platform=linux/amd64 dhi.io/node:22-debian13-dev@sha256:cb4828216aa2d1d964e657bce189277fb927f3049fbf35592a7105034847cec2 AS build

# The native dependency's install step downloads the prebuilt addon with curl
# via `make install`.  UPLINK_INSTALL=prebuilt forbids a silent fallback to a
# from-source compile (which would need a toolchain we deliberately omit).
ENV UPLINK_INSTALL=prebuilt \
    UPLINK_LOG_LEVEL=error \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false

# Build-stage tools, version-pinned (hadolint DL3008): make + curl run the
# library's prebuilt download, gzip lets tar extract it. Docker Hardened Images
# rebuild Debian 13 packages with a "+dhiN" suffix and serve only those, so the
# pins must be the DHI versions (see infra/README.md for how to refresh them).
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      make=4.4.1-2+dhi1 \
      curl=8.14.1-2+deb13u5+dhi0 \
      ca-certificates=20250419+dhi2 \
      gzip=1.13-1+dhi1 \
 && rm -rf /var/lib/apt/lists/*

# The hardened dev image ships no which(1) and its apt repo has no package for
# it; storj-uplink-nodejs's Makefile probes tools with `which`, so provide a
# POSIX shim (build stage only — it never reaches the runtime image).
RUN mkdir -p /usr/local/bin \
 && printf '#!/bin/sh\nfor c in "$@"; do command -v "$c" || exit 1; done\n' > /usr/local/bin/which \
 && chmod +x /usr/local/bin/which

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
FROM --platform=linux/amd64 dhi.io/node:22-debian13@sha256:fb00a158fa6047167885c65db6b9802cf1f234794e81bb393d683fadaa683500

ENV NODE_ENV=production \
    UPLINK_LOG_LEVEL=error \
    HOME=/home/node

WORKDIR /app
COPY --from=build --chown=1000:1000 /app/package.json ./package.json
COPY --from=build --chown=1000:1000 /app/node_modules ./node_modules
COPY --from=build --chown=1000:1000 /app/dist ./dist

USER 1000:1000

# The hardened runtime image has no ENTRYPOINT; `node` is on PATH.
CMD ["node", "dist/index.js"]

LABEL org.opencontainers.image.title="storj-uplink-mcp" \
      org.opencontainers.image.description="MCP server for Storj decentralized storage (stdio transport)" \
      org.opencontainers.image.source="https://github.com/shivamkumar99/storj-uplink-mcp" \
      org.opencontainers.image.licenses="MIT"
