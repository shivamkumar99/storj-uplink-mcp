// ---------------------------------------------------------------------------
// Environment variables — the single place this server reads process.env.
//
// Variable names are defined here exactly once, so renaming one is a single
// edit and no other module ever spells "STORJ_…" itself. Values are read at
// call time rather than module load, so the setup wizard's --status and the
// tests always see the live environment.
// ---------------------------------------------------------------------------

/** Names of every environment variable this server reads. */
export const ENV = {
  ACCESS_GRANT: 'STORJ_ACCESS_GRANT',
  SATELLITE: 'STORJ_SATELLITE',
  API_KEY: 'STORJ_API_KEY',
  PASSPHRASE: 'STORJ_PASSPHRASE',
  /** IANA zone for timestamps in tool output, e.g. "Asia/Kolkata". Unset = UTC. */
  TIMEZONE: 'STORJ_MCP_TIMEZONE',
} as const;

/** Credentials as currently present in the environment. */
export interface StorjEnv {
  accessGrant?: string;
  satellite?: string;
  apiKey?: string;
  passphrase?: string;
}

/** An empty string counts as unset, the same as an absent variable. */
function read(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value === '' ? undefined : value;
}

/** Read the Storj credential variables from the current environment. */
export function readStorjEnv(): StorjEnv {
  return {
    accessGrant: read(ENV.ACCESS_GRANT),
    satellite: read(ENV.SATELLITE),
    apiKey: read(ENV.API_KEY),
    passphrase: read(ENV.PASSPHRASE),
  };
}

/** The display time zone requested via the environment, if any. */
export function readDisplayTimeZone(): string | undefined {
  return read(ENV.TIMEZONE);
}

type PassphraseEnv = StorjEnv & Required<Pick<StorjEnv, 'satellite' | 'apiKey' | 'passphrase'>>;

/** True when all three passphrase-mode variables are set (narrows the type). */
export function hasPassphraseCredentials(env: StorjEnv): env is PassphraseEnv {
  return Boolean(env.satellite && env.apiKey && env.passphrase);
}
