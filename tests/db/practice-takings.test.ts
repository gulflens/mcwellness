import { SignJWT } from 'jose';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from '../../app/api/_middleware/db';
import { createTokenVerifier } from '../../app/api/_middleware/token-verifier';
import { createApi } from '../../app/api/create-api';
import type { MonthlyMoneyResponse } from '../../app/api/billing/document-schema';
import {
  AUTH,
  IDS,
  asApiRole,
  freshDatabase,
  rejectsWith,
  rolledBack,
  seedClient,
  seedServiceType,
  seedTenant,
  seedUser,
} from './helpers';

/**
 * The takings figure that is the same whoever asks (migration 952, and the
 * first of the small things in docs/PLAN/pieces-seven-to-nine.md).
 *
 * `payment` and `entitlement` pass through `app.client_erasure_gate` when they
 * are read as the caller, so an erased household's money is visible to the
 * owner and the lead practitioner and to nobody else. That is right for a
 * household's own money and wrong for the practice's month, which is what this
 * proves both halves of: the plain read still differs by role, and the figure
 * the summary answers no longer does.
 *
 * Everything here is synthetic and inside the reserved ranges
 * (.claude/rules/testing.md).
 */

const SECRET = 'test-secret-that-unlocks-nothing-0123456789';
const ISSUER = 'http://localhost:54321/auth/v1';
const KEY = new TextEncoder().encode(SECRET);

const id = (slot: number): string => `0000000b-0000-4000-8000-${String(slot).padStart(12, '0')}`;

const SERVICE = id(1);
const STANDING = id(11);
const ERASED = id(12);
const FINANCE_USER = id(21);
const FINANCE_AUTH = id(22);

/** A month with nothing else in it, so the figures are only what this file wrote. */
const MONTH = '2026-04';
const STANDING_PAID = 120_000;
const ERASED_PAID = 45_000;
const STANDING_CREDIT = 90_000;
const ERASED_CREDIT = 30_000;

let owner: pg.Client;
let pool: ReturnType<typeof createPool>;
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

async function summary(sub: string): Promise<MonthlyMoneyResponse> {
  const res = await api.request(`/api/billing/summary?month=${MONTH}`, {
    headers: { authorization: `Bearer ${await mint(sub)}` },
  });
  expect(res.status).toBe(200);
  return (await res.json()) as MonthlyMoneyResponse;
}

beforeAll(async () => {
  owner = await freshDatabase();
  await seedTenant(owner, IDS.tenantA, IDS.ownerA, 'Synthetic Studio A');
  await seedServiceType(owner, IDS.tenantA, SERVICE, 'nf-session');
  await owner.query('update app_user set auth_id = $2 where id = $1', [IDS.ownerA, AUTH.ownerA]);
  await seedUser(owner, {
    id: FINANCE_USER,
    tenantId: IDS.tenantA,
    authId: FINANCE_AUTH,
    displayName: 'Synthetic Bookkeeper',
    roles: ['finance'],
  });
  // Every practice gets its first VAT setting when it is created (migration
  // 400); a credit names the version it was priced under.
  const vat = await owner.query<{ version: number }>(
    'select version from vat_setting where tenant_id = $1 order by version desc limit 1',
    [IDS.tenantA],
  );
  const vatVersion = vat.rows[0]?.version ?? 1;

  await seedClient(owner, IDS.tenantA, STANDING, IDS.ownerA, 'Harbour');
  await seedClient(owner, IDS.tenantA, ERASED, IDS.ownerA, 'Meadow');

  for (const [clientId, paid, credit] of [
    [STANDING, STANDING_PAID, STANDING_CREDIT],
    [ERASED, ERASED_PAID, ERASED_CREDIT],
  ] as const) {
    await owner.query(
      'insert into payment (tenant_id, client_id, method, amount_fils, received_at) ' +
        "values ($1, $2, 'transfer', $3, $4)",
      [IDS.tenantA, clientId, paid, `${MONTH}-14T09:00:00+04:00`],
    );
    await owner.query(
      'insert into entitlement (tenant_id, client_id, service_type_id, source_type, ' +
        'allocated_net_fils, vat_rate_basis_points, vat_setting_version, status) ' +
        "values ($1, $2, $3, 'complimentary', $4, 0, $5, 'available')",
      [IDS.tenantA, clientId, SERVICE, credit, vatVersion],
    );
  }

  // The household is erased after its money was taken, which is the whole
  // point: the rows stay for five years and the record does not.
  await owner.query("update client set status = 'erased' where id = $1", [ERASED]);

  const apiUrl = process.env.API_DATABASE_URL;
  if (!apiUrl) throw new Error('API_DATABASE_URL is not set.');
  pool = createPool(apiUrl);
  api = createApi({ pool, verifier: createTokenVerifier({ issuer: ISSUER, secret: SECRET }) });
});

afterAll(async () => {
  await pool.end();
  await owner.end();
});

describe('the erasure gate, which is why the function exists', () => {
  it('still hides an erased household’s payments from finance, read the plain way', async () => {
    const total = async (roles: string) =>
      rolledBack(owner, () =>
        asApiRole(
          owner,
          IDS.tenantA,
          async () => {
            const { rows } = await owner.query<{ sum: string | null }>(
              'select sum(amount_fils)::text as sum from payment',
            );
            return Number(rows[0]?.sum ?? 0);
          },
          roles,
        ),
      );
    expect(await total('owner')).toBe(STANDING_PAID + ERASED_PAID);
    expect(await total('finance')).toBe(STANDING_PAID);
  });
});

describe('app.practice_money_ledger', () => {
  it('answers the owner and finance the very same ledger', async () => {
    const ledger = async (roles: string) =>
      rolledBack(owner, () =>
        asApiRole(
          owner,
          IDS.tenantA,
          async () => {
            const { rows } = await owner.query<{ ledger: unknown }>(
              'select app.practice_money_ledger() as ledger',
            );
            return JSON.stringify(rows[0]?.ledger);
          },
          roles,
        ),
      );
    const asOwner = await ledger('owner');
    expect(await ledger('finance')).toBe(asOwner);
    expect(await ledger('admin')).toBe(asOwner);
  });

  it('names no client, no invoice and no visit anywhere in it', async () => {
    await rolledBack(owner, () =>
      asApiRole(owner, IDS.tenantA, async () => {
        const { rows } = await owner.query<{ ledger: string }>(
          'select app.practice_money_ledger()::text as ledger',
        );
        const text = rows[0]?.ledger ?? '';
        expect(text).not.toContain(STANDING);
        expect(text).not.toContain(ERASED);
        expect(text).not.toContain('clientId');
        expect(text).toContain('amountFils');
      }),
    );
  });

  it('refuses a practitioner and a household’s own contact', async () => {
    for (const roles of ['practitioner', 'client_contact']) {
      await rolledBack(owner, () =>
        asApiRole(
          owner,
          IDS.tenantA,
          async () => {
            await rejectsWith(owner, '42501', 'select app.practice_money_ledger()');
          },
          roles,
        ),
      );
    }
  });
});

describe('GET /api/billing/summary', () => {
  it('answers the owner and finance the same month’s takings', async () => {
    const asOwner = await summary(AUTH.ownerA);
    const asFinance = await summary(FINANCE_AUTH);
    expect(asOwner.cashCollectedFils).toBe(STANDING_PAID + ERASED_PAID);
    expect(asOwner.deferredNetFils).toBe(STANDING_CREDIT + ERASED_CREDIT);
    expect(asFinance).toEqual(asOwner);
  });
});
