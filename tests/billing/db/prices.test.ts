import { SignJWT } from 'jose';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mountBilling } from '../../../app/api/billing/routes';
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
import { deriveIdentityKeys } from '../../../domain/shared';
import { freshDatabase } from '../../db/helpers';

// Everything synthetic: the seeded practice, a test secret that unlocks
// nothing, and a second practice with one admin to prove the fence between
// practices. mountBilling is called by hand here — app/api/create-api.ts is
// shared, and mounting it there is a change request
// (docs/CHANGE-REQUESTS/billing-01.md), not this pull request's to make.
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
  api = createApi({ pool, verifier: createTokenVerifier({ issuer: ISSUER, secret: SECRET }) });
  mountBilling(api, NOW);
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

describe('GET /api/billing/prices before any price is set', () => {
  it('is empty rather than an error', async () => {
    const res = await call('GET', '/api/billing/prices', authIdOf(0));
    expect(res.status).toBe(200);
    expect(((await res.json()) as PricesResponse).prices).toEqual([]);
  });
});

describe('POST /api/billing/prices before the practice has a VAT rate', () => {
  it('refuses with a named reason, not a guessed rate', async () => {
    const res = await call('POST', '/api/billing/prices', authIdOf(0), {
      serviceTypeId: serviceTypeId('nf-session'),
      unitPriceFils: 90_000,
      validFrom: SEED_TODAY,
    });
    expect(res.status).toBe(422);
    expect((await res.json()) as { error: string }).toMatchObject({ error: 'no_vat_setting' });
  });
});

describe('once the practice has set its VAT rate', () => {
  beforeAll(async () => {
    await owner.query(
      'insert into vat_setting (tenant_id, version, rate_basis_points, effective_from, created_by) ' +
        'values ($1, 1, 500, $2, $3)',
      [SEED_TENANT_ID, SEED_TODAY, SEED_OWNER_USER_ID],
    );
  });

  describe('POST /api/billing/prices', () => {
    it('refuses a practitioner: reading prices is one thing, setting them is another', async () => {
      const res = await call('POST', '/api/billing/prices', authIdOf(1), {
        serviceTypeId: serviceTypeId('nf-session'),
        unitPriceFils: 90_000,
        validFrom: SEED_TODAY,
      });
      expect(res.status).toBe(403);
    });

    it('sets the first price for a service, VAT resolved from the tenant rate and stamped on the row', async () => {
      const res = await call('POST', '/api/billing/prices', authIdOf(0), {
        serviceTypeId: serviceTypeId('nf-session'),
        unitPriceFils: 90_000,
        validFrom: SEED_TODAY,
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as CreatePriceResponse;
      expect(body.price.unitPriceFils).toBe(90_000);
      expect(body.price.vatRateBasisPoints).toBe(500);
      expect(body.price.vatFils).toBe(4_500);
      expect(body.price.grossFils).toBe(94_500);
      expect(body.price.validFrom).toBe(SEED_TODAY);

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
      });
      expect(res.status).toBe(201);
    });

    it('refuses a second price for the same service that does not start after the current one', async () => {
      const sameDay = await call('POST', '/api/billing/prices', authIdOf(0), {
        serviceTypeId: serviceTypeId('nf-session'),
        unitPriceFils: 95_000,
        validFrom: SEED_TODAY,
      });
      expect(sameDay.status).toBe(400);

      const earlier = await call('POST', '/api/billing/prices', authIdOf(0), {
        serviceTypeId: serviceTypeId('nf-session'),
        unitPriceFils: 95_000,
        validFrom: '2026-01-01',
      });
      expect(earlier.status).toBe(400);
    });

    it('accepts a future price, which supersedes without touching the current row', async () => {
      const res = await call('POST', '/api/billing/prices', authIdOf(0), {
        serviceTypeId: serviceTypeId('nf-session'),
        unitPriceFils: 99_000,
        validFrom: '2026-12-01',
      });
      expect(res.status).toBe(201);
    });

    it('cannot price a service type in a tenant it does not belong to', async () => {
      const res = await call('POST', '/api/billing/prices', ADMIN_B_AUTH, {
        serviceTypeId: serviceTypeId('nf-session'),
        unitPriceFils: 90_000,
        validFrom: SEED_TODAY,
      });
      expect(res.status).toBe(404);
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
});
