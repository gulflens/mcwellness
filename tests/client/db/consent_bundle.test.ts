import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SignJWT } from 'jose';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from '../../../app/api/_middleware/db';
import { localDiskStorage } from '../../../app/api/_middleware/storage';
import { createTokenVerifier } from '../../../app/api/_middleware/token-verifier';
import { createApi } from '../../../app/api/create-api';
import { mountClientRecord } from '../../../app/api/clients/mount';
import { AUTH, IDS, freshDatabase, seedTenant, seedUser } from '../../db/helpers';

/**
 * One signature, several consents (trunk round 43): the bundle route writes one
 * consent row per purpose the client needs, each against its own current
 * wording, all pointing at one filed signature.
 *
 * Fixtures follow tests/client/db/consent_documents.test.ts: `mint`, `request`
 * and `seedWording` are copied rather than imported, and the client/contact
 * rows are inserted directly, the way that file does, so this suite reads on
 * its own.
 */

const SECRET = 'test-secret-that-unlocks-nothing-0123456789';
const ISSUER = 'http://localhost:54321/auth/v1';
const KEY = new TextEncoder().encode(SECRET);

const ADMIN_ID = '00000000-0000-4000-8000-000000000201';
const ADMIN_AUTH = '00000000-0000-4000-8000-000000000202';
const PRACTITIONER_ID = '00000000-0000-4000-8000-000000000203';
const PRACTITIONER_AUTH = '00000000-0000-4000-8000-000000000204';

const ADULT_ID = '00000000-0000-4000-8000-000000000211';
const ADULT_CONTACT = '00000000-0000-4000-8000-000000000212';

// A minor client: the household the bundle exists for, since a child signs
// four scrolls (participation, home_visit, health_data, minor_participation)
// rather than three. One contact who may consent but is not a guardian, and
// one who is both, so the guardian rule inside the bundle actually runs.
const CHILD_ID = '00000000-0000-4000-8000-000000000213';
const CHILD_NON_GUARDIAN_CONTACT = '00000000-0000-4000-8000-000000000214';
const CHILD_GUARDIAN_CONTACT = '00000000-0000-4000-8000-000000000215';
// Same convention as tests/client/db/consent_documents.test.ts's CHILD_ID and
// domain/client/requiredConsents.test.ts's own minor fixture: a synthetic
// date, not a real child's birthday, that is unambiguously a minor today.
const CHILD_DATE_OF_BIRTH = '2015-04-01';

const WORDING_PARTICIPATION = '00000000-0000-4000-8000-000000000221';
const WORDING_HOME_VISIT = '00000000-0000-4000-8000-000000000222';
const WORDING_HEALTH_DATA = '00000000-0000-4000-8000-000000000223';
const WORDING_MINOR = '00000000-0000-4000-8000-000000000224';

/** A one-pixel PNG, byte for byte: the smallest thing the signature pad could produce. */
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

let owner: pg.Client;
let pool: pg.Pool;
let api: ReturnType<typeof createApi>;
let dir: string;

async function mint(sub: string): Promise<string> {
  return new SignJWT({ role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setAudience('authenticated')
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(KEY);
}

async function request(sub: string, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${await mint(sub)}`);
  if (init.body) headers.set('content-type', 'application/json');
  return api.request(path, { ...init, headers });
}

/** A practice wording document, filed the way the seed files one. */
async function seedWording(
  id: string,
  purpose: string,
  locale: string,
  version: string,
  status: 'draft' | 'approved',
  retired: boolean,
): Promise<void> {
  const key = `tenant/${IDS.tenantA}/practice/${id}`;
  await owner.query(
    'insert into document (id, tenant_id, kind, storage_key, mime_type, sha256, purpose, ' +
      "locale, version, status, retired_at, is_immutable) values ($1, $2, 'consent_text', $3, " +
      "'text/markdown', sha256(($4)::bytea), $5, $6, $7, $8, $9, true)",
    [
      id,
      IDS.tenantA,
      key,
      `wording ${id}`,
      purpose,
      locale,
      version,
      status,
      retired ? new Date() : null,
    ],
  );
}

const bundle = (
  purposes: { purpose: string; textDocumentId: string }[],
  givenByContactId: string = ADULT_CONTACT,
) => ({
  purposes,
  givenByContactId,
  method: 'app_signature',
  evidence: { mimeType: 'image/png', bytesBase64: PNG_BASE64 },
});

const THREE = [
  { purpose: 'participation', textDocumentId: WORDING_PARTICIPATION },
  { purpose: 'home_visit', textDocumentId: WORDING_HOME_VISIT },
  { purpose: 'health_data', textDocumentId: WORDING_HEALTH_DATA },
];

// What a minor needs beyond the three above: the guardian's own consent that
// this child in particular is participating (docs/SPEC/client-record.md rule 3).
const FOUR = [...THREE, { purpose: 'minor_participation', textDocumentId: WORDING_MINOR }];

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mcwellness-bundle-'));
  owner = await freshDatabase();
  await seedTenant(owner, IDS.tenantA, IDS.ownerA, 'Synthetic Studio');
  await owner.query('update app_user set auth_id = $1 where id = $2', [AUTH.ownerA, IDS.ownerA]);
  await seedUser(owner, {
    id: ADMIN_ID,
    tenantId: IDS.tenantA,
    authId: ADMIN_AUTH,
    displayName: 'Hazel Ridge',
    roles: ['admin'],
  });
  await seedUser(owner, {
    id: PRACTITIONER_ID,
    tenantId: IDS.tenantA,
    authId: PRACTITIONER_AUTH,
    displayName: 'Jasper Creek',
    roles: ['practitioner'],
  });

  // One adult client, self-consenting: the plain case the bundle exists for.
  await owner.query(
    'insert into client (id, tenant_id, mrn, given_name, family_name, date_of_birth, ' +
      "preferred_locale, status, created_by) values ($1, $2, $3, 'Synthetic', 'Meadow', " +
      "'1990-03-12', 'en', 'lead', $4)",
    [ADULT_ID, IDS.tenantA, `MW-${ADULT_ID.slice(-6)}`, IDS.ownerA],
  );
  await owner.query(
    'insert into contact (id, tenant_id, client_id, given_name, family_name, relationship, ' +
      "is_legal_guardian, can_consent, phone) values ($1, $2, $3, 'Laurel', 'Meadow', 'self', " +
      "false, true, '+971500000021')",
    [ADULT_CONTACT, IDS.tenantA, ADULT_ID],
  );

  // A minor client: the household a child's own household faces, four
  // scrolls rather than three (F1, task-2-fix-brief.md). One contact who may
  // give consent but is not a guardian, and one who is both.
  await owner.query(
    'insert into client (id, tenant_id, mrn, given_name, family_name, date_of_birth, ' +
      "preferred_locale, status, created_by) values ($1, $2, $3, 'Synthetic', 'Brook', " +
      "$4, 'en', 'lead', $5)",
    [CHILD_ID, IDS.tenantA, `MW-${CHILD_ID.slice(-6)}`, CHILD_DATE_OF_BIRTH, IDS.ownerA],
  );
  await owner.query(
    'insert into contact (id, tenant_id, client_id, given_name, family_name, relationship, ' +
      "is_legal_guardian, can_consent, phone) values ($1, $2, $3, 'Rowan', 'Brook', 'other', " +
      "false, true, '+971500000022')",
    [CHILD_NON_GUARDIAN_CONTACT, IDS.tenantA, CHILD_ID],
  );
  await owner.query(
    'insert into contact (id, tenant_id, client_id, given_name, family_name, relationship, ' +
      "is_legal_guardian, can_consent, phone) values ($1, $2, $3, 'Elm', 'Brook', 'mother', " +
      "true, true, '+971500000023')",
    [CHILD_GUARDIAN_CONTACT, IDS.tenantA, CHILD_ID],
  );

  await seedWording(WORDING_PARTICIPATION, 'participation', 'en', '1.0', 'approved', false);
  await seedWording(WORDING_HOME_VISIT, 'home_visit', 'en', '1.0', 'approved', false);
  await seedWording(WORDING_HEALTH_DATA, 'health_data', 'en', '1.1', 'approved', false);
  await seedWording(WORDING_MINOR, 'minor_participation', 'en', '1.0', 'approved', false);

  const apiUrl = process.env.API_DATABASE_URL;
  if (!apiUrl) throw new Error('API_DATABASE_URL is not set.');
  pool = createPool(apiUrl);
  const storage = localDiskStorage({ dir, signingSecret: Buffer.alloc(32, 7) });
  for (const id of [
    WORDING_PARTICIPATION,
    WORDING_HOME_VISIT,
    WORDING_HEALTH_DATA,
    WORDING_MINOR,
  ]) {
    await storage.put(
      `tenant/${IDS.tenantA}/practice/${id}`,
      new TextEncoder().encode(`---\npurpose: x\n---\n\n# Synthetic wording ${id}\n`),
      'text/markdown',
    );
  }
  api = createApi({
    pool,
    verifier: createTokenVerifier({ issuer: ISSUER, secret: SECRET }),
    storage,
  });
  mountClientRecord(api);
});

afterAll(async () => {
  await pool.end();
  await owner.end();
  await rm(dir, { recursive: true, force: true });
});

describe('POST /api/clients/:id/consents/bundle', () => {
  it('writes one consent per purpose, all pointing at one filed signature', async () => {
    const res = await request(ADMIN_AUTH, `/api/clients/${ADULT_ID}/consents/bundle`, {
      method: 'POST',
      body: JSON.stringify(bundle(THREE)),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { ids: string[]; signatureDocumentId: string };
    expect(body.ids).toHaveLength(3);
    const { rows } = await owner.query<{
      purpose: string;
      text_document_id: string;
      signature_document_id: string;
      status: string;
      method: string;
    }>(
      'select purpose, text_document_id, signature_document_id, status, method from consent ' +
        'where client_id = $1 order by purpose',
      [ADULT_ID],
    );
    // Postgres orders an enum column by the type's own declared order, not
    // alphabetically (db/migrations/060_client.sql, with health_data appended
    // by migration 915): participation, then home_visit, then health_data.
    expect(rows.map((r) => r.purpose)).toEqual(['participation', 'home_visit', 'health_data']);
    expect(new Set(rows.map((r) => r.signature_document_id)).size).toBe(1);
    expect(rows[0]?.signature_document_id).toBe(body.signatureDocumentId);
    expect(rows.every((r) => r.status === 'active' && r.method === 'app_signature')).toBe(true);
    expect(rows.find((r) => r.purpose === 'health_data')?.text_document_id).toBe(
      WORDING_HEALTH_DATA,
    );
    const docs = await owner.query<{ n: number }>(
      "select count(*)::int as n from document where kind = 'consent_signature'",
    );
    expect(docs.rows[0]?.n).toBe(1);

    // F2: the design spec names "one audit row per consent" — it holds today
    // because the audit trigger fires per row (db/migrations/080_audit_triggers.sql),
    // but a future implementer who batched the insert would pass every other
    // assertion here. Pin it directly: one 'insert' row per consent this
    // bundle wrote, each naming its own consent id, and no more.
    const audit = await owner.query<{ entity_id: string }>(
      "select entity_id from audit_log where entity_type = 'consent' and action = 'insert' " +
        'and client_id = $1',
      [ADULT_ID],
    );
    expect(audit.rows.map((r) => r.entity_id).sort()).toEqual([...body.ids].sort());
  });

  it('supersedes the earlier active consent for each purpose, as the single route does', async () => {
    const again = await request(ADMIN_AUTH, `/api/clients/${ADULT_ID}/consents/bundle`, {
      method: 'POST',
      body: JSON.stringify(bundle(THREE)),
    });
    expect(again.status).toBe(201);
    const { rows } = await owner.query<{ status: string }>(
      "select status from consent where client_id = $1 and purpose = 'participation' order by created_at",
      [ADULT_ID],
    );
    expect(rows.map((r) => r.status)).toEqual(['superseded', 'active']);
  });

  it('refuses a purpose the client does not need, a repeated purpose, and a verbal method', async () => {
    const notNeeded = await request(ADMIN_AUTH, `/api/clients/${ADULT_ID}/consents/bundle`, {
      method: 'POST',
      body: JSON.stringify(
        bundle([...THREE, { purpose: 'minor_participation', textDocumentId: WORDING_MINOR }]),
      ),
    });
    expect(notNeeded.status).toBe(400);
    expect((await notNeeded.json()) as { code: string }).toMatchObject({
      code: 'purpose_not_needed',
    });

    const repeated = await request(ADMIN_AUTH, `/api/clients/${ADULT_ID}/consents/bundle`, {
      method: 'POST',
      body: JSON.stringify(bundle([THREE[0]!, THREE[0]!])),
    });
    expect(repeated.status).toBe(400);
    expect((await repeated.json()) as { code: string }).toMatchObject({ code: 'purpose_repeated' });

    const verbal = await request(ADMIN_AUTH, `/api/clients/${ADULT_ID}/consents/bundle`, {
      method: 'POST',
      body: JSON.stringify({ ...bundle(THREE), method: 'verbal_witnessed' }),
    });
    expect(verbal.status).toBe(400);
  });

  it('refuses the whole bundle when one wording is not the current one, writing nothing', async () => {
    const before = await owner.query<{ n: number }>(
      'select count(*)::int as n from consent where client_id = $1',
      [ADULT_ID],
    );
    // Cheap 1: a route that files the evidence before it validates would pass
    // every assertion above without this — prove the signature was never
    // filed either, not only that no consent row exists.
    const docsBefore = await owner.query<{ n: number }>(
      "select count(*)::int as n from document where kind = 'consent_signature'",
    );
    const res = await request(ADMIN_AUTH, `/api/clients/${ADULT_ID}/consents/bundle`, {
      method: 'POST',
      body: JSON.stringify(
        bundle([THREE[0]!, { purpose: 'home_visit', textDocumentId: WORDING_HEALTH_DATA }]),
      ),
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { code: string }).toMatchObject({ code: 'wording_wrong_purpose' });
    const after = await owner.query<{ n: number }>(
      'select count(*)::int as n from consent where client_id = $1',
      [ADULT_ID],
    );
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
    const docsAfter = await owner.query<{ n: number }>(
      "select count(*)::int as n from document where kind = 'consent_signature'",
    );
    expect(docsAfter.rows[0]?.n).toBe(docsBefore.rows[0]?.n);
  });

  it('is refused for a practitioner, who may not write the record', async () => {
    const res = await request(PRACTITIONER_AUTH, `/api/clients/${ADULT_ID}/consents/bundle`, {
      method: 'POST',
      body: JSON.stringify(bundle(THREE)),
    });
    expect(res.status).toBe(403);
  });

  // F1: a household with a child signs four scrolls, not three — that
  // household is the whole reason the bundle exists, and until now no test
  // ever drove it with a minor, so the guardian rule inside the bundle
  // (`canGiveConsent`, via `requiredConsentsFor`) had never actually run.
  it('refuses a bundle for a minor given by a contact who is not a guardian, writing nothing', async () => {
    const before = await owner.query<{ n: number }>(
      'select count(*)::int as n from consent where client_id = $1',
      [CHILD_ID],
    );
    const res = await request(ADMIN_AUTH, `/api/clients/${CHILD_ID}/consents/bundle`, {
      method: 'POST',
      body: JSON.stringify(bundle(FOUR, CHILD_NON_GUARDIAN_CONTACT)),
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { code: string }).toMatchObject({ code: 'guardian_required' });
    // The whole transaction rolled back, not just the offending purpose: the
    // route checks every purpose to completion before writing any of them
    // (app/api/clients/consents.ts), so a refusal on one leaves none.
    const after = await owner.query<{ n: number }>(
      'select count(*)::int as n from consent where client_id = $1',
      [CHILD_ID],
    );
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
  });

  it('writes all four consents for a minor when a guardian gives them, under one signature', async () => {
    const docsBefore = await owner.query<{ n: number }>(
      "select count(*)::int as n from document where kind = 'consent_signature'",
    );
    const res = await request(ADMIN_AUTH, `/api/clients/${CHILD_ID}/consents/bundle`, {
      method: 'POST',
      body: JSON.stringify(bundle(FOUR, CHILD_GUARDIAN_CONTACT)),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { ids: string[]; signatureDocumentId: string };
    expect(body.ids).toHaveLength(4);
    const { rows } = await owner.query<{ purpose: string; signature_document_id: string }>(
      'select purpose, signature_document_id from consent where client_id = $1',
      [CHILD_ID],
    );
    expect(rows).toHaveLength(4);
    expect(new Set(rows.map((r) => r.signature_document_id)).size).toBe(1);
    expect(rows[0]?.signature_document_id).toBe(body.signatureDocumentId);
    const docsAfter = await owner.query<{ n: number }>(
      "select count(*)::int as n from document where kind = 'consent_signature'",
    );
    expect((docsAfter.rows[0]?.n ?? 0) - (docsBefore.rows[0]?.n ?? 0)).toBe(1);
  });
});
