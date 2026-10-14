import { createDecipheriv, createECDH, createHmac, type ECDH } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { NotificationsResponse } from '../../../app/api/portal/schema';
import { pushSender, type PushSender } from '../../../app/api/portal/push/sender';
import { generateVapidKeys } from '../../../app/api/portal/push/webpush';
import { IDS, seedCredential, seedUser } from '../../db/helpers';
import { PORTAL, seedAppointment, startPortalHarness, type PortalHarness } from './support';

/**
 * Phone notifications for events, through `createApi` as the server builds it
 * (the practice's list of 6 October 2026, items 6 and 7; migration 708): the
 * calendar's confirm, move and cancel, the website's enquiry door, and the
 * console's own switch for a member of staff's browser. The push services are
 * a fake that records what it was sent; every device key is made here and
 * opens nothing anywhere else. What a household is sent is opened again here,
 * as their browser would, and read word for word.
 */

const KEYS = { ...generateVapidKeys(), subject: 'mailto:practice@example.com' };
const REASON = { 'x-reason': 'Practice change of plan' };
const PRACTICE_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' });

type Posted = { url: string; body: Buffer };
type Opened = { kind: string; lang: string; title: string; body: string; url: string };

let h: PortalHarness;
let sender: PushSender;
let api: ReturnType<PortalHarness['apiWith']>;
let offApi: ReturnType<PortalHarness['apiWith']>;
const posted: Posted[] = [];
const devices = new Map<string, ECDH>();
const auth = Buffer.alloc(16, 7);

const endpoint = (name: string) => `https://fcm.googleapis.com/fcm/send/synthetic-event-${name}`;

function device(name: string) {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  devices.set(endpoint(name), ecdh);
  return {
    endpoint: endpoint(name),
    keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') },
  };
}

/** The receiving browser's half (RFC 8291). */
function opened(post: Posted): Opened {
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
  return JSON.parse(plain.subarray(0, plain.lastIndexOf(2)).toString('utf8')) as Opened;
}

/** What reached each device, once every delivery started so far has finished. */
async function delivered(): Promise<{ to: string; message: Opened }[]> {
  await sender.idle();
  return posted.map((post) => ({ to: post.url, message: opened(post) }));
}

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

const OWNER_AUTH = '00000001-0000-4000-8000-000000000010';

/** A visit in the practice's own day `inDays` from now, at `hour`, and how a phone shows it. */
function shownAs(inDays: number, hour: number): string {
  const [year, month, day] = PRACTICE_DAY.format(
    new Date(Date.now() + inDays * 24 * 60 * 60 * 1000),
  ).split('-');
  return `${day}/${month}/${year} at ${String(hour).padStart(2, '0')}:00`;
}

const VISIT = {
  proposed: '00000001-0000-4000-8000-0000000000e1',
  confirmed: '00000001-0000-4000-8000-0000000000e2',
  calledOff: '00000001-0000-4000-8000-0000000000e3',
  householdCalled: '00000001-0000-4000-8000-0000000000e4',
  quiet: '00000001-0000-4000-8000-0000000000e5',
  proposedMove: '00000001-0000-4000-8000-0000000000e6',
  handedOver: '00000001-0000-4000-8000-0000000000e8',
  handedOverMoved: '00000001-0000-4000-8000-0000000000e9',
} as const;

/** A second practitioner, to hand a visit to. */
const SECOND = {
  user: '00000001-0000-4000-8000-0000000000f6',
  auth: '00000001-0000-4000-8000-0000000000f7',
  practitioner: '00000001-0000-4000-8000-0000000000f8',
} as const;

async function events(kind: string): Promise<{ recipient_count: number; device_count: number }[]> {
  const rows = await h.owner.query<{ recipient_count: number; device_count: number }>(
    'select recipient_count, device_count from push_event where kind = $1::push_event_kind',
    [kind],
  );
  return rows.rows;
}

beforeAll(async () => {
  h = await startPortalHarness();
  sender = pushSender({
    pool: h.pool,
    keys: KEYS,
    log: () => undefined,
    fetch: async (url, init) => {
      posted.push({ url, body: Buffer.from(init.body as Uint8Array) });
      return { status: 201 };
    },
  });
  api = h.apiWith({ push: sender });
  offApi = h.apiWith({});

  // The practitioner may deliver this service, so a move passes the
  // credential rule the calendar asks.
  await seedCredential(h.owner, {
    tenantId: IDS.tenantA,
    practitionerId: PORTAL.practitionerRow,
    serviceTypeId: PORTAL.serviceType,
    certification: 'bcia_bcn',
    validFrom: '2026-01-01',
    validTo: null,
    canExecuteSession: true,
  });

  await seedUser(h.owner, {
    id: SECOND.user,
    tenantId: IDS.tenantA,
    authId: SECOND.auth,
    displayName: 'Rowan Vale',
    roles: ['practitioner'],
  });
  await h.owner.query('insert into practitioner (id, tenant_id, user_id) values ($1, $2, $3)', [
    SECOND.practitioner,
    IDS.tenantA,
    SECOND.user,
  ]);
  await seedCredential(h.owner, {
    tenantId: IDS.tenantA,
    practitionerId: SECOND.practitioner,
    serviceTypeId: PORTAL.serviceType,
    certification: 'bcia_bcn',
    validFrom: '2026-01-01',
    validTo: null,
    canExecuteSession: true,
  });

  // The mother on two devices and the Arabic-reading adult on one, through
  // the household's own step.
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
  // The young person's own login is refused a device by the portal; one is
  // written here as the table owner, to prove the event rule keeps them off
  // even so.
  const minor = device('minor-phone');
  await h.owner.query(
    'insert into push_subscription (tenant_id, user_id, push_endpoint, push_p256dh, push_auth) ' +
      'values ($1, $2, $3, $4, $5)',
    [IDS.tenantA, PORTAL.minorUser, minor.endpoint, minor.keys.p256dh, minor.keys.auth],
  );

  for (const [id, inDays, hour, status] of [
    [VISIT.proposed, 3, 10, 'proposed'],
    [VISIT.confirmed, 4, 11, 'confirmed'],
    [VISIT.calledOff, 5, 12, 'confirmed'],
    [VISIT.householdCalled, 6, 13, 'confirmed'],
    [VISIT.quiet, 7, 14, 'proposed'],
    [VISIT.proposedMove, 8, 15, 'proposed'],
    [VISIT.handedOver, 11, 10, 'confirmed'],
    [VISIT.handedOverMoved, 12, 10, 'confirmed'],
  ] as const) {
    await seedAppointment(h.owner, { id, clientId: PORTAL.childA, inDays, hour, status });
  }
});

afterAll(async () => {
  await sender?.idle();
  await h?.close();
});

beforeEach(async () => {
  await sender.idle();
  posted.length = 0;
});

describe('a visit, told to the household’s phones', () => {
  it('says nothing at all from a deployment without the key pair', async () => {
    const res = await call(
      offApi,
      'POST',
      `/api/appointments/${VISIT.quiet}/confirm`,
      PORTAL.adminAuth,
    );
    expect(res.status).toBe(200);
    expect(await delivered()).toEqual([]);
    expect(await events('visit_booked')).toEqual([]);
  });

  it('says a visit is booked when it is confirmed: every adult device, never a young person’s', async () => {
    const res = await call(
      api,
      'POST',
      `/api/appointments/${VISIT.proposed}/confirm`,
      PORTAL.adminAuth,
    );
    expect(res.status).toBe(200);
    const sent = await delivered();
    expect(sent.map((each) => each.to).sort()).toEqual(
      [endpoint('mother-phone'), endpoint('mother-tablet')].sort(),
    );
    for (const each of sent) {
      expect(each.message).toMatchObject({
        kind: 'event',
        lang: 'en',
        title: 'Visit booked',
        body: `Your visit is booked for ${shownAs(3, 10)}.`,
        url: '/portal/visits',
      });
    }
    expect(await events('visit_booked')).toEqual([{ recipient_count: 1, device_count: 2 }]);

    // Nothing sensitive on the lock screen: not the client's name, the
    // address, the practitioner or the service.
    const record = await h.owner.query<{ words: string }>(
      "select concat_ws(' ', c.given_name, c.family_name, l.display_address, u.display_name, " +
        's.name) as words from appointment a join client c on c.id = a.client_id ' +
        'join location l on l.id = a.location_id join practitioner p on p.id = a.practitioner_id ' +
        'join app_user u on u.id = p.user_id join service_type s on s.id = a.service_type_id ' +
        'where a.id = $1',
      [VISIT.proposed],
    );
    const words = (record.rows[0]?.words ?? '')
      .split(/[\s,()]+/)
      .filter((word) => word.length > 3 && !/^\d+$/.test(word));
    expect(words.length).toBeGreaterThan(3);
    for (const each of sent) {
      for (const word of words) {
        expect(`${each.message.title} ${each.message.body}`).not.toContain(word);
      }
    }
  });

  it('says a confirmed visit moved, with its new day and time', async () => {
    const res = await call(
      api,
      'POST',
      `/api/appointments/${VISIT.confirmed}/move`,
      PORTAL.adminAuth,
      {
        windowStart: `${PRACTICE_DAY.format(new Date(Date.now() + 9 * 86_400_000))}T12:00:00Z`,
      },
      REASON,
    );
    expect(res.status).toBe(201);
    const sent = await delivered();
    expect(sent).toHaveLength(2);
    expect(sent[0]?.message).toMatchObject({
      title: 'Visit moved',
      body: `Your visit has moved to ${shownAs(9, 16)}.`,
    });
  });

  it('says nothing when a visit the household was never told of moves', async () => {
    const res = await call(
      api,
      'POST',
      `/api/appointments/${VISIT.proposedMove}/move`,
      PORTAL.adminAuth,
      {
        windowStart: `${PRACTICE_DAY.format(new Date(Date.now() + 10 * 86_400_000))}T05:00:00Z`,
      },
      REASON,
    );
    expect(res.status).toBe(201);
    expect(await delivered()).toEqual([]);
  });

  it('says nothing when a confirmed visit changes hands at the same time', async () => {
    const res = await call(
      api,
      'POST',
      `/api/appointments/${VISIT.handedOver}/reassign`,
      PORTAL.adminAuth,
      { practitionerId: SECOND.practitioner },
      REASON,
    );
    expect(res.status).toBe(201);
    expect(await delivered()).toEqual([]);
  });

  it('says a visit moved when a handover also gives it a new time', async () => {
    const res = await call(
      api,
      'POST',
      `/api/appointments/${VISIT.handedOverMoved}/reassign`,
      PORTAL.adminAuth,
      {
        practitionerId: SECOND.practitioner,
        windowStart: `${PRACTICE_DAY.format(new Date(Date.now() + 13 * 86_400_000))}T07:00:00Z`,
      },
      REASON,
    );
    expect(res.status).toBe(201);
    const sent = await delivered();
    expect(sent).toHaveLength(2);
    expect(sent[0]?.message).toMatchObject({
      title: 'Visit moved',
      body: `Your visit has moved to ${shownAs(13, 11)}.`,
    });
  });

  it('says a confirmed visit was called off when the practice calls it off', async () => {
    const res = await call(
      api,
      'POST',
      `/api/appointments/${VISIT.calledOff}/cancel`,
      PORTAL.adminAuth,
      { reason: 'practice_request' },
      REASON,
    );
    expect(res.status).toBe(200);
    const sent = await delivered();
    expect(sent).toHaveLength(2);
    expect(sent[0]?.message).toMatchObject({
      title: 'Visit called off',
      body: `The practice has called off your visit on ${shownAs(5, 12)}.`,
    });
  });

  it('says nothing when the household itself called the visit off', async () => {
    const res = await call(
      api,
      'POST',
      `/api/appointments/${VISIT.householdCalled}/cancel`,
      PORTAL.adminAuth,
      { reason: 'client_request' },
      REASON,
    );
    expect(res.status).toBe(200);
    expect(await delivered()).toEqual([]);
  });

  it('speaks Arabic to a household that reads it', async () => {
    await seedAppointment(h.owner, {
      id: '00000001-0000-4000-8000-0000000000e7',
      clientId: PORTAL.adultClient,
      inDays: 3,
      hour: 9,
      status: 'proposed',
    });
    await call(
      api,
      'POST',
      '/api/appointments/00000001-0000-4000-8000-0000000000e7/confirm',
      PORTAL.adminAuth,
    );
    const sent = await delivered();
    expect(sent.map((each) => each.to)).toEqual([endpoint('adult-phone')]);
    expect(sent[0]?.message).toMatchObject({ lang: 'ar', title: 'تم حجز الزيارة' });
  });
});

describe('a member of staff’s browser, and a new website enquiry', () => {
  const ENQUIRY = {
    name: 'Hazel Meadow',
    country_code: '+971',
    phone: '50 000 0098',
    email: 'hazel.enquiry@example.com',
    message: 'I would like to know more about the sessions',
    consent: 'on',
    source: 'website',
  };

  it('offers the switch to the people who see Enquiries, and to nobody else', async () => {
    const admin = (await (
      await call(api, 'GET', '/api/me/notifications', PORTAL.adminAuth)
    ).json()) as NotificationsResponse;
    expect(admin).toEqual({
      configured: true,
      offered: true,
      publicKey: KEYS.publicKey,
      devices: 0,
    });
    for (const authId of [PORTAL.practitionerAuth, PORTAL.financeAuth, PORTAL.motherAuth]) {
      const body = (await (
        await call(api, 'GET', '/api/me/notifications', authId)
      ).json()) as NotificationsResponse;
      expect(body.offered, authId).toBe(false);
      expect(body.publicKey, authId).toBeNull();
      const refused = await call(
        api,
        'POST',
        '/api/me/notifications/subscriptions',
        authId,
        device(`refused-${authId.slice(-2)}`),
      );
      expect(refused.status, authId).toBe(403);
    }
    const off = (await (
      await call(offApi, 'GET', '/api/me/notifications', PORTAL.adminAuth)
    ).json()) as NotificationsResponse;
    expect(off).toEqual({ configured: false, offered: false, publicKey: null, devices: 0 });
  });

  it('tells a new website enquiry to staff browsers only, and never who sent it', async () => {
    for (const [authId, name] of [
      [PORTAL.adminAuth, 'admin-laptop'],
      [PORTAL.leadAuth, 'lead-laptop'],
      [OWNER_AUTH, 'owner-laptop'],
    ] as const) {
      const res = await call(
        api,
        'POST',
        '/api/me/notifications/subscriptions',
        authId,
        device(name),
      );
      expect(res.status).toBe(201);
    }
    // A staff browser that later loses the role hears nothing.
    await h.owner.query("update user_role set role = 'practitioner' where user_id = $1", [
      PORTAL.leadPractitioner,
    ]);
    const lodged = await api.request('/api/enquiries', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://mcwellnessuae.com' },
      body: JSON.stringify(ENQUIRY),
    });
    expect(lodged.status).toBe(200);
    const sent = await delivered();
    expect(sent.map((each) => each.to).sort()).toEqual(
      [endpoint('admin-laptop'), endpoint('owner-laptop')].sort(),
    );
    for (const each of sent) {
      expect(each.message).toEqual({
        v: 1,
        kind: 'event',
        lang: 'en',
        dir: 'ltr',
        title: 'New website enquiry',
        body: 'Open Enquiries in the console to read it.',
        url: '/admin/enquiries',
        stopUrl: null,
        stopLabel: null,
      });
      const words = JSON.stringify(each.message);
      for (const value of [ENQUIRY.name, 'Hazel', 'Meadow', '0098', ENQUIRY.email, 'sessions']) {
        expect(words).not.toContain(value);
      }
    }
    // No household device hears of it.
    expect(sent.some((each) => each.to.includes('mother') || each.to.includes('adult'))).toBe(
      false,
    );
    expect(await events('enquiry_new')).toEqual([{ recipient_count: 2, device_count: 2 }]);
    await h.owner.query("update user_role set role = 'lead_practitioner' where user_id = $1", [
      PORTAL.leadPractitioner,
    ]);
  });

  it('records each event by kind, id and counts, and never a word that was sent', async () => {
    const columns = await h.owner.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_name = 'push_event'",
    );
    const names = columns.rows.map((row) => row.column_name);
    for (const word of ['title', 'body', 'title_en', 'body_en', 'text']) {
      expect(names).not.toContain(word);
    }
    const trail = await h.owner.query<{ new_values: Record<string, string> }>(
      "select new_values from audit_log where action = 'portal.push.event_delivered'",
    );
    expect(trail.rows.length).toBeGreaterThan(0);
    for (const row of trail.rows) {
      expect(Object.keys(row.new_values).sort()).toEqual(['delivered', 'failed', 'gone', 'kind']);
    }
  });

  it('lets a member of staff turn their browser off again', async () => {
    const res = await call(
      api,
      'POST',
      '/api/me/notifications/subscriptions/remove',
      PORTAL.adminAuth,
      {
        endpoint: endpoint('admin-laptop'),
      },
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as NotificationsResponse).devices).toBe(0);
  });
});
