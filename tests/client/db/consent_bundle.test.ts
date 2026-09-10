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

const bundle = (purposes: { purpose: string; textDocumentId: string }[]) => ({
  purposes,
  givenByContactId: ADULT_CONTACT,
  method: 'app_signature',
  evidence: { mimeType: 'image/png', bytesBase64: PNG_BASE64 },
});

const THREE = [
  { purpose: 'participation', textDocumentId: WORDING_PARTICIPATION },
  { purpose: 'home_visit', textDocumentId: WORDING_HOME_VISIT },
  { purpose: 'health_data', textDocumentId: WORDING_HEALTH_DATA },
];

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
  });

  it('is refused for a practitioner, who may not write the record', async () => {
    const res = await request(PRACTITIONER_AUTH, `/api/clients/${ADULT_ID}/consents/bundle`, {
      method: 'POST',
      body: JSON.stringify(bundle(THREE)),
    });
    expect(res.status).toBe(403);
  });
});
