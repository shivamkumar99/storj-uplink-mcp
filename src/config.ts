import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AuthType = 'access_grant' | 'passphrase';

export interface StorjMcpConfig {
  authType: AuthType;
  // access_grant mode
  accessGrant?: string;
  // passphrase mode
  satellite?: string;
  apiKey?: string;
  passphrase?: string;
}

interface EncryptedFile {
  authType: AuthType;
  iv: string;
  authTag: string;
  ciphertext: string;
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const CONFIG_DIR = path.join(os.homedir(), '.storj-mcp');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

export function configPath(): string {
  return CONFIG_PATH;
}

export function configExists(): boolean {
  return fs.existsSync(CONFIG_PATH);
}

// ---------------------------------------------------------------------------
// Encryption key — derived from machine identity, zero extra deps
//
// Key = PBKDF2(hostname + ":" + username, STATIC_SALT, 100000, 32, sha256)
// Ties the config to this machine+user. Attacker who only has the file
// cannot decrypt without also knowing hostname and username.
// ---------------------------------------------------------------------------

const STATIC_SALT = 'storj-uplink-mcp-v1-salt-2024';

function deriveKey(): Buffer {
  const material = `${os.hostname()}:${os.userInfo().username}`;
  return crypto.pbkdf2Sync(material, STATIC_SALT, 100_000, 32, 'sha256');
}

// ---------------------------------------------------------------------------
// Encrypt / Decrypt
// ---------------------------------------------------------------------------

function encrypt(plaintext: string): { iv: string; authTag: string; ciphertext: string } {
  const key = deriveKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
    ciphertext: encrypted.toString('hex'),
  };
}

function decrypt(iv: string, authTag: string, ciphertext: string): string {
  const key = deriveKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(authTag, 'hex'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'hex')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function saveConfig(config: StorjMcpConfig): void {
  // Encrypt the sensitive fields as one JSON blob
  const sensitive: Partial<StorjMcpConfig> = { ...config };
  delete (sensitive as { authType?: AuthType }).authType;

  const { iv, authTag, ciphertext } = encrypt(JSON.stringify(sensitive));

  const file: EncryptedFile = {
    authType: config.authType,
    iv,
    authTag,
    ciphertext,
  };

  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(file, null, 2), { encoding: 'utf8' });
  fs.chmodSync(CONFIG_PATH, 0o600);
}

export function loadConfig(): StorjMcpConfig | null {
  if (!configExists()) return null;

  let file: EncryptedFile;
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    file = JSON.parse(raw) as EncryptedFile;
  } catch {
    return null;
  }

  try {
    const sensitiveJson = decrypt(file.iv, file.authTag, file.ciphertext);
    const sensitive = JSON.parse(sensitiveJson) as Partial<StorjMcpConfig>;
    return { authType: file.authType, ...sensitive };
  } catch {
    // Decryption failed — likely different machine/user or corrupted file
    return null;
  }
}

export function deleteConfig(): void {
  if (configExists()) {
    fs.rmSync(CONFIG_PATH);
  }
}
