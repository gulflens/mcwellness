import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED_TENANT_ID } from '../../../db/seed/generate';
import { asApiRole, rejectsWith, rolledBack } from '../../db/helpers';
import { startHarness, type Harness } from './support';

/**
 * Migrations 450 and 451: one settings row and the sixteen default accounts
 * for every practice, by trigger and by data step (docs/SPEC/accounting.md
 * sections 4.1 and 8).
 */
const NOW = () => new Date('2026-09-07T08:00:00.000Z');
let h: Harness;
beforeAll(async () => {
  h = await startHarness(NOW);
});
afterAll(async () => {
  await h.close();
});

describe('the books settings and the chart, per practice', () => {
  it('gives the seeded practice one settings row with the defaults of section 8', async () => {
    const { rows } = await h.owner.query(
      'select books_start_on, year_end_month, year_end_day, locked_through, ' +
        'corporate_tax_rate_basis_points, corporate_tax_threshold_fils::text, ' +
        'small_business_relief_elected, small_business_relief_threshold_fils::text, next_entry_number ' +
        'from accounting_setting where tenant_id = $1',
      [SEED_TENANT_ID],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      year_end_month: 12,
      year_end_day: 31,
      locked_through: null,
      corporate_tax_rate_basis_points: 900,
      corporate_tax_threshold_fils: '37500000',
      small_business_relief_elected: true,
      small_business_relief_threshold_fils: '300000000',
      next_entry_number: 1,
    });
  });

  it('gives the seeded practice the sixteen default accounts with twelve roles', async () => {
    const { rows } = await h.owner.query<{ code: string; role: string | null }>(
      'select code, role from account where tenant_id = $1 order by code',
      [SEED_TENANT_ID],
    );
    expect(rows.map((r) => r.code)).toEqual([
      '1010',
      '1020',
      '1030',
      '1200',
      '1500',
      '2100',
      '2400',
      '2500',
      '3000',
      '3100',
      '4000',
      '4100',
      '4300',
      '4400',
      '6000',
      '6200',
    ]);
    expect(rows.filter((r) => r.role !== null)).toHaveLength(12);
  });

  it('refuses an account whose code does not match its type, or a duplicate role', async () => {
    await rolledBack(h.owner, async () => {
      await rejectsWith(
        h.owner,
        '23514',
        "insert into account (tenant_id, code, name, type) values ($1, '4999', 'Wrong', 'expense')",
        [SEED_TENANT_ID],
      );
      await rejectsWith(
        h.owner,
        '23505',
        'insert into account (tenant_id, code, name, type, role) ' +
          "values ($1, '1011', 'Second bank', 'asset', 'bank')",
        [SEED_TENANT_ID],
      );
    });
  });

  it('refuses a code outside the four-digit ranges, and an archive without a reason', async () => {
    await rolledBack(h.owner, async () => {
      await rejectsWith(
        h.owner,
        '23514',
        "insert into account (tenant_id, code, name, type) values ($1, '7000', 'Too high', 'expense')",
        [SEED_TENANT_ID],
      );
      await rejectsWith(
        h.owner,
        '23514',
        "update account set archived_at = now() where tenant_id = $1 and code = '1500'",
        [SEED_TENANT_ID],
      );
    });
  });

  it('hands out journal numbers one at a time from the settings row', async () => {
    await rolledBack(h.owner, () =>
      asApiRole(
        h.owner,
        SEED_TENANT_ID,
        async () => {
          const a = await h.owner.query<{ n: number }>(
            'select app.next_journal_entry_number() as n',
          );
          const b = await h.owner.query<{ n: number }>(
            'select app.next_journal_entry_number() as n',
          );
          expect(b.rows[0]!.n).toBe(a.rows[0]!.n + 1);
        },
        'owner',
      ),
    );
  });

  it('lets a finance actor read the settings and the chart, and nobody outside the office', async () => {
    const count = (roles: string) =>
      rolledBack(h.owner, () =>
        asApiRole(
          h.owner,
          SEED_TENANT_ID,
          async () => {
            const { rows } = await h.owner.query<{ n: string }>(
              'select count(*)::text as n from account',
            );
            return Number(rows[0]!.n);
          },
          roles,
        ),
      );
    expect(await count('finance')).toBe(16);
    expect(await count('owner')).toBe(16);
    expect(await count('admin')).toBe(0);
    expect(await count('practitioner')).toBe(0);
  });

  it('lets a finance actor read the settings row and refuses an admin', async () => {
    const count = (roles: string) =>
      rolledBack(h.owner, () =>
        asApiRole(
          h.owner,
          SEED_TENANT_ID,
          async () => {
            const { rows } = await h.owner.query<{ n: string }>(
              'select count(*)::text as n from accounting_setting',
            );
            return Number(rows[0]!.n);
          },
          roles,
        ),
      );
    expect(await count('finance')).toBe(1);
    expect(await count('owner')).toBe(1);
    expect(await count('admin')).toBe(0);
  });
});
