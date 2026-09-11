import { describe, it, expect } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { validateFilePath, resolveWithinDir } from '../../src/lib/paths.js';

describe('validateFilePath', () => {
  it('allows an ordinary path', () => {
    expect(() => validateFilePath(path.resolve('ok.txt'))).not.toThrow();
  });
  it.each([
    ['a/../b', '".." traversal'],
    [path.join(os.homedir(), 'x', '.ssh', 'id_rsa'), 'sensitive directory ".ssh"'],
    [path.join(os.homedir(), '.ssh'), 'sensitive directory ".ssh"'],
    [path.join(os.homedir(), 'proj', '.env'), 'sensitive file ".env"'],
    ['/etc/passwd', 'system directory "/etc"'],
    ['/etc', 'system directory "/etc"'],
  ])('rejects %s', (p, why) => {
    expect(() => validateFilePath(p)).toThrow(why);
  });
});

describe('resolveWithinDir', () => {
  it('keeps paths inside the base and rejects escapes (Zip Slip)', () => {
    expect(resolveWithinDir('/base', 'a/b')).toBe(path.resolve('/base/a/b'));
    expect(resolveWithinDir('/base', '')).toBe(path.resolve('/base'));
    expect(() => resolveWithinDir('/base', '../x')).toThrow('escapes destination directory');
    expect(() => resolveWithinDir('/base', '/etc/passwd')).toThrow('escapes destination directory');
  });
});
