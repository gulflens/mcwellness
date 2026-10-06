import {
  createDecipheriv,
  createECDH,
  createHmac,
  createPublicKey,
  verify as verifySignature,
} from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  encryptPayload,
  fromBase64Url,
  generateVapidKeys,
  toBase64Url,
  vapidAuthorization,
  vapidKeysFromEnv,
} from './webpush';

/**
 * Sealing a message for a push service (RFC 8291) and signing the delivery
 * with the practice's own key (RFC 8292), with Node's own crypto and no
 * dependency (docs/CHANGE-REQUESTS/client-portal-07.md says why).
 *
 * The first test is the RFC's own worked example, byte for byte (RFC 8291,
 * Appendix A): the application server's and the user agent's key pairs, the
 * authentication value and the salt are the RFC's published values, which
 * open nothing anywhere, and the sealed body must be exactly the RFC's.
 */

const RFC = {
  plaintext: 'When I grow up, I want to be a watermelon',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  asPublic:
    'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  uaPublic:
    'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  uaAuthValue: 'BTBZMqHH6r4Tts7J_aSIgg',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  body:
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInm' +
    'YWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexS' +
    'gSxsj_Qulcy4a-fN',
} as const;

/** The receiving browser's half, written from the RFC, to open what the server sealed. */
function open(body: Buffer, uaPrivate: Buffer, uaPublic: Buffer, authValue: Buffer): string {
  const salt = body.subarray(0, 16);
  const idLength = body.readUInt8(20);
  const asPublic = body.subarray(21, 21 + idLength);
  const sealed = body.subarray(21 + idLength);
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(uaPrivate);
  const shared = ecdh.computeSecret(asPublic);
  const hmac = (key: Buffer, data: Buffer) => createHmac('sha256', key).update(data).digest();
  const prkKey = hmac(authValue, shared);
  const ikm = hmac(
    prkKey,
    Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic, Buffer.from([1])]),
  );
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12);
  const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(sealed.subarray(sealed.length - 16));
  const padded = Buffer.concat([
    decipher.update(sealed.subarray(0, sealed.length - 16)),
    decipher.final(),
  ]);
  const delimiter = padded.lastIndexOf(2);
  return padded.subarray(0, delimiter).toString('utf8');
}

describe('encryptPayload (RFC 8291)', () => {
  it('seals the RFC’s own example to exactly the RFC’s own bytes', () => {
    const body = encryptPayload(
      Buffer.from(RFC.plaintext),
      fromBase64Url(RFC.uaPublic),
      fromBase64Url(RFC.uaAuthValue),
      {
        salt: fromBase64Url(RFC.salt),
        serverKeys: {
          privateKey: fromBase64Url(RFC.asPrivate),
          publicKey: fromBase64Url(RFC.asPublic),
        },
      },
    );
    expect(toBase64Url(body)).toBe(RFC.body);
  });

  it('seals with a fresh key and salt each time, and the device opens it', () => {
    const device = createECDH('prime256v1');
    device.generateKeys();
    const authValue = Buffer.alloc(16, 7);
    const words = JSON.stringify({ title: 'خبر من المركز', body: 'Practice news.' });
    const first = encryptPayload(Buffer.from(words), device.getPublicKey(), authValue);
    const second = encryptPayload(Buffer.from(words), device.getPublicKey(), authValue);
    expect(first.equals(second)).toBe(false);
    expect(open(first, device.getPrivateKey(), device.getPublicKey(), authValue)).toBe(words);
    expect(first.includes(Buffer.from('Practice news.'))).toBe(false);
  });

  it('refuses a device key that is not a P-256 point, or an authentication value of the wrong size', () => {
    expect(() => encryptPayload(Buffer.from('x'), Buffer.alloc(65, 1), Buffer.alloc(16))).toThrow();
    const device = createECDH('prime256v1');
    device.generateKeys();
    expect(() => encryptPayload(Buffer.from('x'), device.getPublicKey(), Buffer.alloc(8))).toThrow(
      /16 bytes/,
    );
  });
});

describe('vapidAuthorization (RFC 8292)', () => {
  const keys = { ...generateVapidKeys(), subject: 'mailto:practice@example.com' };
  const now = new Date('2026-10-06T08:00:00Z');

  it('signs a token for the push service’s own origin, with the practice’s public key beside it', () => {
    const header = vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', keys, now);
    const match = /^vapid t=([^,]+), k=(.+)$/.exec(header);
    expect(match).not.toBeNull();
    const [token, key] = [match?.[1] ?? '', match?.[2] ?? ''];
    expect(key).toBe(keys.publicKey);
    const [head, claims, signature] = token.split('.');
    expect(JSON.parse(fromBase64Url(head ?? '').toString())).toEqual({ typ: 'JWT', alg: 'ES256' });
    expect(JSON.parse(fromBase64Url(claims ?? '').toString())).toEqual({
      aud: 'https://fcm.googleapis.com',
      exp: Math.floor(now.getTime() / 1000) + 12 * 60 * 60,
      sub: 'mailto:practice@example.com',
    });
    const point = fromBase64Url(keys.publicKey);
    const publicKey = createPublicKey({
      key: {
        kty: 'EC',
        crv: 'P-256',
        x: toBase64Url(point.subarray(1, 33)),
        y: toBase64Url(point.subarray(33, 65)),
      },
      format: 'jwk',
    });
    expect(
      verifySignature(
        'sha256',
        Buffer.from(`${head}.${claims}`),
        { key: publicKey, dsaEncoding: 'ieee-p1363' },
        fromBase64Url(signature ?? ''),
      ),
    ).toBe(true);
  });
});

describe('vapidKeysFromEnv', () => {
  const pair = generateVapidKeys();
  const env = {
    PUSH_VAPID_PUBLIC_KEY: pair.publicKey,
    PUSH_VAPID_PRIVATE_KEY: pair.privateKey,
    PUSH_VAPID_SUBJECT: 'mailto:practice@example.com',
  };

  it('reads the practice’s key pair and contact', () => {
    expect(vapidKeysFromEnv(env)).toEqual({
      publicKey: pair.publicKey,
      privateKey: pair.privateKey,
      subject: 'mailto:practice@example.com',
    });
  });

  it('switches push off cleanly when the variables are absent or blank', () => {
    expect(vapidKeysFromEnv({})).toBeNull();
    expect(
      vapidKeysFromEnv({
        PUSH_VAPID_PUBLIC_KEY: ' ',
        PUSH_VAPID_PRIVATE_KEY: '',
        PUSH_VAPID_SUBJECT: '',
      }),
    ).toBeNull();
  });

  it('refuses to start with half a configuration, or a pair that does not belong together', () => {
    expect(() => vapidKeysFromEnv({ PUSH_VAPID_PUBLIC_KEY: pair.publicKey })).toThrow(/all three/);
    const other = generateVapidKeys();
    expect(() => vapidKeysFromEnv({ ...env, PUSH_VAPID_PUBLIC_KEY: other.publicKey })).toThrow(
      /do not belong together/,
    );
    expect(() => vapidKeysFromEnv({ ...env, PUSH_VAPID_SUBJECT: 'practice' })).toThrow(
      /mailto: or https:/,
    );
    expect(() => vapidKeysFromEnv({ ...env, PUSH_VAPID_PRIVATE_KEY: 'short' })).toThrow();
  });

  it('never puts a key in the message it refuses with', () => {
    try {
      vapidKeysFromEnv({ ...env, PUSH_VAPID_PUBLIC_KEY: generateVapidKeys().publicKey });
    } catch (error) {
      expect((error as Error).message).not.toContain(pair.privateKey);
      expect((error as Error).message).not.toContain(pair.publicKey);
    }
  });
});
