import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AccountsResponse,
  EntriesResponse,
  LedgerResponse,
  SettingsResponse,
  YearsResponse,
} from '../../../app/api/accounting/schema';
import { FINANCE, SEEDED, seedFinanceUser, startHarness, type Harness } from './support';

/**
 * The books' read routes on a practice whose journal is empty: the shapes, the
 * defaults and who may ask (docs/SPEC/accounting.md sections 9 and 10).
 */
const NOW = () => new Date('2026-09-07T08:00:00.000Z');
const UNKNOWN = '0000000e-0000-4000-8000-0000000000ff';

let h: Harness;

beforeAll(async () => {
  h = await startHarness(NOW);
  await seedFinanceUser(h);
});

afterAll(async () => {
  await h.close();
});

describe('GET /api/accounting/settings', () => {
  it('gives the owner the defaults and an empty journal', async () => {
    const res = await h.call('GET', '/api/accounting/settings', SEEDED.owner);
    expect(res.status).toBe(200);
    const body = SettingsResponse.parse(await res.json());
    expect(body).toMatchObject({
      yearEndMonth: 12,
      yearEndDay: 31,
      lockedThrough: null,
      corporateTaxRateBasisPoints: 900,
      corporateTaxThresholdFils: 37_500_000,
      smallBusinessReliefElected: true,
      smallBusinessReliefThresholdFils: 300_000_000,
      entryCount: 0,
    });
  });

  it('gives finance the same and refuses everybody else', async () => {
    const asFinance = await h.callAs('GET', '/api/accounting/settings', FINANCE.authId);
    expect(asFinance.status).toBe(200);
    for (const user of [SEEDED.admin, SEEDED.practitioner]) {
      const res = await h.call('GET', '/api/accounting/settings', user);
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ error: 'forbidden' });
    }
  });
});

describe('GET /api/accounting/accounts', () => {
  it('gives the sixteen default accounts by code, each at nothing', async () => {
    const res = await h.call('GET', '/api/accounting/accounts', SEEDED.owner);
    expect(res.status).toBe(200);
    const body = AccountsResponse.parse(await res.json());
    expect(body.accounts).toHaveLength(16);
    expect(body.accounts.map((a) => a.code)).toEqual([...body.accounts.map((a) => a.code)].sort());
    expect(body.accounts[0]).toMatchObject({ code: '1010', role: 'bank', balanceFils: 0 });
    expect(body.accounts.every((a) => a.balanceFils === 0)).toBe(true);
    expect(JSON.stringify(body)).not.toContain('clientId');
  });

  it('refuses an admin', async () => {
    const res = await h.call('GET', '/api/accounting/accounts', SEEDED.admin);
    expect(res.status).toBe(403);
  });
});

describe('GET /api/accounting/years and /entries', () => {
  it('has no year and no entry yet', async () => {
    const years = await h.call('GET', '/api/accounting/years', SEEDED.owner);
    expect(YearsResponse.parse(await years.json())).toEqual({ years: [] });
    const entries = await h.call('GET', '/api/accounting/entries', SEEDED.owner);
    expect(EntriesResponse.parse(await entries.json())).toEqual({ entries: [], truncated: false });
  });

  it('answers 404 for an entry that is not there and 400 for a bad limit', async () => {
    const missing = await h.call('GET', `/api/accounting/entries/${UNKNOWN}`, SEEDED.owner);
    expect(missing.status).toBe(404);
    const tooMany = await h.call('GET', '/api/accounting/entries?limit=5000', SEEDED.owner);
    expect(tooMany.status).toBe(400);
    expect(await tooMany.json()).toMatchObject({ code: 'invalid_request' });
  });
});

describe('GET /api/accounting/accounts/:id/ledger', () => {
  it('gives an empty ledger for the bank account', async () => {
    const accounts = AccountsResponse.parse(
      await (await h.call('GET', '/api/accounting/accounts', SEEDED.owner)).json(),
    );
    const bank = accounts.accounts.find((a) => a.code === '1010')!;
    const res = await h.call(
      'GET',
      `/api/accounting/accounts/${bank.id}/ledger?from=2026-01-01&to=2026-12-31`,
      SEEDED.owner,
    );
    expect(res.status).toBe(200);
    const body = LedgerResponse.parse(await res.json());
    expect(body).toMatchObject({
      from: '2026-01-01',
      to: '2026-12-31',
      openingBalanceFils: 0,
      rows: [],
      closingBalanceFils: 0,
    });
    expect(body.account.code).toBe('1010');
  });

  it('answers 404 for an account the practice does not have', async () => {
    const res = await h.call(
      'GET',
      `/api/accounting/accounts/${UNKNOWN}/ledger?from=2026-01-01&to=2026-12-31`,
      SEEDED.owner,
    );
    expect(res.status).toBe(404);
  });
});
