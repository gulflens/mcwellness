import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  timingSafeEqual,
} from 'node:crypto';
import { normaliseEmiratesId } from './emirates-id';

/**
 * The Emirates ID is the one identifier the practice may hold, and only on an
 * adult who consents for a minor or who is refunded. It is never stored in
 * plain text: a keyed fingerprint (HMAC-SHA256) allows lookup, and the value
 * itself is sealed (AES-256-GCM). Everything here is a pure function of its
 * arguments: the keys and the nonce come from the caller, so this file reads
 * neither the environment nor a random source.
 *
 * Server-only: it opens with `node:crypto` at module scope, so it is never
 * imported through the `domain/shared` barrel and never by any file a
 * browser bundle can reach — import it by its own path, always
 * 'domain/shared/identity' (tests/lint/no-node-imports-in-browser-bundle.test.ts
 * proves this for every stream barrel, not only the shared one). The pure
 * parsing and formatting this file's callers also need — normalisation and
 * display — lives in the browser-safe `./emirates-id` instead, which this
 * file imports back for its own use.
 */

const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

export type IdentityKeys = { hashKey: Buffer; sealKey: Buffer };

/** Two independent keys from one 32-byte master, so hashing and sealing never share one. */
export function deriveIdentityKeys(master: Buffer): IdentityKeys {
  if (master.length !== KEY_BYTES) {
    throw new Error('The identity master key is 32 bytes.');
  }
  const derive = (label: string): Buffer =>
    Buffer.from(hkdfSync('sha256', master, Buffer.alloc(0), label, KEY_BYTES));
  return {
    hashKey: derive('mcwellness/emirates-id-hash'),
    sealKey: derive('mcwellness/emirates-id-seal'),
  };
}

/** The lookup fingerprint: 32 bytes, the same for the same id and key, useless without the key. */
export function emiratesIdHash(id: string, keys: IdentityKeys): Buffer {
  return createHmac('sha256', keys.hashKey).update(normaliseEmiratesId(id)).digest();
}

/**
 * nonce || tag || ciphertext. A nonce must never repeat under one key; the caller
 * supplies it, fresh and random for every write. `boundTo` (the contact id) is
 * authenticated with the seal, so a sealed value moved onto another row will not open.
 */
export function sealEmiratesId(
  id: string,
  keys: IdentityKeys,
  nonce: Buffer,
  boundTo?: string,
): Buffer {
  if (nonce.length !== NONCE_BYTES) {
    throw new Error('The nonce is 12 bytes.');
  }
  const cipher = createCipheriv('aes-256-gcm', keys.sealKey, nonce);
  if (boundTo !== undefined) {
    cipher.setAAD(Buffer.from(boundTo, 'utf8'));
  }
  const ciphertext = Buffer.concat([
    cipher.update(normaliseEmiratesId(id), 'utf8'),
    cipher.final(),
  ]);
  return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]);
}

/** The digits back, or a throw when the key is wrong or a byte was altered. */
export function openEmiratesId(sealed: Buffer, keys: IdentityKeys, boundTo?: string): string {
  if (sealed.length <= NONCE_BYTES + TAG_BYTES) {
    throw new Error('Not a sealed Emirates ID.');
  }
  const nonce = sealed.subarray(0, NONCE_BYTES);
  const tag = sealed.subarray(NONCE_BYTES, NONCE_BYTES + TAG_BYTES);
  const ciphertext = sealed.subarray(NONCE_BYTES + TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', keys.sealKey, nonce);
  if (boundTo !== undefined) {
    decipher.setAAD(Buffer.from(boundTo, 'utf8'));
  }
  decipher.setAuthTag(tag);
  const digits = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  return normaliseEmiratesId(digits);
}

/** Constant-time comparison of two fingerprints. */
export function sameFingerprint(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}
