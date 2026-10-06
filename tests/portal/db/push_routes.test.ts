import { createDecipheriv, createECDH, createHmac, randomUUID, type ECDH } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pushSender, type PushSender } from '../../../app/api/portal/push/sender';
import { generateVapidKeys } from '../../../app/api/portal/push/webpush';
import type {
  NotificationsResponse,
  OfficePushRecordResponse,
  OfficePushResponse,
  SendPushResponse,
} from '../../../app/api/portal/schema';
import { IDS } from '../../db/helpers';
import { PORTAL, seedWording, startPortalHarness, type PortalHarness } from './support';

/**
 * Phone notifications through `createApi` as the server builds it (the push
 * memo's decisions 2 and 3; migration 707): the household's step, the Send
 * screen's routes, and the delivery that runs in this process once a send has
 * committed. The push services are a fake that records what it was sent and
 * answers what each test asks; every device key is made here and opens
 * nothing anywhere else.
 */

const OWNER_AUTH = '00000001-0000-4000-8000-000000000010';
const REASON = { 'x-reason': 'Practice news for the households' };
const WORDING = '00000001-0000-4000-8000-0000000000a1';
const KEYS = { ...generateVapidKeys(), subject: 'mailto:practice@example.com' };

type Posted = { url: string; headers: Record<string, string>; body: Buffer };

let h: PortalHarness;
let sender: PushSender;
let api: ReturnType<PortalHarness['apiWith']>;
let offApi: ReturnType<PortalHarness['apiWith']>;
const posted: Posted[] = [];
/** What each device's service answers; 201 unless a test says otherwise. */
const answers = new Map<string, number>();
const devices = new Map<string, ECDH>();
const auth = Buffer.alloc(16, 5);

function endpoint(name: string): string {
  return `https://fcm.googleapis.com/fcm/send/synthetic-${name}`;
}

function device(name: string) {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  devices.set(endpoint(name), ecdh);
  return {
    endpoint: endpoint(name),
    keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') },
  };
}

/** The receiving browser's half (RFC 8291), to read what a device was sent. */
function opened(post: Posted): {
  title: string;
  body: string;
  lang: string;
  stopUrl: string | null;
} {
  const ecdh = devices.get(post.url);
  if (!ecdh) throw new Error('No such synthetic device.');
  const body = post.body;
  const salt = body.subarray(0, 16);
  const id = body.readUInt8(20);
  const serverKey = body.subarray(21, 21 + id);
  const sealed = body.subarray(21 + id);
  const hmac = (key: Buffer, data: Buffer) => createHmac('sha256', key).update(data).digest();
  const ikm = hmac(
    hmac(auth, ecdh.computeSecret(serverKey)),
    Buffer.concat([
      Buffer.from('WebPush: info\0'),
      ecdh.getPublicKey(),
      serverKey,
      Buffer.from([1]),
    ]),
  );
  const prk = hmac(salt, ikm);
  const decipher = createDecipheriv(
    'aes-128-gcm',
    hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16),
    hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12),
  );
  decipher.setAuthTag(sealed.subarray(sealed.length - 16));
  const plain = Buffer.concat([
    decipher.update(sealed.subarray(0, sealed.length - 16)),
    decipher.final(),
  ]);
  return JSON.parse(plain.subarray(0, plain.lastIndexOf(2)).toString('utf8'));
}

beforeAll(async () => {
  h = await startPortalHarness();
  await seedWording(h.owner, {
    id: WORDING,
    purpose: 'marketing',
    locale: 'en',
    version: '1.0',
    status: 'approved',
  });
  sender = pushSender({
    pool: h.pool,
    keys: KEYS,
    log: () => undefined,
    fetch: async (url, init) => {
      posted.push({
        url,
        headers: init.headers as Record<string, string>,
        body: Buffer.from(init.body as Uint8Array),
      });
      return { status: answers.get(url) ?? 201 };
    },
  });
  api = h.apiWith({ push: sender });
  offApi = h.apiWith({});
});

afterAll(async () => {
  await sender?.idle();
  await h?.close();
});

async function call(
  target: ReturnType<PortalHarness['apiWith']>,
  method: 'GET' | 'POST',
  path: string,
  authId: string,
  body?: unknown,
  extra: Record<string, string> = {},
): Promise<Response> {
  const headers: Record<string, string> = { ...extra, ...(await h.authHeader(authId)) };
  const init: RequestInit = { method, headers };
  if (method === 'POST') {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body ?? {});
  }
  return target.request(path, init);
}

function message(kind: 'announcement' | 'offer', id = randomUUID()) {
  return {
    id,
    kind,
    title: { en: 'Closed for the holiday', ar: 'مغلق في العطلة' },
    body: {
      en: 'The studio is closed on Thursday. Home visits go ahead as booked.',
      ar: 'الاستوديو مغلق يوم الخميس. تستمر الزيارات المنزلية كما هي محجوزة.',
    },
  };
}

describe('the household’s step', () => {
  it('is not offered at all when the practice has no key pair', async () => {
    const res = await call(offApi, 'GET', '/api/portal/notifications', PORTAL.motherAuth);
    expect((await res.json()) as NotificationsResponse).toEqual({
      configured: false,
      offered: false,
      publicKey: null,
      devices: 0,
    });
    const refused = await call(
      offApi,
      'POST',
      '/api/portal/notifications/subscriptions',
      PORTAL.motherAuth,
      device('never'),
    );
    expect(refused.status).toBe(503);
  });

  it('hands an adult the practice’s public key to subscribe with', async () => {
    const res = await call(api, 'GET', '/api/portal/notifications', PORTAL.motherAuth);
    expect((await res.json()) as NotificationsResponse).toEqual({
      configured: true,
      offered: true,
      publicKey: KEYS.publicKey,
      devices: 0,
    });
  });

  it("offers nothing to a young person's own login, and refuses their device", async () => {
    const res = await call(api, 'GET', '/api/portal/notifications', PORTAL.minorAuth);
    const body = (await res.json()) as NotificationsResponse;
    expect(body.offered).toBe(false);
    expect(body.publicKey).toBeNull();
    const refused = await call(
      api,
      'POST',
      '/api/portal/notifications/subscriptions',
      PORTAL.minorAuth,
      device('minor'),
    );
    expect(refused.status).toBe(403);
  });

  it('keeps this device for the person signed in, and lets it go', async () => {
    const added = await call(
      api,
      'POST',
      '/api/portal/notifications/subscriptions',
      PORTAL.adultAuth,
      device('passing'),
    );
    expect(added.status).toBe(201);
    expect(((await added.json()) as NotificationsResponse).devices).toBe(1);
    const removed = await call(
      api,
      'POST',
      '/api/portal/notifications/subscriptions/remove',
      PORTAL.adultAuth,
      { endpoint: endpoint('passing') },
    );
    expect(removed.status).toBe(200);
    expect(((await removed.json()) as NotificationsResponse).devices).toBe(0);
  });

  it('refuses an address that is not one of the three push services, and keys of the wrong shape', async () => {
    const elsewhere = await call(
      api,
      'POST',
      '/api/portal/notifications/subscriptions',
      PORTAL.motherAuth,
      { ...device('x'), endpoint: 'https://push.example.com/abc' },
    );
    expect(elsewhere.status).toBe(422);
    const badKey = await call(
      api,
      'POST',
      '/api/portal/notifications/subscriptions',
      PORTAL.motherAuth,
      { endpoint: endpoint('bad'), keys: { p256dh: `C${'A'.repeat(86)}`, auth: 'A'.repeat(22) } },
    );
    expect(badKey.status).toBe(422);
  });
});

describe('the Send screen', () => {
  beforeAll(async () => {
    // The mother on two devices, the adult on one; the young person on none.
    for (const [authId, name] of [
      [PORTAL.motherAuth, 'mother-phone'],
      [PORTAL.motherAuth, 'mother-tablet'],
      [PORTAL.adultAuth, 'adult-phone'],
    ] as const) {
      const res = await call(
        api,
        'POST',
        '/api/portal/notifications/subscriptions',
        authId,
        device(name),
      );
      expect(res.status).toBe(201);
    }
  });

  it('shows the owner how many each kind would reach before anything is sent', async () => {
    const res = await call(api, 'GET', '/api/portal/push', OWNER_AUTH);
    expect(res.status).toBe(200);
    const body = (await res.json()) as OfficePushResponse;
    expect(body.configured).toBe(true);
    expect(body.audience).toEqual({
      announcement: { people: 2, devices: 3 },
      offer: { people: 0, devices: 0 },
    });
    expect(body.offersLeft).toBe(2);
  });

  it('is the owner’s and an admin’s alone', async () => {
    for (const authId of [PORTAL.motherAuth, PORTAL.leadAuth, PORTAL.financeAuth]) {
      expect((await call(api, 'GET', '/api/portal/push', authId)).status, authId).toBe(403);
      const send = await call(
        api,
        'POST',
        '/api/portal/push/messages',
        authId,
        message('announcement'),
        REASON,
      );
      expect(send.status, authId).toBe(403);
    }
  });

  it('says push is not configured, and sends nothing, without the key pair', async () => {
    const res = await call(
      offApi,
      'POST',
      '/api/portal/push/messages',
      OWNER_AUTH,
      message('announcement'),
      REASON,
    );
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toBe('push_not_configured');
    const overview = (await (
      await call(offApi, 'GET', '/api/portal/push', OWNER_AUTH)
    ).json()) as OfficePushResponse;
    expect(overview.configured).toBe(false);
  });

  it('wants a reason, and refuses a medical word in either language', async () => {
    expect(
      (await call(api, 'POST', '/api/portal/push/messages', OWNER_AUTH, message('announcement')))
        .status,
    ).toBe(400);
    const claim = message('announcement');
    claim.body.en = 'Our new therapy sessions.';
    const res = await call(api, 'POST', '/api/portal/push/messages', OWNER_AUTH, claim, REASON);
    expect(res.status).toBe(422);
  });

  it('sends an announcement once to every adult with a device, and keeps the record', async () => {
    const sent = message('announcement');
    const res = await call(
      api,
      'POST',
      '/api/portal/push/messages',
      PORTAL.adminAuth,
      sent,
      REASON,
    );
    expect(res.status).toBe(201);
    expect(((await res.json()) as SendPushResponse).message).toMatchObject({
      id: sent.id,
      kind: 'announcement',
      recipients: 2,
      devices: 3,
    });
    await sender.idle();

    const mine = posted.filter((post) => post.url.includes('synthetic-'));
    expect(mine.map((post) => post.url).sort()).toEqual(
      [endpoint('adult-phone'), endpoint('mother-phone'), endpoint('mother-tablet')].sort(),
    );
    for (const post of mine) {
      expect(post.headers['content-encoding']).toBe('aes128gcm');
      expect(post.headers.authorization).toMatch(/^vapid t=.+, k=/);
      expect(post.body.includes(Buffer.from('Closed for the holiday'))).toBe(false);
    }
    // Each in the person's own language; no stop on an announcement.
    const adult = opened(mine.find((post) => post.url === endpoint('adult-phone')) as Posted);
    expect(adult).toMatchObject({ lang: 'ar', title: 'مغلق في العطلة', stopUrl: null });
    const mother = opened(mine.find((post) => post.url === endpoint('mother-phone')) as Posted);
    expect(mother).toMatchObject({ lang: 'en', title: 'Closed for the holiday' });

    const again = await call(
      api,
      'POST',
      '/api/portal/push/messages',
      PORTAL.adminAuth,
      sent,
      REASON,
    );
    expect(again.status).toBe(409);
    expect(((await again.json()) as { error: string }).error).toBe('already_sent');

    const record = (await (
      await call(api, 'GET', `/api/portal/push/messages/${sent.id}`, OWNER_AUTH)
    ).json()) as OfficePushRecordResponse;
    expect(record.message.delivery).toMatchObject({ delivered: 3, gone: 0, failed: 0 });
    expect(record.recipients).toEqual([
      { name: 'Hazel Meadow', devices: 2, standing: 'off', wordingVersion: null },
      { name: 'Saffron Dune', devices: 1, standing: 'off', wordingVersion: null },
    ]);
  });

  it('sends an offer only where the consent stands, carrying the stop', async () => {
    const nobody = await call(
      api,
      'POST',
      '/api/portal/push/messages',
      OWNER_AUTH,
      message('offer'),
      REASON,
    );
    expect(nobody.status).toBe(409);
    expect(((await nobody.json()) as { error: string }).error).toBe('no_recipients');

    expect(
      (await call(api, 'POST', '/api/portal/marketing', PORTAL.motherAuth, { wordingId: WORDING }))
        .status,
    ).toBe(201);
    posted.length = 0;
    const offer = message('offer');
    const res = await call(api, 'POST', '/api/portal/push/messages', OWNER_AUTH, offer, REASON);
    expect(res.status).toBe(201);
    await sender.idle();
    expect(posted.map((post) => post.url).sort()).toEqual(
      [endpoint('mother-phone'), endpoint('mother-tablet')].sort(),
    );
    const received = opened(posted[0] as Posted);
    expect(received.stopUrl).toBe('/portal/agreements#offers');
    expect(received.body).toContain('To stop offers');

    const record = (await (
      await call(api, 'GET', `/api/portal/push/messages/${offer.id}`, OWNER_AUTH)
    ).json()) as OfficePushRecordResponse;
    expect(record.recipients).toEqual([
      { name: 'Hazel Meadow', devices: 2, standing: 'on', wordingVersion: '1.0' },
    ]);
  });

  it('leaves out a withdrawn consent at once', async () => {
    await call(api, 'POST', '/api/portal/marketing/withdraw', PORTAL.motherAuth);
    const res = await call(
      api,
      'POST',
      '/api/portal/push/messages',
      OWNER_AUTH,
      message('offer'),
      REASON,
    );
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe('no_recipients');
  });

  it('refuses a third offer in the calendar month', async () => {
    await call(api, 'POST', '/api/portal/marketing', PORTAL.motherAuth, { wordingId: WORDING });
    const second = await call(
      api,
      'POST',
      '/api/portal/push/messages',
      OWNER_AUTH,
      message('offer'),
      REASON,
    );
    expect(second.status).toBe(201);
    await sender.idle();
    const third = await call(
      api,
      'POST',
      '/api/portal/push/messages',
      OWNER_AUTH,
      message('offer'),
      REASON,
    );
    expect(third.status).toBe(409);
    expect(((await third.json()) as { error: string }).error).toBe('offer_ceiling');
    const overview = (await (
      await call(api, 'GET', '/api/portal/push', OWNER_AUTH)
    ).json()) as OfficePushResponse;
    expect(overview.offersLeft).toBe(0);
  });

  it('deletes a device its push service reports gone, and keeps one that merely failed', async () => {
    answers.set(endpoint('mother-tablet'), 410);
    answers.set(endpoint('adult-phone'), 500);
    const sent = message('announcement');
    expect(
      (await call(api, 'POST', '/api/portal/push/messages', OWNER_AUTH, sent, REASON)).status,
    ).toBe(201);
    await sender.idle();
    const left = await h.owner.query<{ push_endpoint: string }>(
      'select push_endpoint from push_subscription order by push_endpoint',
    );
    expect(left.rows.map((row) => row.push_endpoint)).toEqual([
      endpoint('adult-phone'),
      endpoint('mother-phone'),
    ]);
    const record = (await (
      await call(api, 'GET', `/api/portal/push/messages/${sent.id}`, OWNER_AUTH)
    ).json()) as OfficePushRecordResponse;
    expect(record.message.delivery).toMatchObject({ delivered: 1, gone: 1, failed: 1 });
    const trail = await h.owner.query(
      "select 1 from audit_log where action = 'portal.push.delivered' and entity_id = $1",
      [sent.id],
    );
    expect(trail.rowCount).toBe(1);
  });

  it('never shows another practice any of it', async () => {
    const rows = await h.owner.query('select 1 from push_message where tenant_id = $1', [
      IDS.tenantB,
    ]);
    expect(rows.rowCount).toBe(0);
  });
});
