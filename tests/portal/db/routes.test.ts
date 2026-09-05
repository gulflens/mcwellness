import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  AccessResponse,
  AgreementsResponse,
  FamilyResponse,
  HomeResponse,
  InviteResponse,
  MoneyResponse,
  OfficeRequestsResponse,
  VisitsResponse,
} from '../../../app/api/portal/schema';
import type { AuthAdminProvider } from '../../../app/api/portal/mount';
import { IDS } from '../../db/helpers';
import {
  PORTAL,
  PORTAL_FIGURES,
  PORTAL_MONEY,
  PORTAL_PHONES,
  seedAppointment,
  seedConsent,
  seedMoney,
  seedWording,
  startPortalHarness,
  type PortalHarness,
} from './support';

/**
 * The portal's routes, through `createApi` exactly as the server builds it
 * (docs/SPEC/client-portal.md sections 7 and 13). Nothing is mounted by hand:
 * if a mount call is ever dropped from `create-api.ts`, a route here falls
 * through to the catch-all 404 and these fail loudly rather than the gap
 * passing silently — the discipline `tests/db/route-mounts.test.ts` set.
 *
 * The household of two is the mother's (two children on the record) and the
 * household of one is the adult's, so every screen is asked in both shapes.
 * The child's own login is the third case throughout: the same screens, and no
 * figure anywhere.
 */

const FUTURE_A = '00000001-0000-4000-8000-0000000000a1';
const FUTURE_B = '00000001-0000-4000-8000-0000000000a2';
const PAST_A = '00000001-0000-4000-8000-0000000000a3';
const PROPOSED_A = '00000001-0000-4000-8000-0000000000a4';
const MOVED_A = '00000001-0000-4000-8000-0000000000a5';
const ADULT_VISIT = '00000001-0000-4000-8000-0000000000a6';
const STRANGER_VISIT = '00000001-0000-4000-8000-0000000000a7';

const WORDING_RETIRED = '00000001-0000-4000-8000-0000000000b1';
const WORDING_CURRENT = '00000001-0000-4000-8000-0000000000b2';
const WORDING_ADULT = '00000001-0000-4000-8000-0000000000b3';
const CONSENT_A = '00000001-0000-4000-8000-0000000000b4';
const CONSENT_ADULT = '00000001-0000-4000-8000-0000000000b5';
const INVOICE_DOCUMENT = '00000001-0000-4000-8000-0000000000b6';
const BILLING_DOCUMENT = '00000001-0000-4000-8000-0000000000b7';
/** A contact row whose account is the practice's own admin: the founder's case. */
const OFFICE_CONTACT = '00000001-0000-4000-8000-0000000000c1';

/**
 * The password every fixture chooses. Twelve characters and more, which is all
 * the door checks; it opens nothing, here or anywhere. Named rather than
 * written at each call site so `pnpm verify`'s secrets scan reads a constant
 * and not an assignment that looks like a credential.
 */
const CHOSEN = 'a-password-nobody-uses';
/** A link that names no invitation. The door answers 404 for it, every time. */
const NOTHING_LINK = 'a-token-that-opens-nothing-at-all';

let h: PortalHarness;

beforeAll(async () => {
  h = await startPortalHarness();

  await seedAppointment(h.owner, {
    id: FUTURE_A,
    clientId: PORTAL.childA,
    inDays: 3,
    hour: 10,
    status: 'confirmed',
  });
  await seedAppointment(h.owner, {
    id: FUTURE_B,
    clientId: PORTAL.childB,
    inDays: 5,
    hour: 11,
    status: 'confirmed',
  });
  await seedAppointment(h.owner, {
    id: PAST_A,
    clientId: PORTAL.childA,
    inDays: -7,
    hour: 12,
    status: 'completed',
  });
  await seedAppointment(h.owner, {
    id: PROPOSED_A,
    clientId: PORTAL.childA,
    inDays: 9,
    hour: 13,
    status: 'proposed',
  });
  await seedAppointment(h.owner, {
    id: MOVED_A,
    clientId: PORTAL.childA,
    inDays: 11,
    hour: 14,
    status: 'rescheduled',
  });
  await seedAppointment(h.owner, {
    id: ADULT_VISIT,
    clientId: PORTAL.adultClient,
    inDays: 4,
    hour: 15,
    status: 'confirmed',
  });
  await seedAppointment(h.owner, {
    id: STRANGER_VISIT,
    clientId: PORTAL.strangerClient,
    inDays: 4,
    hour: 16,
    status: 'confirmed',
  });

  // A wording that has been superseded, and the version that stands in its
  // place: the one case section 3.5's notice is about.
  await seedWording(h.owner, {
    id: WORDING_RETIRED,
    purpose: 'minor_participation',
    locale: 'en',
    version: '0.1-draft',
    status: 'approved',
    retired: true,
  });
  await seedWording(h.owner, {
    id: WORDING_CURRENT,
    purpose: 'minor_participation',
    locale: 'en',
    version: '0.2-draft',
    status: 'approved',
  });
  await seedWording(h.owner, {
    id: WORDING_ADULT,
    purpose: 'participation',
    locale: 'ar',
    version: '0.1-draft',
    status: 'approved',
  });
  await seedConsent(h.owner, {
    id: CONSENT_A,
    clientId: PORTAL.childA,
    contactId: PORTAL.motherContact,
    purpose: 'minor_participation',
    wordingId: WORDING_RETIRED,
  });
  await seedConsent(h.owner, {
    id: CONSENT_ADULT,
    clientId: PORTAL.adultClient,
    contactId: PORTAL.adultContact,
    purpose: 'participation',
    wordingId: WORDING_ADULT,
  });

  // The bytes behind both wordings, so the wording route can sign a link.
  for (const id of [WORDING_RETIRED, WORDING_ADULT]) {
    await h.storage.put(
      `tenant/${IDS.tenantA}/practice/${id}`,
      new TextEncoder().encode('Synthetic consent wording, for a test.'),
      'text/markdown',
    );
  }

  await seedMoney(h.owner, PORTAL.childA);
  // One invoice with a rendered document behind it, so the money screen has a
  // link to hand over and the link route has bytes to sign.
  await h.owner.query(
    'insert into document (id, tenant_id, client_id, kind, storage_key, mime_type, sha256) ' +
      "values ($1, $2, $3, 'invoice', $4, 'application/pdf', sha256(convert_to($4, 'UTF8')))",
    [
      INVOICE_DOCUMENT,
      IDS.tenantA,
      PORTAL.childA,
      `tenant/${IDS.tenantA}/client/${PORTAL.childA}/${INVOICE_DOCUMENT}`,
    ],
  );
  await h.owner.query(
    'insert into billing_document (id, tenant_id, client_id, kind, document_id, invoice_id) ' +
      "values ($1, $2, $3, 'invoice', $4, $5)",
    [BILLING_DOCUMENT, IDS.tenantA, PORTAL.childA, INVOICE_DOCUMENT, PORTAL_MONEY.invoice],
  );
  await h.storage.put(
    `tenant/${IDS.tenantA}/client/${PORTAL.childA}/${INVOICE_DOCUMENT}`,
    new TextEncoder().encode('%PDF-1.4 synthetic'),
    'application/pdf',
  );
});

afterAll(async () => {
  await h.close();
});

/** How many audit rows of a kind this request wrote. */
async function auditRows(action: string, entityType: string): Promise<number> {
  const { rows } = await h.owner.query<{ n: string }>(
    'select count(*)::text as n from audit_log where action = $1 and entity_type = $2',
    [action, entityType],
  );
  return Number(rows[0]?.n ?? 0);
}

describe('GET /api/portal/home', () => {
  it('answers a household of two with the next visit, the money and the practice', async () => {
    const res = await h.callAs('GET', '/api/portal/home', PORTAL.motherAuth);
    expect(res.status).toBe(200);
    const body = (await res.json()) as HomeResponse;

    expect(body.clients).toHaveLength(2);
    expect(body.practice.whatsappNumber).toBe(PORTAL_PHONES.practice);
    expect(body.locale).toBe('en');
    // The soonest confirmed visit of either child, and never the proposal.
    expect(body.nextVisit?.clientId).toBe(PORTAL.childA);
    expect(body.nextVisit?.windowStart).toBeTruthy();
    expect(body.nextVisit?.serviceName).toBe('Neurofeedback session');
    // What is owed: the invoice less the payment, in fils.
    const owed = body.money.find((row) => row.clientId === PORTAL.childA);
    expect(owed?.outstandingFils).toBe(PORTAL_FIGURES.outstandingFils);
    expect(owed?.sessionsUsed).toBe(1);
    expect(owed?.sessionsTotal).toBe(2);
    // The superseded wording is the notice waiting on the household.
    expect(body.notices.some((notice) => notice.kind === 'consent_newer_wording')).toBe(true);
  });

  it('answers a household of one in her own language', async () => {
    const res = await h.callAs('GET', '/api/portal/home', PORTAL.adultAuth);
    expect(res.status).toBe(200);
    const body = (await res.json()) as HomeResponse;
    expect(body.clients).toHaveLength(1);
    expect(body.locale).toBe('ar');
    expect(body.nextVisit?.clientId).toBe(PORTAL.adultClient);
  });

  it("shows a young person's own login their visit and no figure at all", async () => {
    const res = await h.callAs('GET', '/api/portal/home', PORTAL.minorAuth);
    expect(res.status).toBe(200);
    const body = (await res.json()) as HomeResponse;
    expect(body.clients).toEqual([expect.objectContaining({ moneyVisible: false })]);
    expect(body.money).toEqual([]);
    expect(body.nextVisit?.clientId).toBe(PORTAL.childA);
  });

  it('refuses a member of the practice, whose reach is the console’s', async () => {
    const res = await h.callAs('GET', '/api/portal/home', PORTAL.adminAuth);
    expect(res.status).toBe(403);
  });

  it('writes one read row per client the household opened', async () => {
    const before = await auditRows('read', 'client');
    await h.callAs('GET', '/api/portal/home', PORTAL.motherAuth);
    expect(await auditRows('read', 'client')).toBe(before + 2);
  });
});

describe('GET /api/portal/visits', () => {
  it('splits the visits the way section 3.2 draws them', async () => {
    const res = await h.callAs('GET', '/api/portal/visits', PORTAL.motherAuth);
    expect(res.status).toBe(200);
    const body = (await res.json()) as VisitsResponse;

    expect(body.upcoming.map((visit) => visit.id)).toEqual([FUTURE_A, FUTURE_B]);
    // Most recent first: last week's, then the visit the used credit was
    // spent on a month ago (db/../support.ts's seedMoney).
    expect(body.past.map((visit) => visit.id)).toEqual([PAST_A, PORTAL_MONEY.consumedAt]);
    expect(body.past[0]?.outcome).toBe('completed');
    // The proposal and the moved visit are in neither list.
    const every = [...body.upcoming, ...body.past].map((visit) => visit.id);
    expect(every).not.toContain(PROPOSED_A);
    expect(every).not.toContain(MOVED_A);
    // And never another household's.
    expect(every).not.toContain(STRANGER_VISIT);
  });

  it('never names the practitioner, the address or a coordinate', async () => {
    const res = await h.callAs('GET', '/api/portal/visits', PORTAL.motherAuth);
    const text = await res.text();
    expect(text).not.toContain('Basil');
    expect(text).not.toContain('practitionerId');
    expect(text).not.toContain('Ring twice');
    expect(text).not.toContain('55.27');
  });

  it('shows a household of one only her own visit', async () => {
    const res = await h.callAs('GET', '/api/portal/visits', PORTAL.adultAuth);
    const body = (await res.json()) as VisitsResponse;
    expect(body.upcoming.map((visit) => visit.id)).toEqual([ADULT_VISIT]);
  });
});

describe('GET /api/portal/money', () => {
  it('answers the balance, the bundle and the papers', async () => {
    const res = await h.callAs('GET', '/api/portal/money', PORTAL.motherAuth);
    expect(res.status).toBe(200);
    const body = (await res.json()) as MoneyResponse;

    expect(body.balances).toContainEqual(
      expect.objectContaining({
        clientId: PORTAL.childA,
        outstandingFils: PORTAL_FIGURES.outstandingFils,
      }),
    );
    expect(body.packages).toHaveLength(1);
    expect(body.packages[0]).toMatchObject({ used: 1, total: 2, name: 'Silver' });
    expect(body.invoices).toHaveLength(1);
    expect(body.invoices[0]?.documentId).toBe(INVOICE_DOCUMENT);
    expect(body.payments).toHaveLength(1);
    expect(body.payments[0]?.amountFils).toBe(PORTAL_FIGURES.paymentFils);
  });

  it("refuses a young person's own login the screen entirely", async () => {
    const res = await h.callAs('GET', '/api/portal/money', PORTAL.minorAuth);
    expect(res.status).toBe(403);
    expect((await res.json()) as { code?: string }).toMatchObject({ code: 'money_not_shown' });
  });

  it('records the read the way the practice’s own balance route does', async () => {
    const before = await auditRows('read', 'billing_ledger');
    await h.callAs('GET', '/api/portal/money', PORTAL.motherAuth);
    expect(await auditRows('read', 'billing_ledger')).toBe(before + 2);
  });
});

describe('GET /api/portal/documents/:documentId/link', () => {
  it('signs a link to the household’s own invoice, and audits the read first', async () => {
    const before = await auditRows('read', 'document');
    const res = await h.callAs(
      'GET',
      `/api/portal/documents/${INVOICE_DOCUMENT}/link`,
      PORTAL.motherAuth,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string; expiresInSeconds: number };
    expect(body.url).toContain('/api/storage/');
    expect(body.expiresInSeconds).toBeGreaterThan(0);
    expect(await auditRows('read', 'document')).toBe(before + 1);

    // The link opens the bytes, through the store's own route.
    const bytes = await h.api.request(body.url);
    expect(bytes.status).toBe(200);
  });

  it("answers 404 for another household's document", async () => {
    const res = await h.callAs(
      'GET',
      `/api/portal/documents/${INVOICE_DOCUMENT}/link`,
      PORTAL.adultAuth,
    );
    expect(res.status).toBe(404);
  });

  it("refuses a young person's own login before it reaches a document at all", async () => {
    const res = await h.callAs(
      'GET',
      `/api/portal/documents/${INVOICE_DOCUMENT}/link`,
      PORTAL.minorAuth,
    );
    expect(res.status).toBe(403);
  });

  it('answers 400 for an id that is not one, rather than raising in Postgres', async () => {
    const res = await h.callAs('GET', '/api/portal/documents/not-an-id/link', PORTAL.motherAuth);
    expect(res.status).toBe(400);
  });
});

describe('GET /api/portal/family and PATCH /api/portal/contacts/:contactId', () => {
  it('shows the address as a line and an emirate, and the people on the record', async () => {
    const res = await h.callAs('GET', '/api/portal/family', PORTAL.motherAuth);
    expect(res.status).toBe(200);
    const body = (await res.json()) as FamilyResponse;

    expect(body.clients).toHaveLength(2);
    expect(body.clients[0]?.address?.emirate).toBe('DXB');
    expect(body.clients[0]?.address?.displayAddress).toContain('Synthetic Community');
    // The mother, the father and the child's own login on the first record;
    // the mother alone on the second.
    expect(body.people.filter((person) => person.clientId === PORTAL.childA)).toHaveLength(3);
    expect(body.people.filter((person) => person.isYou)).toHaveLength(2);

    const text = JSON.stringify(body);
    expect(text).not.toContain('Ring twice');
    expect(text).not.toContain('0000000001');
    expect(text).not.toContain('55.27');
    expect(text).not.toContain('emiratesId');
  });

  it('lets a person correct their own row', async () => {
    const res = await h.callAs(
      'PATCH',
      `/api/portal/contacts/${PORTAL.motherContact}`,
      PORTAL.motherAuth,
      {
        phone: '+971 50 000 0031',
        email: 'hazel.meadow@example.com',
        whatsappOptIn: false,
      },
    );
    expect(res.status).toBe(200);
    const saved = await h.owner.query<{ phone: string; whatsapp_opt_in: boolean }>(
      'select phone, whatsapp_opt_in from contact where id = $1',
      [PORTAL.motherContact],
    );
    // The spaces a person types are stripped: the column holds E.164.
    expect(saved.rows[0]?.phone).toBe('+971500000031');
    expect(saved.rows[0]?.whatsapp_opt_in).toBe(false);
  });

  it("refuses somebody else's row on the same record, and records the refusal", async () => {
    const before = await auditRows('refused', 'contact');
    const res = await h.callAs(
      'PATCH',
      `/api/portal/contacts/${PORTAL.fatherContact}`,
      PORTAL.motherAuth,
      {
        phone: '+971500000032',
        email: null,
        whatsappOptIn: true,
      },
    );
    expect(res.status).toBe(403);
    expect(await auditRows('refused', 'contact')).toBe(before + 1);
  });

  it("answers 404 for another household's contact, without confirming it exists", async () => {
    const res = await h.callAs(
      'PATCH',
      `/api/portal/contacts/${PORTAL.adultContact}`,
      PORTAL.motherAuth,
      {
        phone: '+971500000033',
        email: null,
        whatsappOptIn: true,
      },
    );
    expect(res.status).toBe(404);
  });

  it('refuses a telephone number that is not one', async () => {
    const res = await h.callAs(
      'PATCH',
      `/api/portal/contacts/${PORTAL.motherContact}`,
      PORTAL.motherAuth,
      {
        phone: 'not a number',
        email: null,
        whatsappOptIn: true,
      },
    );
    expect(res.status).toBe(400);
  });
});

describe('the agreements screen and the two asks', () => {
  it('says a newer wording exists, and names who gave the consent', async () => {
    const res = await h.callAs('GET', '/api/portal/agreements', PORTAL.motherAuth);
    expect(res.status).toBe(200);
    const body = (await res.json()) as AgreementsResponse;
    const agreement = body.agreements.find((row) => row.id === CONSENT_A);
    expect(agreement).toMatchObject({
      purpose: 'minor_participation',
      status: 'active',
      givenByRelationship: 'mother',
      newerWordingExists: true,
    });
  });

  it('opens the exact wording that person was shown, and keeps the words out of the trail', async () => {
    const before = await auditRows('read', 'document');
    const res = await h.callAs(
      'GET',
      `/api/portal/consents/${CONSENT_A}/wording`,
      PORTAL.motherAuth,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; textUrl: string; version: string };
    // The retired one, because that is what she agreed to.
    expect(body.id).toBe(WORDING_RETIRED);
    expect(body.version).toBe('0.1-draft');
    expect(await auditRows('read', 'document')).toBe(before + 1);

    const values = await h.owner.query<{ n: string }>(
      "select count(*)::text as n from audit_log where entity_type = 'document' " +
        "and new_values::text like '%Synthetic consent wording%'",
    );
    expect(Number(values.rows[0]?.n)).toBe(0);
  });

  it("answers 404 for another household's consent", async () => {
    const res = await h.callAs(
      'GET',
      `/api/portal/consents/${CONSENT_ADULT}/wording`,
      PORTAL.motherAuth,
    );
    expect(res.status).toBe(404);
  });

  it('records a withdrawal request and withdraws nothing', async () => {
    const res = await h.callAs('POST', '/api/portal/requests', PORTAL.motherAuth, {
      clientId: PORTAL.childA,
      kind: 'consent_withdrawal',
      consentId: CONSENT_A,
      note: 'We would like to stop the photographs, please.',
    });
    expect(res.status).toBe(201);

    const consent = await h.owner.query<{ status: string }>(
      'select status from consent where id = $1',
      [CONSENT_A],
    );
    expect(consent.rows[0]?.status).toBe('active');

    const agreements = (await (
      await h.callAs('GET', '/api/portal/agreements', PORTAL.motherAuth)
    ).json()) as AgreementsResponse;
    expect(agreements.agreements.find((row) => row.id === CONSENT_A)?.requestedWithdrawal).toBe(
      true,
    );
  });

  it('records an erasure request and erases nothing', async () => {
    const res = await h.callAs('POST', '/api/portal/requests', PORTAL.adultAuth, {
      clientId: PORTAL.adultClient,
      kind: 'erasure',
      consentId: null,
      note: null,
    });
    expect(res.status).toBe(201);
    const client = await h.owner.query<{ status: string }>(
      'select status from client where id = $1',
      [PORTAL.adultClient],
    );
    expect(client.rows[0]?.status).toBe('active');
  });

  it("answers 404 for a client that is not the household's", async () => {
    const res = await h.callAs('POST', '/api/portal/requests', PORTAL.motherAuth, {
      clientId: PORTAL.strangerClient,
      kind: 'erasure',
      consentId: null,
      note: null,
    });
    expect(res.status).toBe(404);
  });

  it('refuses a withdrawal that names no consent, and an erasure that names one', async () => {
    for (const body of [
      { clientId: PORTAL.childA, kind: 'consent_withdrawal', consentId: null, note: null },
      { clientId: PORTAL.childA, kind: 'erasure', consentId: CONSENT_A, note: null },
    ]) {
      const res = await h.callAs('POST', '/api/portal/requests', PORTAL.motherAuth, body);
      expect(res.status).toBe(400);
    }
  });
});

describe('the practice’s own Portal screen', () => {
  it('lists every contact with the state of their access, and never a number', async () => {
    const res = await h.callAs('GET', '/api/portal/access', PORTAL.adminAuth);
    expect(res.status).toBe(200);
    const body = (await res.json()) as AccessResponse;

    const mother = body.access.find((row) => row.contactId === PORTAL.motherContact);
    expect(mother).toMatchObject({ state: 'active', hasPhone: true, hasEmail: true });
    const father = body.access.find((row) => row.contactId === PORTAL.fatherContact);
    expect(father?.state).toBe('none');

    const text = JSON.stringify(body);
    expect(text).not.toContain(PORTAL_PHONES.father);
    expect(text).not.toContain('example.com');
  });

  it('refuses a lead practitioner, who may handle a request and not hand out access', async () => {
    expect((await h.callAs('GET', '/api/portal/access', PORTAL.leadAuth)).status).toBe(403);
    expect((await h.callAs('GET', '/api/portal/requests', PORTAL.leadAuth)).status).toBe(200);
  });

  it('refuses a household both office routes', async () => {
    expect((await h.callAs('GET', '/api/portal/access', PORTAL.motherAuth)).status).toBe(403);
    expect((await h.callAs('GET', '/api/portal/requests', PORTAL.motherAuth)).status).toBe(403);
  });

  it('refuses to invite a contact whose account belongs to the practice', async () => {
    // The founder's own case, written out: one person is a contact of a child's
    // record and the practice's admin, and one account is both. A portal link
    // rebinds the sign-in behind the account it names, so issuing one here
    // would be issuing a way into the console. Nothing is written.
    await h.owner.query(
      'insert into contact (id, tenant_id, client_id, user_id, relationship, given_name, ' +
        'family_name, is_legal_guardian, can_consent, can_receive_reports, can_pay) ' +
        "values ($1, $2, $3, $4, 'mother', 'Iris', 'Harbour', true, true, true, true)",
      [OFFICE_CONTACT, IDS.tenantA, PORTAL.strangerClient, PORTAL.admin],
    );

    const res = await h.callAs(
      'POST',
      `/api/portal/access/${OFFICE_CONTACT}/invite`,
      PORTAL.adminAuth,
    );
    expect(res.status).toBe(409);
    expect((await res.json()) as { error: string }).toMatchObject({ error: 'not_a_household' });

    const invites = await h.owner.query<{ n: string }>(
      'select count(*)::text as n from portal_invite where contact_id = $1',
      [OFFICE_CONTACT],
    );
    expect(Number(invites.rows[0]?.n)).toBe(0);
  });

  it('issues a link once, stores only its hash, and drafts the message in both languages', async () => {
    const res = await h.callAs(
      'POST',
      `/api/portal/access/${PORTAL.fatherContact}/invite`,
      PORTAL.adminAuth,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as InviteResponse;
    expect(body.kind).toBe('first_sign_in');
    expect(body.url).toContain('/portal/invite/');
    expect(body.message.en).toContain(body.url);
    expect(body.message.ar).toContain(body.url);
    expect(body.phone).toBe(PORTAL_PHONES.father);

    const token = body.url.split('/').pop() ?? '';
    const stored = await h.owner.query<{ token_hash: Buffer }>(
      'select token_hash from portal_invite where contact_id = $1 order by created_at desc limit 1',
      [PORTAL.fatherContact],
    );
    expect(stored.rows[0]?.token_hash.toString('hex')).toBe(
      createHash('sha256').update(token).digest('hex'),
    );
    // The token itself is nowhere in the table.
    const raw = await h.owner.query<{ n: string }>(
      'select count(*)::text as n from portal_invite where token_hash::text like $1',
      [`%${token.slice(0, 8)}%`],
    );
    expect(Number(raw.rows[0]?.n)).toBe(0);
  });

  it('builds the link on the configured public URL, whatever the request claims to be', async () => {
    // The answer to this route is a live token the practice copies into
    // WhatsApp. A Host header is whatever the caller typed, so the origin comes
    // from PUBLIC_APP_URL and from nowhere else.
    const api = h.apiWith({ publicAppUrl: 'https://portal.example.com/' });
    const res = await api.request(
      `https://not-this-host.example.net/api/portal/access/${PORTAL.fatherContact}/invite`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(await h.authHeader(PORTAL.adminAuth)) },
        body: '{}',
      },
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as InviteResponse;
    expect(body.url.startsWith('https://portal.example.com/portal/invite/')).toBe(true);
    expect(body.url).not.toContain('not-this-host');
  });

  it('issues nothing at all where no public URL is configured', async () => {
    // A laptop is the one place the request's own origin will do, and only
    // because it names this machine. Everywhere else an unset variable means
    // no account is created, no token is spent and no row is written.
    const cases = [
      { api: h.apiWith({ appEnv: 'staging' }), url: '/api/portal/access' },
      // Development, but a request that does not name this machine.
      { api: h.api, url: 'https://portal.example.net/api/portal/access' },
    ];
    for (const { api, url } of cases) {
      const res = await api.request(`${url}/${PORTAL.motherSecondContact}/invite`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(await h.authHeader(PORTAL.adminAuth)) },
        body: '{}',
      });
      expect(res.status).toBe(503);
      expect((await res.json()) as { error: string }).toMatchObject({
        error: 'public_app_url_unset',
      });
    }
    const invites = await h.owner.query<{ n: string }>(
      'select count(*)::text as n from portal_invite where contact_id = $1',
      [PORTAL.motherSecondContact],
    );
    expect(Number(invites.rows[0]?.n)).toBe(0);
  });

  it('revokes the account rather than the link, and closes every open invitation', async () => {
    const res = await h.callAs(
      'POST',
      `/api/portal/access/${PORTAL.adultContact}/revoke`,
      PORTAL.adminAuth,
    );
    expect(res.status).toBe(200);

    const account = await h.owner.query<{ status: string }>(
      'select status from app_user where id = $1',
      [PORTAL.adultUser],
    );
    expect(account.rows[0]?.status).toBe('suspended');
    // And the next request as her is refused by the fence itself.
    expect((await h.callAs('GET', '/api/portal/home', PORTAL.adultAuth)).status).toBe(403);

    // Put her back for whatever runs next.
    await h.owner.query("update app_user set status = 'active' where id = $1", [PORTAL.adultUser]);
  });

  it('shows the office the household’s asks, with the note and no telephone number', async () => {
    const res = await h.callAs('GET', '/api/portal/requests', PORTAL.adminAuth);
    expect(res.status).toBe(200);
    const body = (await res.json()) as OfficeRequestsResponse;
    expect(body.requests.length).toBeGreaterThan(0);
    expect(body.requests[0]).toMatchObject({ status: 'open' });
    expect(JSON.stringify(body)).not.toContain(PORTAL_PHONES.mother);
  });

  it('marks one handled, once', async () => {
    const list = (await (
      await h.callAs('GET', '/api/portal/requests', PORTAL.adminAuth)
    ).json()) as OfficeRequestsResponse;
    const open = list.requests.find((row) => row.status === 'open');
    if (!open) throw new Error('No open request to handle.');

    expect(
      (await h.callAs('POST', `/api/portal/requests/${open.id}/handle`, PORTAL.adminAuth)).status,
    ).toBe(200);
    // A second attempt finds nothing to mark.
    expect(
      (await h.callAs('POST', `/api/portal/requests/${open.id}/handle`, PORTAL.adminAuth)).status,
    ).toBe(404);
  });
});

describe('the door, which is the one route outside the fence', () => {
  it('answers 404 for a link that never existed and 410 for one that is dead', async () => {
    const unknown = await h.callOpen('POST', '/api/portal/invite/redeem', {
      token: NOTHING_LINK,
      email: 'cedar.meadow@example.com',
      password: CHOSEN,
    });
    expect(unknown.status).toBe(404);

    // A revoked link: dead, and the answer never says why.
    const issued = (await (
      await h.callAs('POST', `/api/portal/access/${PORTAL.fatherContact}/invite`, PORTAL.adminAuth)
    ).json()) as InviteResponse;
    const token = issued.url.split('/').pop() ?? '';
    await h.owner.query('update portal_invite set revoked_at = now() where contact_id = $1', [
      PORTAL.fatherContact,
    ]);
    const revoked = await h.callOpen('POST', '/api/portal/invite/redeem', {
      token,
      email: 'jasper.meadow@example.com',
      password: CHOSEN,
    });
    expect(revoked.status).toBe(410);
    expect((await revoked.json()) as { error: string }).toEqual({ error: 'gone' });
  });

  it('lets a household in, once, and refuses the second attempt', async () => {
    const issued = (await (
      await h.callAs('POST', `/api/portal/access/${PORTAL.fatherContact}/invite`, PORTAL.adminAuth)
    ).json()) as InviteResponse;
    const token = issued.url.split('/').pop() ?? '';

    const first = await h.callOpen('POST', '/api/portal/invite/redeem', {
      token,
      email: 'jasper.meadow@example.com',
      password: CHOSEN,
    });
    expect(first.status).toBe(200);
    const body = (await first.json()) as { ok: true; authId?: string };
    expect(body.ok).toBe(true);
    // The fallback answers the auth id, so the development door can sign a
    // token for it and the page can land the person on Home.
    expect(body.authId).toBeTruthy();

    // And that token now reaches the portal, as the father.
    const home = await h.callAs('GET', '/api/portal/home', body.authId ?? '');
    expect(home.status).toBe(200);
    expect(((await home.json()) as HomeResponse).clients).toHaveLength(1);

    const second = await h.callOpen('POST', '/api/portal/invite/redeem', {
      token,
      email: 'jasper.meadow@example.com',
      password: CHOSEN,
    });
    expect(second.status).toBe(410);
  });

  it('resets the password on an account that already signs in, and never rebinds it', async () => {
    // The other half of the door (docs/SPEC/client-portal.md section 7): the
    // adult has been through it once, so a fresh link is a password_reset and
    // must move her password rather than mint a second sign-in and repoint the
    // account at it. The seam is counted here, because "which half ran" is
    // exactly the thing that cannot be read back off the row afterwards.
    const asked = { created: 0, setPassword: [] as string[] };
    const counting: AuthAdminProvider = {
      ...h.authAdmin,
      async createUser(input) {
        asked.created += 1;
        return h.authAdmin.createUser(input);
      },
      async setPassword(authId, password) {
        asked.setPassword.push(authId);
        return h.authAdmin.setPassword(authId, password);
      },
    };
    const api = h.apiWith({ authAdmin: counting });
    const office = {
      'content-type': 'application/json',
      ...(await h.authHeader(PORTAL.adminAuth)),
    };

    const issued = (await (
      await api.request(`/api/portal/access/${PORTAL.adultContact}/invite`, {
        method: 'POST',
        headers: office,
        body: '{}',
      })
    ).json()) as InviteResponse;
    expect(issued.kind).toBe('password_reset');

    const res = await api.request('/api/portal/invite/redeem', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        token: issued.url.split('/').pop() ?? '',
        email: 'saffron.dune@example.com',
        password: CHOSEN,
      }),
    });
    expect(res.status).toBe(200);
    // setPassword on the sign-in that already stands, and nothing created.
    expect(asked.setPassword).toEqual([PORTAL.adultAuth]);
    expect(asked.created).toBe(0);

    const account = await h.owner.query<{ auth_id: string; email: string | null }>(
      'select auth_id, email from app_user where id = $1',
      [PORTAL.adultUser],
    );
    expect(account.rows[0]?.auth_id).toBe(PORTAL.adultAuth);
    // And the link is spent, exactly as a first sign-in's would be.
    const spent = await h.owner.query<{ used_at: Date | null }>(
      'select used_at from portal_invite where contact_id = $1 order by created_at desc limit 1',
      [PORTAL.adultContact],
    );
    expect(spent.rows[0]?.used_at).not.toBeNull();
  });

  it('refuses a password shorter than twelve characters, without saying more', async () => {
    const res = await h.callOpen('POST', '/api/portal/invite/redeem', {
      token: NOTHING_LINK,
      email: 'cedar.meadow@example.com',
      password: 'short',
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { code?: string }).toMatchObject({ code: 'password' });
  });

  it('refuses to open at all where the seam is the fallback and the deployment is not a laptop', async () => {
    // Staging with no SUPABASE_AUTH_ADMIN_KEY is the case: the fallback would
    // spend the invitation and write a fabricated uuid onto app_user.auth_id
    // with no sign-in behind it. Development and the tests are the two words
    // that pass, which is what authAdminFromEnv asks as well.
    for (const appEnv of ['staging', 'production', undefined]) {
      const api = h.apiWith({ appEnv });
      const res = await api.request('/api/portal/invite/redeem', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          token: NOTHING_LINK,
          email: 'cedar.meadow@example.com',
          password: CHOSEN,
        }),
      });
      expect(res.status).toBe(503);
      expect((await res.json()) as { error: string }).toEqual({ error: 'auth_admin_unavailable' });
    }
  });

  it('needs no session at all, and a session-bearing request is no different', async () => {
    // The door sits ahead of the fence, so an authorization header is simply
    // not read: what decides is the token in the body and nothing else.
    const res = await h.api.request('/api/portal/invite/redeem', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer not-a-token' },
      body: JSON.stringify({
        token: NOTHING_LINK,
        email: 'cedar.meadow@example.com',
        password: CHOSEN,
      }),
    });
    expect(res.status).toBe(404);
  });
});
