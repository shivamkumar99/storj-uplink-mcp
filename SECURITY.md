# Security Policy

## Reporting a vulnerability

Report security issues privately through GitHub:
[Report a vulnerability](https://github.com/shivamkumar99/storj-uplink-mcp/security/advisories/new).
Please do not open a public issue for anything exploitable.

Include what you can: affected version, how to reproduce, and what an attacker
gains. You will get an acknowledgement within a few days, and an update as the
fix progresses.

## Supported versions

The latest published release receives fixes. Earlier versions do not.

## What this server touches

The server runs on the machine of whoever configures it and talks to Storj over
the network. It holds a Storj access grant, which is a bearer credential: anyone
holding it has whatever permissions it encodes. Treat it as a secret.

- Credentials are read from the environment or from `~/.storj-mcp`, never from
  the repository, and never baked into the Docker image.
- Secrets are redacted from tool output and error messages.
- Tools that read or write local files resolve paths and refuse to escape the
  directory they were given.
- The Docker image runs as a non-root user with a read-only root filesystem and
  all Linux capabilities dropped.

## How the code is checked

Automated on every change, with findings in the repository's Security tab:

| Check | Where |
|---|---|
| Dependency audit (blocking), ESLint incl. `eslint-plugin-security` | `ci.yml` |
| CodeQL (`security-extended`), Semgrep, secret scanning (Gitleaks, TruffleHog) | `security.yml` |
| Dependency review on pull requests, licence allowlist, CycloneDX SBOM | `security.yml` |
| Trivy on the lockfile and on the Dockerfile and compose files | `security.yml` |
| Trivy on the built image, blocking on fixable HIGH/CRITICAL | `docker.yml` |
| OpenSSF Scorecard | `security.yml` |
| Signed build provenance for the release tarball | `release.yml` |
| Workflow linting (actionlint, zizmor), actions pinned to commit SHAs | `ci.yml` |

Release artifacts carry provenance you can verify yourself:

```bash
gh attestation verify storj-uplink-mcp-<version>.tgz --repo shivamkumar99/storj-uplink-mcp
```

Published images carry an SBOM and SLSA provenance:

```bash
docker buildx imagetools inspect shivam995364/storj-uplink-mcp:latest --format '{{ json .Provenance }}'
```
