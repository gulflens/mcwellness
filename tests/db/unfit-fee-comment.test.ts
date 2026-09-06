import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDatabase } from './helpers';

/**
 * `scheduling_setting.unfit_fee_fils` says what it pays for
 * (migration `205_unfit_fee_is_the_call_out_fee.sql`, and request 4 of
 * `docs/CHANGE-REQUESTS/billing-06.md`).
 *
 * Migration 202 commented the column "Recorded here; nothing charges it yet",
 * which was true when it was written and stopped being true when migration 408
 * began posting the fee on every late cancellation, every visit unfit at the
 * door and every no-show. A column comment that says nothing charges a figure
 * that is charged reads as authoritative and teaches the wrong rule, so this
 * asks the database itself what the comment now says.
 *
 * **Why this file is in `tests/db/` and not `tests/scheduling/db/`.** The
 * migration is in the scheduling range, but it was written by the trunk in
 * round 33 under that round's widening, and round 31's default 18 already
 * settled the shape: a test about a migration the trunk wrote lives in the
 * trunk's own path rather than being dropped into a stream's suite, where that
 * stream would own it from the moment it landed.
 */

let owner: pg.Client;

beforeAll(async () => {
  owner = await freshDatabase();
});

afterAll(async () => {
  await owner.end();
});

async function commentOn(table: string, column: string): Promise<string | null> {
  const { rows } = await owner.query<{ comment: string | null }>(
    'select col_description(a.attrelid, a.attnum) as comment from pg_attribute a ' +
      'where a.attrelid = to_regclass($1) and a.attname = $2',
    [`public.${table}`, column],
  );
  return rows[0]?.comment ?? null;
}

describe('the comment on scheduling_setting.unfit_fee_fils', () => {
  it('no longer says nothing charges it', async () => {
    const comment = await commentOn('scheduling_setting', 'unfit_fee_fils');
    expect(comment).not.toBeNull();
    expect(comment).not.toContain('nothing charges it');
  });

  it('says what the figure pays for, and what charges it', async () => {
    const comment = (await commentOn('scheduling_setting', 'unfit_fee_fils')) ?? '';
    expect(comment).toContain('call-out fee');
    expect(comment).toContain('net of VAT');
    expect(comment).toContain('app.billing_on_appointment_charged');
    for (const occasion of ['late cancellation', 'unfit at the door', 'no-show']) {
      expect(comment, occasion).toContain(occasion);
    }
  });

  it('leaves the notice period’s own comment alone', async () => {
    const comment = (await commentOn('scheduling_setting', 'notice_hours')) ?? '';
    expect(comment).toContain('Hours of notice');
  });
});
