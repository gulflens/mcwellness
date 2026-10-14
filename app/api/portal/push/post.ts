import { encryptPayload, fromBase64Url, vapidAuthorization, type VapidKeys } from './webpush';

/**
 * One sealed post to one device, shared by the practice's messages
 * (./sender.ts) and its event notices (./events.ts): the same key pair, the
 * same sealing, the same answer read the same way.
 */

/** How long a service keeps a message for a phone that is off: four days. */
export const PUSH_TTL_SECONDS = 4 * 24 * 60 * 60;
const POST_TIMEOUT_MS = 10_000;
/** Devices posted to at once. A practice's households, not a newsletter. */
export const AT_ONCE = 6;

export type Fetch = (input: string, init: RequestInit) => Promise<{ status: number }>;

export type Outcome = 'delivered' | 'gone' | 'failed';

/** A device's address and its two keys, as a target list hands them over. */
export type SealTarget = { push_endpoint: string; push_p256dh: string; push_auth: string };

/**
 * Seals one payload for one device (RFC 8291), signs the delivery with the
 * practice's key (RFC 8292) and posts it once. What the service answered, and
 * nothing else: no answer within ten seconds, a redirect or any other status
 * is `failed`, never retried.
 */
export async function sealAndPost(
  post: Fetch,
  at: Date,
  target: SealTarget,
  payload: unknown,
  key: VapidKeys,
): Promise<Outcome> {
  try {
    const body = encryptPayload(
      Buffer.from(JSON.stringify(payload)),
      fromBase64Url(target.push_p256dh),
      fromBase64Url(target.push_auth),
    );
    const answer = await post(target.push_endpoint, {
      method: 'POST',
      headers: {
        authorization: vapidAuthorization(target.push_endpoint, key, at),
        'content-encoding': 'aes128gcm',
        'content-type': 'application/octet-stream',
        ttl: String(PUSH_TTL_SECONDS),
        urgency: 'normal',
      },
      body: new Uint8Array(body),
      redirect: 'error',
      signal: AbortSignal.timeout(POST_TIMEOUT_MS),
    });
    if (answer.status === 404 || answer.status === 410) return 'gone';
    if (answer.status >= 200 && answer.status < 300) return 'delivered';
    return 'failed';
  } catch {
    return 'failed';
  }
}
