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
import { createApi } from '../../../app/api/create-api';
import type { Comparison } from '@domain/assessment';
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
} from '../../db/helpers';
import {
  assessmentId,
  brainMapPayload,
  seedAppointment,
  seedConsent,
  seedConsentDocument,
  seedContact,
} from './helpers';

/**
 * The measurement's routes, through the API the server actually builds
 * (docs/SPEC/assessment.md sections 7, 8 and 11).
 *
 * The store is the real local implementation writing to a temporary folder, so
 * the file door is exercised end to end and **nothing here reaches a vendor**
 * (docs/SEAMS.md).
 *
 * Everything is synthetic and inside the reserved ranges
 * (.claude/rules/testing.md). No real person, instrument or software is named.
 */

const SECRET = 'test-secret-that-unlocks-nothing-0123456789';
const ISSUER = 'http://localhost:54321/auth/v1';
const KEY = new TextEncoder().encode(SECRET);

const BRAIN_MAP_SERVICE = assessmentId('10', 1);
const WORDING = assessmentId('10', 2);

const OWNER_AUTH = assessmentId('11', 1);
const ADMIN_USER = assessmentId('12', 1);
const ADMIN_AUTH = assessmentId('12', 2);
const FINANCE_USER = assessmentId('13', 1);
const FINANCE_AUTH = assessmentId('13', 2);
const CONTACT_USER = assessmentId('14', 1);
const CONTACT_AUTH = assessmentId('14', 2);

/** A one-page PDF's worth of nothing. What matters is that it starts as one. */
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x25]);
const OTHER_PDF = new Uint8Array([...PDF, 0x0a]);
const digestOf = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

let owner: pg.Client;
let pool: ReturnType<typeof createPool>;
let api: ReturnType<typeof createApi>;
let today: string;
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

async function get(path: string, sub: string): Promise<Response> {
  return api.request(path, { headers: { authorization: `Bearer ${await mint(sub)}` } });
}

async function post(path: string, sub: string, body: unknown): Promise<Response> {
  return api.request(path, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${await mint(sub)}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

async function putFile(
  assessment: string,
  sub: string,
  bytes: Uint8Array,
  options: { digest?: string; type?: string; role?: string } = {},
): Promise<Response> {
  const role = options.role === undefined ? '' : `?role=${options.role}`;
  return api.request(`/api/assessments/${assessment}/file${role}`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${await mint(sub)}`,
      'content-type': options.type ?? 'application/pdf',
      'x-sha256': options.digest ?? digestOf(bytes),
    },
    // `BodyInit` is typed from the DOM lib, which does not know a Uint8Array
    // over a plain ArrayBuffer is one. It is, and the runtime takes it.
    body: bytes as unknown as BodyInit,
  });
}

type Household = {
  scenario: string;
  authSub: string;
  practitionerUserId: string;
  practitionerId: string;
  clientId: string;
};

/**
 * A credentialed practitioner, a consenting household, and a visit today so
 * the client is on that practitioner's schedule.
 */
async function seedHousehold(
  scenario: string,
  options: {
    consents?: readonly ('participation' | 'minor_participation' | 'home_visit')[];
    minor?: boolean;
    credentialTo?: string | null;
    familyName?: string;
  } = {},
): Promise<Household> {
  const userId = assessmentId(scenario, 1);
  const authSub = assessmentId(scenario, 2);
  const practitionerId = assessmentId(scenario, 3);
  const clientId = assessmentId(scenario, 4);
  const contactId = assessmentId(scenario, 5);
  const locationId = assessmentId(scenario, 6);
  const appointmentId = assessmentId(scenario, 7);

  await seedUser(owner, {
    id: userId,
    tenantId: IDS.tenantA,
    authId: authSub,
    displayName: 'Synthetic Practitioner',
    roles: ['practitioner'],
  });
  await seedPractitioner(owner, IDS.tenantA, practitionerId, userId);
  if (options.credentialTo !== null) {
    await seedCredential(owner, {
      tenantId: IDS.tenantA,
      practitionerId,
      serviceTypeId: BRAIN_MAP_SERVICE,
      certification: 'vendor_qeeg',
      validFrom: '2020-01-01',
      validTo: options.credentialTo ?? null,
      canExecuteSession: true,
    });
  }
  await seedClient(owner, IDS.tenantA, clientId, IDS.ownerA, options.familyName ?? 'Harbour');
  await owner.query('update client set date_of_birth = $2 where id = $1', [
    clientId,
    options.minor ? '2016-01-01' : '1990-01-01',
  ]);
  await seedContact(owner, { id: contactId, tenantId: IDS.tenantA, clientId });
  const purposes = options.consents ?? ['participation', 'home_visit'];
  for (const [index, purpose] of purposes.entries()) {
    await seedConsent(owner, {
      id: assessmentId(scenario, 20 + index),
      tenantId: IDS.tenantA,
      clientId,
      givenByContactId: contactId,
      purpose,
      textDocumentId: WORDING,
    });
  }
  await seedLocation(owner, IDS.tenantA, locationId, clientId, IDS.ownerA);
  await seedAppointment(owner, {
    id: appointmentId,
    tenantId: IDS.tenantA,
    clientId,
    practitionerId,
    serviceTypeId: BRAIN_MAP_SERVICE,
    locationId,
    windowStart: `${today}T08:00:00+04:00`,
  });
  return { scenario, authSub, practitionerUserId: userId, practitionerId, clientId };
}

function recording(
  household: Household,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    clientId: household.clientId,
    instrument: 'qeeg',
    instrumentVersion: '1',
    performedAt: `${today}T09:00:00+04:00`,
    derived: brainMapPayload(10),
    conditionNote: 'Eyes closed, quiet room.',
    referenceAgeYears: 9,
    referenceSex: 'female',
    deliveryMode: 'home',
    ...overrides,
  };
}

async function record(household: Household, overrides: Record<string, unknown> = {}) {
  const res = await post('/api/assessments', household.authSub, recording(household, overrides));
  return res;
}

async function refusals(clientOrAssessment: string): Promise<string[]> {
  const { rows } = await owner.query<{ reason: string }>(
    "select reason from audit_log where action = 'refused' and entity_id = $1 order by id",
    [clientOrAssessment],
  );
  return rows.map((row) => row.reason);
}

beforeAll(async () => {
  owner = await freshDatabase();
  await seedTenant(owner, IDS.tenantA, IDS.ownerA, 'Synthetic Studio A');
  await seedTenant(owner, IDS.tenantB, IDS.ownerB, 'Synthetic Studio B');
  await seedServiceType(owner, IDS.tenantA, BRAIN_MAP_SERVICE, 'brain-map');
  await seedConsentDocument(owner, IDS.tenantA, WORDING);
  await owner.query('update app_user set auth_id = $2 where id = $1', [IDS.ownerA, OWNER_AUTH]);
  await seedUser(owner, {
    id: ADMIN_USER,
    tenantId: IDS.tenantA,
    authId: ADMIN_AUTH,
    displayName: 'Synthetic Admin',
    roles: ['admin'],
  });
  await seedUser(owner, {
    id: FINANCE_USER,
    tenantId: IDS.tenantA,
    authId: FINANCE_AUTH,
    displayName: 'Synthetic Bookkeeper',
    roles: ['finance'],
  });
  await seedUser(owner, {
    id: CONTACT_USER,
    tenantId: IDS.tenantA,
    authId: CONTACT_AUTH,
    displayName: 'Synthetic Parent',
    roles: ['client_contact'],
  });

  const dates = await owner.query<{ today: string }>(
    "select (now() at time zone 'Asia/Dubai')::date::text as today",
  );
  today = dates.rows[0]!.today;

  dir = await mkdtemp(join(tmpdir(), 'mcwellness-assessment-'));
  const apiUrl = process.env.API_DATABASE_URL;
  if (!apiUrl) throw new Error('API_DATABASE_URL is not set.');
  pool = createPool(apiUrl);
  api = createApi({
    pool,
    verifier: createTokenVerifier({ issuer: ISSUER, secret: SECRET }),
    storage: localDiskStorage({ dir, signingSecret: Buffer.alloc(32, 5) }),
  });
});

afterAll(async () => {
  await pool?.end();
  await owner?.end();
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe('recording a measurement', () => {
  it('writes the row, snapshots the reference age and sex, and hands it back', async () => {
    const household = await seedHousehold('21');
    const res = await record(household);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { assessment: Record<string, unknown> };
    expect(body.assessment).toMatchObject({
      clientId: household.clientId,
      instrument: 'qeeg',
      version: 1,
      referenceAgeYears: 9,
      referenceSex: 'female',
      supersedesId: null,
    });

    const row = await owner.query<{ derived: { provenance: { software: string } } }>(
      'select derived from assessment where id = $1',
      [body.assessment.id as string],
    );
    // Decision 6: every payload names what produced it.
    expect(row.rows[0]?.derived.provenance.software).toBe('Synthetic Mapping Suite');
  });

  it('refuses a payload the shape does not recognise, naming the field', async () => {
    const household = await seedHousehold('22');
    const res = await record(household, {
      derived: {
        kind: 'brain-map',
        provenance: { software: 'Synthetic Mapping Suite', softwareVersion: '3.2.1' },
        condition: 'eyes-closed',
        figures: [{ site: 'Fz', band: 'alpha', value: 12.5 }],
      },
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({
      code: 'invalid_payload',
      field: 'figures.0.unit',
      reason: 'missing_unit',
    });
  });

  it('refuses a payload that puts a word beside a figure', async () => {
    const household = await seedHousehold('23');
    const res = await record(household, {
      derived: { ...brainMapPayload(10), severity: 'anything' },
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ reason: 'interpretation_not_stored' });
  });

  it('refuses a recording without an active participation consent, and audits it', async () => {
    const household = await seedHousehold('24', { consents: ['home_visit'] });
    const res = await record(household);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'consent_missing_participation' });
    expect(await refusals(household.clientId)).toContain('consent_missing_participation');
  });

  it("refuses a minor's recording without the guardian's own consent", async () => {
    const household = await seedHousehold('25', {
      minor: true,
      consents: ['participation', 'home_visit'],
    });
    const res = await record(household);
    expect(res.status).toBe(403);
    expect((await res.json()) as { refusals: string[] }).toMatchObject({
      refusals: ['consent_missing_minor_participation'],
    });
  });

  it("accepts a minor's recording when the guardian has consented", async () => {
    const household = await seedHousehold('26', {
      minor: true,
      consents: ['participation', 'minor_participation', 'home_visit'],
    });
    expect((await record(household)).status).toBe(201);
  });

  it('refuses a home recording without the home-visit consent', async () => {
    const household = await seedHousehold('27', { consents: ['participation'] });
    const res = await record(household);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'consent_missing_home_visit' });
  });

  it('refuses a lapsed certification, with the reason named', async () => {
    const household = await seedHousehold('28', { credentialTo: '2021-01-01' });
    const res = await record(household);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'credential_invalid' });
    expect(await refusals(household.clientId)).toContain('credential_invalid');
  });

  it('refuses a practitioner with no certification for that service at all', async () => {
    const household = await seedHousehold('29', { credentialTo: null });
    const res = await record(household);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'credential_invalid' });
  });

  it('refuses an administrator recording one, and audits the attempt', async () => {
    const household = await seedHousehold('30');
    const res = await post('/api/assessments', ADMIN_AUTH, recording(household));
    expect(res.status).toBe(403);
  });

  it('refuses a practitioner off that client’s schedule, and says nothing about the record', async () => {
    const household = await seedHousehold('31');
    const stranger = await seedHousehold('32', { familyName: 'Lagoon' });
    const res = await post('/api/assessments', stranger.authSub, recording(household));
    expect(res.status).toBe(404);
    expect(await refusals(household.clientId)).toContain('not_visible');
  });

  it('refuses a client of another practice as if it did not exist', async () => {
    const household = await seedHousehold('33');
    await seedClient(owner, IDS.tenantB, IDS.clientB, IDS.ownerB, 'Meadow');
    const res = await post(
      '/api/assessments',
      household.authSub,
      recording(household, { clientId: IDS.clientB }),
    );
    expect(res.status).toBe(404);
    expect(await refusals(IDS.clientB)).toContain('client_not_found');
  });
});

describe('reading the tab', () => {
  it('lists the current version with its history beneath, and writes one list row each', async () => {
    const household = await seedHousehold('34');
    const first = (await record(household)).clone();
    const created = (await first.json()) as { assessment: { id: string } };
    const correction = await post(
      `/api/assessments/${created.assessment.id}/supersede`,
      household.authSub,
      {
        instrumentVersion: '1',
        performedAt: `${today}T09:00:00+04:00`,
        derived: brainMapPayload(12.5),
        conditionNote: 'Eyes closed, quiet room.',
        referenceAgeYears: 9,
        referenceSex: 'female',
        deliveryMode: 'home',
        reason: 'The alpha figure at Fz was typed from the wrong column.',
      },
    );
    expect(correction.status).toBe(201);

    const res = await get(`/api/clients/${household.clientId}/assessments`, household.authSub);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      assessments: { current: { id: string; version: number }; superseded: { id: string }[] }[];
    };
    expect(body.assessments).toHaveLength(1);
    expect(body.assessments[0]?.current.version).toBe(2);
    expect(body.assessments[0]?.superseded.map((row) => row.id)).toEqual([created.assessment.id]);

    const listed = await owner.query<{ n: string }>(
      "select count(*)::text as n from audit_log where action = 'list' and entity_type = 'assessment' " +
        'and client_id = $1',
      [household.clientId],
    );
    expect(Number(listed.rows[0]?.n)).toBe(2);
  });

  it('shows a client contact nothing, whatever the screen would do', async () => {
    const household = await seedHousehold('35');
    await record(household);
    const res = await get(`/api/clients/${household.clientId}/assessments`, CONTACT_AUTH);
    expect(res.status).toBe(403);
  });

  it('shows finance nothing', async () => {
    const household = await seedHousehold('36');
    await record(household);
    const res = await get(`/api/clients/${household.clientId}/assessments`, FINANCE_AUTH);
    expect(res.status).toBe(403);
  });

  it('refuses a practitioner off that client’s schedule and audits the attempt', async () => {
    const household = await seedHousehold('37');
    const stranger = await seedHousehold('38', { familyName: 'Lagoon' });
    await record(household);
    const res = await get(`/api/clients/${household.clientId}/assessments`, stranger.authSub);
    expect(res.status).toBe(404);
    expect(await refusals(household.clientId)).toContain('not_visible');
  });
});

describe('correcting a measurement', () => {
  it('refuses a correction of a version already corrected', async () => {
    const household = await seedHousehold('39');
    const created = (await (await record(household)).json()) as { assessment: { id: string } };
    const body = {
      instrumentVersion: '1',
      performedAt: `${today}T09:00:00+04:00`,
      derived: brainMapPayload(12.5),
      conditionNote: null,
      referenceAgeYears: 9,
      referenceSex: 'female',
      deliveryMode: 'home',
      reason: 'The alpha figure at Fz was typed from the wrong column.',
    };
    expect(
      (await post(`/api/assessments/${created.assessment.id}/supersede`, household.authSub, body))
        .status,
    ).toBe(201);
    const second = await post(
      `/api/assessments/${created.assessment.id}/supersede`,
      household.authSub,
      body,
    );
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ code: 'already_superseded' });
  });

  it('refuses a correction with no reason', async () => {
    const household = await seedHousehold('40');
    const created = (await (await record(household)).json()) as { assessment: { id: string } };
    const res = await post(
      `/api/assessments/${created.assessment.id}/supersede`,
      household.authSub,
      {
        instrumentVersion: '1',
        performedAt: `${today}T09:00:00+04:00`,
        derived: brainMapPayload(12.5),
        conditionNote: null,
        referenceAgeYears: 9,
        referenceSex: 'female',
        deliveryMode: 'home',
        reason: '   ',
      },
    );
    expect(res.status).toBe(400);
  });

  it("refuses another practitioner's measurement", async () => {
    const household = await seedHousehold('41');
    const created = (await (await record(household)).json()) as { assessment: { id: string } };
    // A second practitioner of the same practice, who shares the schedule.
    const colleagueUser = assessmentId('42', 1);
    const colleagueAuth = assessmentId('42', 2);
    const colleague = assessmentId('42', 3);
    await seedUser(owner, {
      id: colleagueUser,
      tenantId: IDS.tenantA,
      authId: colleagueAuth,
      displayName: 'Synthetic Colleague',
      roles: ['practitioner'],
    });
    await seedPractitioner(owner, IDS.tenantA, colleague, colleagueUser);
    await seedCredential(owner, {
      tenantId: IDS.tenantA,
      practitionerId: colleague,
      serviceTypeId: BRAIN_MAP_SERVICE,
      certification: 'vendor_qeeg',
      validFrom: '2020-01-01',
      validTo: null,
      canExecuteSession: true,
    });
    await seedAppointment(owner, {
      id: assessmentId('42', 4),
      tenantId: IDS.tenantA,
      clientId: household.clientId,
      practitionerId: colleague,
      serviceTypeId: BRAIN_MAP_SERVICE,
      locationId: assessmentId('41', 6),
      windowStart: `${today}T11:00:00+04:00`,
    });
    const res = await post(`/api/assessments/${created.assessment.id}/supersede`, colleagueAuth, {
      instrumentVersion: '1',
      performedAt: `${today}T09:00:00+04:00`,
      derived: brainMapPayload(12.5),
      conditionNote: null,
      referenceAgeYears: 9,
      referenceSex: 'female',
      deliveryMode: 'home',
      reason: 'A colleague reaching for somebody else’s measurement.',
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'not_your_measurement' });
  });
});

describe('the comparison', () => {
  it('sets two recordings side by side and writes a read row for each', async () => {
    const household = await seedHousehold('43');
    const first = (await (
      await record(household, { performedAt: `${today}T09:00:00+04:00` })
    ).json()) as { assessment: { id: string } };
    const second = (await (
      await record(household, {
        performedAt: `${today}T11:00:00+04:00`,
        derived: brainMapPayload(12.5),
      })
    ).json()) as { assessment: { id: string } };

    const res = await get(
      `/api/assessments/compare?ids=${first.assessment.id},${second.assessment.id}`,
      household.authSub,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { comparison: Comparison };
    expect(body.comparison.figures[0]).toMatchObject({
      key: 'Fz.alpha',
      earlier: 10,
      later: 12.5,
      difference: 2.5,
    });
    expect(body.comparison.earlier.referenceAgeYears).toBe(9);

    const reads = await owner.query<{ n: string }>(
      "select count(*)::text as n from audit_log where action = 'read' and entity_type = 'assessment' " +
        'and client_id = $1',
      [household.clientId],
    );
    expect(Number(reads.rows[0]?.n)).toBe(2);
  });

  it('refuses two people’s measurements', async () => {
    const first = await seedHousehold('44');
    const second = await seedHousehold('45', { familyName: 'Lagoon' });
    const a = (await (await record(first)).json()) as { assessment: { id: string } };
    const b = (await (await record(second)).json()) as { assessment: { id: string } };
    // The owner can reach both records, so the refusal is the domain's rather
    // than row security's.
    const res = await get(
      `/api/assessments/compare?ids=${a.assessment.id},${b.assessment.id}`,
      OWNER_AUTH,
    );
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: 'different_clients' });
  });

  it('answers not found when one of the two is out of reach', async () => {
    const household = await seedHousehold('46');
    const stranger = await seedHousehold('47', { familyName: 'Lagoon' });
    const a = (await (await record(household)).json()) as { assessment: { id: string } };
    const b = (await (await record(stranger)).json()) as { assessment: { id: string } };
    const res = await get(
      `/api/assessments/compare?ids=${a.assessment.id},${b.assessment.id}`,
      household.authSub,
    );
    expect(res.status).toBe(404);
  });
});

describe('the export’s own door', () => {
  it('files the row, the link and the bytes, and audits the filing with the id alone', async () => {
    const household = await seedHousehold('48');
    const created = (await (await record(household)).json()) as { assessment: { id: string } };
    const res = await putFile(created.assessment.id, household.authSub, PDF);
    expect(res.status).toBe(201);
    const filed = (await res.json()) as { documentId: string; role: string };
    expect(filed.role).toBe('raw');

    const document = await owner.query<{
      kind: string;
      client_id: string;
      sha256: Buffer;
      storage_key: string;
      is_immutable: boolean;
      mime_type: string;
    }>(
      'select kind, client_id, sha256, storage_key, is_immutable, mime_type from document ' +
        'where id = $1',
      [filed.documentId],
    );
    expect(document.rows[0]?.kind).toBe('assessment_raw');
    expect(document.rows[0]?.mime_type).toBe('application/pdf');
    expect(document.rows[0]?.client_id).toBe(household.clientId);
    expect(document.rows[0]?.sha256.toString('hex')).toBe(digestOf(PDF));
    expect(document.rows[0]?.is_immutable).toBe(true);
    expect(document.rows[0]?.storage_key).toBe(
      `tenant/${IDS.tenantA}/client/${household.clientId}/${filed.documentId}`,
    );

    // The act, with what was filed and no id: a random uuid trips the trail's
    // own telephone-number guard about one time in eighty
    // (docs/CHANGE-REQUESTS/assessment-01.md).
    const trail = await owner.query<{ new_values: { role?: string } | null }>(
      "select new_values from audit_log where action = 'assessment.file_filed' and entity_id = $1",
      [created.assessment.id],
    );
    expect(trail.rows).toHaveLength(1);
    expect(trail.rows[0]?.new_values).toEqual({ role: 'raw' });

    // And the document is named where it belongs: on the link row's own entry,
    // written by the audit trigger.
    const link = await owner.query<{ new_values: { document_id?: string } | null }>(
      "select new_values from audit_log where entity_type = 'assessment_document' " +
        "and action = 'insert' and client_id = $1",
      [household.clientId],
    );
    expect(link.rows).toHaveLength(1);
    expect(link.rows[0]?.new_values?.document_id).toBe(filed.documentId);
  });

  it('is idempotent on the same bytes and takes a second, different file', async () => {
    const household = await seedHousehold('49');
    const created = (await (await record(household)).json()) as { assessment: { id: string } };
    const first = (await (await putFile(created.assessment.id, household.authSub, PDF)).json()) as {
      documentId: string;
    };
    const again = await putFile(created.assessment.id, household.authSub, PDF);
    expect(again.status).toBe(200);
    expect(((await again.json()) as { documentId: string }).documentId).toBe(first.documentId);

    // One brain map produces several files; a different one is an ordinary
    // second file rather than a conflict.
    const second = await putFile(created.assessment.id, household.authSub, OTHER_PDF, {
      role: 'vendor_report',
    });
    expect(second.status).toBe(201);
    const links = await owner.query<{ n: string }>(
      'select count(*)::text as n from assessment_document where assessment_id = $1',
      [created.assessment.id],
    );
    expect(Number(links.rows[0]?.n)).toBe(2);
  });

  it('refuses a media type that is not a PDF', async () => {
    const household = await seedHousehold('50');
    const created = (await (await record(household)).json()) as { assessment: { id: string } };
    const res = await putFile(created.assessment.id, household.authSub, PDF, {
      type: 'image/png',
    });
    expect(res.status).toBe(415);
  });

  it('refuses bytes that are not a PDF whatever the caller calls them', async () => {
    const household = await seedHousehold('51');
    const created = (await (await record(household)).json()) as { assessment: { id: string } };
    const page = new TextEncoder().encode('<html><body>anything</body></html>');
    const res = await putFile(created.assessment.id, household.authSub, page);
    expect(res.status).toBe(415);
    expect(await res.json()).toMatchObject({ code: 'not_a_pdf' });
  });

  it('refuses a digest that does not match the bytes', async () => {
    const household = await seedHousehold('52');
    const created = (await (await record(household)).json()) as { assessment: { id: string } };
    const res = await putFile(created.assessment.id, household.authSub, PDF, {
      digest: digestOf(OTHER_PDF),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'digest_mismatch' });
  });

  it('lets an admin file an export against a measurement a practitioner recorded', async () => {
    // Section 7.2: an admin may file, and may not create.
    const household = await seedHousehold('53');
    const created = (await (await record(household)).json()) as { assessment: { id: string } };
    const res = await putFile(created.assessment.id, ADMIN_AUTH, PDF);
    expect(res.status).toBe(201);
  });

  it('refuses a practitioner off that client’s schedule', async () => {
    const household = await seedHousehold('54');
    const stranger = await seedHousehold('55', { familyName: 'Lagoon' });
    const created = (await (await record(household)).json()) as { assessment: { id: string } };
    const res = await putFile(created.assessment.id, stranger.authSub, PDF);
    expect(res.status).toBe(404);
  });

  it('refuses finance and a household outright', async () => {
    const household = await seedHousehold('56');
    const created = (await (await record(household)).json()) as { assessment: { id: string } };
    expect((await putFile(created.assessment.id, FINANCE_AUTH, PDF)).status).toBe(403);
    expect((await putFile(created.assessment.id, CONTACT_AUTH, PDF)).status).toBe(403);
  });
});

describe('a link to an export', () => {
  it('records the read before it signs, and the bytes come back', async () => {
    const household = await seedHousehold('57');
    const created = (await (await record(household)).json()) as { assessment: { id: string } };
    const filed = (await (await putFile(created.assessment.id, household.authSub, PDF)).json()) as {
      documentId: string;
    };

    const res = await get(`/api/assessments/file/${filed.documentId}/link`, household.authSub);
    expect(res.status).toBe(200);
    const link = (await res.json()) as { url: string; expiresInSeconds: number };
    expect(link.expiresInSeconds).toBe(300);

    const reads = await owner.query<{ n: string }>(
      "select count(*)::text as n from audit_log where action = 'read' and entity_type = 'document' " +
        'and entity_id = $1',
      [filed.documentId],
    );
    expect(Number(reads.rows[0]?.n)).toBe(1);

    const bytes = await api.request(link.url);
    expect(bytes.status).toBe(200);
    expect(new Uint8Array(await bytes.arrayBuffer())).toEqual(PDF);
  });

  it('answers not found to a household and to a practitioner off the schedule', async () => {
    const household = await seedHousehold('58');
    const stranger = await seedHousehold('59', { familyName: 'Lagoon' });
    const created = (await (await record(household)).json()) as { assessment: { id: string } };
    const filed = (await (await putFile(created.assessment.id, household.authSub, PDF)).json()) as {
      documentId: string;
    };
    expect((await get(`/api/assessments/file/${filed.documentId}/link`, CONTACT_AUTH)).status).toBe(
      403,
    );
    expect(
      (await get(`/api/assessments/file/${filed.documentId}/link`, stranger.authSub)).status,
    ).toBe(404);
  });
});
