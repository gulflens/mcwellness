import {
  createCipheriv,
  createECDH,
  createHmac,
  createPrivateKey,
  randomBytes,
  sign as signWith,
  type KeyObject,
} from 'node:crypto';

/**
 * Web push, written against the two RFCs with Node's own crypto and nothing
 * else (docs/CHANGE-REQUESTS/client-portal-07.md says why: no new dependency
 * for about a hundred lines whose correctness the RFC's own worked example
 * proves, in webpush.test.ts).
 *
 * - **RFC 8291, message encryption.** Each message is sealed for one device
 *   with a fresh key pair and salt: the device's public key and its
 *   authentication value derive the content key, and the push service carries
 *   bytes it cannot open. `aes128gcm` content coding (RFC 8188), one record.
 * - **RFC 8292, VAPID.** Each delivery carries a short-lived token signed with
 *   the practice's own P-256 key, so a push service accepts it only from the
 *   server holding the key the device subscribed against.
 *
 * Server-only (Node's crypto). Never imported by anything the browser loads.
 */

const P256 = 'prime256v1';
/** RFC 8188 record size: one record carries a notification with room to spare. */
const RECORD_SIZE = 4096;
/** A token is good for twelve hours: RFC 8292 allows up to twenty-four. */
const TOKEN_SECONDS = 12 * 60 * 60;

export function toBase64Url(bytes: Buffer): string {
  return bytes.toString('base64url');
}

export function fromBase64Url(text: string): Buffer {
  return Buffer.from(text, 'base64url');
}

function hmac(key: Buffer, data: Buffer): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

export type ServerKeys = { privateKey: Buffer; publicKey: Buffer };

/**
 * Seals `plaintext` for one device (RFC 8291 section 3 and 4). `options` is
 * for the RFC's own worked example only: in use the key pair and the salt are
 * fresh every time, as the RFC requires.
 */
export function encryptPayload(
  plaintext: Buffer,
  devicePublicKey: Buffer,
  authValue: Buffer,
  options: { salt?: Buffer; serverKeys?: ServerKeys } = {},
): Buffer {
  if (authValue.length !== 16) {
    throw new Error('A device authentication value is 16 bytes.');
  }
  if (devicePublicKey.length !== 65 || devicePublicKey[0] !== 0x04) {
    throw new Error('A device key is an uncompressed P-256 point of 65 bytes.');
  }
  const ecdh = createECDH(P256);
  if (options.serverKeys) {
    ecdh.setPrivateKey(options.serverKeys.privateKey);
  } else {
    ecdh.generateKeys();
  }
  const serverPublic = ecdh.getPublicKey();
  // Throws on a point that is not on the curve.
  const shared = ecdh.computeSecret(devicePublicKey);
  const salt = options.salt ?? randomBytes(16);

  const prkKey = hmac(authValue, shared);
  const keyInfo = Buffer.concat([
    Buffer.from('WebPush: info\0', 'latin1'),
    devicePublicKey,
    serverPublic,
    Buffer.from([1]),
  ]);
  const ikm = hmac(prkKey, keyInfo);
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01', 'latin1')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01', 'latin1')).subarray(0, 12);

  // One record, so it ends with the last-record delimiter and no padding.
  const record = Buffer.concat([plaintext, Buffer.from([2])]);
  if (record.length + 16 > RECORD_SIZE) {
    throw new Error('A notification is larger than one record allows.');
  }
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const sealed = Buffer.concat([cipher.update(record), cipher.final(), cipher.getAuthTag()]);

  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(serverPublic.length, 20);
  return Buffer.concat([header, serverPublic, sealed]);
}

/** The practice's push key pair and the contact a push service may write to. */
export type VapidKeys = { publicKey: string; privateKey: string; subject: string };

function privateKeyObject(keys: VapidKeys): KeyObject {
  const point = fromBase64Url(keys.publicKey);
  return createPrivateKey({
    key: {
      kty: 'EC',
      crv: 'P-256',
      d: keys.privateKey,
      x: toBase64Url(point.subarray(1, 33)),
      y: toBase64Url(point.subarray(33, 65)),
    },
    format: 'jwk',
  });
}

/** `Authorization: vapid t=…, k=…` for one delivery to one push service. */
export function vapidAuthorization(endpoint: string, keys: VapidKeys, now: Date): string {
  const audience = new URL(endpoint).origin;
  const head = toBase64Url(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = toBase64Url(
    Buffer.from(
      JSON.stringify({
        aud: audience,
        exp: Math.floor(now.getTime() / 1000) + TOKEN_SECONDS,
        sub: keys.subject,
      }),
    ),
  );
  const signature = signWith('sha256', Buffer.from(`${head}.${claims}`), {
    key: privateKeyObject(keys),
    dsaEncoding: 'ieee-p1363',
  });
  return `vapid t=${head}.${claims}.${toBase64Url(signature)}, k=${keys.publicKey}`;
}

/**
 * A new key pair for the practice, base64url: the public key as the 65-byte
 * point a browser's `applicationServerKey` takes, the private key as its
 * 32-byte scalar. Run by the operator through `pnpm push:keys`
 * (scripts/push-keys.mjs), never by the app.
 */
export function generateVapidKeys(): { publicKey: string; privateKey: string } {
  const ecdh = createECDH(P256);
  ecdh.generateKeys();
  return {
    publicKey: toBase64Url(ecdh.getPublicKey()),
    privateKey: toBase64Url(ecdh.getPrivateKey()),
  };
}

type PushEnv = {
  PUSH_VAPID_PUBLIC_KEY?: string | undefined;
  PUSH_VAPID_PRIVATE_KEY?: string | undefined;
  PUSH_VAPID_SUBJECT?: string | undefined;
};

/**
 * The practice's key pair from the environment, or null when push is not
 * configured — all three variables blank or absent, which switches push off
 * cleanly: the portal does not offer the step and the Send screen says push
 * is not configured. Half a configuration, a pair that does not belong
 * together, or a subject a push service cannot write to stops the API at
 * startup with a sentence that never repeats a key.
 */
export function vapidKeysFromEnv(env: PushEnv): VapidKeys | null {
  const publicKey = env.PUSH_VAPID_PUBLIC_KEY?.trim() ?? '';
  const privateKey = env.PUSH_VAPID_PRIVATE_KEY?.trim() ?? '';
  const subject = env.PUSH_VAPID_SUBJECT?.trim() ?? '';
  const set = [publicKey, privateKey, subject].filter((value) => value.length > 0).length;
  if (set === 0) return null;
  if (set < 3) {
    throw new Error(
      'Push needs all three of PUSH_VAPID_PUBLIC_KEY, PUSH_VAPID_PRIVATE_KEY and ' +
        'PUSH_VAPID_SUBJECT, or none of them. Generate a pair with pnpm push:keys.',
    );
  }
  if (!/^(mailto:|https:)/.test(subject)) {
    throw new Error(
      'PUSH_VAPID_SUBJECT is a mailto: or https: address a push service may contact.',
    );
  }
  const point = fromBase64Url(publicKey);
  const scalar = fromBase64Url(privateKey);
  if (point.length !== 65 || point[0] !== 0x04 || scalar.length !== 32) {
    throw new Error(
      'PUSH_VAPID_PUBLIC_KEY and PUSH_VAPID_PRIVATE_KEY are not a P-256 pair in base64url. ' +
        'Generate a pair with pnpm push:keys.',
    );
  }
  const ecdh = createECDH(P256);
  try {
    ecdh.setPrivateKey(scalar);
  } catch {
    throw new Error('PUSH_VAPID_PRIVATE_KEY is not a P-256 private key.');
  }
  if (!ecdh.getPublicKey().equals(point)) {
    throw new Error(
      'PUSH_VAPID_PUBLIC_KEY and PUSH_VAPID_PRIVATE_KEY do not belong together. ' +
        'Set both from the same run of pnpm push:keys.',
    );
  }
  return { publicKey, privateKey, subject };
}
