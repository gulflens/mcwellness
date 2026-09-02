import { randomBytes } from 'node:crypto';
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
  // Explicit, never assumed: a deployment that forgets APP_ENV is not a laptop.
  if (env.APP_ENV !== 'development' && value.toLowerCase() === LOCAL_PLACEHOLDER_IDENTITY_KEY) {
    throw new Error(
      'IDENTITY_KEY is the local placeholder. Set APP_ENV=development locally, or generate a key for this environment.',
    );
  }
  return deriveIdentityKeys(Buffer.from(value, 'hex'));
}

/** A fresh random nonce for one seal. Never derive a nonce from the row: it must not repeat. */
export function freshNonce(): Buffer {
  return randomBytes(12);
}
