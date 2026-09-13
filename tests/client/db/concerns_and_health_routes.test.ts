import { SignJWT } from 'jose';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from '../../../app/api/_middleware/db';
import { createTokenVerifier } from '../../../app/api/_middleware/token-verifier';
import { createApi } from '../../../app/api/create-api';
import { mountClientRecord } from '../../../app/api/clients/mount';
import type { ClientRecordResponse } from '../../../app/api/clients/record-schema';
import {
  AUTH,
  IDS,
  freshDatabase,
  seedClient,
  seedContact,
  seedTenant,
  seedUser,
} from '../../db/helpers';

/**
 * The routes that record a concern and the six health answers
 * (app/api/clients/concerns.ts, app/api/clients/health.ts).
 *
 * The rules are the operator's, taken 2026-09-14: the office records both, a
 * practitioner reads and does not write, and a change to the answers is a new
 * row rather than an edit — so the record shows the newest and the older ones
 * stay as history.
 */

const SECRET = 'test-secret-that-unlocks-nothing-0123456789';
const ISSUER = 'http://localhost:54321/auth/v1';
const KEY = new TextEncoder().encode(SECRET);

const PRACTITIONER_ID = '00000000-0000-4000-8000-0000000001d1';
const PRACTITIONER_AUTH = '00000000-0000-4000-8000-0000000001d2';
const ADMIN_ID = '00000000-0000-4000-8000-0000000001d3';
const ADMIN_AUTH = '00000000-0000-4000-8000-0000000001d4';
const CLIENT_ID = '00000000-0000-4000-8000-0000000001d5';
const CONTACT_ID = '00000000-0000-4000-8000-0000000001d6';
const WORDING_DOCUMENT = '00000000-0000-4000-8000-0000000001d7';
const CONSENT_ID = '00000000-0000-4000-8000-0000000001d8';
/** A second household that never agreed to health data being held. */
const UNCONSENTED_CLIENT_ID = '00000000-0000-4000-8000-0000000001d9';

let owner: pg.Client;
let pool: pg.Pool;
let api: ReturnType<typeof createApi>;
let category: string;

async function request(sub: string, path: string, init: RequestInit = {}): Promise<Response> {
  const token = await new SignJWT({ role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setAudience('authenticated')
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(KEY);
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${token}`);
  if (init.body) headers.set('content-type', 'application/json');
  headers.set('x-reason', 'the household told us');
  return api.request(path, { ...init, headers });
}

const ANSWERS = {
  seizures: false,
  implantedDevice: false,
  headInjury: true,
  headInjuryNote: 'A fall in 2019, no lasting effect',
  pregnancy: false,
  medication: false,
  scalp: false,
};

beforeAll(async () => {
  owner = await freshDatabase();
  await seedTenant(owner, IDS.tenantA, IDS.ownerA, 'Synthetic Studio');
  await owner.query('update app_user set auth_id = $1 where id = $2', [AUTH.ownerA, IDS.ownerA]);
  await seedUser(owner, {
    id: ADMIN_ID,
    tenantId: IDS.tenantA,
    authId: ADMIN_AUTH,
    displayName: 'Synthetic Admin',
    roles: ['admin'],
  });
  await seedUser(owner, {
    id: PRACTITIONER_ID,
    tenantId: IDS.tenantA,
    authId: PRACTITIONER_AUTH,
    displayName: 'Synthetic Practitioner',
    roles: ['practitioner'],
  });
  await seedClient(owner, IDS.tenantA, CLIENT_ID, IDS.ownerA, 'Harbour');
  await seedClient(owner, IDS.tenantA, UNCONSENTED_CLIENT_ID, IDS.ownerA, 'Meadow');
  // The health answers are written only under an active health_data consent
  // (app/api/clients/health.ts), so the first household has one: a contact who
  // may consent, the wording they were shown, and the consent itself.
  await seedContact(owner, IDS.tenantA, CONTACT_ID, CLIENT_ID, 'synthetic-identity-1d6');
  // A real consent text, the shape 902 gives the practice's wording documents
  // (tests/portal/db/support.ts seeds the same), not a made-up kind.
  await owner.query(
    'insert into document (id, tenant_id, client_id, kind, storage_key, mime_type, sha256, ' +
      "is_immutable, purpose, locale, version, status) values ($1, $2, null, 'consent_text', " +
      "'routes-test/health-data.md', 'text/markdown', sha256('w'::bytea), true, " +
      "'health_data', 'en', '1.1', 'approved')",
    [WORDING_DOCUMENT, IDS.tenantA],
  );
  await owner.query(
    'insert into consent (id, tenant_id, client_id, given_by_contact_id, purpose, version, ' +
      "text_document_id, method) values ($1, $2, $3, $4, 'health_data', 1, $5, 'app_signature')",
    [CONSENT_ID, IDS.tenantA, CLIENT_ID, CONTACT_ID, WORDING_DOCUMENT],
  );
  const categories = await owner.query(
    'select id from goal_category where tenant_id = $1 limit 1',
    [IDS.tenantA],
  );
  category = categories.rows[0]?.id as string;

  const apiUrl = process.env.API_DATABASE_URL;
  if (!apiUrl) throw new Error('API_DATABASE_URL is not set.');
  pool = createPool(apiUrl);
  api = createApi({ pool, verifier: createTokenVerifier({ issuer: ISSUER, secret: SECRET }) });
  mountClientRecord(api);
});

afterAll(async () => {
  await pool.end();
  await owner.end();
});

describe('recording a concern', () => {
  it('lets an admin record one, and shows it on the record', async () => {
    const created = await request(ADMIN_AUTH, `/api/clients/${CLIENT_ID}/concerns`, {
      method: 'POST',
      body: JSON.stringify({ categoryId: category, description: 'Wakes at three most nights' }),
    });
    expect(created.status).toBe(201);

    const record = await request(ADMIN_AUTH, `/api/clients/${CLIENT_ID}`);
    const body = (await record.json()) as ClientRecordResponse;
    expect(body.concerns).toHaveLength(1);
    expect(body.concerns[0]).toMatchObject({
      description: 'Wakes at three most nights',
      status: 'open',
    });
  });

  it('refuses empty words, which the column cannot refuse itself', async () => {
    // The erasure empties this text, so the floor lives here rather than on a
    // check constraint (108_concerns_and_health.sql).
    const res = await request(ADMIN_AUTH, `/api/clients/${CLIENT_ID}/concerns`, {
      method: 'POST',
      body: JSON.stringify({ categoryId: category, description: '   ' }),
    });
    expect(res.status).toBe(400);
  });

  it('resolves one without deleting it', async () => {
    const record = await request(ADMIN_AUTH, `/api/clients/${CLIENT_ID}`);
    const first = ((await record.json()) as ClientRecordResponse).concerns[0];
    const res = await request(ADMIN_AUTH, `/api/clients/${CLIENT_ID}/concerns/${first?.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'resolved' }),
    });
    expect(res.status).toBe(200);

    const after = await request(ADMIN_AUTH, `/api/clients/${CLIENT_ID}`);
    const body = (await after.json()) as ClientRecordResponse;
    expect(body.concerns[0]).toMatchObject({ status: 'resolved' });
  });
});

describe('recording the six health answers', () => {
  it('lets the office record them, and the record shows the newest', async () => {
    const first = await request(ADMIN_AUTH, `/api/clients/${CLIENT_ID}/health`, {
      method: 'POST',
      body: JSON.stringify({ ...ANSWERS, wordingVersion: '1.1' }),
    });
    expect(first.status).toBe(201);

    const record = await request(ADMIN_AUTH, `/api/clients/${CLIENT_ID}`);
    const body = (await record.json()) as ClientRecordResponse;
    expect(body.health).toMatchObject({
      headInjury: true,
      headInjuryNote: 'A fall in 2019, no lasting effect',
      seizures: false,
      wordingVersion: '1.1',
    });
  });

  it('supersedes rather than edits when something changes', async () => {
    const second = await request(ADMIN_AUTH, `/api/clients/${CLIENT_ID}/health`, {
      method: 'POST',
      body: JSON.stringify({ ...ANSWERS, medication: true, medicationNote: 'Melatonin at night' }),
    });
    expect(second.status).toBe(201);

    const record = await request(ADMIN_AUTH, `/api/clients/${CLIENT_ID}`);
    const body = (await record.json()) as ClientRecordResponse;
    expect(body.health).toMatchObject({ medication: true, medicationNote: 'Melatonin at night' });

    // Both askings are still there: the first is what was true in March.
    const rows = await owner.query(
      'select count(*)::int as n from health_declaration where client_id = $1',
      [CLIENT_ID],
    );
    expect(rows.rows[0]?.n).toBe(2);
  });

  it('refuses a practitioner, who tells the office instead', async () => {
    const res = await request(PRACTITIONER_AUTH, `/api/clients/${CLIENT_ID}/health`, {
      method: 'POST',
      body: JSON.stringify(ANSWERS),
    });
    expect(res.status).toBe(403);
  });

  it('refuses an answer with a question missing: "we did not ask" is not "no"', async () => {
    const withoutOne: Record<string, unknown> = { ...ANSWERS };
    delete withoutOne.seizures;
    const res = await request(ADMIN_AUTH, `/api/clients/${CLIENT_ID}/health`, {
      method: 'POST',
      body: JSON.stringify(withoutOne),
    });
    expect(res.status).toBe(400);
  });

  it('refuses a household that has not agreed to health data being held', async () => {
    // docs/CONSENT/health-data.en.md names "the health answers you gave us" as
    // what that consent covers. Read at the moment of writing, not from the
    // client's status (.claude/rules/compliance.md).
    const res = await request(ADMIN_AUTH, `/api/clients/${UNCONSENTED_CLIENT_ID}/health`, {
      method: 'POST',
      body: JSON.stringify(ANSWERS),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'conflict', code: 'consent_required' });
    const rows = await owner.query(
      'select count(*)::int as n from health_declaration where client_id = $1',
      [UNCONSENTED_CLIENT_ID],
    );
    expect(rows.rows[0]?.n).toBe(0);
  });

  it('refuses again once the agreement is withdrawn: "we stop collecting it"', async () => {
    await owner.query(
      "update consent set status = 'withdrawn', withdrawn_at = now() where id = $1",
      [CONSENT_ID],
    );
    try {
      const res = await request(ADMIN_AUTH, `/api/clients/${CLIENT_ID}/health`, {
        method: 'POST',
        body: JSON.stringify(ANSWERS),
      });
      expect(res.status).toBe(409);
    } finally {
      await owner.query("update consent set status = 'active', withdrawn_at = null where id = $1", [
        CONSENT_ID,
      ]);
    }
  });
});
