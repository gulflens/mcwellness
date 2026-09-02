import { describe, expect, it } from 'vitest';
import {
  deriveIdentityKeys,
  emiratesIdHash,
  openEmiratesId,
  sameFingerprint,
  sealEmiratesId,
} from './identity';

// Synthetic throughout: the 784-1900 range is reserved for fakes, and the keys are
// test constants that unlock nothing. normaliseEmiratesId and formatEmiratesId are
// pure and browser-safe, so their own tests live with them in emirates-id.test.ts;
// this file covers only the crypto identity.ts keeps.
const ID = '784-1900-0000001-7';
const KEYS = deriveIdentityKeys(Buffer.alloc(32, 1));
const OTHER_KEYS = deriveIdentityKeys(Buffer.alloc(32, 2));
const NONCE = Buffer.alloc(12, 9);

describe('deriveIdentityKeys', () => {
  it('gives two different 32-byte keys from one master and refuses any other size', () => {
    expect(KEYS.hashKey).toHaveLength(32);
    expect(KEYS.sealKey).toHaveLength(32);
    expect(KEYS.hashKey.equals(KEYS.sealKey)).toBe(false);
    expect(() => deriveIdentityKeys(Buffer.alloc(16))).toThrow('32 bytes');
  });
});

describe('emiratesIdHash', () => {
  it('is 32 bytes and the same whichever way the id is written', () => {
    const a = emiratesIdHash(ID, KEYS);
    expect(a).toHaveLength(32);
    expect(sameFingerprint(a, emiratesIdHash('784190000000017', KEYS))).toBe(true);
  });

  it('changes with the key and with the id', () => {
    expect(sameFingerprint(emiratesIdHash(ID, KEYS), emiratesIdHash(ID, OTHER_KEYS))).toBe(false);
    expect(
      sameFingerprint(emiratesIdHash(ID, KEYS), emiratesIdHash('784-1900-0000002-5', KEYS)),
    ).toBe(false);
  });
});

describe('sealEmiratesId and openEmiratesId', () => {
  it('round-trips with the same key and is deterministic for the same nonce', () => {
    const sealed = sealEmiratesId(ID, KEYS, NONCE);
    expect(openEmiratesId(sealed, KEYS)).toBe('784190000000017');
    expect(sealed.equals(sealEmiratesId(ID, KEYS, NONCE))).toBe(true);
    expect(sealed.subarray(0, 12).equals(NONCE)).toBe(true);
  });

  it('opens only on the row it was bound to', () => {
    const sealed = sealEmiratesId(ID, KEYS, NONCE, 'contact-1');
    expect(openEmiratesId(sealed, KEYS, 'contact-1')).toBe('784190000000017');
    expect(() => openEmiratesId(sealed, KEYS, 'contact-2')).toThrow();
    expect(() => openEmiratesId(sealed, KEYS)).toThrow();
  });

  it('refuses the wrong key, an altered byte, and a nonce of the wrong size', () => {
    const sealed = sealEmiratesId(ID, KEYS, NONCE);
    expect(() => openEmiratesId(sealed, OTHER_KEYS)).toThrow();
    const tampered = Buffer.from(sealed);
    tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 0xff;
    expect(() => openEmiratesId(tampered, KEYS)).toThrow();
    expect(() => sealEmiratesId(ID, KEYS, Buffer.alloc(8))).toThrow('12 bytes');
    expect(() => openEmiratesId(Buffer.alloc(20), KEYS)).toThrow('Not a sealed');
  });
});
