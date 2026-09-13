import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SignJWT } from 'jose';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from '../../../app/api/_middleware/db';
import { localDiskStorage } from '../../../app/api/_middleware/storage';
import { createTokenVerifier } from '../../../app/api/_middleware/token-verifier';
import { ASSESSMENT_FILE_LIMIT_BYTES, createApi } from '../../../app/api/create-api';
import { sweepErasureFiles } from '../../../app/api/clients/erasure-file-sweep';
import { SESSION_EXPORT_LIMIT_BYTES } from '../../../app/api/sessions/schema';
import {
  IDS,
  freshDatabase,
  seedClient,
  seedCredential,
  seedLocation,
  seedPractitioner,
  seedServiceType,
  seedTenant,
  seedUser,
  setAuditContext,
} from '../../db/helpers';
import { seedAppointment, seedConsent, seedConsentDocument } from './helpers';

/**
 * The export the practice's own software wrote, attached to the visit
 * (migration 307, app/api/sessions/export.ts).
 *
 * The practice runs its brain mapping and neurofeedback on professional
 * software on a laptop the practitioner carries. This door is how that
 * software's exported result reaches the record, and it is the assessment
 * stream's own file door (app/api/assessments/file.ts) under a second name:
 * the same three kinds, the same signature check, the same digest declared by
 * the browser and recomputed here, the same audit row.
 *
 * Everything is synthetic and inside the reserved ranges
 * (.claude/rules/testing.md): ids of the shape 00000000-0000-4000-8000-*,
 * family names from db/seed/names.ts, never a real person.
 *
 * **The recordings are built here rather than borrowed.** The assessment
 * stream has fixtures of its own for these formats, but tests/assessment is
 * that stream's and no test in this repository reaches across into another
 * stream's test tree. What the door actually reads is the first eight bytes,
 * so what is needed is eight bytes and a comment saying which eight.
 */

const SECRET = 'test-secret-that-unlocks-nothing-0123456789';
const ISSUER = 'http://localhost:54321/auth/v1';
const KEY = new TextEncoder().encode(SECRET);

const SERVICE_TYPE = '00000000-0000-4000-8000-0000000000f1';
const CONSENT_DOCUMENT = '00000000-0000-4000-8000-000000003001';

/** A one-page PDF's worth of nothing. What matters is that it starts as one. */
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x25]);
/**
 * The eight bytes the European Data Format fixes at the front of every file —
 * an ASCII zero followed by seven spaces (domain/shared/fileSignature.ts) —
 * and then padding. Nothing past byte eight is read by anything here, and the
 * eighty-byte field that follows in a real recording is the person's own
 * identity, which this repository never reaches and this fixture leaves empty.
 */
const EDF = new Uint8Array(64).fill(0x20);
EDF[0] = 0x30;
/**
 * A recording in the amplifier software's own format: bytes that are none of
 * the four types the platform knows and do not begin as markup, chosen under
 * the `.eeg` extension. That is exactly what `classifyAssessmentFile` accepts
 * for this kind, and why it accepts it on those terms is argued in
 * domain/assessment/fileType.ts.
 */
const NATIVE = new Uint8Array([0x4e, 0x52, 0x43, 0x00, 0x01, 0x00, 0x00, 0x00, 0x7f, 0x80]);
/** A PNG: a real file, and a fourth kind this door does not take. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const digestOf = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** Family names from db/seed/names.ts, one per scenario. */
const FAMILY_NAMES = ['Bay', 'Cliff', 'Creek', 'Dune', 'Harbour', 'Lagoon', 'Meadow', 'Orchard'];

let owner: pg.Client;
let pool: ReturnType<typeof createPool>;
let api: ReturnType<typeof createApi>;
let storage: ReturnType<typeof localDiskStorage>;
let dir: string;
let today: string;

function id(scenario: string, slot: number): string {
  return `00000000-0000-4000-8000-000000${scenario}${String(slot).padStart(4, '0')}`;
}

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

type Visit = {
  scenario: string;
  authSub: string;
  practitionerId: string;
  clientId: string;
  contactId: string;
  sessionId: string;
};

/**
 * A credentialed practitioner, a consenting adult client, a booked visit
 * today, and the check-in that opens the session — the same fixture
 * tests/session/db/run.test.ts builds, because the door being tested here
 * only exists on a visit that has been opened through it.
 */
async function seedVisit(scenario: string): Promise<Visit> {
  const userId = id(scenario, 1);
  const authSub = id(scenario, 2);
  const practitionerId = id(scenario, 3);
  const clientId = id(scenario, 4);
  const contactId = id(scenario, 5);
  const locationId = id(scenario, 6);
  const appointmentId = id(scenario, 7);

  await seedUser(owner, {
    id: userId,
    tenantId: IDS.tenantA,
    authId: authSub,
    displayName: 'Synthetic Practitioner',
    roles: ['practitioner'],
  });
  await seedPractitioner(owner, IDS.tenantA, practitionerId, userId);
  await seedCredential(owner, {
    tenantId: IDS.tenantA,
    practitionerId,
    serviceTypeId: SERVICE_TYPE,
    certification: 'bcia_bcn',
    validFrom: '2020-01-01',
    validTo: null,
    canExecuteSession: true,
  });

  await seedClient(
    owner,
    IDS.tenantA,
    clientId,
    IDS.ownerA,
    FAMILY_NAMES[Number(scenario) - 1] ?? 'Ridge',
  );
  await owner.query("update client set date_of_birth = '1990-01-01' where id = $1", [clientId]);
  await owner.query(
    'insert into contact (id, tenant_id, client_id, relationship, can_consent) ' +
      "values ($1, $2, $3, 'mother', true)",
    [contactId, IDS.tenantA, clientId],
  );
  const purposes = ['participation', 'home_visit', 'health_data'] as const;
  for (const [index, purpose] of purposes.entries()) {
    await seedConsent(owner, {
      id: id(scenario, 10 + index),
      tenantId: IDS.tenantA,
      clientId,
      givenByContactId: contactId,
      purpose,
      textDocumentId: CONSENT_DOCUMENT,
    });
  }

  await seedLocation(owner, IDS.tenantA, locationId, clientId, IDS.ownerA);
  await seedAppointment(owner, {
    id: appointmentId,
    tenantId: IDS.tenantA,
    clientId,
    practitionerId,
    serviceTypeId: SERVICE_TYPE,
    locationId,
    windowStart: `${today}T08:00:00+04:00`,
    status: 'confirmed',
  });

  const sessionId = id(scenario, 20);
  const res = await api.request(`/api/sessions/${sessionId}/events`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${await mint(authSub)}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      clientId,
      point: null,
      events: [
        {
          id: id(scenario, 21),
          seq: 1,
          kind: 'session_started',
          deviceAt: new Date().toISOString(),
          payload: { serviceTypeId: SERVICE_TYPE, deliveryMode: 'home', locationId: null },
        },
      ],
    }),
  });
  expect(res.status, `check-in for scenario ${scenario}`).toBe(201);

  return { scenario, authSub, practitionerId, clientId, contactId, sessionId };
}

/**
 * Closes a visit the way the close route does, as the owner: the fixture for
 * everything that has to happen to a record that is already frozen. Only
 * `closed_at` and the status, because nothing below reads the projection —
 * the stamp trigger (302) would fill the first in on its own, and it is
 * written anyway so the fixture says what it means.
 */
async function closeVisit(sessionId: string): Promise<void> {
  await owner.query("update session set status = 'completed', closed_at = now() where id = $1", [
    sessionId,
  ]);
}

async function putExport(
  sessionId: string,
  authSub: string,
  bytes: Uint8Array,
  options: { digest?: string; type?: string; extension?: string } = {},
): Promise<Response> {
  const query = new URLSearchParams();
  if (options.extension !== undefined) query.set('extension', options.extension);
  const suffix = query.toString() === '' ? '' : `?${query.toString()}`;
  return api.request(`/api/sessions/${sessionId}/export${suffix}`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${await mint(authSub)}`,
      'content-type': options.type ?? 'application/pdf',
      'x-sha256': options.digest ?? digestOf(bytes),
    },
    // `BodyInit` is typed from the DOM lib, which does not know a Uint8Array
    // over a plain ArrayBuffer is one. It is, and the runtime takes it.
    body: bytes as unknown as BodyInit,
  });
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mcwellness-session-export-'));
  owner = await freshDatabase();
  await seedTenant(owner, IDS.tenantA, IDS.ownerA, 'Synthetic Studio A');
  await seedTenant(owner, IDS.tenantB, IDS.ownerB, 'Synthetic Studio B');
  await seedServiceType(owner, IDS.tenantA, SERVICE_TYPE, 'nf-session');
  await seedConsentDocument(owner, IDS.tenantA, CONSENT_DOCUMENT);
  const dates = await owner.query<{ today: string }>(
    "select (now() at time zone 'Asia/Dubai')::date::text as today",
  );
  today = dates.rows[0]!.today;

  const apiUrl = process.env.API_DATABASE_URL;
  if (!apiUrl) throw new Error('API_DATABASE_URL is not set.');
  pool = createPool(apiUrl);
  storage = localDiskStorage({ dir, signingSecret: Buffer.alloc(32, 7) });
  api = createApi({
    pool,
    verifier: createTokenVerifier({ issuer: ISSUER, secret: SECRET }),
    storage,
  });
});

afterAll(async () => {
  await pool?.end();
  await owner?.end();
  await rm(dir, { recursive: true, force: true });
});

describe('the column the export hangs on', () => {
  it('carries the export from the practice software, as the setup photo did before it', async () => {
    const { rows } = await owner.query<{ column_name: string; is_nullable: string }>(
      'select column_name, is_nullable from information_schema.columns ' +
        "where table_name = 'session' and column_name = 'export_document_id'",
    );
    expect(rows).toHaveLength(1);
    // Never required: a practitioner standing in someone's home must always be
    // able to close the visit.
    expect(rows[0]?.is_nullable).toBe('YES');
  });

  it('tells the browser the same cap the server enforces', () => {
    // Two constants because one module is the server's and pulls in Node while
    // the other is read by the practitioner's screen. They must not drift.
    expect(SESSION_EXPORT_LIMIT_BYTES).toBe(ASSESSMENT_FILE_LIMIT_BYTES);
  });
});

describe('filing the export', () => {
  it('takes the software’s own PDF report', async () => {
    const visit = await seedVisit('01');
    const res = await putExport(visit.sessionId, visit.authSub, PDF);
    expect(res.status).toBe(201);
    const { documentId } = (await res.json()) as { documentId: string };

    const { rows } = await owner.query<{
      kind: string;
      mime_type: string;
      storage_key: string;
      sha256: Buffer;
      is_immutable: boolean;
      client_id: string;
      retention_until: Date | null;
    }>(
      'select kind, mime_type, storage_key, sha256, is_immutable, client_id, retention_until ' +
        'from document where id = $1',
      [documentId],
    );
    expect(rows[0]?.kind).toBe('session_export');
    expect(rows[0]?.mime_type).toBe('application/pdf');
    expect(rows[0]?.client_id).toBe(visit.clientId);
    expect(rows[0]?.sha256.toString('hex')).toBe(digestOf(PDF));
    // Evidence, like the setup photograph before it: migration 903 neither
    // changes nor deletes it outside an erasure.
    expect(rows[0]?.is_immutable).toBe(true);
    expect(rows[0]?.retention_until).not.toBeNull();
    // Ids and nothing else, from the seam's own helper (docs/SEAMS.md): the
    // same shape the setup photograph's key had.
    expect(rows[0]?.storage_key).toBe(
      `tenant/${IDS.tenantA}/client/${visit.clientId}/${documentId}`,
    );
    expect(await storage.exists(rows[0]!.storage_key)).toBe(true);

    const session = await owner.query<{ export_document_id: string | null }>(
      'select export_document_id from session where id = $1',
      [visit.sessionId],
    );
    expect(session.rows[0]?.export_document_id).toBe(documentId);

    const trail = await owner.query<{ n: string }>(
      "select count(*)::text as n from audit_log where action = 'session.export_filed' " +
        'and entity_id = $1',
      [visit.sessionId],
    );
    expect(trail.rows[0]?.n).toBe('1');
  });

  it('takes an EDF recording, by its own signature', async () => {
    const visit = await seedVisit('02');
    const res = await putExport(visit.sessionId, visit.authSub, EDF, {
      type: 'application/octet-stream',
      extension: 'edf',
    });
    expect(res.status).toBe(201);
    const { documentId } = (await res.json()) as { documentId: string };
    const { rows } = await owner.query<{ mime_type: string }>(
      'select mime_type from document where id = $1',
      [documentId],
    );
    expect(rows[0]?.mime_type).toBe('application/octet-stream');
  });

  it('takes the amplifier software’s own recording, by the extension it was chosen under', async () => {
    const visit = await seedVisit('03');
    const res = await putExport(visit.sessionId, visit.authSub, NATIVE, {
      type: 'application/octet-stream',
      extension: 'eeg',
    });
    expect(res.status).toBe(201);
  });

  it('hands the same document back when the same file is sent twice', async () => {
    const visit = await seedVisit('04');
    const first = await putExport(visit.sessionId, visit.authSub, PDF);
    expect(first.status).toBe(201);
    const again = await putExport(visit.sessionId, visit.authSub, PDF);
    expect(again.status).toBe(200);
    expect((await again.json()) as { documentId: string }).toEqual(
      (await first.json()) as { documentId: string },
    );
    const { rows } = await owner.query<{ n: string }>(
      "select count(*)::text as n from document where kind = 'session_export' and client_id = $1",
      [visit.clientId],
    );
    expect(rows[0]?.n).toBe('1');
  });
});

describe('what the door refuses', () => {
  it('refuses a fourth kind of file outright', async () => {
    const visit = await seedVisit('05');
    const res = await putExport(visit.sessionId, visit.authSub, PNG, { type: 'image/png' });
    expect(res.status).toBe(415);
    const { rows } = await owner.query<{ n: string }>(
      "select count(*)::text as n from document where kind = 'session_export' and client_id = $1",
      [visit.clientId],
    );
    expect(rows[0]?.n).toBe('0');
  });

  it('refuses bytes that contradict the type they were declared as', async () => {
    const visit = await seedVisit('06');
    // An EDF recording called a PDF. The file itself is fine; the word for it
    // is not, and the bytes are what decide (domain/assessment/fileType.ts).
    const res = await putExport(visit.sessionId, visit.authSub, EDF, { type: 'application/pdf' });
    expect(res.status).toBe(415);
    expect(((await res.json()) as { code?: string }).code).toBe('not_a_pdf');
    const trail = await owner.query<{ reason: string | null }>(
      "select reason from audit_log where action = 'refused' and entity_id = $1",
      [visit.sessionId],
    );
    expect(trail.rows.map((row) => row.reason)).toContain('not_a_pdf');
  });

  it('refuses a digest that does not match the bytes that arrived', async () => {
    const visit = await seedVisit('07');
    const res = await putExport(visit.sessionId, visit.authSub, PDF, { digest: 'f'.repeat(64) });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code?: string }).code).toBe('digest_mismatch');
  });

  it('refuses a visit that has already been checked out', async () => {
    // The boundary the whole round's shape rests on: migration 960 took away
    // the one change a closed visit admitted, so an export goes on before
    // check-out or nowhere. Pinned by a test rather than by reading the two
    // `closed_at is null` predicates that enforce it.
    const visit = await seedVisit('12');
    await closeVisit(visit.sessionId);

    const res = await putExport(visit.sessionId, visit.authSub, PDF);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code?: string }).code).toBe('session_closed');

    const session = await owner.query<{ export_document_id: string | null }>(
      'select export_document_id from session where id = $1',
      [visit.sessionId],
    );
    expect(session.rows[0]?.export_document_id).toBeNull();
    const documents = await owner.query<{ n: string }>(
      "select count(*)::text as n from document where kind = 'session_export' and client_id = $1",
      [visit.clientId],
    );
    expect(documents.rows[0]?.n).toBe('0');
  });

  it('refuses a second, different file, and has looked before it says why', async () => {
    const visit = await seedVisit('13');
    expect((await putExport(visit.sessionId, visit.authSub, PDF)).status).toBe(201);

    const second = await putExport(visit.sessionId, visit.authSub, EDF, {
      type: 'application/octet-stream',
      extension: 'edf',
    });
    expect(second.status).toBe(409);
    // `export_already_filed` asserts a fact about the record, so the route
    // reads the row back before it says it (app/api/sessions/export.ts).
    expect(((await second.json()) as { code?: string }).code).toBe('export_already_filed');
    const { rows } = await owner.query<{ n: string }>(
      "select count(*)::text as n from document where kind = 'session_export' and client_id = $1",
      [visit.clientId],
    );
    expect(rows[0]?.n).toBe('1');
  });

  it('refuses a visit that is not this practitioner’s', async () => {
    const mine = await seedVisit('08');
    const theirs = await seedVisit('09');
    const res = await putExport(theirs.sessionId, mine.authSub, PDF);
    expect(res.status).toBe(404);
    const { rows } = await owner.query<{ export_document_id: string | null }>(
      'select export_document_id from session where id = $1',
      [theirs.sessionId],
    );
    expect(rows[0]?.export_document_id).toBeNull();
  });
});

/**
 * The act itself, as the assessment stream's own erasure test runs it
 * (tests/assessment/db/erasure.test.ts): the request row, then
 * `app.erase_client` as the owner.
 *
 * One transaction, and committed rather than rolled back, because the sweep
 * afterwards reads the worklist the act writes. The settings are
 * transaction-local — that is what `set_config(..., true)` means — so the act
 * has to run inside one to see the role it demands.
 */
async function erase(clientId: string, requestId: string): Promise<Record<string, unknown>> {
  await owner.query(
    'insert into erasure_request (id, tenant_id, client_id, reason) values ($1, $2, $3, $4)',
    [requestId, IDS.tenantA, clientId, 'Household asked to be forgotten'],
  );
  await owner.query('begin');
  await setAuditContext(owner, IDS.ownerA);
  await owner.query(
    "select set_config('app.tenant_id', $1, true), set_config('app.actor_roles', $2, true)",
    [IDS.tenantA, 'owner'],
  );
  const summary = await owner.query<{ erase_client: Record<string, unknown> }>(
    'select app.erase_client($1, $2) as erase_client',
    [clientId, requestId],
  );
  await owner.query('commit');
  return summary.rows[0]!.erase_client;
}

/** What every erasure of an export has to be true of, whatever state the visit is in. */
async function expectSwept(
  visit: Visit,
  documentId: string,
  summary: Record<string, unknown>,
): Promise<void> {
  const key = `tenant/${IDS.tenantA}/client/${visit.clientId}/${documentId}`;

  // The visit no longer names it. Nothing in app.erase_client mentions this
  // column by name — that function is migration 954, which sorts after this
  // stream's whole range and cannot be taught one — so what unlinks it is the
  // foreign key's own `on delete set null` (migration 307).
  const session = await owner.query<{ export_document_id: string | null }>(
    'select export_document_id from session where id = $1',
    [visit.sessionId],
  );
  expect(session.rows[0]?.export_document_id).toBeNull();

  // The row is gone, and the key is on the list the caller then deletes.
  const document = await owner.query<{ n: string }>(
    'select count(*)::text as n from document where id = $1',
    [documentId],
  );
  expect(document.rows[0]?.n).toBe('0');
  const keys = summary.storage_keys_to_delete as { id: string; storageKey: string }[];
  expect(keys.map((entry) => entry.storageKey)).toContain(key);

  // And the bytes go with it. The sweep is the second attempt at removing them
  // (app/api/clients/erasure-file-sweep.ts); running it here proves the export
  // is on the worklist and that the store gives it up.
  await sweepErasureFiles(owner, storage);
  expect(await storage.exists(key)).toBe(false);
}

describe('erasure', () => {
  it('is swept by erasure like every other client document', async () => {
    const visit = await seedVisit('11');
    const filed = await putExport(visit.sessionId, visit.authSub, PDF);
    expect(filed.status).toBe(201);
    const { documentId } = (await filed.json()) as { documentId: string };
    expect(
      await storage.exists(`tenant/${IDS.tenantA}/client/${visit.clientId}/${documentId}`),
    ).toBe(true);

    await expectSwept(visit, documentId, await erase(visit.clientId, id('11', 90)));
  });

  it('is swept from a visit that has been closed, which is every visit in the end', async () => {
    // The realistic case, and the one that actually exercises the exemption
    // the `on delete set null` depends on. A closed session admits no change
    // at all (migration 960) — so the referential action that nulls this
    // column has to pass a trigger that refuses every update to a frozen row,
    // and it does so only because 960 stands aside for a transaction named in
    // app.erasure_active. A household asks to be forgotten years after their
    // last visit, so this is the shape the compliance path really has, and
    // reading the guard is the weakest evidence there is that it holds.
    const visit = await seedVisit('14');
    const filed = await putExport(visit.sessionId, visit.authSub, PDF);
    expect(filed.status).toBe(201);
    const { documentId } = (await filed.json()) as { documentId: string };
    await closeVisit(visit.sessionId);

    // Frozen, and provably so before the erasure runs: an ordinary update is
    // refused, which is what makes the erasure's success below mean something.
    await expect(
      owner.query('update session set observation_flag = true where id = $1', [visit.sessionId]),
    ).rejects.toThrow(/closed and cannot be changed/);

    await expectSwept(visit, documentId, await erase(visit.clientId, id('14', 90)));

    // And the visit is still there, closed, as the erasure letter promises: it
    // is the file that goes, not the fact that a visit happened.
    const session = await owner.query<{ status: string; closed_at: Date | null }>(
      'select status, closed_at from session where id = $1',
      [visit.sessionId],
    );
    expect(session.rows[0]?.status).toBe('completed');
    expect(session.rows[0]?.closed_at).not.toBeNull();
  });
});
