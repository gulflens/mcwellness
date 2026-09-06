import { SignJWT } from 'jose';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from '../../app/api/_middleware/db';
import { createTokenVerifier } from '../../app/api/_middleware/token-verifier';
import { createApi } from '../../app/api/create-api';
import type { PracticeResponse } from '../../app/api/practice/schema';
import {
  AUTH,
  IDS,
  asApiRole,
  freshDatabase,
  rejectsWith,
  rolledBack,
  seedClient,
  seedLocation,
  seedPractitioner,
  seedServiceType,
  seedTenant,
} from './helpers';

/**
 * The VAT threshold watch (migration 953, and the second of the small things
 * in docs/PLAN/pieces-seven-to-nine.md).
 *
 * Three things are proved here: the window is the twelve months before the day
 * asked about and nothing older; the figure does not move with who is
 * looking — an erased household's invoices count, because a supply the
 * practice made is a supply it made; and a call-out fee the practice forgave
 * is left out, because a charge nobody owes is not a supply at all
 * (migration 957, `docs/CHANGE-REQUESTS/billing-06.md` request 2). The two
 * marks themselves and what to say at each are
 * `domain/shared/vat-threshold.ts`'s and are tested there.
 *
 * Everything is synthetic and inside the reserved ranges
 * (.claude/rules/testing.md).
 */

const SECRET = 'test-secret-that-unlocks-nothing-0123456789';
const ISSUER = 'http://localhost:54321/auth/v1';
const KEY = new TextEncoder().encode(SECRET);

const id = (slot: number): string => `0000000c-0000-4000-8000-${String(slot).padStart(12, '0')}`;
const STANDING = id(11);
const ERASED = id(12);
/** What a call-out fee needs before it can name a visit: who, what and where. */
const PRACTITIONER = id(13);
const SERVICE = id(14);
const LOCATION = id(15);
const CALLED_OFF = id(16);
const FEE_INVOICE = id(17);

const AS_OF = '2026-09-06';
/** Inside the window, outside it, and the erased household's own. */
const RECENT_NET = 200_000;
const OLD_NET = 900_000;
const ERASED_NET = 50_000;
/** The practice's own call-out fee, net of VAT (scheduling_setting.unfit_fee_fils). */
const FEE_NET = 15_000;

let owner: pg.Client;
let pool: ReturnType<typeof createPool>;
let api: ReturnType<typeof createApi>;

async function invoice(clientId: string, issuedOn: string, netFils: number): Promise<void> {
  await owner.query(
    'insert into invoice (tenant_id, client_id, number, kind, issued_on, net_fils, vat_fils, ' +
      // Net, with no VAT: this practice is not registered for it, and migration
      // 406 refuses an invoice carrying VAT for one that is not.
      "gross_fils) values ($1, $2, app.next_invoice_number(), 'statement', $3::date, $4, 0, $4)",
    [IDS.tenantA, clientId, issuedOn, netFils],
  );
}

/**
 * A call-out fee for a visit that was called off, forgiven by the practice.
 *
 * The fee has to name a visit (`invoice_source_matches_kind`, migration 408),
 * so the visit and the three rows a visit needs are made first. The
 * appointment is left as it was proposed rather than called off, because a
 * status change is what posts a fee of the database's own accord and this
 * fixture writes the row it wants to ask about.
 */
async function seedWaivedFee(): Promise<void> {
  await seedServiceType(owner, IDS.tenantA, SERVICE, 'neurofeedback-session');
  await seedPractitioner(owner, IDS.tenantA, PRACTITIONER, IDS.ownerA);
  await seedLocation(owner, IDS.tenantA, LOCATION, STANDING, IDS.ownerA);
  await owner.query(
    'insert into appointment (id, tenant_id, client_id, practitioner_id, service_type_id, ' +
      'location_id, delivery_mode, window_start, window_end) values ($1, $2, $3, $4, $5, $6, ' +
      "'home', $7::timestamptz, $7::timestamptz + interval '45 minutes')",
    [CALLED_OFF, IDS.tenantA, STANDING, PRACTITIONER, SERVICE, LOCATION, '2026-08-15T06:00:00Z'],
  );
  await owner.query(
    'insert into invoice (id, tenant_id, client_id, number, kind, issued_on, net_fils, ' +
      'vat_fils, gross_fils, appointment_id, waived_at, waived_by, waiver_reason) values ' +
      "($1, $2, $3, app.next_invoice_number(), 'call_out_fee', $4::date, $5, 0, $5, $6, " +
      '$4::date, $7, $8)',
    [
      FEE_INVOICE,
      IDS.tenantA,
      STANDING,
      '2026-08-15',
      FEE_NET,
      CALLED_OFF,
      IDS.ownerA,
      'The family had an emergency; the practice let it go.',
    ],
  );
}

/**
 * The figure, read inside whatever transaction the caller is already in.
 * `asApiRole` takes a savepoint rather than a transaction, so a test that has
 * changed a row and wants to see the effect can call this and roll the whole
 * thing back itself.
 */
async function suppliesHere(roles: string, asOf = AS_OF): Promise<number> {
  return asApiRole(
    owner,
    IDS.tenantA,
    async () => {
      const { rows } = await owner.query<{ total: string }>(
        'select app.vat_taxable_supplies_fils($1::date)::text as total',
        [asOf],
      );
      return Number(rows[0]?.total ?? -1);
    },
    roles,
  );
}

async function supplies(roles: string, asOf = AS_OF): Promise<number> {
  return rolledBack(owner, () => suppliesHere(roles, asOf));
}

beforeAll(async () => {
  owner = await freshDatabase();
  await seedTenant(owner, IDS.tenantA, IDS.ownerA, 'Synthetic Studio A');
  await owner.query('update app_user set auth_id = $2 where id = $1', [IDS.ownerA, AUTH.ownerA]);
  // `app.next_invoice_number` and the supplier stamp both read the practice
  // out of the session, so it is named once here rather than in every insert.
  await owner.query("select set_config('app.tenant_id', $1, false)", [IDS.tenantA]);
  await seedClient(owner, IDS.tenantA, STANDING, IDS.ownerA, 'Harbour');
  await seedClient(owner, IDS.tenantA, ERASED, IDS.ownerA, 'Meadow');

  await invoice(STANDING, '2026-08-01', RECENT_NET);
  // Thirteen months back: outside the window, and by enough that an off-by-one
  // in the boundary would show up as a large wrong figure rather than a small one.
  await invoice(STANDING, '2025-08-01', OLD_NET);
  await invoice(ERASED, '2026-07-01', ERASED_NET);
  await owner.query("update client set status = 'erased' where id = $1", [ERASED]);

  await seedWaivedFee();

  const apiUrl = process.env.API_DATABASE_URL;
  if (!apiUrl) throw new Error('API_DATABASE_URL is not set.');
  pool = createPool(apiUrl);
  api = createApi({ pool, verifier: createTokenVerifier({ issuer: ISSUER, secret: SECRET }) });
});

afterAll(async () => {
  await pool.end();
  await owner.end();
});

describe('app.vat_taxable_supplies_fils', () => {
  it('counts the twelve months before the day asked about, and nothing older', async () => {
    expect(await supplies('owner')).toBe(RECENT_NET + ERASED_NET);
  });

  it('moves its window with the day it is given', async () => {
    // A year earlier, only the old invoice is inside it.
    expect(await supplies('owner', '2025-09-06')).toBe(OLD_NET);
    // And a year later, nothing at all is.
    expect(await supplies('owner', '2027-09-06')).toBe(0);
  });

  it('counts an erased household’s supplies, and answers every role the same', async () => {
    const asOwner = await supplies('owner');
    expect(await supplies('admin')).toBe(asOwner);
    expect(await supplies('finance')).toBe(asOwner);
    expect(asOwner).toBeGreaterThan(RECENT_NET);
  });

  it('leaves a forgiven call-out fee out, and counts the very same fee unwaived', async () => {
    // The fee is inside the window and issued to a household in good standing,
    // so the only thing keeping it out of the figure is the waiver.
    await rolledBack(owner, async () => {
      expect(await suppliesHere('owner')).toBe(RECENT_NET + ERASED_NET);
      await owner.query(
        'update invoice set waived_at = null, waived_by = null, waiver_reason = null ' +
          'where id = $1',
        [FEE_INVOICE],
      );
      expect(await suppliesHere('owner')).toBe(RECENT_NET + ERASED_NET + FEE_NET);
    });
  });

  it('refuses a practitioner, a lead practitioner and a household’s own contact', async () => {
    for (const roles of ['practitioner', 'lead_practitioner', 'client_contact']) {
      await rolledBack(owner, () =>
        asApiRole(
          owner,
          IDS.tenantA,
          async () => {
            await rejectsWith(owner, '42501', 'select app.vat_taxable_supplies_fils($1::date)', [
              AS_OF,
            ]);
          },
          roles,
        ),
      );
    }
  });
});

describe('GET /api/practice', () => {
  it('answers the figure and the day its window ends on', async () => {
    const res = await api.request('/api/practice', {
      headers: {
        authorization: `Bearer ${await new SignJWT({ role: 'authenticated' })
          .setProtectedHeader({ alg: 'HS256' })
          .setIssuer(ISSUER)
          .setAudience('authenticated')
          .setSubject(AUTH.ownerA)
          .setIssuedAt()
          .setExpirationTime('10m')
          .sign(KEY)}`,
      },
    });
    expect(res.status).toBe(200);
    const { practice } = (await res.json()) as PracticeResponse;
    expect(practice.vatTaxableSuppliesAsOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(practice.vatTaxableSuppliesFils).toBeGreaterThanOrEqual(0);
    expect(practice.vatRegistered).toBe(false);
  });
});
