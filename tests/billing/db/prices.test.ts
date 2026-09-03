import { SignJWT } from 'jose';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  CreatePriceResponse,
  PricesResponse,
  ServiceTypeOptionsResponse,
} from '../../../app/api/billing/schema';
import { createPool } from '../../../app/api/_middleware/db';
import { createTokenVerifier } from '../../../app/api/_middleware/token-verifier';
import { createApi } from '../../../app/api/create-api';
import { applySeed } from '../../../db/seed/apply';
import {
  generateSeed,
  SEED_OWNER_USER_ID,
  SEED_TENANT_ID,
  SEED_TODAY,
} from '../../../db/seed/generate';
import { deriveIdentityKeys } from '../../../domain/shared/identity';
import { freshDatabase } from '../../db/helpers';

// Everything synthetic: the seeded practice, a test secret that unlocks
// nothing, and a second practice with one admin to prove the fence between
// practices. createApi's own `now` option reaches mountBilling from inside
// createApi itself (app/api/create-api.ts) now that round 5
// (docs/CHANGE-REQUESTS/billing-01.md) mounts it there — a second, manual
// mountBilling call on the same Hono instance would only add a second
// handler for the same path, shadowed behind the one createApi already
// registered, since Hono answers from whichever handler was registered
// first.
//
// Both practices get a VAT rate the instant applySeed() and the manual
// tenant B insert below create their tenant rows: migration 400's
// app.default_vat_setting() trigger sees to that, so no test here inserts a
// vat_setting row for a normal tenant by hand any more.
const SECRET = 'test-secret-that-unlocks-nothing-0123456789';
const ISSUER = 'http://localhost:54321/auth/v1';
const KEY = new TextEncoder().encode(SECRET);
// SEED_TODAY (2026-09-02) at 08:00 UTC is still 2026-09-02 in Asia/Dubai.
const NOW = () => new Date('2026-09-02T08:00:00.000Z');

const TENANT_B = '00000000-0000-4000-8000-0000000000b0';
const ADMIN_B = '00000000-0000-4000-8000-0000000000b1';
const ADMIN_B_AUTH = '00000000-0000-4000-8000-0000000000b2';

const data = generateSeed();

let owner: pg.Client;
let pool: pg.Pool;
let api: ReturnType<typeof createApi>;

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

async function call(
  method: 'GET' | 'POST',
  path: string,
  sub: string,
  body?: unknown,
): Promise<Response> {
  const headers: Record<string, string> = { authorization: `Bearer ${await mint(sub)}` };
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  return api.request(path, init);
}

function authIdOf(index: number): string {
  const user = data.users[index];
  if (!user) throw new Error(`No seeded user ${index}.`);
  return user.authId;
}

function serviceTypeId(code: string): string {
  const service = data.serviceTypes.find((s) => s.code === code);
  if (!service) throw new Error(`No seeded service type "${code}".`);
  return service.id;
}

/**
 * What the seed left on the price list, read once at the start.
 *
 * The seed used to carry no prices at all, and three assertions below were
 * written against that emptiness. It carries the practice's own figures now
 * (`shared-zone-round-15`), so those assertions are written against what the
 * seed provides instead: a first price for a service the seed never priced
 * supersedes nothing, and one for a service it did priced supersedes that
 * row. Both readings are correct, and the suite passes whichever seed the
 * database in front of it happens to hold — neither pull request can break
 * the other by merging first.
 */
let seededPrices: PricesResponse['prices'] = [];

function seededPriceFor(code: string): PricesResponse['prices'][number] | undefined {
  const id = serviceTypeId(code);
  return seededPrices.find((price) => price.serviceTypeId === id);
}

/** The id a first price written today would supersede: the seed's, or none. */
function supersededBy(code: string): string | null {
  return seededPriceFor(code)?.id ?? null;
}

beforeAll(async () => {
  owner = await freshDatabase();
  await applySeed(owner, data, deriveIdentityKeys(Buffer.alloc(32, 7)));
  await owner.query("insert into tenant (id, legal_name) values ($1, 'Synthetic Studio B')", [
    TENANT_B,
  ]);
  await owner.query(
    "insert into app_user (id, tenant_id, auth_id, display_name) values ($1, $2, $3, 'Synthetic Admin B')",
    [ADMIN_B, TENANT_B, ADMIN_B_AUTH],
  );
  await owner.query("insert into user_role (tenant_id, user_id, role) values ($1, $2, 'admin')", [
    TENANT_B,
    ADMIN_B,
  ]);
  const apiUrl = process.env.API_DATABASE_URL;
  if (!apiUrl) throw new Error('API_DATABASE_URL is not set.');
  pool = createPool(apiUrl);
  api = createApi({
    pool,
    verifier: createTokenVerifier({ issuer: ISSUER, secret: SECRET }),
    now: NOW,
  });
  const listed = await call('GET', '/api/billing/prices', authIdOf(0));
  seededPrices = ((await listed.json()) as PricesResponse).prices;
});

afterAll(async () => {
  await pool.end();
  await owner.end();
});

describe('GET /api/billing/service-types', () => {
  it("lists the practice's active services for the owner", async () => {
    const res = await call('GET', '/api/billing/service-types', authIdOf(0));
    expect(res.status).toBe(200);
    const body = (await res.json()) as ServiceTypeOptionsResponse;
    expect(body.serviceTypes.map((s) => s.code).sort()).toEqual(
      [...data.serviceTypes.map((s) => s.code)].sort(),
    );
  });

  it('refuses a practitioner, who holds no billing role', async () => {
    const res = await call('GET', '/api/billing/service-types', authIdOf(1));
    expect(res.status).toBe(403);
  });
});

describe('GET /api/billing/prices, whatever the seed left there', () => {
  it('answers with the list, and an empty practice is an empty list rather than an error', async () => {
    const res = await call('GET', '/api/billing/prices', authIdOf(0));
    expect(res.status).toBe(200);
    const { prices } = (await res.json()) as PricesResponse;
    expect(Array.isArray(prices)).toBe(true);
    // One row per service at most, VAT stamped and the total adding up: true
    // of the practice's own seeded list and vacuously true of an empty one.
    for (const price of prices) {
      expect(price.grossFils).toBe(price.unitPriceFils + price.vatFils);
      expect(price.vatRateBasisPoints).toBe(500);
      expect(price.amendmentReason.length).toBeGreaterThan(0);
    }
    expect(new Set(prices.map((p) => p.serviceTypeId)).size).toBe(prices.length);
  });

  it("shows the practice's own figures once the seed carries them", async () => {
    // Skipped, not failed, against the older seed: this asserts the founder's
    // decision of 2026-09-03, which only the seeded database can show.
    const session = seededPriceFor('nf-session');
    if (!session) {
      expect(seededPrices).toEqual([]);
      return;
    }
    expect(session.unitPriceFils).toBe(70_000);
    expect(session.vatFils).toBe(3_500);
    expect(seededPriceFor('brain-map')?.unitPriceFils).toBe(82_500);
    expect(seededPriceFor('consultation')?.unitPriceFils).toBe(0);
  });
});

describe('POST /api/billing/prices', () => {
  it('refuses a practitioner: reading prices is one thing, setting them is another', async () => {
    const res = await call('POST', '/api/billing/prices', authIdOf(1), {
      serviceTypeId: serviceTypeId('nf-session'),
      unitPriceFils: 90_000,
      validFrom: SEED_TODAY,
      amendmentReason: 'Setting the launch price.',
    });
    expect(res.status).toBe(403);
  });

  it('sets the first price for a service, VAT resolved from the tenant rate and stamped on the row', async () => {
    const res = await call('POST', '/api/billing/prices', authIdOf(0), {
      serviceTypeId: serviceTypeId('nf-session'),
      unitPriceFils: 90_000,
      validFrom: SEED_TODAY,
      amendmentReason: 'Setting the launch price.',
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as CreatePriceResponse;
    expect(body.price.unitPriceFils).toBe(90_000);
    expect(body.price.vatRateBasisPoints).toBe(500);
    expect(body.price.vatFils).toBe(4_500);
    expect(body.price.grossFils).toBe(94_500);
    expect(body.price.validFrom).toBe(SEED_TODAY);
    // Null on a practice that had no price for this service, and the seeded
    // row's id on one that did: a price supersedes whatever it replaces.
    expect(body.price.supersedesId).toBe(supersededBy('nf-session'));
    expect(body.price.amendmentReason).toBe('Setting the launch price.');

    const { rows } = await owner.query<{ n: number }>(
      "select count(*)::int as n from audit_log where action = 'insert' and entity_type = 'price' " +
        'and entity_id = $1 and client_id is null',
      [body.price.id],
    );
    expect(rows[0]?.n).toBe(1);
  });

  it('lets an admin, not only the owner, set a price', async () => {
    const res = await call('POST', '/api/billing/prices', authIdOf(3), {
      serviceTypeId: serviceTypeId('brain-map'),
      unitPriceFils: 145_000,
      validFrom: SEED_TODAY,
      amendmentReason: 'Setting the launch price for the brain map.',
    });
    expect(res.status).toBe(201);
  });

  it('refuses a second price for the same service that does not start after the current one', async () => {
    const sameDay = await call('POST', '/api/billing/prices', authIdOf(0), {
      serviceTypeId: serviceTypeId('nf-session'),
      unitPriceFils: 95_000,
      validFrom: SEED_TODAY,
      amendmentReason: 'Trying to reprice the same day.',
    });
    expect(sameDay.status).toBe(400);

    const earlier = await call('POST', '/api/billing/prices', authIdOf(0), {
      serviceTypeId: serviceTypeId('nf-session'),
      unitPriceFils: 95_000,
      validFrom: '2026-01-01',
      amendmentReason: 'Trying to backdate a reprice.',
    });
    expect(earlier.status).toBe(400);
  });

  it('accepts a future price, which supersedes without touching the current row', async () => {
    const res = await call('POST', '/api/billing/prices', authIdOf(0), {
      serviceTypeId: serviceTypeId('nf-session'),
      unitPriceFils: 99_000,
      validFrom: '2026-12-01',
      amendmentReason: "Scheduling next quarter's increase.",
    });
    expect(res.status).toBe(201);
  });

  it('links a superseding price to the one it replaces, both carrying a reason', async () => {
    const svc = serviceTypeId('results-call');
    const first = await call('POST', '/api/billing/prices', authIdOf(0), {
      serviceTypeId: svc,
      unitPriceFils: 20_000,
      validFrom: SEED_TODAY,
      amendmentReason: 'Initial price for results calls.',
    });
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as CreatePriceResponse;
    expect(firstBody.price.supersedesId).toBe(supersededBy('results-call'));
    expect(firstBody.price.amendmentReason).toBe('Initial price for results calls.');

    const second = await call('POST', '/api/billing/prices', authIdOf(0), {
      serviceTypeId: svc,
      unitPriceFils: 22_000,
      validFrom: '2026-10-01',
      amendmentReason: 'Aligning with the updated price list.',
    });
    expect(second.status).toBe(201);
    const secondBody = (await second.json()) as CreatePriceResponse;
    expect(secondBody.price.supersedesId).toBe(firstBody.price.id);
    expect(secondBody.price.amendmentReason).toBe('Aligning with the updated price list.');
  });

  it('cannot price a service type in a tenant it does not belong to', async () => {
    const res = await call('POST', '/api/billing/prices', ADMIN_B_AUTH, {
      serviceTypeId: serviceTypeId('nf-session'),
      unitPriceFils: 90_000,
      validFrom: SEED_TODAY,
      amendmentReason: 'Attempting to price a service in another practice.',
    });
    expect(res.status).toBe(404);
  });

  it("uses the VAT rate in force on the price's own valid_from, not a later scheduled one", async () => {
    // A rate change the practice has already scheduled for the new year.
    await owner.query(
      'insert into vat_setting (tenant_id, version, rate_basis_points, effective_from, ' +
        'supersedes_id, amendment_reason, created_by) ' +
        'values ($1, 2, 700, $2, (select id from vat_setting where tenant_id = $1 and version = 1), ' +
        '$3, $4)',
      [SEED_TENANT_ID, '2027-01-01', 'Rate increase announced by the FTA.', SEED_OWNER_USER_ID],
    );
    const { rows: settingRows } = await owner.query<{
      id: string;
      version: number;
      supersedes_id: string | null;
    }>('select id, version, supersedes_id from vat_setting where tenant_id = $1 order by version', [
      SEED_TENANT_ID,
    ]);
    const first = settingRows.find((r) => r.version === 1);
    const second = settingRows.find((r) => r.version === 2);
    // The later version names the one it replaces; the first names nothing.
    expect(first?.supersedes_id).toBeNull();
    expect(second?.supersedes_id).toBe(first?.id);

    const beforeChange = await call('POST', '/api/billing/prices', authIdOf(0), {
      serviceTypeId: serviceTypeId('consultation'),
      unitPriceFils: 50_000,
      validFrom: SEED_TODAY,
      amendmentReason: 'Setting the consultation price ahead of the rate change.',
    });
    expect(beforeChange.status).toBe(201);
    expect(((await beforeChange.json()) as CreatePriceResponse).price.vatRateBasisPoints).toBe(500);

    const afterChange = await call('POST', '/api/billing/prices', authIdOf(0), {
      serviceTypeId: serviceTypeId('consultation'),
      unitPriceFils: 52_000,
      validFrom: '2027-02-01',
      amendmentReason: 'Re-pricing once the new VAT rate is in force.',
    });
    expect(afterChange.status).toBe(201);
    expect(((await afterChange.json()) as CreatePriceResponse).price.vatRateBasisPoints).toBe(700);
  });

  describe('validation', () => {
    it('refuses a date that does not exist, as a bad request, not a database error', async () => {
      const res = await call('POST', '/api/billing/prices', authIdOf(0), {
        serviceTypeId: serviceTypeId('discovery-call'),
        unitPriceFils: 10_000,
        validFrom: '2026-13-45',
        amendmentReason: 'Testing an impossible date.',
      });
      expect(res.status).toBe(400);
    });

    it('refuses a price above the integer column maximum', async () => {
      const res = await call('POST', '/api/billing/prices', authIdOf(0), {
        serviceTypeId: serviceTypeId('discovery-call'),
        unitPriceFils: 2_147_483_648,
        validFrom: SEED_TODAY,
        amendmentReason: 'Testing an oversized price.',
      });
      expect(res.status).toBe(400);
    });

    it('refuses a price with no reason', async () => {
      const res = await call('POST', '/api/billing/prices', authIdOf(0), {
        serviceTypeId: serviceTypeId('discovery-call'),
        unitPriceFils: 10_000,
        validFrom: SEED_TODAY,
        amendmentReason: '',
      });
      expect(res.status).toBe(400);
    });
  });
});

describe('GET /api/billing/prices', () => {
  it("shows today's price for each service, not a future one that hasn't started", async () => {
    const res = await call('GET', '/api/billing/prices', authIdOf(0));
    expect(res.status).toBe(200);
    const body = (await res.json()) as PricesResponse;
    const nf = body.prices.find((p) => p.serviceTypeCode === 'nf-session');
    expect(nf?.unitPriceFils).toBe(90_000); // the future 99,000 row does not apply yet
    const map = body.prices.find((p) => p.serviceTypeCode === 'brain-map');
    expect(map?.unitPriceFils).toBe(145_000);
  });

  it('refuses a practitioner', async () => {
    const res = await call('GET', '/api/billing/prices', authIdOf(1));
    expect(res.status).toBe(403);
  });

  it("shows a second tenant none of the first tenant's prices", async () => {
    const res = await call('GET', '/api/billing/prices', ADMIN_B_AUTH);
    expect(res.status).toBe(200);
    expect(((await res.json()) as PricesResponse).prices).toEqual([]);
  });
});
