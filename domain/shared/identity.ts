import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  timingSafeEqual,
} from 'node:crypto';

/**
 * The Emirates ID is the one identifier the practice may hold, and only on an
 * adult who consents for a minor or who is refunded. It is never stored in
 * plain text: a keyed fingerprint (HMAC-SHA256) allows lookup, and the value
 * itself is sealed (AES-256-GCM). Everything here is a pure function of its
 * arguments: the keys and the nonce come from the caller, so this file reads
 * neither the environment nor a random source.
 */

export const EMIRATES_ID_DIGITS = 15;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

export type IdentityKeys = { hashKey: Buffer; sealKey: Buffer };

/** Digits only, fifteen of them, starting 784: the canonical form that is hashed and sealed. */
export function normaliseEmiratesId(input: string): string {
  const digits = input.replace(/[^0-9]/g, '');
  if (digits.length !== EMIRATES_ID_DIGITS || !digits.startsWith('784')) {
    throw new Error('An Emirates ID is fifteen digits starting 784.');
  }
  return digits;
}

/** 784-1900-1234567-1: the display form. Never stored. */
export function formatEmiratesId(input: string): string {
  const d = normaliseEmiratesId(input);
  return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7, 14)}-${d.slice(14)}`;
}

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

/** nonce || tag || ciphertext. A nonce must never repeat under one key; the caller supplies it. */
export function sealEmiratesId(id: string, keys: IdentityKeys, nonce: Buffer): Buffer {
  if (nonce.length !== NONCE_BYTES) {
    throw new Error('The nonce is 12 bytes.');
  }
  const cipher = createCipheriv('aes-256-gcm', keys.sealKey, nonce);
  const ciphertext = Buffer.concat([
    cipher.update(normaliseEmiratesId(id), 'utf8'),
    cipher.final(),
  ]);
  return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]);
}

/** The digits back, or a throw when the key is wrong or a byte was altered. */
export function openEmiratesId(sealed: Buffer, keys: IdentityKeys): string {
  if (sealed.length <= NONCE_BYTES + TAG_BYTES) {
    throw new Error('Not a sealed Emirates ID.');
  }
  const nonce = sealed.subarray(0, NONCE_BYTES);
  const tag = sealed.subarray(NONCE_BYTES, NONCE_BYTES + TAG_BYTES);
  const ciphertext = sealed.subarray(NONCE_BYTES + TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', keys.sealKey, nonce);
  decipher.setAuthTag(tag);
  const digits = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  return normaliseEmiratesId(digits);
}

/** Constant-time comparison of two fingerprints. */
export function sameFingerprint(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}
