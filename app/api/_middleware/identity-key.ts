import { deriveIdentityKeys, type IdentityKeys } from '../../../domain/shared/identity';

/** The value shipped in .env.example. Fine on a laptop, refused anywhere else. */
export const LOCAL_PLACEHOLDER_IDENTITY_KEY = '0123456789abcdef'.repeat(4);

/**
 * The master key behind the Emirates ID fingerprint and seal, from the
 * environment: 64 hexadecimal characters. Read once at startup; the derived
 * keys are what the seed and, later, the client routes use.
 */
export function identityKeysFromEnv(env: NodeJS.ProcessEnv): IdentityKeys {
  const value = env.IDENTITY_KEY;
  if (!value) {
    throw new Error('IDENTITY_KEY is not set. Copy .env.example to .env.');
  }
  if (!/^[0-9a-f]{64}$/i.test(value)) {
    throw new Error('IDENTITY_KEY is 64 hexadecimal characters (32 bytes).');
  }
  const appEnv = env.APP_ENV ?? 'development';
  if (appEnv !== 'development' && value.toLowerCase() === LOCAL_PLACEHOLDER_IDENTITY_KEY) {
    throw new Error('IDENTITY_KEY is the local placeholder. Generate a key for this environment.');
  }
  return deriveIdentityKeys(Buffer.from(value, 'hex'));
}
