import { describe, it, expect, afterEach, vi } from 'vitest';
import { ENV, readStorjEnv, hasPassphraseCredentials } from '../../src/core/env.js';

afterEach(() => vi.unstubAllEnvs());

describe('env', () => {
  it('names every variable the server reads, in one place', () => {
    expect(ENV).toEqual({
      ACCESS_GRANT: 'STORJ_ACCESS_GRANT',
      SATELLITE: 'STORJ_SATELLITE',
      API_KEY: 'STORJ_API_KEY',
      PASSPHRASE: 'STORJ_PASSPHRASE',
    });
  });

  it('reads live values and treats empty strings as unset', () => {
    for (const name of Object.values(ENV)) vi.stubEnv(name, '');
    expect(readStorjEnv()).toEqual({ accessGrant: undefined, satellite: undefined, apiKey: undefined, passphrase: undefined });

    vi.stubEnv(ENV.ACCESS_GRANT, 'grant');
    vi.stubEnv(ENV.SATELLITE, 'sat');
    expect(readStorjEnv()).toEqual({ accessGrant: 'grant', satellite: 'sat', apiKey: undefined, passphrase: undefined });
  });

  it('hasPassphraseCredentials requires all three variables', () => {
    expect(hasPassphraseCredentials({ satellite: 's', apiKey: 'k', passphrase: 'p' })).toBe(true);
    expect(hasPassphraseCredentials({ satellite: 's', apiKey: 'k' })).toBe(false);
    expect(hasPassphraseCredentials({ accessGrant: 'g' })).toBe(false);
    expect(hasPassphraseCredentials({})).toBe(false);
  });
});
