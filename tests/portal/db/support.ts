import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SignJWT } from 'jose';
import pg from 'pg';
import { createPool } from '../../../app/api/_middleware/db';
import { localDiskStorage } from '../../../app/api/_middleware/storage';
import { createTokenVerifier } from '../../../app/api/_middleware/token-verifier';
import { createApi, type ApiOptions } from '../../../app/api/create-api';
import { fakeAuthAdmin, type AuthAdminProvider } from '../../../app/api/portal/mount';
import {
  freshDatabase,
  IDS,
  asApiRole,
  seedClient,
  seedContact,
  seedTenant,
  seedUser,
  setAuditContext,
} from '../../db/helpers';

/**
 * One synthetic household, built the same way in every portal database test.
 *
 * Three people sign in: the mother of a child, an adult who is her own
 * contact, and the child's own login — the one case that sees no figure
 * (docs/SPEC/client-portal.md section 2). Two clients belong to the mother, so
 * every test that asks "and the other household?" has one to ask about.
 *
 * Everything here is invented: names from `db/seed/names.ts`, telephone
 * numbers in the hand-written `+971 50 000 00xx` block, addresses at
 * example.com and ids in the reserved shape (.claude/rules/testing.md).
 */

/** The people and the rows they touch. Kind `1`, which no other suite uses. */
export const PORTAL = {
  /** The mother of two children, in English. */
  motherUser: '00000001-0000-4000-8000-000000000001',
  motherAuth: '00000001-0000-4000-8000-000000000002',
  motherContact: '00000001-0000-4000-8000-000000000003',
  /** Her second child's contact row: the same person, the other record. */
  motherSecondContact: '00000001-0000-4000-8000-000000000004',
  /** An adult who is her own contact, in Arabic, in another household. */
  adultUser: '00000001-0000-4000-8000-000000000005',
  adultAuth: '00000001-0000-4000-8000-000000000006',
  adultContact: '00000001-0000-4000-8000-000000000007',
  /** A young person's own login, on the first child's record. */
  minorUser: '00000001-0000-4000-8000-000000000008',
  minorAuth: '00000001-0000-4000-8000-000000000009',
  minorContact: '00000001-0000-4000-8000-00000000000a',
  /** A father with no login at all: a contact row is not an account. */
  fatherContact: '00000001-0000-4000-8000-00000000000b',

  /** The practice. */
  admin: '00000001-0000-4000-8000-000000000011',
  adminAuth: '00000001-0000-4000-8000-000000000012',
  leadPractitioner: '00000001-0000-4000-8000-000000000013',
  leadAuth: '00000001-0000-4000-8000-000000000014',
  practitioner: '00000001-0000-4000-8000-000000000015',
  practitionerAuth: '00000001-0000-4000-8000-000000000016',
  finance: '00000001-0000-4000-8000-000000000017',
  financeAuth: '00000001-0000-4000-8000-000000000018',

  /** The households. `childA` is the minor; `childB` is the mother's second. */
  childA: '00000001-0000-4000-8000-000000000021',
  childB: '00000001-0000-4000-8000-000000000022',
  adultClient: '00000001-0000-4000-8000-000000000023',
  /** Nobody's household: the record every deny test asks about. */
  strangerClient: '00000001-0000-4000-8000-000000000024',

  serviceType: '00000001-0000-4000-8000-000000000031',
  /** The person who drives to the visit. Never named to a household (section 7). */
  practitionerRow: '00000001-0000-4000-8000-000000000032',
  homeChildA: '00000001-0000-4000-8000-000000000033',
  homeChildB: '00000001-0000-4000-8000-000000000034',
  homeAdult: '00000001-0000-4000-8000-000000000035',
  homeStranger: '00000001-0000-4000-8000-000000000036',
} as const;

/** Which home belongs to which client, so a fixture never has to remember. */
export const PORTAL_HOMES: Readonly<Record<string, string>> = {
  [PORTAL.childA]: PORTAL.homeChildA,
  [PORTAL.childB]: PORTAL.homeChildB,
  [PORTAL.adultClient]: PORTAL.homeAdult,
  [PORTAL.strangerClient]: PORTAL.homeStranger,
};

/** Hand-written fixtures keep +971 50 000 00xx; the seed keeps 1xxx. */
export const PORTAL_PHONES = {
  mother: '+971500000021',
  adult: '+971500000022',
  father: '+971500000023',
  practice: '+971500000024',
} as const;

/**
 * A child, and one who stays a child for years yet: the money-visibility test
 * moves this date itself to stand on either side of an eighteenth birthday, and
 * every other suite wants a minor that no passing of time turns into an adult.
 */
export const CHILD_A_BIRTHDAY = '2014-09-05';

type HouseholdOptions = {
  /** The practice's own time zone, which decides when a birthday arrives. */
  timezone?: string;
};

/**
 * The whole fixture, written as the table owner so no policy is in the way.
 * Every test that follows reads it back as `app_role`, which is where the
 * policies live.
 */
export async function seedPortalHousehold(
  owner: pg.Client,
  options: HouseholdOptions = {},
): Promise<void> {
  await seedTenant(owner, IDS.tenantA, IDS.ownerA, 'Synthetic Studio');
  if (options.timezone) {
    await owner.query('update tenant set timezone = $1 where id = $2', [
      options.timezone,
      IDS.tenantA,
    ]);
  }
  await owner.query('update tenant set whatsapp_number = $1 where id = $2', [
    PORTAL_PHONES.practice,
    IDS.tenantA,
  ]);
  await owner.query('update app_user set auth_id = $1 where id = $2', [
    '00000001-0000-4000-8000-000000000010',
    IDS.ownerA,
  ]);

  for (const person of [
    {
      id: PORTAL.motherUser,
      authId: PORTAL.motherAuth,
      name: 'Hazel Meadow',
      roles: ['client_contact'],
    },
    {
      id: PORTAL.adultUser,
      authId: PORTAL.adultAuth,
      name: 'Saffron Dune',
      roles: ['client_contact'],
    },
    {
      id: PORTAL.minorUser,
      authId: PORTAL.minorAuth,
      name: 'Cedar Meadow',
      roles: ['client_contact'],
    },
    { id: PORTAL.admin, authId: PORTAL.adminAuth, name: 'Iris Harbour', roles: ['admin'] },
    {
      id: PORTAL.leadPractitioner,
      authId: PORTAL.leadAuth,
      name: 'Rowan Ridge',
      roles: ['lead_practitioner'],
    },
    {
      id: PORTAL.practitioner,
      authId: PORTAL.practitionerAuth,
      name: 'Basil Vale',
      roles: ['practitioner'],
    },
    { id: PORTAL.finance, authId: PORTAL.financeAuth, name: 'Pearl Cove', roles: ['finance'] },
  ]) {
    await seedUser(owner, {
      id: person.id,
      tenantId: IDS.tenantA,
      authId: person.authId,
      displayName: person.name,
      roles: person.roles,
    });
  }
  await owner.query("update app_user set preferred_locale = 'ar' where id = $1", [
    PORTAL.adultUser,
  ]);

  await seedClient(owner, IDS.tenantA, PORTAL.childA, IDS.ownerA, 'Meadow');
  await seedClient(owner, IDS.tenantA, PORTAL.childB, IDS.ownerA, 'Meadow');
  await seedClient(owner, IDS.tenantA, PORTAL.adultClient, IDS.ownerA, 'Dune');
  await seedClient(owner, IDS.tenantA, PORTAL.strangerClient, IDS.ownerA, 'Summit');
  await owner.query("update client set status = 'active', date_of_birth = $2 where id = $1", [
    PORTAL.childA,
    CHILD_A_BIRTHDAY,
  ]);
  await owner.query(
    "update client set status = 'active', date_of_birth = '2016-04-02' where id = $1",
    [PORTAL.childB],
  );
  await owner.query(
    "update client set status = 'active', date_of_birth = '1990-01-01', preferred_locale = 'ar' " +
      'where id = $1',
    [PORTAL.adultClient],
  );
  await owner.query("update client set status = 'active' where id = $1", [PORTAL.strangerClient]);

  // The contacts. seedContact writes a mother with an identity hash; the rest
  // are written here because their relationships differ.
  await seedContact(owner, IDS.tenantA, PORTAL.motherContact, PORTAL.childA, 'portal-mother-a');
  await owner.query(
    'update contact set user_id = $1, given_name = $2, family_name = $3, phone = $4, ' +
      'email = $5, whatsapp_opt_in = true, can_receive_reports = true, can_pay = true ' +
      'where id = $6',
    [
      PORTAL.motherUser,
      'Hazel',
      'Meadow',
      PORTAL_PHONES.mother,
      'hazel.meadow@example.com',
      PORTAL.motherContact,
    ],
  );
  await owner.query(
    'insert into contact (id, tenant_id, client_id, user_id, relationship, given_name, ' +
      'family_name, is_legal_guardian, can_consent, can_receive_reports, can_pay, phone, email) ' +
      "values ($1, $2, $3, $4, 'mother', 'Hazel', 'Meadow', true, true, true, true, $5, $6)",
    [
      PORTAL.motherSecondContact,
      IDS.tenantA,
      PORTAL.childB,
      PORTAL.motherUser,
      PORTAL_PHONES.mother,
      'hazel.meadow@example.com',
    ],
  );
  await owner.query(
    'insert into contact (id, tenant_id, client_id, relationship, given_name, family_name, ' +
      'is_legal_guardian, can_consent, can_receive_reports, can_pay, phone, email) ' +
      "values ($1, $2, $3, 'father', 'Jasper', 'Meadow', true, false, true, false, $4, $5)",
    [
      PORTAL.fatherContact,
      IDS.tenantA,
      PORTAL.childA,
      PORTAL_PHONES.father,
      'jasper.meadow@example.com',
    ],
  );
  await owner.query(
    'insert into contact (id, tenant_id, client_id, user_id, relationship, given_name, ' +
      'family_name, given_name_ar, family_name_ar, is_legal_guardian, can_consent, ' +
      'can_receive_reports, can_pay, phone, email) ' +
      "values ($1, $2, $3, $4, 'self', 'Saffron', 'Dune', 'زعفران', 'كثيب', false, true, " +
      'true, true, $5, $6)',
    [
      PORTAL.adultContact,
      IDS.tenantA,
      PORTAL.adultClient,
      PORTAL.adultUser,
      PORTAL_PHONES.adult,
      'saffron.dune@example.com',
    ],
  );
  // The child's own login. `self` on a client under eighteen: the one row the
  // money policies narrow (docs/SPEC/client-portal.md section 6.3).
  await owner.query(
    'insert into contact (id, tenant_id, client_id, user_id, relationship, given_name, ' +
      'family_name, is_legal_guardian, can_consent, can_receive_reports, can_pay) ' +
      "values ($1, $2, $3, $4, 'self', 'Cedar', 'Meadow', false, false, true, false)",
    [PORTAL.minorContact, IDS.tenantA, PORTAL.childA, PORTAL.minorUser],
  );

  await owner.query(
    'insert into service_type (id, tenant_id, code, name, name_ar, duration_minutes, ' +
      "delivery_modes) values ($1, $2, 'nf-session', 'Neurofeedback session', " +
      "'جلسة تدريب', 45, '{home,studio}')",
    [PORTAL.serviceType, IDS.tenantA],
  );
  await owner.query(
    'insert into practitioner (id, tenant_id, user_id, display_name_ar) values ($1, $2, $3, $4)',
    [PORTAL.practitionerRow, IDS.tenantA, PORTAL.practitioner, 'ريحان'],
  );
  for (const [clientId, locationId] of Object.entries(PORTAL_HOMES)) {
    await owner.query(
      'insert into location (id, tenant_id, owner_type, owner_id, label, emirate, ' +
        'entrance_point, display_address, is_primary, access_notes, makani_number, created_by) ' +
        "values ($1, $2, 'client', $3, 'home', 'DXB', " +
        "extensions.st_geogfromtext('SRID=4326;POINT(55.27 25.20)'), $4, true, " +
        "'Ring twice', '0000000001', $5)",
      [
        locationId,
        IDS.tenantA,
        clientId,
        `Villa 1, Street 2, Synthetic Community, Dubai (${clientId.slice(-2)})`,
        IDS.ownerA,
      ],
    );
    await owner.query('update client set primary_location_id = $1 where id = $2', [
      locationId,
      clientId,
    ]);
  }
}

/**
 * One visit, at a distinct hour so the exclusion constraint on the
 * practitioner's own diary never has two fixtures fighting over a slot.
 */
export async function seedAppointment(
  owner: pg.Client,
  appointment: {
    id: string;
    clientId: string;
    /** Days from now: negative for a visit that has already happened. */
    inDays: number;
    hour: number;
    status: string;
  },
): Promise<void> {
  const home = PORTAL_HOMES[appointment.clientId];
  if (!home) throw new Error(`No seeded home for client ${appointment.clientId}.`);
  await owner.query(
    'insert into appointment (id, tenant_id, client_id, practitioner_id, service_type_id, ' +
      'location_id, delivery_mode, window_start, window_end, status) values ' +
      "($1, $2, $3, $4, $5, $6, 'home', $7::timestamptz, $7::timestamptz + interval " +
      "'45 minutes', $8::appointment_status)",
    [
      appointment.id,
      IDS.tenantA,
      appointment.clientId,
      PORTAL.practitionerRow,
      PORTAL.serviceType,
      home,
      windowStart(appointment.inDays, appointment.hour),
      appointment.status,
    ],
  );
}

/**
 * One consent wording, as a `consent_text` document (migration 902). Written
 * as the table owner, so the write guard of 903 stands aside; a wording is
 * only ever filed by the owner or an admin in a real request.
 */
export async function seedWording(
  owner: pg.Client,
  wording: {
    id: string;
    purpose: string;
    locale: 'en' | 'ar';
    version: string;
    status: 'draft' | 'approved';
    retired?: boolean;
  },
): Promise<void> {
  await owner.query(
    'insert into document (id, tenant_id, client_id, kind, storage_key, mime_type, sha256, ' +
      'is_immutable, purpose, locale, version, status, retired_at) values ' +
      "($1::uuid, $2, null, 'consent_text', $3, 'text/markdown', " +
      "sha256(convert_to($3, 'UTF8')), true, " +
      '$4::consent_purpose, $5::locale, $6, $7::consent_text_status, ' +
      'case when $8::boolean then now() else null end)',
    [
      wording.id,
      IDS.tenantA,
      `tenant/${IDS.tenantA}/practice/${wording.id}`,
      wording.purpose,
      wording.locale,
      wording.version,
      wording.status,
      wording.retired ?? false,
    ],
  );
}

/** One consent, pointing at the exact wording that person was shown. */
export async function seedConsent(
  owner: pg.Client,
  consent: {
    id: string;
    clientId: string;
    contactId: string;
    purpose: string;
    wordingId: string;
    status?: 'active' | 'withdrawn';
  },
): Promise<void> {
  await owner.query(
    'insert into consent (id, tenant_id, client_id, given_by_contact_id, purpose, version, ' +
      'text_document_id, status, given_at, withdrawn_at, method) values ' +
      '($1, $2, $3, $4, $5::consent_purpose, 1, $6, $7::consent_status, now() - interval ' +
      "'30 days', $8, 'app_signature')",
    [
      consent.id,
      IDS.tenantA,
      consent.clientId,
      consent.contactId,
      consent.purpose,
      consent.wordingId,
      consent.status ?? 'active',
      consent.status === 'withdrawn' ? new Date() : null,
    ],
  );
}

const PRACTICE_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' });

/**
 * A moment in the practice's own day, written as an absolute instant. The day
 * is named in Asia/Dubai, which is the zone the `+04:00` on the end of it
 * means: read in UTC, `inDays: 0` names yesterday's practice day for the four
 * hours after midnight there, and every other offset slides with it.
 */
function windowStart(inDays: number, hour: number): string {
  const day = PRACTICE_DAY.format(new Date(Date.now() + inDays * 24 * 60 * 60 * 1000));
  return `${day}T${String(hour).padStart(2, '0')}:00:00+04:00`;
}

/** Reads something back as one of the household, with their stamp and roles. */
export async function asContact<T>(
  owner: pg.Client,
  userId: string,
  fn: () => Promise<T>,
  roles = 'client_contact',
): Promise<T> {
  await setAuditContext(owner, userId);
  return asApiRole(owner, IDS.tenantA, fn, roles);
}

/**
 * The money on one record: a bundle bought, its credits, an invoice and a
 * payment against it. Enough for every figure the portal's money screen shows
 * and for the seven restrictive policies to have something to hide.
 */
export const PORTAL_MONEY = {
  package: '00000001-0000-4000-8000-000000000061',
  purchase: '00000001-0000-4000-8000-000000000062',
  entitlementUsed: '00000001-0000-4000-8000-000000000063',
  entitlementLeft: '00000001-0000-4000-8000-000000000064',
  invoice: '00000001-0000-4000-8000-000000000065',
  invoiceLine: '00000001-0000-4000-8000-000000000066',
  payment: '00000001-0000-4000-8000-000000000067',
  /** The visit the used credit was spent on: a credit is consumed by something. */
  consumedAt: '00000001-0000-4000-8000-000000000068',
} as const;

/** The figures, in fils, so a test never writes a decimal number for money. */
export const PORTAL_FIGURES = {
  /** Two sessions at the practice's own AED 700 net: what the credits total. */
  creditNetFils: 70_000,
  purchaseNetFils: 140_000,
  invoiceGrossFils: 140_000,
  paymentFils: 40_000,
  /** What is left owing once the payment is set against the invoice. */
  outstandingFils: 100_000,
} as const;

export async function seedMoney(owner: pg.Client, clientId: string): Promise<void> {
  // One transaction, because the credits and the purchase they belong to have
  // to arrive together: app.check_purchase_allocation (migration 403) is a
  // deferred constraint trigger, so it asks at the commit whether the credits
  // total what was paid, and a purchase written on its own would never balance.
  await seedAppointment(owner, {
    id: PORTAL_MONEY.consumedAt,
    clientId,
    inDays: -30,
    hour: 9,
    status: 'completed',
  });
  await owner.query('begin');
  await owner.query(
    'insert into package (id, tenant_id, code, name, name_ar, list_price_fils, status) ' +
      "values ($1, $2, 'silver-under-test', 'Silver', 'الفضية', $3, 'active') " +
      'on conflict (tenant_id, code) do nothing',
    [PORTAL_MONEY.package, IDS.tenantA, PORTAL_FIGURES.purchaseNetFils],
  );
  await owner.query(
    'insert into package_purchase (id, tenant_id, client_id, package_id, package_name, ' +
      'package_name_ar, purchased_on, net_fils, vat_fils, vat_rate_basis_points, ' +
      'vat_setting_version, list_price_fils, expires_on) values ' +
      "($1, $2, $3, $4, 'Silver', 'الفضية', current_date, $5, 0, 0, 1, $5, " +
      "current_date + interval '180 days')",
    [
      PORTAL_MONEY.purchase,
      IDS.tenantA,
      clientId,
      PORTAL_MONEY.package,
      PORTAL_FIGURES.purchaseNetFils,
    ],
  );
  for (const [id, status] of [
    [PORTAL_MONEY.entitlementUsed, 'consumed'],
    [PORTAL_MONEY.entitlementLeft, 'available'],
  ] as const) {
    await owner.query(
      'insert into entitlement (id, tenant_id, client_id, service_type_id, source_type, ' +
        'package_purchase_id, status, allocated_net_fils, vat_rate_basis_points, ' +
        'vat_setting_version, expires_on, consumption_kind, consumed_at, ' +
        "consumed_by_appointment_id) values ($1, $2, $3, $4, 'package', $5, " +
        "$6::entitlement_status, $7, 0, 1, current_date + interval '180 days', $8, $9, $10)",
      [
        id,
        IDS.tenantA,
        clientId,
        PORTAL.serviceType,
        PORTAL_MONEY.purchase,
        status,
        PORTAL_FIGURES.creditNetFils,
        status === 'consumed' ? 'session' : null,
        status === 'consumed' ? new Date() : null,
        status === 'consumed' ? PORTAL_MONEY.consumedAt : null,
      ],
    );
  }
  await owner.query(
    // `reference` is a generated column: the practice's numbering is the
    // database's to write, never a fixture's (migration 402).
    'insert into invoice (id, tenant_id, client_id, number, kind, issued_on, ' +
      'net_fils, vat_fils, gross_fils, supplier_legal_name, package_purchase_id) values ' +
      "($1, $2, $3, 1, 'package', current_date, $4, 0, $4, 'Synthetic Studio', $5)",
    [
      PORTAL_MONEY.invoice,
      IDS.tenantA,
      clientId,
      PORTAL_FIGURES.invoiceGrossFils,
      PORTAL_MONEY.purchase,
    ],
  );
  await owner.query(
    'insert into invoice_line (id, tenant_id, invoice_id, client_id, line_no, description, ' +
      'quantity, unit_net_fils, net_fils, vat_rate_basis_points, vat_setting_version, ' +
      "vat_fils, gross_fils) values ($1, $2, $3, $4, 1, 'Silver', 1, $5, $5, 0, 1, 0, $5)",
    [
      PORTAL_MONEY.invoiceLine,
      IDS.tenantA,
      PORTAL_MONEY.invoice,
      clientId,
      PORTAL_FIGURES.invoiceGrossFils,
    ],
  );
  await owner.query(
    'insert into payment (id, tenant_id, client_id, amount_fils, method, received_at, ' +
      "receipt_number) values ($1, $2, $3, $4, 'transfer', now(), 1)",
    [PORTAL_MONEY.payment, IDS.tenantA, clientId, PORTAL_FIGURES.paymentFils],
  );
  await owner.query('commit');
}

/**
 * A whole API, pointed at this fixture's database, with the portal mounted the
 * way `createApi` mounts it — no route registered by hand, so a dropped mount
 * call fails a test loudly rather than falling through to the catch-all 404.
 *
 * The two seams are the fallbacks: documents in a folder under the system
 * temporary directory, sign-ins in this process's memory. That is what a
 * laptop runs, and it is the forced-fallback proof the seam pattern asks for
 * (docs/SEAMS.md) applied to the whole invitation path rather than to one call.
 */
export type PortalHarness = {
  owner: pg.Client;
  pool: pg.Pool;
  api: ReturnType<typeof createApi>;
  storage: ReturnType<typeof localDiskStorage>;
  authAdmin: AuthAdminProvider;
  /**
   * The same API over the same fixture with an option or two the server would
   * set differently — a deployment that is not a laptop, a public URL that was
   * never configured, a seam that counts what the door asks of it.
   */
  apiWith: (overrides: Partial<ApiOptions>) => ReturnType<typeof createApi>;
  /** A bearer header for that person, for a request built by hand. */
  authHeader: (authId: string) => Promise<Record<string, string>>;
  /** A signed request as the person whose auth id is given. */
  callAs: (
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    authId: string,
    body?: unknown,
  ) => Promise<Response>;
  /** The same, with no session at all: what the door answers. */
  callOpen: (method: 'POST', path: string, body?: unknown) => Promise<Response>;
  close: () => Promise<void>;
};

export const PORTAL_SECRET = 'test-secret-that-unlocks-nothing-0123456789';
export const PORTAL_ISSUER = 'http://localhost:54321/auth/v1';

export async function startPortalHarness(
  now: () => Date = () => new Date(),
): Promise<PortalHarness> {
  const owner = await freshDatabase();
  await seedPortalHousehold(owner);

  const apiUrl = process.env.API_DATABASE_URL;
  if (!apiUrl) throw new Error('API_DATABASE_URL is not set.');
  const pool = createPool(apiUrl);
  const storage = localDiskStorage({
    dir: mkdtempSync(join(tmpdir(), 'mcwellness-portal-')),
    signingSecret: Buffer.alloc(32, 9),
  });
  const authAdmin = fakeAuthAdmin();
  const options: ApiOptions = {
    pool,
    verifier: createTokenVerifier({ issuer: PORTAL_ISSUER, secret: PORTAL_SECRET }),
    now,
    storage,
    authAdmin,
    // What the server passes, from the environment it is running in. The
    // database tests refuse to run outside development (tests/db/helpers.ts),
    // so this is 'development' and the door and the invitation route read it
    // as such.
    appEnv: process.env.APP_ENV,
  };
  const api = createApi(options);

  const key = new TextEncoder().encode(PORTAL_SECRET);
  async function mint(sub: string): Promise<string> {
    return new SignJWT({ role: 'authenticated' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(PORTAL_ISSUER)
      .setAudience('authenticated')
      .setSubject(sub)
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(key);
  }

  return {
    owner,
    pool,
    api,
    storage,
    authAdmin,
    apiWith(overrides) {
      return createApi({ ...options, ...overrides });
    },
    async authHeader(authId) {
      return { authorization: `Bearer ${await mint(authId)}` };
    },
    async callAs(method, path, authId, body) {
      const headers: Record<string, string> = { authorization: `Bearer ${await mint(authId)}` };
      const init: RequestInit = { method, headers };
      if (method !== 'GET') {
        // The API takes JSON bodies only (app/api/_middleware/security.ts), and
        // says 415 to a write that does not declare one — including a write
        // with no body at all, such as revoking access.
        headers['content-type'] = 'application/json';
        init.body = JSON.stringify(body ?? {});
      }
      return api.request(path, init);
    },
    async callOpen(method, path, body) {
      return api.request(path, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      });
    },
    async close() {
      await pool.end();
      await owner.end();
    },
  };
}
