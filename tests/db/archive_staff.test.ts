import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  IDS,
  asApiRole,
  freshDatabase,
  rolledBack,
  seedClient,
  seedLocation,
  seedPractitioner,
  seedServiceType,
  seedTenant,
  seedUser,
  setAuditContext,
} from './helpers';

/**
 * Archiving a colleague, and restoring one (migration 977; the practice's ask
 * of 6 October 2026 to be able to remove a practitioner or a person, built as
 * an archive because nothing in this schema is deleted).
 *
 * `app.archive_staff` and `app.restore_staff` are security definer, so the
 * rules written in them are the whole boundary: every refusal has a case here,
 * each asserting the rule that spoke and not only the SQLSTATE, because both
 * functions raise 42501 for several different reasons (owner_lock.test.ts says
 * why that matters).
 *
 * Names from db/seed/names.ts; ids in this file's own 977x block.
 */

const SECOND_OWNER = '00000000-0000-4000-8000-000000009771';
const ADMIN = '00000000-0000-4000-8000-000000009772';
/** A practitioner with a practitioner row, the person the practice asked about. */
const PRACTITIONER_USER = '00000000-0000-4000-8000-000000009773';
const PRACTITIONER = '00000000-0000-4000-8000-000000009774';
const PRACTITIONER_AUTH = '00000000-0000-4000-8000-000000009775';
/** A helper accompanying that practitioner (213). */
const HELPER = '00000000-0000-4000-8000-000000009776';
/** A household contact: not a member of staff, and not archived from Team. */
const HOUSEHOLD = '00000000-0000-4000-8000-000000009777';
const CLIENT = '00000000-0000-4000-8000-000000009778';
const HOME = '00000000-0000-4000-8000-000000009779';
const SERVICE = '00000000-0000-4000-8000-00000000977a';
const FUTURE_VISIT = '00000000-0000-4000-8000-00000000977b';
const PAST_VISIT = '00000000-0000-4000-8000-00000000977c';
const CANCELLED_VISIT = '00000000-0000-4000-8000-00000000977d';
/** The same shape of colleague in another practice: never reachable from A. */
const ELSEWHERE = '00000000-0000-4000-8000-00000000977e';

const REASON = 'Left the practice at the end of the month';

let owner: pg.Client;

/**
 * Runs `fn` as `actorId` holding `roles`, under the API role in practice A,
 * inside a transaction that is rolled back: every case starts from the seed.
 */
async function as<T>(actorId: string, roles: string, fn: () => Promise<T>): Promise<T> {
  return rolledBack(owner, async () => {
    await setAuditContext(owner, actorId, REASON);
    return asApiRole(owner, IDS.tenantA, fn, roles);
  });
}

/** The statement's SQLSTATE and message, or 'ok'. Inside a savepoint. */
async function refusal(
  sql: string,
  params: unknown[] = [],
): Promise<{ code: string; message: string } | 'ok'> {
  await owner.query('savepoint attempt');
  try {
    await owner.query(sql, params);
    await owner.query('release savepoint attempt');
    return 'ok';
  } catch (error) {
    await owner.query('rollback to savepoint attempt');
    const seen = error as { code?: string; message?: string };
    return { code: seen.code ?? 'unknown', message: seen.message ?? '' };
  }
}

/**
 * As asApiRole, but keeps the work for the rest of the surrounding (rolled
 * back) transaction, so the case can read back what the door wrote. asApiRole
 * rolls its own savepoint back, and with it everything a door did.
 */
async function asOwnerKept<T>(fn: () => Promise<T>): Promise<T> {
  await setAuditContext(owner, IDS.ownerA, REASON);
  await owner.query('set local role app_role');
  await owner.query(
    "select set_config('app.tenant_id', $1, true), set_config('app.actor_roles', 'owner', true)",
    [IDS.tenantA],
  );
  try {
    return await fn();
  } finally {
    await owner.query('reset role');
  }
}

const ARCHIVE = 'select app.archive_staff($1, $2) as summary';
const RESTORE = 'select app.restore_staff($1) as summary';

async function visit(id: string, inDays: number, hour: number, status: string): Promise<void> {
  await owner.query(
    'insert into appointment (id, tenant_id, client_id, practitioner_id, service_type_id, ' +
      "location_id, delivery_mode, window_start, window_end, status) values ($1, $2, $3, $4, $5, $6, 'home', " +
      "date_trunc('day', now()) + make_interval(days => $7, hours => $8), " +
      "date_trunc('day', now()) + make_interval(days => $7, hours => $8) + interval '45 minutes', " +
      '$9::appointment_status)',
    [id, IDS.tenantA, CLIENT, PRACTITIONER, SERVICE, HOME, inDays, hour, status],
  );
}

async function statusOf(userId: string): Promise<string | undefined> {
  const { rows } = await owner.query<{ status: string }>(
    'select status::text as status from app_user where id = $1',
    [userId],
  );
  return rows[0]?.status;
}

async function practitionerStatus(): Promise<string | undefined> {
  const { rows } = await owner.query<{ status: string }>(
    'select status::text as status from practitioner where id = $1',
    [PRACTITIONER],
  );
  return rows[0]?.status;
}

beforeAll(async () => {
  owner = await freshDatabase();
  await seedTenant(owner, IDS.tenantA, IDS.ownerA, 'Synthetic Studio A');
  await seedTenant(owner, IDS.tenantB, IDS.ownerB, 'Synthetic Studio B');
  await seedUser(owner, {
    id: SECOND_OWNER,
    tenantId: IDS.tenantA,
    authId: null,
    displayName: 'Hazel Lagoon',
    roles: ['owner'],
  });
  await seedUser(owner, {
    id: ADMIN,
    tenantId: IDS.tenantA,
    authId: null,
    displayName: 'Iris Harbour',
    roles: ['admin'],
  });
  await seedUser(owner, {
    id: PRACTITIONER_USER,
    tenantId: IDS.tenantA,
    authId: PRACTITIONER_AUTH,
    displayName: 'Fern Bay',
    roles: ['practitioner', 'lead_practitioner'],
  });
  await seedUser(owner, {
    id: HELPER,
    tenantId: IDS.tenantA,
    authId: null,
    displayName: 'Reed Bay',
    roles: [],
  });
  await seedUser(owner, {
    id: HOUSEHOLD,
    tenantId: IDS.tenantA,
    authId: null,
    displayName: 'Cedar Meadow',
    roles: ['client_contact'],
  });
  await seedUser(owner, {
    id: ELSEWHERE,
    tenantId: IDS.tenantB,
    authId: null,
    displayName: 'Rowan Ridge',
    roles: ['practitioner'],
  });
  await seedPractitioner(owner, IDS.tenantA, PRACTITIONER, PRACTITIONER_USER);
  await seedClient(owner, IDS.tenantA, CLIENT, IDS.ownerA, 'Dune');
  await seedLocation(owner, IDS.tenantA, HOME, CLIENT, IDS.ownerA);
  await seedServiceType(owner, IDS.tenantA, SERVICE, 'nfb');

  // The helper is named the way the owner names one, so 213's own rules wrote
  // the role row and the accompaniment.
  await owner.query('begin');
  await setAuditContext(owner, IDS.ownerA, 'named whom a helper accompanies');
  await owner.query('set local role app_role');
  await owner.query(
    "select set_config('app.tenant_id', $1, true), set_config('app.actor_roles', 'owner', true)",
    [IDS.tenantA],
  );
  await owner.query('select app.name_helper($1, $2)', [HELPER, PRACTITIONER]);
  await owner.query('reset role');
  await owner.query('commit');

  // Two of the helper's positions and one of the practitioner's, which the
  // archive takes with it as 213's revoke does.
  await owner.query(
    'insert into practitioner_position (tenant_id, practitioner_id, latitude, longitude, accuracy_metres, created_by) ' +
      'values ($1, $2, 25.21, 55.27, 12, $3)',
    [IDS.tenantA, PRACTITIONER, PRACTITIONER_USER],
  );

  // A visit that is over and one that was cancelled never hold an archive up.
  await visit(PAST_VISIT, -3, 9, 'completed');
  await visit(CANCELLED_VISIT, 4, 11, 'cancelled');
});

afterAll(async () => {
  await owner.end();
});

describe('who may archive whom', () => {
  it('refuses a caller with no actor named', async () => {
    const seen = await rolledBack(owner, () =>
      asApiRole(owner, IDS.tenantA, () => refusal(ARCHIVE, [ADMIN, REASON])),
    );
    expect(seen).toMatchObject({ code: '42501', message: expect.stringContaining('named') });
  });

  it('refuses anybody who is not an owner, an admin included', async () => {
    const seen = await as(ADMIN, 'admin', () => refusal(ARCHIVE, [PRACTITIONER_USER, REASON]));
    expect(seen).toMatchObject({
      code: '42501',
      message: expect.stringContaining('only an owner'),
    });
    expect(await statusOf(PRACTITIONER_USER)).toBe('active');
  });

  it('refuses an owner as the one archived, even by the other owner', async () => {
    const seen = await as(IDS.ownerA, 'owner', () => refusal(ARCHIVE, [SECOND_OWNER, REASON]));
    expect(seen).toMatchObject({
      code: '42501',
      message: expect.stringContaining('an owner is not archived'),
    });
  });

  it('refuses an owner archiving themselves', async () => {
    const seen = await as(IDS.ownerA, 'owner', () => refusal(ARCHIVE, [IDS.ownerA, REASON]));
    expect(seen).toMatchObject({ code: '42501', message: expect.stringContaining('themselves') });
  });

  it('refuses a household contact, who is not a member of staff', async () => {
    const seen = await as(IDS.ownerA, 'owner', () => refusal(ARCHIVE, [HOUSEHOLD, REASON]));
    expect(seen).toMatchObject({
      code: '42501',
      message: expect.stringContaining('no such colleague'),
    });
  });

  it('refuses a colleague of another practice as nobody', async () => {
    const seen = await as(IDS.ownerA, 'owner', () => refusal(ARCHIVE, [ELSEWHERE, REASON]));
    expect(seen).toMatchObject({
      code: '42501',
      message: expect.stringContaining('no such colleague'),
    });
  });

  it('refuses an archive with no reason, or a blank one', async () => {
    for (const reason of [null, '', '   ']) {
      const seen = await as(IDS.ownerA, 'owner', () => refusal(ARCHIVE, [ADMIN, reason]));
      expect(seen).toMatchObject({ code: '22023', message: expect.stringContaining('reason') });
    }
  });
});

describe('a practitioner with visits still ahead', () => {
  it('is refused with 55000 while a future visit is still theirs, and nothing moves', async () => {
    await rolledBack(owner, async () => {
      await visit(FUTURE_VISIT, 2, 10, 'confirmed');
      await setAuditContext(owner, IDS.ownerA, REASON);
      const seen = await asApiRole(owner, IDS.tenantA, () =>
        refusal(ARCHIVE, [PRACTITIONER_USER, REASON]),
      );
      expect(seen).toMatchObject({
        code: '55000',
        message: expect.stringContaining('reassign their future visits first'),
      });
      expect(await statusOf(PRACTITIONER_USER)).toBe('active');
      expect(await practitionerStatus()).toBe('active');
    });
  });

  it('counts a proposed or a checked-in visit as well as a confirmed one', async () => {
    for (const status of ['proposed', 'checked_in']) {
      await rolledBack(owner, async () => {
        await visit(FUTURE_VISIT, 1, 14, status);
        await setAuditContext(owner, IDS.ownerA, REASON);
        const seen = await asApiRole(owner, IDS.tenantA, () =>
          refusal(ARCHIVE, [PRACTITIONER_USER, REASON]),
        );
        expect(seen).toMatchObject({ code: '55000' });
      });
    }
  });
});

describe('archiving a practitioner', () => {
  it('archives them, takes them out of booking, ends whom a helper accompanies, and forgets their positions', async () => {
    await rolledBack(owner, async () => {
      const summary = await asOwnerKept(async () => {
        const { rows } = await owner.query<{ summary: Record<string, unknown> }>(ARCHIVE, [
          PRACTITIONER_USER,
          ` ${REASON} `,
        ]);
        return rows[0]?.summary;
      });
      expect(summary).toEqual({
        archived: true,
        practitionerDeactivated: true,
        accompanimentsEnded: 1,
        positionsForgotten: 1,
      });
      expect(await statusOf(PRACTITIONER_USER)).toBe('archived');
      expect(await practitionerStatus()).toBe('inactive');

      // Their roles stay, so the trail and an erasure (968) still read them as
      // staff; the fence refuses them by status alone.
      const roles = await owner.query<{ role: string }>(
        'select role::text as role from user_role where user_id = $1 order by role',
        [PRACTITIONER_USER],
      );
      expect(roles.rows.map((r) => r.role)).toEqual(['lead_practitioner', 'practitioner']);
      const resolved = await owner.query('select * from app.resolve_actor($1)', [
        PRACTITIONER_AUTH,
      ]);
      expect(resolved.rowCount).toBe(0);

      // The helper who went with them accompanies nobody now, and the row
      // says who ended it.
      const ended = await owner.query<{ ended_by: string | null; standing: string }>(
        'select ended_by, (ended_at is null)::text as standing from helper_accompaniment where helper_user_id = $1',
        [HELPER],
      );
      expect(ended.rows).toEqual([{ ended_by: IDS.ownerA, standing: 'false' }]);
      const positions = await owner.query(
        'select 1 from practitioner_position where practitioner_id = $1',
        [PRACTITIONER],
      );
      expect(positions.rowCount).toBe(0);

      // The act is in the trail under the owner, with the reason, trimmed.
      const trail = await owner.query<{ actor_id: string; reason: string }>(
        "select actor_id, reason from audit_log where action = 'staff_archived' and entity_id = $1",
        [PRACTITIONER_USER],
      );
      expect(trail.rows).toEqual([{ actor_id: IDS.ownerA, reason: REASON }]);
      const statusRow = await owner.query<{ reason: string }>(
        "select reason from audit_log where entity_type = 'app_user' and action = 'update' " +
          "and entity_id = $1 and 'status' = any(changed_fields)",
        [PRACTITIONER_USER],
      );
      expect(statusRow.rows).toEqual([{ reason: REASON }]);
    });
  });

  it('answers archived false and changes nothing for somebody already archived', async () => {
    await rolledBack(owner, async () => {
      await owner.query("update app_user set status = 'archived' where id = $1", [ADMIN]);
      await setAuditContext(owner, IDS.ownerA, REASON);
      const summary = await asApiRole(owner, IDS.tenantA, async () => {
        const { rows } = await owner.query<{ summary: { archived: boolean } }>(ARCHIVE, [
          ADMIN,
          REASON,
        ]);
        return rows[0]?.summary;
      });
      expect(summary?.archived).toBe(false);
    });
  });
});

describe('archiving a helper', () => {
  it('ends their accompaniment and archives them, leaving 213’s helper rule standing', async () => {
    await rolledBack(owner, async () => {
      await owner.query(
        'insert into practitioner_position (tenant_id, user_id, latitude, longitude, accuracy_metres, created_by) ' +
          'values ($1, $2, 25.21, 55.27, 12, $2)',
        [IDS.tenantA, HELPER],
      );
      const summary = await asOwnerKept(async () => {
        const { rows } = await owner.query<{ summary: Record<string, unknown> }>(ARCHIVE, [
          HELPER,
          REASON,
        ]);
        return rows[0]?.summary;
      });
      expect(summary).toEqual({
        archived: true,
        practitionerDeactivated: false,
        accompanimentsEnded: 1,
        positionsForgotten: 1,
      });
      expect(await statusOf(HELPER)).toBe('archived');
      // The practitioner they went with keeps working.
      expect(await practitionerStatus()).toBe('active');
      const roles = await owner.query<{ role: string }>(
        'select role::text as role from user_role where user_id = $1',
        [HELPER],
      );
      expect(roles.rows).toEqual([{ role: 'helper' }]);
    });
  });
});

describe('restoring', () => {
  /** Archives the practitioner as the owner, committed inside the caller's transaction. */
  async function archived(): Promise<void> {
    await asOwnerKept(() => owner.query(ARCHIVE, [PRACTITIONER_USER, REASON]));
  }

  it('brings the person and their practitioner row back, and says so in the trail', async () => {
    await rolledBack(owner, async () => {
      await archived();
      const summary = await asOwnerKept(async () => {
        await owner.query("select set_config('app.reason', 'Back from a long leave', true)");
        const { rows } = await owner.query<{ summary: Record<string, unknown> }>(RESTORE, [
          PRACTITIONER_USER,
        ]);
        return rows[0]?.summary;
      });
      expect(summary).toEqual({ restored: true, status: 'active', practitionerReactivated: true });
      expect(await statusOf(PRACTITIONER_USER)).toBe('active');
      expect(await practitionerStatus()).toBe('active');
      const resolved = await owner.query('select * from app.resolve_actor($1)', [
        PRACTITIONER_AUTH,
      ]);
      expect(resolved.rowCount).toBe(1);
      const trail = await owner.query<{ actor_id: string; reason: string }>(
        "select actor_id, reason from audit_log where action = 'staff_restored' and entity_id = $1",
        [PRACTITIONER_USER],
      );
      expect(trail.rows).toEqual([{ actor_id: IDS.ownerA, reason: 'Back from a long leave' }]);
      // An ended accompaniment stays ended: the owner names a helper again.
      const standing = await owner.query(
        'select 1 from helper_accompaniment where helper_user_id = $1 and ended_at is null',
        [HELPER],
      );
      expect(standing.rowCount).toBe(0);
    });
  });

  it('brings a suspended colleague back suspended, never quietly reactivated', async () => {
    await rolledBack(owner, async () => {
      await owner.query("update app_user set status = 'suspended' where id = $1", [
        PRACTITIONER_USER,
      ]);
      await archived();
      // What the archive found is kept on the person until the restore reads it.
      const kept = await owner.query<{ from: string; deactivated: boolean }>(
        'select archived_from_status::text as from, archive_deactivated_practitioner as deactivated ' +
          'from app_user where id = $1',
        [PRACTITIONER_USER],
      );
      expect(kept.rows).toEqual([{ from: 'suspended', deactivated: true }]);

      const summary = await asOwnerKept(async () => {
        const { rows } = await owner.query<{ summary: Record<string, unknown> }>(RESTORE, [
          PRACTITIONER_USER,
        ]);
        return rows[0]?.summary;
      });
      expect(summary).toEqual({
        restored: true,
        status: 'suspended',
        practitionerReactivated: true,
      });
      expect(await statusOf(PRACTITIONER_USER)).toBe('suspended');
      // Suspend never touched the practitioner row; the archive did, and gives it back.
      expect(await practitionerStatus()).toBe('active');
      const resolved = await owner.query('select * from app.resolve_actor($1)', [
        PRACTITIONER_AUTH,
      ]);
      expect(resolved.rowCount).toBe(0);
      const cleared = await owner.query<{ from: string | null; deactivated: boolean | null }>(
        'select archived_from_status::text as from, archive_deactivated_practitioner as deactivated ' +
          'from app_user where id = $1',
        [PRACTITIONER_USER],
      );
      expect(cleared.rows).toEqual([{ from: null, deactivated: null }]);
    });
  });

  it('leaves a practitioner row the archive did not deactivate as it found it', async () => {
    await rolledBack(owner, async () => {
      // Already off the booking lists before the archive, for its own reasons.
      await owner.query("update practitioner set status = 'inactive' where id = $1", [
        PRACTITIONER,
      ]);
      await archived();
      const summary = await asOwnerKept(async () => {
        const { rows } = await owner.query<{ summary: Record<string, unknown> }>(RESTORE, [
          PRACTITIONER_USER,
        ]);
        return rows[0]?.summary;
      });
      expect(summary).toEqual({ restored: true, status: 'active', practitionerReactivated: false });
      expect(await statusOf(PRACTITIONER_USER)).toBe('active');
      expect(await practitionerStatus()).toBe('inactive');
    });
  });

  it('is the owner’s alone, never one’s own, and only for somebody archived', async () => {
    await rolledBack(owner, async () => {
      await archived();
      await setAuditContext(owner, ADMIN, REASON);
      const byAdmin = await asApiRole(
        owner,
        IDS.tenantA,
        () => refusal(RESTORE, [PRACTITIONER_USER]),
        'admin',
      );
      expect(byAdmin).toMatchObject({
        code: '42501',
        message: expect.stringContaining('only an owner'),
      });

      await setAuditContext(owner, IDS.ownerA, REASON);
      const self = await asApiRole(owner, IDS.tenantA, () => refusal(RESTORE, [IDS.ownerA]));
      expect(self).toMatchObject({ code: '42501', message: expect.stringContaining('themselves') });

      const notArchived = await asApiRole(owner, IDS.tenantA, () => refusal(RESTORE, [ADMIN]));
      expect(notArchived).toMatchObject({
        code: '42501',
        message: expect.stringContaining('not archived'),
      });
      expect(await statusOf(PRACTITIONER_USER)).toBe('archived');
    });
  });
});

describe('the doors themselves', () => {
  it('are executable by the API role and by nobody else', async () => {
    const { rows } = await owner.query<{ fn: string; public: boolean; api: boolean }>(
      "select p.proname as fn, has_function_privilege('public', p.oid, 'execute') as public, " +
        "has_function_privilege('app_role', p.oid, 'execute') as api " +
        "from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' " +
        "and p.proname in ('archive_staff', 'restore_staff') order by p.proname",
    );
    expect(rows).toEqual([
      { fn: 'archive_staff', public: false, api: true },
      { fn: 'restore_staff', public: false, api: true },
    ]);
  });
});
