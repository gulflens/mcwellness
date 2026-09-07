import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SignJWT } from 'jose';
import type pg from 'pg';
import { createPool } from '../../../app/api/_middleware/db';
import { localDiskStorage } from '../../../app/api/_middleware/storage';
import { createTokenVerifier } from '../../../app/api/_middleware/token-verifier';
import { createApi } from '../../../app/api/create-api';
import { applySeed } from '../../../db/seed/apply';
import { generateSeed, type SeedData } from '../../../db/seed/generate';
import { deriveIdentityKeys } from '../../../domain/shared/identity';
import { freshDatabase } from '../../db/helpers';

/**
 * Shared plumbing for the books' database tests: a fresh database, the
 * synthetic practice, and a signed request as one of its seeded people. Copied
 * from tests/billing/db/support.ts rather than imported across streams
 * (docs/SPEC/OWNERSHIP.md), with one addition: a finance-only user, because
 * the seed's owner also holds finance and the positive role tests need the
 * two apart.
 * Everything here is synthetic — a secret that unlocks nothing, and people
 * `db/seed/generate.ts` invented (.claude/rules/testing.md: fixtures come
 * from the generators only).
 */

export const SECRET = 'test-secret-that-unlocks-nothing-0123456789';
export const ISSUER = 'http://localhost:54321/auth/v1';
const KEY = new TextEncoder().encode(SECRET);

/** The seeded team, by the roles they hold (db/seed/generate.ts). */
export const SEEDED = {
  /** Owner, admin, finance and lead practitioner: the founder as she works today. */
  owner: 0,
  /** A practitioner and nothing else. */
  practitioner: 1,
  otherPractitioner: 2,
  /** A coordinator: admin alone. */
  admin: 3,
} as const;

export type Harness = {
  owner: pg.Client;
  pool: pg.Pool;
  api: ReturnType<typeof createApi>;
  /**
   * The document store, as the fallback implementation: a folder under the
   * system temporary directory, which is what every test and every laptop uses
   * (docs/SEAMS.md). No vendor, no network, and the same four calls the real
   * one answers.
   */
  storage: ReturnType<typeof localDiskStorage>;
  data: SeedData;
  call: (
    method: 'GET' | 'POST',
    path: string,
    seededUser: number,
    body?: unknown,
    /** Extra request headers: an idempotency key, a reason for the trail. */
    extra?: Record<string, string>,
  ) => Promise<Response>;
  /** The same call, as any auth id at all: a fixture's own user, not a seeded one. */
  callAs: (
    method: 'GET' | 'POST',
    path: string,
    authId: string,
    body?: unknown,
    extra?: Record<string, string>,
  ) => Promise<Response>;
  authIdOf: (index: number) => string;
  serviceTypeId: (code: string) => string;
  clientId: (index: number) => string;
  close: () => Promise<void>;
};

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

/** A clean database holding the synthetic practice, and an API pointed at it. */
export async function startHarness(now: () => Date): Promise<Harness> {
  const data = generateSeed();
  const owner = await freshDatabase();
  await applySeed(owner, data, deriveIdentityKeys(Buffer.alloc(32, 7)));

  const apiUrl = process.env.API_DATABASE_URL;
  if (!apiUrl) throw new Error('API_DATABASE_URL is not set.');
  const pool = createPool(apiUrl);
  const storage = localDiskStorage({
    dir: mkdtempSync(join(tmpdir(), 'mcwellness-accounting-')),
    signingSecret: Buffer.alloc(32, 5),
  });
  const api = createApi({
    pool,
    verifier: createTokenVerifier({ issuer: ISSUER, secret: SECRET }),
    now,
    storage,
  });

  function authIdOf(index: number): string {
    const user = data.users[index];
    if (!user) throw new Error(`No seeded user ${index}.`);
    return user.authId;
  }

  async function callAs(
    method: 'GET' | 'POST',
    path: string,
    authId: string,
    body?: unknown,
    extra?: Record<string, string>,
  ): Promise<Response> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${await mint(authId)}`,
      ...extra,
    };
    const init: RequestInit = { method, headers };
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    return api.request(path, init);
  }

  return {
    owner,
    pool,
    api,
    storage,
    data,
    authIdOf,
    callAs,
    serviceTypeId(code: string): string {
      const service = data.serviceTypes.find((s) => s.code === code);
      if (!service) throw new Error(`No seeded service type "${code}".`);
      return service.id;
    },
    clientId(index: number): string {
      const client = data.clients[index];
      if (!client) throw new Error(`No seeded client ${index}.`);
      return client.id;
    },
    async call(method, path, seededUser, body, extra) {
      return callAs(method, path, authIdOf(seededUser), body, extra);
    },
    async close() {
      await pool.end();
      await owner.end();
    },
  };
}

/**
 * A finance-only user for the positive role tests; the seed has none (its
 * owner also holds finance, as the founder works today).
 */
export const FINANCE = {
  userId: '0000000e-0000-4000-8000-0000000000f1',
  authId: '0000000e-0000-4000-8000-0000000000f2',
} as const;

export async function seedFinanceUser(h: Harness): Promise<void> {
  const { seedUser } = await import('../../db/helpers');
  const { SEED_TENANT_ID } = await import('../../../db/seed/generate');
  await seedUser(h.owner, {
    id: FINANCE.userId,
    tenantId: SEED_TENANT_ID,
    authId: FINANCE.authId,
    displayName: 'Synthetic Bookkeeper',
    roles: ['finance'],
  });
}

/**
 * The practice's own price list, as the founder set it on 2026-09-03:
 * neurofeedback at AED 700 net, the brain map at AED 825, and the
 * consultation bundled at nothing because it is never sold on its own. Net
 * figures; VAT is added on top at write time.
 */
export const PRACTICE_PRICES: readonly { code: string; netFils: number; reason: string }[] = [
  { code: 'nf-session', netFils: 70_000, reason: "The practice's own session price." },
  { code: 'brain-map', netFils: 82_500, reason: "The practice's own brain map price." },
  {
    code: 'consultation',
    netFils: 0,
    reason: 'Included in every package; never sold on its own.',
  },
];

/** Writes those prices through the price route, as the owner would. */
export async function setPracticePrices(h: Harness, validFrom: string): Promise<void> {
  for (const price of PRACTICE_PRICES) {
    const res = await h.call('POST', '/api/billing/prices', SEEDED.owner, {
      serviceTypeId: h.serviceTypeId(price.code),
      unitPriceFils: price.netFils,
      validFrom,
      amendmentReason: price.reason,
    });
    if (res.status !== 201) {
      throw new Error(`Could not set the ${price.code} price: ${res.status}`);
    }
  }
}

/** Silver, as the founder priced it: list AED 12,150, launch AED 10,325. */
/**
 * The codes these suites create under.
 *
 * Not `silver` and `gold`: the seed carries the practice's own three
 * programmes now (`shared-zone-round-15`), and a bundle code is unique per
 * practice, so a fixture using the real code would collide with the seeded
 * row on one database and not the other. Suffixed, the suites hold against
 * both seeds, and the figures asserted are still the founder's own.
 */
export const SILVER_CODE = 'silver-under-test';
export const GOLD_CODE = 'gold-under-test';

export function silverInput(h: Harness, validFrom: string) {
  return {
    code: SILVER_CODE,
    name: 'Silver',
    nameAr: 'الفضية',
    listPriceFils: 1_215_000,
    expiryMonths: 12,
    components: [
      { serviceTypeId: h.serviceTypeId('consultation'), quantity: 1 },
      { serviceTypeId: h.serviceTypeId('brain-map'), quantity: 2 },
      { serviceTypeId: h.serviceTypeId('nf-session'), quantity: 15 },
    ],
    price: {
      amountFils: 1_032_500,
      validFrom,
      amendmentReason: "Launch pricing, ends on the founder's word.",
    },
  };
}
