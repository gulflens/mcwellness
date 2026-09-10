import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADULT_AGE, moneyVisibleTo } from '../../../domain/portal';
import { IDS, asApiRole, freshDatabase, rolledBack, setAuditContext } from '../../db/helpers';
import { PORTAL, PORTAL_MONEY, asContact, seedMoney, seedPortalHousehold } from './support';

/** The practice's own zone, and the one this fixture's seed writes. */
const PRACTICE_TIME_ZONE = 'Asia/Dubai';

/**
 * A young person's own login sees no figure, and the database and the domain
 * agree about the day that changes (docs/SPEC/client-portal.md section 5,
 * rule 5, and section 6.3).
 *
 * The two answers are written twice on purpose — `moneyVisibleTo` in
 * `domain/portal/money.ts` for the route and the screen,
 * `app.actor_is_adult_contact_of` in migration 702 for the seven restrictive
 * policies — because a screen that hides a figure the database would hand over
 * is a courtesy, not a boundary. Written twice, they can drift, so this file
 * asks both the same question on the same dates, including the boundary day
 * itself and the day before it.
 *
 * The database reads "today" from `tenant.timezone`, so the fixture moves the
 * practice's clock rather than the calendar: at 21:00 UTC it is already
 * tomorrow in Dubai, and a birthday must not arrive four hours early or four
 * hours late.
 */

let owner: pg.Client;

/**
 * One extension of the household's programme. Written here rather than in
 * `seedMoney` because it is this file's question alone: an extension carries
 * two dates and a sentence about why the family asked for longer, and the
 * question is who may read it.
 */
const EXTENSION = '00000001-0000-4000-8000-000000000069';

beforeAll(async () => {
  owner = await freshDatabase();
  await seedPortalHousehold(owner);
  await seedMoney(owner, PORTAL.childA);
  await owner.query(
    'insert into package_extension (id, tenant_id, client_id, purchase_id, ordinal, ' +
      'from_on, to_on, reason, created_by) values ($1, $2, $3, $4, 1, ' +
      "(current_date + interval '180 days')::date, " +
      "((current_date + interval '180 days')::date + interval '3 months')::date, $5, $6)",
    [
      EXTENSION,
      IDS.tenantA,
      PORTAL.childA,
      PORTAL_MONEY.purchase,
      'The family was away for the summer.',
      PORTAL.admin,
    ],
  );
});

afterAll(async () => {
  await owner.end();
});

/** What the database says four of the money tables hold for this person, today. */
async function moneyRowsFor(userId: string): Promise<number> {
  return rolledBack(owner, async () => {
    const counts = await asContact(owner, userId, async () => {
      const tables = ['package_purchase', 'entitlement', 'invoice', 'payment'];
      let total = 0;
      for (const table of tables) {
        const rows = await owner.query(`select id from ${table} where client_id = $1`, [
          PORTAL.childA,
        ]);
        total += rows.rowCount ?? 0;
      }
      return total;
    });
    return counts;
  });
}

/** What the database says the household's extensions hold for this person, today. */
async function extensionRowsFor(userId: string): Promise<number> {
  return rolledBack(owner, async () =>
    asContact(owner, userId, async () => {
      const rows = await owner.query('select id from package_extension where client_id = $1', [
        PORTAL.childA,
      ]);
      return rows.rowCount ?? 0;
    }),
  );
}

/** The database's own answer to the age question, for this person. */
async function databaseSaysAdult(userId: string): Promise<boolean> {
  return rolledBack(owner, async () => {
    await setAuditContext(owner, userId);
    const { rows } = await asApiRole(
      owner,
      IDS.tenantA,
      () =>
        owner.query<{ adult: boolean }>('select app.actor_is_adult_contact_of($1) as adult', [
          PORTAL.childA,
        ]),
      'client_contact',
    );
    return rows[0]?.adult ?? false;
  });
}

/**
 * The practice's own today, which is what `app.actor_is_adult_contact_of`
 * reads from `tenant.timezone` and what the route hands the domain.
 */
function practiceToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: PRACTICE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/**
 * A date of birth that makes the child exactly `years` old today, shifted by
 * `shiftDays`. The birthday moves, not the clock: an `Etc/GMT` offset can put
 * the practice on yesterday or tomorrow but not on an arbitrary date, and a
 * fixture that only works in September is a fixture that fails in October.
 */
function birthdayFor(years: number, shiftDays = 0): string {
  const [y, m, d] = practiceToday().split('-').map(Number);
  const born = new Date(Date.UTC(Number(y) - years, Number(m) - 1, Number(d) + shiftDays));
  return born.toISOString().slice(0, 10);
}

/** Gives the child a date of birth, which is the only fact these rules read. */
async function childBornOn(isoDate: string): Promise<void> {
  await owner.query('update client set date_of_birth = $1 where id = $2', [isoDate, PORTAL.childA]);
}

describe('the boundary day', () => {
  it('agrees with the domain on the day before the eighteenth birthday', async () => {
    // Born a day later than eighteen years ago: the birthday is tomorrow.
    const dateOfBirth = birthdayFor(ADULT_AGE, 1);
    // The domain, asked with the same two facts the database has.
    expect(moneyVisibleTo({ relationship: 'self' }, { dateOfBirth }, practiceToday())).toBe(false);
    await childBornOn(dateOfBirth);
    expect(await databaseSaysAdult(PORTAL.minorUser)).toBe(false);
    expect(await moneyRowsFor(PORTAL.minorUser)).toBe(0);
  });

  it('agrees with the domain on the eighteenth birthday itself', async () => {
    const dateOfBirth = birthdayFor(ADULT_AGE);
    expect(moneyVisibleTo({ relationship: 'self' }, { dateOfBirth }, practiceToday())).toBe(true);
    await childBornOn(dateOfBirth);
    expect(await databaseSaysAdult(PORTAL.minorUser)).toBe(true);
    expect(await moneyRowsFor(PORTAL.minorUser)).toBeGreaterThan(0);
  });

  it('treats a record with no date of birth as an adult, both ways', async () => {
    expect(moneyVisibleTo({ relationship: 'self' }, { dateOfBirth: null }, practiceToday())).toBe(
      true,
    );
    await childBornOn(null as unknown as string);
    expect(await databaseSaysAdult(PORTAL.minorUser)).toBe(true);
  });
});

describe('everybody else', () => {
  it("shows the mother her child's money, because a parent pays", async () => {
    const dateOfBirth = birthdayFor(ADULT_AGE, 1);
    await childBornOn(dateOfBirth);
    expect(moneyVisibleTo({ relationship: 'mother' }, { dateOfBirth }, practiceToday())).toBe(true);
    expect(await databaseSaysAdult(PORTAL.motherUser)).toBe(true);
    expect(await moneyRowsFor(PORTAL.motherUser)).toBe(5);
  });

  it('keeps a staff member out of the narrowing entirely', async () => {
    await rolledBack(owner, async () => {
      await setAuditContext(owner, PORTAL.admin);
      const rows = await asApiRole(
        owner,
        IDS.tenantA,
        () => owner.query('select id from invoice where client_id = $1', [PORTAL.childA]),
        'admin',
      );
      expect(rows.rowCount).toBe(1);
    });
  });

  it("hides an extension of the household's programme from the young person's own login", async () => {
    // `package_extension` (migration 410) joined the money tables a round
    // after this policy was written, and the array below it was not widened
    // with them. `package_extension_readers` admits any contact of the record,
    // so a young person's own login read the dates of an extension of their
    // own programme — and the sentence somebody wrote about why the family
    // asked for longer — where the same login is refused the purchase those
    // rows belong to. The free-text reason is exactly the kind of sentence
    // this gate exists for.
    const dateOfBirth = birthdayFor(ADULT_AGE, 1);
    await childBornOn(dateOfBirth);
    expect(await extensionRowsFor(PORTAL.minorUser)).toBe(0);
    // The same row, to the mother, on the same day: the gate narrows the
    // young person's own login and nobody else.
    expect(await extensionRowsFor(PORTAL.motherUser)).toBe(1);
  });

  it('shows a staff member who is also a contact their staff reach', async () => {
    await childBornOn(birthdayFor(ADULT_AGE, 1));
    await rolledBack(owner, async () => {
      // A person may be several things at once (docs/SPEC/00-data-model.md
      // section 2). Here the minor's own login is stamped with an admin role
      // beside it: an absurd household, and exactly the shape the founder's
      // own record has — a contact of one client who runs the practice. The
      // admin reach stands, over this record and every other.
      await setAuditContext(owner, PORTAL.minorUser);
      const rows = await asApiRole(
        owner,
        IDS.tenantA,
        () => owner.query('select id from invoice where client_id = $1', [PORTAL.childA]),
        'client_contact,admin',
      );
      expect(rows.rowCount).toBe(1);
    });
  });
});
