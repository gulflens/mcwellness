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
 * Recording consent with the evidence that was signed, and the Documents tab
 * (docs/SPEC/client-record.md sections 4.2 and 7; the fourth pull request).
 *
 * Against a real database and a real storage seam — the folder implementation,
 * which is the fallback every test runs on (docs/SEAMS.md) — because every
 * rule worth proving here lives in the join between the two: a wording row
 * that is retired, a guard trigger that refuses to let an immutable row
 * change, an audit row that has to exist before a link is signed.
 */

const SECRET = 'test-secret-that-unlocks-nothing-0123456789';
const ISSUER = 'http://localhost:54321/auth/v1';
const KEY = new TextEncoder().encode(SECRET);

const ADMIN_ID = '00000000-0000-4000-8000-0000000000f1';
const ADMIN_AUTH = '00000000-0000-4000-8000-0000000000f2';
const CONTACT_USER_ID = '00000000-0000-4000-8000-0000000000f3';
const CONTACT_AUTH = '00000000-0000-4000-8000-0000000000f4';
const OTHER_CONTACT_USER_ID = '00000000-0000-4000-8000-0000000000f5';
const OTHER_CONTACT_AUTH = '00000000-0000-4000-8000-0000000000f6';

const ADULT_ID = '00000000-0000-4000-8000-000000000101';
const CHILD_ID = '00000000-0000-4000-8000-000000000102';
const OTHER_CLIENT_ID = '00000000-0000-4000-8000-000000000103';
const ADULT_CONTACT = '00000000-0000-4000-8000-000000000111';
const GUARDIAN_CONTACT = '00000000-0000-4000-8000-000000000112';
const NON_GUARDIAN_CONTACT = '00000000-0000-4000-8000-000000000113';
const OTHER_CLIENT_CONTACT = '00000000-0000-4000-8000-000000000114';

const WORDING_PARTICIPATION = '00000000-0000-4000-8000-000000000121';
const WORDING_HOME_VISIT = '00000000-0000-4000-8000-000000000122';
const WORDING_RETIRED = '00000000-0000-4000-8000-000000000123';
const WORDING_ARABIC = '00000000-0000-4000-8000-000000000124';
const WORDING_MINOR = '00000000-0000-4000-8000-000000000125';

/** A one-pixel PNG, byte for byte: the smallest thing the signature pad could produce. */
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
/** A PDF header and nothing more: enough for the sniff, small enough for the cap. */
const PDF_BASE64 = Buffer.from('%PDF-1.7\n% synthetic\n').toString('base64');
/** A page, so a file claiming to be an image can be caught claiming it. */
const HTML_AS_PNG = Buffer.from('<!doctype html><p>not an image</p>').toString('base64');

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

async function auditRows(entityId: string, action: string): Promise<number> {
  const { rows } = await owner.query<{ n: string }>(
    'select count(*)::text as n from audit_log where entity_id = $1 and action = $2',
    [entityId, action],
  );
  return Number(rows[0]?.n ?? '0');
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mcwellness-client-record-'));
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
    id: CONTACT_USER_ID,
    tenantId: IDS.tenantA,
    authId: CONTACT_AUTH,
    displayName: 'Synthetic Household',
    roles: ['client_contact'],
  });
  await seedUser(owner, {
    id: OTHER_CONTACT_USER_ID,
    tenantId: IDS.tenantA,
    authId: OTHER_CONTACT_AUTH,
    displayName: 'Another Household',
    roles: ['client_contact'],
  });

  // An adult and a child, each with their own contacts. The child's household
  // holds two people who may consent: one is a legal guardian and one is not,
  // which is the whole point of the guardian rule.
  for (const [id, familyName, dateOfBirth, locale] of [
    [ADULT_ID, 'Meadow', '1990-01-01', 'en'],
    [CHILD_ID, 'Harbour', '2015-04-01', 'en'],
    [OTHER_CLIENT_ID, 'Quarry', '1988-06-01', 'ar'],
  ] as const) {
    await owner.query(
      'insert into client (id, tenant_id, mrn, given_name, family_name, date_of_birth, ' +
        'preferred_locale, status, created_by) ' +
        "values ($1, $2, $3, 'Synthetic', $4, $5, $6, 'lead', $7)",
      [id, IDS.tenantA, `MW-${id.slice(-6)}`, familyName, dateOfBirth, locale, IDS.ownerA],
    );
  }
  await owner.query(
    'insert into contact (id, tenant_id, client_id, given_name, family_name, relationship, ' +
      'is_legal_guardian, can_consent, phone, user_id) values ' +
      "($1, $9, $5, 'Laurel', 'Meadow', 'self', false, true, '+971500000011', $10), " +
      "($2, $9, $6, 'Iris', 'Harbour', 'mother', true, true, '+971500000012', null), " +
      "($3, $9, $6, 'Cedar', 'Harbour', 'other', false, true, '+971500000013', null), " +
      "($4, $9, $7, 'Sage', 'Quarry', 'self', false, true, '+971500000014', $8)",
    [
      ADULT_CONTACT,
      GUARDIAN_CONTACT,
      NON_GUARDIAN_CONTACT,
      OTHER_CLIENT_CONTACT,
      ADULT_ID,
      CHILD_ID,
      OTHER_CLIENT_ID,
      OTHER_CONTACT_USER_ID,
      IDS.tenantA,
      CONTACT_USER_ID,
    ],
  );

  await seedWording(WORDING_PARTICIPATION, 'participation', 'en', '1.0', 'approved', false);
  await seedWording(WORDING_HOME_VISIT, 'home_visit', 'en', '1.0', 'approved', false);
  await seedWording(WORDING_MINOR, 'minor_participation', 'en', '1.0', 'approved', false);
  await seedWording(WORDING_RETIRED, 'participation', 'en', '0.9', 'approved', true);
  await seedWording(WORDING_ARABIC, 'participation', 'ar', '1.0', 'approved', false);

  const apiUrl = process.env.API_DATABASE_URL;
  if (!apiUrl) throw new Error('API_DATABASE_URL is not set.');
  pool = createPool(apiUrl);
  const storage = localDiskStorage({ dir, signingSecret: Buffer.alloc(32, 7) });
  // The wording bytes have to exist for a link to serve them; the rows above
  // named the keys, this puts something behind them.
  for (const id of [
    WORDING_PARTICIPATION,
    WORDING_HOME_VISIT,
    WORDING_MINOR,
    WORDING_RETIRED,
    WORDING_ARABIC,
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

describe('GET /api/clients/consent-wording', () => {
  it('names the approved version, and writes a read before it signs the link', async () => {
    const before = await auditRows(WORDING_PARTICIPATION, 'read');
    const res = await request(
      ADMIN_AUTH,
      '/api/clients/consent-wording?purpose=participation&locale=en',
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      version: string;
      status: string;
      textUrl: string;
    };
    expect(body.id).toBe(WORDING_PARTICIPATION);
    expect(body.version).toBe('1.0');
    expect(body.status).toBe('approved');
    // The link opens exactly those bytes, through the store rather than a
    // route of this API's own.
    const bytes = await api.request(body.textUrl);
    expect(bytes.status).toBe(200);
    expect(await bytes.text()).toContain(WORDING_PARTICIPATION);
    // Signing is a read (app/api/_middleware/storage/audit.ts): one row, and
    // the text itself is nowhere in it.
    expect(await auditRows(WORDING_PARTICIPATION, 'read')).toBe(before + 1);
    const { rows } = await owner.query<{ old_values: unknown; new_values: unknown }>(
      "select old_values, new_values from audit_log where entity_id = $1 and action = 'read' " +
        'order by occurred_at desc limit 1',
      [WORDING_PARTICIPATION],
    );
    expect(rows[0]?.old_values).toBeNull();
    expect(rows[0]?.new_values).toBeNull();
  });

  it('never offers a retired version, even when it is the only approved one', async () => {
    // 0.9 is retired and 1.0 is not; the route answers 1.0 and nothing points
    // at the retired row.
    const res = await request(
      ADMIN_AUTH,
      '/api/clients/consent-wording?purpose=participation&locale=en',
    );
    const body = (await res.json()) as { id: string };
    expect(body.id).not.toBe(WORDING_RETIRED);
  });

  it('answers in the language asked for, not the console operator’s', async () => {
    const res = await request(
      ADMIN_AUTH,
      '/api/clients/consent-wording?purpose=participation&locale=ar',
    );
    expect(res.status).toBe(200);
    expect((await res.json()) as { id: string }).toMatchObject({ id: WORDING_ARABIC });
  });

  it('says plainly when the practice has published nothing for a purpose', async () => {
    const res = await request(
      ADMIN_AUTH,
      '/api/clients/consent-wording?purpose=research&locale=en',
    );
    expect(res.status).toBe(404);
  });

  it('refuses a purpose or a language that is not one of the practice’s', async () => {
    expect(
      (await request(ADMIN_AUTH, '/api/clients/consent-wording?purpose=nonsense&locale=en')).status,
    ).toBe(400);
    expect(
      (await request(ADMIN_AUTH, '/api/clients/consent-wording?purpose=participation&locale=fr'))
        .status,
    ).toBe(400);
  });
});

describe('the readers policy for consent wording', () => {
  it('lets a client contact read the wording their own consent points at', async () => {
    // Nothing signed yet: the wording is a practice document and the branch
    // above it gives those to staff alone.
    const before = await request(
      CONTACT_AUTH,
      '/api/clients/consent-wording?purpose=participation&locale=en',
    );
    expect(before.status).toBe(404);

    await request(ADMIN_AUTH, `/api/clients/${ADULT_ID}/consents`, {
      method: 'POST',
      body: JSON.stringify({
        purpose: 'participation',
        givenByContactId: ADULT_CONTACT,
        textDocumentId: WORDING_PARTICIPATION,
        method: 'app_signature',
        evidence: { mimeType: 'image/png', bytesBase64: PNG_BASE64 },
      }),
    });

    const after = await request(
      CONTACT_AUTH,
      '/api/clients/consent-wording?purpose=participation&locale=en',
    );
    expect(after.status).toBe(200);
  });

  it('does not open the practice’s wording to a household that signed nothing', async () => {
    // The other household's client is Arabic-speaking and has signed nothing:
    // the English wording the first household signed is not theirs to read.
    const res = await request(
      OTHER_CONTACT_AUTH,
      '/api/clients/consent-wording?purpose=participation&locale=en',
    );
    expect(res.status).toBe(404);
  });
});

describe('POST /api/clients/:id/consents', () => {
  it('files the signature, marks it unchangeable, and points the consent at it', async () => {
    const res = await request(ADMIN_AUTH, `/api/clients/${ADULT_ID}/consents`, {
      method: 'POST',
      body: JSON.stringify({
        purpose: 'home_visit',
        givenByContactId: ADULT_CONTACT,
        textDocumentId: WORDING_HOME_VISIT,
        method: 'app_signature',
        evidence: { mimeType: 'image/png', bytesBase64: PNG_BASE64 },
      }),
    });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };

    const { rows } = await owner.query<{
      signature_document_id: string;
      kind: string;
      is_immutable: boolean;
      mime_type: string;
      storage_key: string;
      retention_until: Date | null;
      sha256: Buffer;
    }>(
      'select c.signature_document_id, d.kind, d.is_immutable, d.mime_type, d.storage_key, ' +
        'd.retention_until, d.sha256 from consent c join document d on d.id = c.signature_document_id ' +
        'where c.id = $1',
      [id],
    );
    const row = rows[0];
    expect(row).toBeDefined();
    expect(row?.kind).toBe('consent_signature');
    expect(row?.is_immutable).toBe(true);
    expect(row?.mime_type).toBe('image/png');
    // A key of ids and nothing else: no name, no record number.
    expect(row?.storage_key).toBe(
      `tenant/${IDS.tenantA}/client/${ADULT_ID}/${row?.signature_document_id}`,
    );
    // Five years from the client's own last activity, which filing this is.
    expect(row?.retention_until).not.toBeNull();
    // The fingerprint is the store's, of the bytes as written.
    expect(row?.sha256.length).toBe(32);
  });

  it('refuses a retired wording, and a superseded one', async () => {
    const retired = await request(ADMIN_AUTH, `/api/clients/${ADULT_ID}/consents`, {
      method: 'POST',
      body: JSON.stringify({
        purpose: 'participation',
        givenByContactId: ADULT_CONTACT,
        textDocumentId: WORDING_RETIRED,
        method: 'app_signature',
        evidence: { mimeType: 'image/png', bytesBase64: PNG_BASE64 },
      }),
    });
    expect(retired.status).toBe(400);
    expect((await retired.json()) as { code: string }).toMatchObject({ code: 'wording_retired' });
  });

  it('refuses a wording of another purpose, and of another language', async () => {
    const wrongPurpose = await request(ADMIN_AUTH, `/api/clients/${ADULT_ID}/consents`, {
      method: 'POST',
      body: JSON.stringify({
        purpose: 'participation',
        givenByContactId: ADULT_CONTACT,
        textDocumentId: WORDING_HOME_VISIT,
        method: 'app_signature',
        evidence: { mimeType: 'image/png', bytesBase64: PNG_BASE64 },
      }),
    });
    expect(wrongPurpose.status).toBe(400);
    expect((await wrongPurpose.json()) as { code: string }).toMatchObject({
      code: 'wording_wrong_purpose',
    });

    // The Arabic wording is the current one for that language, but this client
    // reads English: the wording shown must be the one this person reads.
    const wrongLocale = await request(ADMIN_AUTH, `/api/clients/${ADULT_ID}/consents`, {
      method: 'POST',
      body: JSON.stringify({
        purpose: 'participation',
        givenByContactId: ADULT_CONTACT,
        textDocumentId: WORDING_ARABIC,
        method: 'app_signature',
        evidence: { mimeType: 'image/png', bytesBase64: PNG_BASE64 },
      }),
    });
    expect(wrongLocale.status).toBe(400);
    expect((await wrongLocale.json()) as { code: string }).toMatchObject({
      code: 'wording_wrong_locale',
    });
  });

  it("refuses a child's consent from a contact who is not a legal guardian", async () => {
    const refused = await request(ADMIN_AUTH, `/api/clients/${CHILD_ID}/consents`, {
      method: 'POST',
      body: JSON.stringify({
        purpose: 'minor_participation',
        givenByContactId: NON_GUARDIAN_CONTACT,
        textDocumentId: WORDING_MINOR,
        method: 'app_signature',
        evidence: { mimeType: 'image/png', bytesBase64: PNG_BASE64 },
      }),
    });
    expect(refused.status).toBe(400);
    expect((await refused.json()) as { code: string }).toMatchObject({ code: 'guardian_required' });

    const accepted = await request(ADMIN_AUTH, `/api/clients/${CHILD_ID}/consents`, {
      method: 'POST',
      body: JSON.stringify({
        purpose: 'minor_participation',
        givenByContactId: GUARDIAN_CONTACT,
        textDocumentId: WORDING_MINOR,
        method: 'app_signature',
        evidence: { mimeType: 'image/png', bytesBase64: PNG_BASE64 },
      }),
    });
    expect(accepted.status).toBe(201);
  });

  it('refuses a contact belonging to another client', async () => {
    const res = await request(ADMIN_AUTH, `/api/clients/${ADULT_ID}/consents`, {
      method: 'POST',
      body: JSON.stringify({
        purpose: 'participation',
        givenByContactId: OTHER_CLIENT_CONTACT,
        textDocumentId: WORDING_PARTICIPATION,
        method: 'app_signature',
        evidence: { mimeType: 'image/png', bytesBase64: PNG_BASE64 },
      }),
    });
    expect(res.status).toBe(404);
  });

  it('will not record a consent with nothing attached', async () => {
    const res = await request(ADMIN_AUTH, `/api/clients/${ADULT_ID}/consents`, {
      method: 'POST',
      body: JSON.stringify({
        purpose: 'participation',
        givenByContactId: ADULT_CONTACT,
        textDocumentId: WORDING_PARTICIPATION,
        method: 'app_signature',
      }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { code: string }).toMatchObject({ code: 'evidence_required' });
  });

  it('refuses a page dressed as a signature', async () => {
    const res = await request(ADMIN_AUTH, `/api/clients/${ADULT_ID}/consents`, {
      method: 'POST',
      body: JSON.stringify({
        purpose: 'participation',
        givenByContactId: ADULT_CONTACT,
        textDocumentId: WORDING_PARTICIPATION,
        method: 'app_signature',
        evidence: { mimeType: 'image/png', bytesBase64: HTML_AS_PNG },
      }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { code: string }).toMatchObject({
      code: 'bytes_do_not_match_type',
    });
  });

  it('takes a photographed paper form, and refuses a PDF called a signature', async () => {
    const scan = await request(ADMIN_AUTH, `/api/clients/${CHILD_ID}/consents`, {
      method: 'POST',
      body: JSON.stringify({
        purpose: 'home_visit',
        givenByContactId: GUARDIAN_CONTACT,
        textDocumentId: WORDING_HOME_VISIT,
        method: 'paper_scan',
        evidence: { mimeType: 'application/pdf', bytesBase64: PDF_BASE64 },
      }),
    });
    expect(scan.status).toBe(201);

    const wrong = await request(ADMIN_AUTH, `/api/clients/${ADULT_ID}/consents`, {
      method: 'POST',
      body: JSON.stringify({
        purpose: 'participation',
        givenByContactId: ADULT_CONTACT,
        textDocumentId: WORDING_PARTICIPATION,
        method: 'app_signature',
        evidence: { mimeType: 'application/pdf', bytesBase64: PDF_BASE64 },
      }),
    });
    expect(wrong.status).toBe(400);
    expect((await wrong.json()) as { code: string }).toMatchObject({
      code: 'evidence_not_accepted',
    });
  });

  it('allows a verbal re-confirmation only for a home visit, and files nothing for it', async () => {
    const wrongPurpose = await request(ADMIN_AUTH, `/api/clients/${ADULT_ID}/consents`, {
      method: 'POST',
      body: JSON.stringify({
        purpose: 'participation',
        givenByContactId: ADULT_CONTACT,
        textDocumentId: WORDING_PARTICIPATION,
        method: 'verbal_witnessed',
      }),
    });
    expect(wrongPurpose.status).toBe(400);

    const res = await request(ADMIN_AUTH, `/api/clients/${ADULT_ID}/consents`, {
      method: 'POST',
      body: JSON.stringify({
        purpose: 'home_visit',
        givenByContactId: ADULT_CONTACT,
        textDocumentId: WORDING_HOME_VISIT,
        method: 'verbal_witnessed',
      }),
    });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    const { rows } = await owner.query<{ signature_document_id: string | null }>(
      'select signature_document_id from consent where id = $1',
      [id],
    );
    expect(rows[0]?.signature_document_id).toBeNull();
  });

  it('supersedes the consent it replaces, so a purpose has one live answer', async () => {
    const { rows } = await owner.query<{ n: string }>(
      "select count(*)::text as n from consent where client_id = $1 and purpose = 'home_visit' " +
        "and status = 'active'",
      [ADULT_ID],
    );
    expect(Number(rows[0]?.n)).toBe(1);
  });
});

describe('the evidence, once filed', () => {
  it('cannot be changed or deleted, by anyone short of an erasure', async () => {
    const { rows } = await owner.query<{ id: string }>(
      "select id from document where kind = 'consent_signature' limit 1",
    );
    const documentId = rows[0]?.id;
    expect(documentId).toBeDefined();

    // Migration 903's guard stands aside for the owner's own maintenance, so
    // the check has to be made with a role stamped, the way a request is. Each
    // attempt gets its own transaction: the first refusal aborts the one it is
    // in, and a second statement there would fail for that reason rather than
    // for the rule under test.
    for (const statement of [
      "update document set kind = 'referral' where id = $1",
      'delete from document where id = $1',
    ]) {
      await owner.query('begin');
      try {
        await owner.query("select set_config('app.actor_roles', 'owner', true)");
        await expect(owner.query(statement, [documentId])).rejects.toThrow(/immutable/);
      } finally {
        await owner.query('rollback');
      }
    }
  });
});

describe('the Documents tab', () => {
  it('files a document, lists it with who filed it and how long it is kept', async () => {
    const filed = await request(ADMIN_AUTH, `/api/clients/${ADULT_ID}/documents`, {
      method: 'POST',
      body: JSON.stringify({
        kind: 'referral',
        file: { mimeType: 'application/pdf', bytesBase64: PDF_BASE64 },
      }),
    });
    expect(filed.status).toBe(201);

    const list = await request(ADMIN_AUTH, `/api/clients/${ADULT_ID}/documents`);
    expect(list.status).toBe(200);
    const body = (await list.json()) as {
      documents: { kind: string; uploadedByName: string | null; retentionUntil: string | null }[];
    };
    const referral = body.documents.find((document) => document.kind === 'referral');
    expect(referral?.uploadedByName).toBe('Synthetic Admin');
    expect(referral?.retentionUntil).not.toBeNull();
    // The consent evidence is listed here too: it is part of what the practice
    // holds about this client.
    expect(body.documents.some((document) => document.kind === 'consent_signature')).toBe(true);
  });

  it('refuses an identity document by name, and says which reason it is', async () => {
    const res = await request(ADMIN_AUTH, `/api/clients/${ADULT_ID}/documents`, {
      method: 'POST',
      body: JSON.stringify({
        kind: 'emirates_id',
        file: { mimeType: 'image/png', bytesBase64: PNG_BASE64 },
      }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { code: string }).toMatchObject({ code: 'identity_document' });
  });

  it('writes a read before it signs a link, and hands back a link that works', async () => {
    const list = await request(ADMIN_AUTH, `/api/clients/${ADULT_ID}/documents`);
    const { documents } = (await list.json()) as { documents: { id: string; kind: string }[] };
    const target = documents.find((document) => document.kind === 'referral');
    expect(target).toBeDefined();
    const documentId = target?.id ?? '';

    const before = await auditRows(documentId, 'read');
    const link = await request(ADMIN_AUTH, `/api/clients/${ADULT_ID}/documents/${documentId}/link`);
    expect(link.status).toBe(200);
    const { url, expiresInSeconds } = (await link.json()) as {
      url: string;
      expiresInSeconds: number;
    };
    expect(expiresInSeconds).toBeLessThanOrEqual(3600);
    expect(await auditRows(documentId, 'read')).toBe(before + 1);
    const bytes = await api.request(url);
    expect(bytes.status).toBe(200);
  });

  it('will not let one client’s path name another client’s document', async () => {
    const list = await request(ADMIN_AUTH, `/api/clients/${ADULT_ID}/documents`);
    const { documents } = (await list.json()) as { documents: { id: string }[] };
    const documentId = documents[0]?.id ?? '';
    const res = await request(ADMIN_AUTH, `/api/clients/${CHILD_ID}/documents/${documentId}/link`);
    expect(res.status).toBe(404);
  });
});

describe('withdrawing a consent', () => {
  it('will not go without a reason, and takes effect at once when it has one', async () => {
    const recorded = await request(ADMIN_AUTH, `/api/clients/${ADULT_ID}/consents`, {
      method: 'POST',
      body: JSON.stringify({
        purpose: 'photo_video',
        givenByContactId: ADULT_CONTACT,
        textDocumentId: WORDING_PARTICIPATION,
        method: 'app_signature',
        evidence: { mimeType: 'image/png', bytesBase64: PNG_BASE64 },
      }),
    });
    // photo_video has no wording of its own in this fixture, so the wording
    // check refuses it before anything else does: the purpose has to match.
    expect(recorded.status).toBe(400);
    expect((await recorded.json()) as { code: string }).toMatchObject({
      code: 'wording_wrong_purpose',
    });
  });

  it('removes the setup photographs when photo_video is withdrawn', async () => {
    await seedWording(
      '00000000-0000-4000-8000-000000000126',
      'photo_video',
      'en',
      '1.0',
      'approved',
      false,
    );
    const recorded = await request(ADMIN_AUTH, `/api/clients/${ADULT_ID}/consents`, {
      method: 'POST',
      body: JSON.stringify({
        purpose: 'photo_video',
        givenByContactId: ADULT_CONTACT,
        textDocumentId: '00000000-0000-4000-8000-000000000126',
        method: 'app_signature',
        evidence: { mimeType: 'image/png', bytesBase64: PNG_BASE64 },
      }),
    });
    expect(recorded.status).toBe(201);
    const { id } = (await recorded.json()) as { id: string };

    // A setup photograph, filed the way session capture will file one.
    const photoId = '00000000-0000-4000-8000-000000000131';
    const photoKey = `tenant/${IDS.tenantA}/client/${ADULT_ID}/${photoId}`;
    const storage = localDiskStorage({ dir, signingSecret: Buffer.alloc(32, 7) });
    await storage.put(photoKey, new Uint8Array([1, 2, 3]), 'image/png');
    await owner.query(
      'insert into document (id, tenant_id, client_id, kind, storage_key, mime_type, sha256) ' +
        "values ($1, $2, $3, 'setup_photo', $4, 'image/png', sha256(($5)::bytea))",
      [photoId, IDS.tenantA, ADULT_ID, photoKey, 'photo'],
    );
    expect(await storage.exists(photoKey)).toBe(true);

    const withoutReason = await request(
      ADMIN_AUTH,
      `/api/clients/${ADULT_ID}/consents/${id}/withdraw`,
      { method: 'POST', body: JSON.stringify({}) },
    );
    expect(withoutReason.status).toBe(400);
    expect(await storage.exists(photoKey)).toBe(true);

    const withdrawn = await request(
      ADMIN_AUTH,
      `/api/clients/${ADULT_ID}/consents/${id}/withdraw`,
      {
        method: 'POST',
        headers: { 'x-reason': 'The household asked us to stop taking photographs.' },
        body: JSON.stringify({}),
      },
    );
    expect(withdrawn.status).toBe(200);
    // The answer says what it did, so the console can say it too.
    expect((await withdrawn.json()) as { photographsRemoved: number }).toMatchObject({
      photographsRemoved: 1,
      photographsStillOnFile: 0,
    });
    // The permission is gone and so are the bytes, with the read recorded.
    expect(await storage.exists(photoKey)).toBe(false);
    expect(await auditRows(photoId, 'read')).toBe(1);
  });
});

describe('a client enrolled, signed and activated', () => {
  it('goes lead to active once every consent is recorded on screen', async () => {
    // The whole path the task brief asks for, end to end: a lead with a date
    // of birth and a verified location, every consent `requiredConsents` names
    // recorded through the route with a signature filed, and then the status
    // change that could not have happened before this pull request.
    const clientId = '00000000-0000-4000-8000-000000000141';
    const contactId = '00000000-0000-4000-8000-000000000142';
    const locationId = '00000000-0000-4000-8000-000000000143';
    await owner.query(
      'insert into client (id, tenant_id, mrn, given_name, family_name, date_of_birth, ' +
        "preferred_locale, status, created_by) values ($1, $2, 'MW-000141', 'Rowan', 'Valley', " +
        "'1994-02-02', 'en', 'lead', $3)",
      [clientId, IDS.tenantA, IDS.ownerA],
    );
    await owner.query(
      'insert into contact (id, tenant_id, client_id, given_name, family_name, relationship, ' +
        "is_legal_guardian, can_consent, phone) values ($1, $2, $3, 'Rowan', 'Valley', 'self', " +
        "false, true, '+971500000031')",
      [contactId, IDS.tenantA, clientId],
    );
    await owner.query(
      'insert into location (id, tenant_id, owner_type, owner_id, label, emirate, ' +
        "entrance_point, created_by) values ($1, $2, 'client', $3, 'home', 'DXB', " +
        "extensions.st_geogfromtext('SRID=4326;POINT(55.27 25.20)'), $4)",
      [locationId, IDS.tenantA, clientId, IDS.ownerA],
    );

    // An adult at home needs participation and home_visit, and no guardian.
    const tooSoon = await request(ADMIN_AUTH, `/api/clients/${clientId}/status`, {
      method: 'POST',
      body: JSON.stringify({ to: 'active' }),
    });
    expect(tooSoon.status).toBe(400);
    expect((await tooSoon.json()) as { missing: string[] }).toMatchObject({
      missing: ['consent:home_visit', 'consent:participation'],
    });

    for (const [purpose, wording] of [
      ['participation', WORDING_PARTICIPATION],
      ['home_visit', WORDING_HOME_VISIT],
    ] as const) {
      const recorded = await request(ADMIN_AUTH, `/api/clients/${clientId}/consents`, {
        method: 'POST',
        body: JSON.stringify({
          purpose,
          givenByContactId: contactId,
          textDocumentId: wording,
          method: 'app_signature',
          evidence: { mimeType: 'image/png', bytesBase64: PNG_BASE64 },
        }),
      });
      expect(recorded.status).toBe(201);
    }

    const activated = await request(ADMIN_AUTH, `/api/clients/${clientId}/status`, {
      method: 'POST',
      body: JSON.stringify({ to: 'active' }),
    });
    expect(activated.status).toBe(200);
    const { rows } = await owner.query<{ status: string }>(
      'select status from client where id = $1',
      [clientId],
    );
    expect(rows[0]?.status).toBe('active');
  });
});
