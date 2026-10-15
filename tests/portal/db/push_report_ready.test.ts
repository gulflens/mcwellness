import { createECDH } from 'node:crypto';
import { SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTokenVerifier } from '../../../app/api/_middleware/token-verifier';
import { createApi } from '../../../app/api/create-api';
import { pushSender, type PushSender } from '../../../app/api/portal/push/sender';
import { generateVapidKeys } from '../../../app/api/portal/push/webpush';
import {
  ISSUER,
  SECRET,
  SEEDED,
  progressBody,
  startHarness,
  type Harness,
} from '../../reports/db/support';

/**
 * "A new report is ready in your portal" (the practice's list of 6 October
 * 2026, item 6; migration 708): told to the phones of those who may read the
 * report on the portal once it is issued, through `createApi` as the server
 * builds it, over the synthetic practice. Never the report's kind or title.
 * The push service is a fake that records where it was asked to post; the
 * device keys are made here and open nothing.
 */

const KEYS = { ...generateVapidKeys(), subject: 'mailto:practice@example.com' };

let h: Harness;
let sender: PushSender;
let api: ReturnType<typeof createApi>;
const posted: string[] = [];

async function asOwner(path: string, body: unknown): Promise<Response> {
  const token = await new SignJWT({ role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setAudience('authenticated')
    .setSubject(h.authIdOf(SEEDED.owner))
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(new TextEncoder().encode(SECRET));
  return api.request(path, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** The seeded Arabic-reading adult, who is her own record's contact and its portal login. */
function adultSelf() {
  const contact = h.data.contacts.find(
    (each) => each.userId !== null && each.relationship === 'self',
  );
  if (!contact?.userId) throw new Error('The seed has no adult with a portal login.');
  const index = h.data.clients.findIndex((client) => client.id === contact.clientId);
  return { userId: contact.userId, clientIndex: index };
}

beforeAll(async () => {
  h = await startHarness(() => new Date());
  sender = pushSender({
    pool: h.pool,
    keys: KEYS,
    log: () => undefined,
    fetch: async (url) => {
      posted.push(url);
      return { status: 201 };
    },
  });
  api = createApi({
    pool: h.pool,
    verifier: createTokenVerifier({ issuer: ISSUER, secret: SECRET }),
    now: () => new Date(),
    storage: h.storage,
    push: sender,
  });
});

afterAll(async () => {
  await sender?.idle();
  await h?.close();
});

describe('a report ready', () => {
  it('is told to the person it is about once it is issued, and recorded by id and counts', async () => {
    const adult = adultSelf();
    const ecdh = createECDH('prime256v1');
    ecdh.generateKeys();
    const address = 'https://fcm.googleapis.com/fcm/send/synthetic-report-ready';
    await h.owner.query(
      'insert into push_subscription (tenant_id, user_id, push_endpoint, push_p256dh, push_auth) ' +
        'values ($1, $2, $3, $4, $5)',
      [
        h.data.tenant.id,
        adult.userId,
        address,
        ecdh.getPublicKey().toString('base64url'),
        Buffer.alloc(16, 3).toString('base64url'),
      ],
    );

    const draft = await asOwner('/api/reports/draft', {
      clientId: h.clientId(adult.clientIndex),
      kind: 'progress',
      locale: 'en',
      coverageFrom: '2026-06-01',
      coverageTo: '2026-09-01',
      content: progressBody(),
    });
    expect(draft.status).toBe(201);
    const reportId = ((await draft.json()) as { report: { id: string } }).report.id;
    await sender.idle();
    expect(posted).toEqual([]);

    const issued = await asOwner(`/api/reports/${reportId}/issue`, {});
    expect(issued.status).toBe(201);
    await sender.idle();
    expect(posted).toEqual([address]);

    const record = await h.owner.query(
      'select kind::text as kind, subject_id, recipient_count, device_count, delivered_count ' +
        'from push_event',
    );
    expect(record.rows).toEqual([
      {
        kind: 'report_ready',
        subject_id: reportId,
        recipient_count: 1,
        device_count: 1,
        delivered_count: 1,
      },
    ]);
  });
});
