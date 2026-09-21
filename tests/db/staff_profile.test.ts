import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  IDS,
  asApiRole,
  freshDatabase,
  rejectsWith,
  seedTenant,
  seedUser,
  setAuditContext,
} from './helpers';
import type pg from 'pg';

const STAFF = '00000001-0000-4000-8000-0000000000c1';
let db: pg.Client;

beforeAll(async () => {
  db = await freshDatabase();
  await seedTenant(db, IDS.tenantA, IDS.ownerA, 'Synthetic Studio');
  // A second practice, so the tenant-scoped key below has a real person of
  // another practice's to be refused: a cross-tenant id is refused at write
  // time rather than filtered at read (099_tenant_scoped_keys.sql).
  await seedTenant(db, IDS.tenantB, IDS.ownerB, 'Other Studio');
  await seedUser(db, {
    id: STAFF,
    tenantId: IDS.tenantA,
    authId: null,
    displayName: 'Fern Bay',
    roles: ['finance'],
  });
  await db.query(
    'insert into staff_profile (tenant_id, user_id, job_title, emergency_contact_name, emergency_contact_phone, private_notes, created_by) ' +
      "values ($1, $2, 'Coordinator', 'Ember Cliff', '+971500000041', 'Contract renews in March.', $3)",
    [IDS.tenantA, STAFF, IDS.ownerA],
  );
  // asApiRole and rejectsWith use savepoints, which Postgres only allows inside
  // an explicit transaction block (the pattern tests/db/rls.test.ts uses): one
  // transaction for the whole file, rolled back at the end.
  await db.query('begin');
});
afterAll(async () => {
  await db.query('rollback');
  await db.end();
});

describe('staff_profile', () => {
  it('is read by an owner and by nobody else, the person themselves included', async () => {
    const seen = (roles: string) =>
      asApiRole(
        db,
        IDS.tenantA,
        async () => (await db.query('select 1 from staff_profile')).rowCount,
        roles,
      );
    expect(await seen('owner')).toBe(1);
    for (const roles of [
      'admin',
      'finance',
      'lead_practitioner',
      'practitioner',
      'admin,lead_practitioner',
    ]) {
      expect(await seen(roles), roles).toBe(0);
    }
  });

  it('is written by an owner and refused to an admin', async () => {
    await asApiRole(
      db,
      IDS.tenantA,
      async () => {
        const r = await db.query(
          "update staff_profile set job_title = 'Office lead' where user_id = $1",
          [STAFF],
        );
        expect(r.rowCount).toBe(1);
      },
      'owner',
    );
    await asApiRole(
      db,
      IDS.tenantA,
      async () => {
        const r = await db.query(
          "update staff_profile set job_title = 'Mine now' where user_id = $1",
          [STAFF],
        );
        expect(r.rowCount).toBe(0);
        await rejectsWith(
          db,
          '42501',
          'insert into staff_profile (tenant_id, user_id) values ($1, $2)',
          [IDS.tenantA, IDS.ownerA],
        );
      },
      'admin',
    );
  });

  it('is invisible from another practice', async () => {
    expect(
      await asApiRole(
        db,
        IDS.tenantB,
        async () => (await db.query('select 1 from staff_profile')).rowCount,
        'owner',
      ),
    ).toBe(0);
  });

  it('says in the trail that the five private columns changed, and never what they said', async () => {
    await setAuditContext(db, IDS.ownerA);
    await db.query(
      "update staff_profile set private_notes = 'Asked about part time.', " +
        "emergency_contact_phone = '+971500000042', started_on = '2019-11-05' where user_id = $1",
      [STAFF],
    );
    const { rows } = await db.query<{ changed: string[]; text: string }>(
      "select changed_fields as changed, coalesce(old_values::text,'') || coalesce(new_values::text,'') as text " +
        "from audit_log where entity_type = 'staff_profile' and action = 'update' order by id desc limit 1",
    );
    expect(rows[0]?.changed).toEqual(
      expect.arrayContaining(['private_notes', 'emergency_contact_phone', 'started_on']),
    );
    // The positive control, and the reason a zero below is redaction rather than
    // a typo: the row's own `user_id` is in `new_values`, read by the very same
    // expression that finds none of the five values. It is the control BECAUSE
    // it is not on migration 967's list — the job title was, until the security
    // review pointed out that a job title and a start date reach an admin and a
    // lead practitioner through the activity feed, which contradicts "the
    // owners and nobody else".
    expect(rows[0]?.text).toContain(STAFF);
    for (const leaked of [
      'part time',
      'March',
      '0000042',
      '0000041',
      'Ember',
      'Coordinator',
      '2019-11-05',
    ]) {
      expect(rows[0]?.text, leaked).not.toContain(leaked);
    }
  });

  it('refuses a row whose person belongs to another practice', async () => {
    // (tenant_id, user_id) names a person and their practice together
    // (099_tenant_scoped_keys.sql, the shape 700_portal_invite.sql and
    // 916_enquiry.sql use), so this practice cannot hold a profile about
    // somebody else's colleague. Run as the superuser, because row security is
    // the other layer and this is the key underneath it.
    await rejectsWith(
      db,
      '23503',
      'insert into staff_profile (tenant_id, user_id) values ($1, $2)',
      [IDS.tenantA, IDS.ownerB],
    );
  });

  it('holds one row for one person and a telephone in E.164', async () => {
    await rejectsWith(
      db,
      '23505',
      'insert into staff_profile (tenant_id, user_id) values ($1, $2)',
      [IDS.tenantA, STAFF],
    );
    await rejectsWith(
      db,
      '23514',
      "update staff_profile set emergency_contact_phone = '050 000 0041' where user_id = $1",
      [STAFF],
    );
  });
});
