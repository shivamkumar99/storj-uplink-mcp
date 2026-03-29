import path from 'node:path';
import os from 'node:os';
import { StorjError } from 'storj-uplink-nodejs';

// ---------------------------------------------------------------------------
// MCP tool response type
// ---------------------------------------------------------------------------

export interface McpTextResponse {
  [key: string]: unknown;
  content: Array<{ type: 'text'; text: string }>;
}

// ---------------------------------------------------------------------------
// Build a successful text response
// ---------------------------------------------------------------------------

export function ok(data: unknown): McpTextResponse {
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  return { content: [{ type: 'text', text }] };
}

// ---------------------------------------------------------------------------
// Secrets redaction — strip access grants, API keys, and long base58 tokens
// from error messages before they reach the LLM.
// ---------------------------------------------------------------------------

/** Matches base58/base64 tokens >= 100 chars (typical Storj access grants) */
const ACCESS_GRANT_RE = /[1-9A-HJ-NP-Za-km-z]{100,}/g;

/** Matches common secret env var patterns leaked in errors */
const SECRET_PATTERN_RE = /(?:api[_-]?key|passphrase|secret|token|password|access[_-]?grant)\s*[:=]\s*\S+/gi;

function redactSecrets(text: string): string {
  return text
    .replace(ACCESS_GRANT_RE, '[REDACTED]')
    .replace(SECRET_PATTERN_RE, (match) => {
      const sep = match.indexOf('=') !== -1 ? '=' : ':';
      const key = match.slice(0, match.indexOf(sep) + 1);
      return `${key} [REDACTED]`;
    });
}

// ---------------------------------------------------------------------------
// Output sanitization — neutralize prompt-injection patterns in file content
// returned to the LLM.  (OWASP MCP: treat tool outputs as untrusted)
// ---------------------------------------------------------------------------

/** Tags commonly used in prompt injection attempts */
const INJECTION_TAG_RE = /<\/?\s*(IMPORTANT|system|admin|instruction|user|assistant|tool_result|function_call|human|claude)[^>]*>/gi;

export function sanitizeOutput(text: string): string {
  return text.replace(INJECTION_TAG_RE, (tag) => `[tag:${tag}]`);
}

// ---------------------------------------------------------------------------
// Format any error into a readable string and return as MCP response.
// Never throws — Claude sees the error message instead of a crash.
// Secrets are redacted before returning.
// ---------------------------------------------------------------------------

export function errorResponse(err: unknown): McpTextResponse {
  let message: string;

  if (err instanceof StorjError) {
    message = `${err.constructor.name}: ${err.message}`;
    if (err.details) message += `\nDetails: ${err.details}`;
  } else if (err instanceof Error) {
    message = `Error: ${err.message}`;
  } else {
    message = `Error: ${String(err)}`;
  }

  return { content: [{ type: 'text', text: redactSecrets(message) }] };
}

// ---------------------------------------------------------------------------
// Wrap a tool handler so any thrown error is caught and returned as text.
// Use this in every tool function instead of a manual try/catch block.
// ---------------------------------------------------------------------------

export function safeCall(
  fn: () => Promise<McpTextResponse>,
): Promise<McpTextResponse> {
  return fn().catch((err: unknown) => errorResponse(err));
}

// ---------------------------------------------------------------------------
// Operation timeout — wrap a promise with a time limit.
// Returns a timeout error response instead of hanging forever.
// ---------------------------------------------------------------------------

/** Default timeout for metadata operations (30 seconds) */
export const TIMEOUT_METADATA_MS = 30_000;

/** Default timeout for transfer operations (5 minutes) */
export const TIMEOUT_TRANSFER_MS = 5 * 60_000;

export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Operation timed out after ${ms / 1000}s: ${label}`)),
      ms,
    );
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err: unknown) => { clearTimeout(timer); reject(err); },
    );
  });
}

// ---------------------------------------------------------------------------
// File path validation — prevent path traversal attacks (CWE-22).
// The LLM can be tricked into requesting paths like ../../.ssh/id_rsa.
// ---------------------------------------------------------------------------

/** Directories that should never be read from or written to */
const SENSITIVE_DIRS = [
  '.ssh', '.gnupg', '.aws', '.azure', '.config', '.kube',
  '.docker', '.npm', '.git',
];

/** Sensitive filenames (dotfiles with secrets) */
const SENSITIVE_FILES = [
  '.env', '.env.local', '.env.production', '.netrc', '.npmrc',
  '.bash_history', '.zsh_history',
];

export function validateFilePath(filePath: string): void {
  const resolved = path.resolve(filePath);
  const home = os.homedir();

  // Reject paths with .. traversal (even after resolution, check original)
  if (filePath.includes('..')) {
    throw new Error(`Path rejected: contains ".." traversal — "${filePath}"`);
  }

  // Reject sensitive directories
  const parts = resolved.split(path.sep);
  for (const dir of SENSITIVE_DIRS) {
    if (parts.includes(dir)) {
      throw new Error(`Path rejected: accesses sensitive directory "${dir}" — "${filePath}"`);
    }
  }

  // Reject sensitive filenames
  const basename = path.basename(resolved);
  if (SENSITIVE_FILES.includes(basename)) {
    throw new Error(`Path rejected: sensitive file "${basename}" — "${filePath}"`);
  }

  // Reject system directories
  const systemDirs = process.platform === 'win32'
    ? ['C:\\Windows', 'C:\\Program Files']
    : ['/etc', '/var', '/usr', '/sys', '/proc', '/boot', '/dev'];

  for (const sysDir of systemDirs) {
    if (resolved.startsWith(sysDir + path.sep) || resolved === sysDir) {
      throw new Error(`Path rejected: system directory "${sysDir}" — "${filePath}"`);
    }
  }

  // Reject paths inside home sensitive dirs (e.g. ~/.ssh/id_rsa)
  if (home) {
    for (const dir of SENSITIVE_DIRS) {
      const sensitiveBase = path.join(home, dir);
      if (resolved.startsWith(sensitiveBase + path.sep) || resolved === sensitiveBase) {
        throw new Error(`Path rejected: sensitive home directory "~/${dir}" — "${filePath}"`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Format bytes to a human-readable string
// ---------------------------------------------------------------------------

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// ---------------------------------------------------------------------------
// Format a Unix timestamp (seconds) to ISO string, or 'none'
// ---------------------------------------------------------------------------

export function formatTimestamp(ts: number | null): string {
  if (!ts) return 'none';
  return new Date(ts * 1000).toISOString();
}
