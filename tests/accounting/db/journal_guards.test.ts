import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED_TENANT_ID } from '../../../db/seed/generate';
import { asApiRole, rejectsWith, rolledBack, setAuditContext } from '../../db/helpers';
import { startHarness, type Harness } from './support';

/**
 * Migrations 452 and 453: the years, the append-only journal and the four
 * guards under it (docs/SPEC/accounting.md section 6, rules 1, 2, 3 and 9).
 * Everything the routes refuse politely is refused again here, where it binds.
 */
const NOW = () => new Date('2026-09-07T08:00:00.000Z');

let h: Harness;
/** The seeded owner: created_by must name a user the practice really has. */
let ACTOR: string;
let accounts: Map<string, string>;
let booksStartOn: string;

beforeAll(async () => {
  h = await startHarness(NOW);
  ACTOR = h.data.users[0]!.id;
  const { rows } = await h.owner.query<{ code: string; id: string }>(
    'select code, id from account where tenant_id = $1',
    [SEED_TENANT_ID],
  );
  accounts = new Map(rows.map((r) => [r.code, r.id]));
  const setting = await h.owner.query<{ books_start_on: string }>(
    'select books_start_on::text as books_start_on from accounting_setting where tenant_id = $1',
    [SEED_TENANT_ID],
  );
  booksStartOn = setting.rows[0]!.books_start_on;
});

afterAll(async () => {
  await h.close();
});

/** The books' context on the owner's own connection: no role switch, the settings only. */
async function asBookkeeper(roles = 'owner'): Promise<void> {
  await h.owner.query(
    "select set_config('app.tenant_id', $1, true), set_config('app.actor_roles', $2, true)",
    [SEED_TENANT_ID, roles],
  );
  await setAuditContext(h.owner, ACTOR, 'a test of the books');
}

async function yearFor(day: string): Promise<string> {
  const { rows } = await h.owner.query<{ id: string }>('select app.fiscal_year_for($1) as id', [
    day,
  ]);
  return rows[0]!.id;
}

async function postEntry(options: {
  day: string;
  kind?: 'opening' | 'manual';
  memo?: string;
  lines?: readonly { code: string; debit: number; credit: number }[];
}): Promise<string> {
  const yearId = await yearFor(options.day);
  const { rows } = await h.owner.query<{ id: string }>(
    'insert into journal_entry (tenant_id, entered_on, fiscal_year_id, kind, memo, created_by) ' +
      'values ($1, $2, $3, $4, $5, $6) returning id',
    [
      SEED_TENANT_ID,
      options.day,
      yearId,
      options.kind ?? 'manual',
      options.memo ?? 'A test entry',
      ACTOR,
    ],
  );
  const entryId = rows[0]!.id;
  const lines = options.lines ?? [
    { code: '6000', debit: 20_000, credit: 0 },
    { code: '1010', debit: 0, credit: 20_000 },
  ];
  let lineNo = 1;
  for (const line of lines) {
    await h.owner.query(
      'insert into journal_line (tenant_id, entry_id, line_no, account_id, debit_fils, credit_fils, created_by) ' +
        'values ($1, $2, $3, $4, $5, $6, $7)',
      [SEED_TENANT_ID, entryId, lineNo, accounts.get(line.code), line.debit, line.credit, ACTOR],
    );
    lineNo += 1;
  }
  return entryId;
}

describe('the financial year, made on demand', () => {
  it('makes the year containing the day, once, and finds it again', async () => {
    await rolledBack(h.owner, async () => {
      await asBookkeeper();
      const first = await yearFor('2026-09-07');
      const { rows } = await h.owner.query<{ starts_on: string; ends_on: string; status: string }>(
        'select starts_on::text as starts_on, ends_on::text as ends_on, status from fiscal_year where id = $1',
        [first],
      );
      expect(rows[0]).toEqual({
        starts_on: '2026-01-01',
        ends_on: '2026-12-31',
        status: 'open',
      });
      expect(await yearFor('2026-03-01')).toBe(first);
    });
  });

  it('refuses a second year overlapping the first', async () => {
    await rolledBack(h.owner, async () => {
      await asBookkeeper();
      await yearFor('2026-09-07');
      await rejectsWith(
        h.owner,
        '23P01',
        "insert into fiscal_year (tenant_id, starts_on, ends_on) values ($1, '2026-06-01', '2027-05-31')",
        [SEED_TENANT_ID],
      );
    });
  });

  it('is not read by anybody outside the books', async () => {
    await rolledBack(h.owner, () =>
      asApiRole(
        h.owner,
        SEED_TENANT_ID,
        async () => {
          await rejectsWith(h.owner, '42501', "select app.fiscal_year_for('2026-09-07')");
        },
        'admin',
      ),
    );
  });
});

describe('the journal, numbered and balanced', () => {
  it('numbers an entry JE-000001 and the next JE-000002', async () => {
    await rolledBack(h.owner, async () => {
      await asBookkeeper();
      const first = await postEntry({ day: '2026-09-07' });
      const second = await postEntry({ day: '2026-09-07' });
      await h.owner.query('set constraints all immediate');
      const { rows } = await h.owner.query<{ id: string; number: number; reference: string }>(
        'select id, number, reference from journal_entry where id = any($1) order by number',
        [[first, second]],
      );
      expect(rows).toEqual([
        { id: first, number: 1, reference: 'JE-000001' },
        { id: second, number: 2, reference: 'JE-000002' },
      ]);
    });
  });

  it('refuses an entry whose lines do not balance, at commit and not before', async () => {
    // No savepoint anywhere in this one: the check is a deferred constraint
    // trigger, so only a real commit asks it.
    await h.owner.query('begin');
    try {
      await asBookkeeper();
      await postEntry({
        day: '2026-09-07',
        lines: [
          { code: '6000', debit: 20_000, credit: 0 },
          { code: '1010', debit: 0, credit: 19_000 },
        ],
      });
      // The inserts themselves were accepted; the commit is what refuses.
      await expect(h.owner.query('commit')).rejects.toMatchObject({ code: '23514' });
    } finally {
      await h.owner.query('rollback');
    }
  });

  it('refuses an entry with a single line, at commit', async () => {
    await h.owner.query('begin');
    try {
      await asBookkeeper();
      await postEntry({ day: '2026-09-07', lines: [{ code: '6000', debit: 20_000, credit: 0 }] });
      await expect(h.owner.query('commit')).rejects.toMatchObject({ code: '23514' });
    } finally {
      await h.owner.query('rollback');
    }
  });

  it('refuses a line on an archived account', async () => {
    await rolledBack(h.owner, async () => {
      await asBookkeeper();
      await h.owner.query(
        "update account set archived_at = now(), archive_reason = 'a test' where tenant_id = $1 and code = '1500'",
        [SEED_TENANT_ID],
      );
      await postEntry({
        day: '2026-09-07',
        lines: [
          { code: '1500', debit: 20_000, credit: 0 },
          { code: '1010', debit: 0, credit: 20_000 },
        ],
      });
      await rejectsWith(h.owner, '23514', 'set constraints all immediate');
    });
  });

  it('is never edited or deleted, on the owner’s own connection', async () => {
    await rolledBack(h.owner, async () => {
      await asBookkeeper();
      const entryId = await postEntry({ day: '2026-09-07' });
      await h.owner.query('set constraints all immediate');
      await rejectsWith(h.owner, '42501', 'update journal_entry set memo = $2 where id = $1', [
        entryId,
        'something else',
      ]);
      await rejectsWith(h.owner, '42501', 'delete from journal_line where entry_id = $1', [
        entryId,
      ]);
      await rejectsWith(h.owner, '42501', 'delete from journal_entry where id = $1', [entryId]);
      await rejectsWith(
        h.owner,
        '42501',
        'update journal_line set debit_fils = 1 where entry_id = $1',
        [entryId],
      );
    });
  });
});

describe('what the books will not take', () => {
  it('refuses an entry dated inside a closed year', async () => {
    await rolledBack(h.owner, async () => {
      await asBookkeeper();
      const yearId = await yearFor('2025-06-01');
      await h.owner.query(
        "update fiscal_year set status = 'closed', closed_at = now(), close_reason = 'a test close' where id = $1",
        [yearId],
      );
      await rejectsWith(
        h.owner,
        '23514',
        'insert into journal_entry (tenant_id, entered_on, fiscal_year_id, kind, memo) ' +
          "values ($1, '2025-06-01', $2, 'manual', 'Too late')",
        [SEED_TENANT_ID, yearId],
      );
    });
  });

  it('refuses an entry dated on or before the lock date, and takes the day after', async () => {
    await rolledBack(h.owner, async () => {
      await asBookkeeper();
      await h.owner.query(
        "update accounting_setting set locked_through = '2026-06-30' where tenant_id = $1",
        [SEED_TENANT_ID],
      );
      const yearId = await yearFor('2026-06-30');
      await rejectsWith(
        h.owner,
        '23514',
        'insert into journal_entry (tenant_id, entered_on, fiscal_year_id, kind, memo) ' +
          "values ($1, '2026-06-30', $2, 'manual', 'On the lock')",
        [SEED_TENANT_ID, yearId],
      );
      await postEntry({ day: '2026-07-01', memo: 'The day after the lock' });
      await h.owner.query('set constraints all immediate');
    });
  });

  it('dates an opening entry the books’ start day and no other', async () => {
    await rolledBack(h.owner, async () => {
      await asBookkeeper();
      const yearId = await yearFor(booksStartOn);
      await rejectsWith(
        h.owner,
        '23514',
        'insert into journal_entry (tenant_id, entered_on, fiscal_year_id, kind, memo) ' +
          "values ($1, $2::date + 1, $3, 'opening', 'A day too late')",
        [SEED_TENANT_ID, booksStartOn, yearId],
      );
      await postEntry({ day: booksStartOn, kind: 'opening', memo: 'Opening balances' });
      await h.owner.query('set constraints all immediate');
    });
  });

  it('refuses a second entry for the same money event', async () => {
    await rolledBack(h.owner, async () => {
      await asBookkeeper();
      const yearId = await yearFor('2026-09-07');
      const source = '0000000e-0000-4000-8000-000000009001';
      const insert =
        'insert into journal_entry (tenant_id, entered_on, fiscal_year_id, kind, memo, ' +
        'source_table, source_id, source_event) ' +
        "values ($1, '2026-09-07', $2, 'automatic', 'Payment received', 'payment', $3, 'payment.received')";
      await h.owner.query(insert, [SEED_TENANT_ID, yearId, source]);
      await rejectsWith(h.owner, '23505', insert, [SEED_TENANT_ID, yearId, source]);
    });
  });
});

describe('who may write in the journal', () => {
  it('lets finance post and refuses an admin', async () => {
    const insertAs = (roles: string) =>
      rolledBack(h.owner, async () => {
        await asBookkeeper();
        const yearId = await yearFor('2026-09-07');
        return asApiRole(
          h.owner,
          SEED_TENANT_ID,
          async () => {
            await h.owner.query(
              "select set_config('app.actor_id', $1, true), set_config('app.reason', 'a test', true)",
              [ACTOR],
            );
            const { rows } = await h.owner.query<{ id: string }>(
              'insert into journal_entry (tenant_id, entered_on, fiscal_year_id, kind, memo) ' +
                "values ($1, '2026-09-07', $2, 'manual', 'A test entry') returning id",
              [SEED_TENANT_ID, yearId],
            );
            return rows[0]!.id;
          },
          roles,
        );
      });
    await expect(insertAs('finance')).resolves.toEqual(expect.any(String));
    await expect(insertAs('admin')).rejects.toMatchObject({ code: '42501' });
  });
});
