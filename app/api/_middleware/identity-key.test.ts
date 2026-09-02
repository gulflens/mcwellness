import { describe, expect, it } from 'vitest';
import { LOCAL_PLACEHOLDER_IDENTITY_KEY, identityKeysFromEnv } from './identity-key';

describe('identityKeysFromEnv', () => {
  it('accepts the local placeholder only in development, or when the environment is unset', () => {
    const base = { IDENTITY_KEY: LOCAL_PLACEHOLDER_IDENTITY_KEY };
    expect(identityKeysFromEnv({ ...base, APP_ENV: 'development' }).hashKey).toHaveLength(32);
    expect(identityKeysFromEnv({ ...base }).sealKey).toHaveLength(32);
    expect(() => identityKeysFromEnv({ ...base, APP_ENV: 'staging' })).toThrow('local placeholder');
    expect(() => identityKeysFromEnv({ ...base, APP_ENV: 'production' })).toThrow(
      'local placeholder',
    );
  });

  it('refuses a missing or malformed key', () => {
    expect(() => identityKeysFromEnv({})).toThrow('not set');
    expect(() => identityKeysFromEnv({ IDENTITY_KEY: 'short' })).toThrow('64 hexadecimal');
  });
});
