import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDatabase } from '../../db/helpers';

/**
 * Reassignment (docs/SPEC/dispatch.md section 6). This file grows in Task 6;
 * the first case proves migration 210 landed with its guard.
 */
let owner: pg.Client;

beforeAll(async () => {
  owner = await freshDatabase();
});

afterAll(async () => {
  await owner.end();
});

describe('migration 210', () => {
  it('adds who a reassigned visit was taken from, set only beside a reschedule link', async () => {
    const { rows } = await owner.query<{ is_nullable: string; data_type: string }>(
      'select is_nullable, data_type from information_schema.columns ' +
        "where table_name = 'appointment' and column_name = 'reassigned_from_practitioner_id'",
    );
    expect(rows).toEqual([{ is_nullable: 'YES', data_type: 'uuid' }]);
    const guard = await owner.query<{ conname: string }>(
      "select conname from pg_constraint where conname = 'appointment_reassigned_implies_rescheduled'",
    );
    expect(guard.rows).toHaveLength(1);
  });
});
