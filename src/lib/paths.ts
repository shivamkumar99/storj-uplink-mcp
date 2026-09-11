import path from 'node:path';

// ---------------------------------------------------------------------------
// Local file-system path safety (CWE-22).
// ---------------------------------------------------------------------------

/** Directories that should never be read from or written to */
const SENSITIVE_DIRS = [
  '.ssh', '.gnupg', '.aws', '.azure', '.config', '.kube',
  '.docker', '.npm', '.git',
];

/** Sensitive filenames (dotfiles with secrets) */
const SENSITIVE_FILES = new Set([
  '.env', '.env.local', '.env.production', '.netrc', '.npmrc',
  '.bash_history', '.zsh_history',
]);

/**
 * Reject path traversal and sensitive locations.  The LLM can be tricked into
 * requesting paths like ../../.ssh/id_rsa; this is the single gate for every
 * local path a tool touches.
 */
export function validateFilePath(filePath: string): void {
  const resolved = path.resolve(filePath);

  // Reject paths with .. traversal (even after resolution, check original)
  if (filePath.includes('..')) {
    throw new Error(`Path rejected: contains ".." traversal — "${filePath}"`);
  }

  // Reject sensitive directories
  const parts = new Set(resolved.split(path.sep));
  for (const dir of SENSITIVE_DIRS) {
    if (parts.has(dir)) {
      throw new Error(`Path rejected: accesses sensitive directory "${dir}" — "${filePath}"`);
    }
  }

  // Reject sensitive filenames
  const basename = path.basename(resolved);
  if (SENSITIVE_FILES.has(basename)) {
    throw new Error(`Path rejected: sensitive file "${basename}" — "${filePath}"`);
  }

  // Reject system directories
  const systemDirs = process.platform === 'win32'
    ? [String.raw`C:\Windows`, String.raw`C:\Program Files`]
    : ['/etc', '/var', '/usr', '/sys', '/proc', '/boot', '/dev'];

  for (const sysDir of systemDirs) {
    if (resolved.startsWith(sysDir + path.sep) || resolved === sysDir) {
      throw new Error(`Path rejected: system directory "${sysDir}" — "${filePath}"`);
    }
  }
}

/**
 * Directory containment — prevent "Zip Slip" path escape.  When writing files
 * whose names come from an untrusted source (e.g. object keys from a shared
 * bucket), a key like "../../etc/passwd" or "/etc/passwd" must never resolve
 * outside the intended destination directory.
 * Returns the safe absolute path, or throws if it would escape `baseDir`.
 */
export function resolveWithinDir(baseDir: string, relativePath: string): string {
  const root = path.resolve(baseDir);
  const resolved = path.resolve(root, relativePath);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`Path rejected: "${relativePath}" escapes destination directory "${baseDir}"`);
  }
  return resolved;
}
