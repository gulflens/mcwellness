import { randomBytes, randomUUID } from 'node:crypto';
import type { Context, Hono } from 'hono';
import { z } from 'zod';
import {
  canActor,
  canEditProfile,
  canResetPassword,
  canSuspend,
  canSwitchRole,
  hasRole,
  isLocked,
  type Role,
} from '@domain/shared';
import { logAction, logReads } from '../_middleware/audit';
import type { ApiEnv, Db } from '../_middleware/request-context';
import { isAuthAdminUnavailable, isEmailInUse, type AuthAdminProvider } from '../portal/auth-admin';
import {
  InviteBody,
  InviteResponse,
  ProfileBody,
  StatusBody,
  TEAM_REFUSALS,
  TeamListResponse,
  TeamProfile,
  type TeamMember,
} from './schema';

/**
 * Who works at the practice, and what each of them may reach: the team list,
 * one colleague's profile, the four working roles switched on and off, a
 * sign-in suspended or reactivated, and a temporary password minted. Trunk
 * round 39, 2026-09-10, opened this file; round 58, 2026-09-21, is what it now
 * says.
 *
 * **Who may.** The list is the owner's and an admin's (`staff.manage`).
 * *Everything else is the owner's alone* (`staff.access.manage`), which is the
 * change of 21 September: an admin could add a colleague, grant them a role
 * and mint them a password, and the operator took all three away on reading
 * round 57's security review — a temporary password is a sign-in, so an admin
 * who mints one for a colleague holding Finance has the books by one remove,
 * and closing the front door while leaving that one open is not a rule anybody
 * could explain. With two owners there is always somebody to ask
 * (docs/superpowers/specs/2026-09-21-team-profiles-and-access-design.md
 * section 5).
 *
 * `db/policies/core/role_guard.sql` says the same beneath, and migration 923
 * says it again as triggers that bind every caller: an ownership row does not
 * change, an owner is not suspended and an owner's name, address and telephone
 * are that owner's own. **A forbidden update is silence there, not an error** —
 * row security matches no row and raises nothing — so every update below reads
 * its row count and none of them answers success on none. The route's own
 * guards make that unreachable; the count is the floor beneath the guard.
 *
 * **The sign-in.** Made through the same seam the portal's door uses
 * (`AuthAdminProvider`), with a temporary password minted here, answered once
 * to the person who pressed the button and stored nowhere — the operator's
 * decision of 10 September. If the practice's rows cannot be written after the
 * sign-in exists, the sign-in is taken back, so the address is free to try
 * again; and when an existing colleague's address changes, the sign-in moves
 * first and the row second, with the address put back if the row refuses.
 *
 * **A role switched off** is `app.revoke_staff_role`, because the API role
 * holds no delete on `user_role` and gains none. The pure rule `canSwitchRole`
 * is asked first so a person reads a sentence; the function is the boundary
 * and says the same thing again.
 *
 * **Nothing is deleted.** A suspended sign-in is refused at the fence
 * (`app.resolve_actor` answers nobody for a status other than active) and can
 * be reactivated; an archived one cannot; the trail keeps every act, because
 * both tables carry the audit trigger.
 *
 * **Why the password route keeps the wider first guard.** It asks
 * `staff.manage`, not `staff.access.manage`, on purpose. An admin's attempt is
 * refused a line later by `canResetPassword` — owners only since round 57 —
 * and that refusal is written to the trail as `password_reset_refused`. A bare
 * 403 at the first guard would refuse the same request and leave no row, and
 * the screen offers no such button, so an attempt that reaches here was made
 * by hand and is exactly the act the trail exists for (docs/SPEC/audit.md:
 * unauthorised use is demonstrable, not only forbidden).
 */

type Row = {
  id: string;
  display_name: string;
  email: string | null;
  status: 'active' | 'suspended' | 'archived';
  roles: string[];
  job_title: string | null;
};

/**
 * The list. `job_title` is joined for an owner and is not asked for at all
 * otherwise: row security on `staff_profile` would answer null for an admin
 * anyway, and a query that never asks is the second reason it can never
 * answer.
 */
function membersSql(forOwner: boolean): string {
  return (
    'select u.id, u.display_name, u.email, u.status::text as status, ' +
    (forOwner ? 'p.job_title, ' : 'null::text as job_title, ') +
    "coalesce(array_agg(r.role::text order by r.role) filter (where r.role is not null), '{}') as roles " +
    'from app_user u left join user_role r on r.user_id = u.id and r.tenant_id = u.tenant_id ' +
    (forOwner
      ? 'left join staff_profile p on p.user_id = u.id and p.tenant_id = u.tenant_id '
      : '') +
    'where u.tenant_id = app.current_tenant_id() ' +
    'group by u.id' +
    (forOwner ? ', p.job_title ' : ' ') +
    // A household contact is not staff, and lives in Settings › Portal.
    "having bool_or(r.role <> 'client_contact') " +
    'order by u.display_name, u.id'
  );
}

type Target = {
  id: string;
  auth_id: string | null;
  display_name: string;
  email: string | null;
  phone: string | null;
  preferred_locale: 'en' | 'ar';
  status: Row['status'];
  roles: Role[];
};

/** One colleague, read once as the actor, for every route that acts on one. */
const TARGET_SQL =
  'select u.id, u.auth_id, u.display_name, u.email, u.phone, u.preferred_locale::text as preferred_locale, ' +
  'u.status::text as status, ' +
  '(select array_agg(r.role::text order by r.role) from user_role r where r.user_id = u.id and r.tenant_id = u.tenant_id) as roles ' +
  'from app_user u where u.id = $1 and u.tenant_id = app.current_tenant_id() ' +
  "and exists (select 1 from user_role r where r.user_id = u.id and r.role <> 'client_contact')";

type ProfileColumns = {
  job_title: string | null;
  started_on: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  private_notes: string | null;
};

const PROFILE_SQL =
  'select job_title, started_on::text as started_on, emergency_contact_name, ' +
  'emergency_contact_phone, private_notes from staff_profile ' +
  'where user_id = $1 and tenant_id = app.current_tenant_id()';

const UPDATE_USER_SQL =
  'update app_user set display_name = $2, email = $3, phone = $4, preferred_locale = $5::locale ' +
  'where id = $1 and tenant_id = app.current_tenant_id()';

const UPSERT_PROFILE_SQL =
  'insert into staff_profile (tenant_id, user_id, job_title, started_on, emergency_contact_name, ' +
  'emergency_contact_phone, private_notes, created_by) ' +
  'values ($1, $2, $3, $4, $5, $6, $7, $8) ' +
  'on conflict (user_id) do update set job_title = excluded.job_title, ' +
  'started_on = excluded.started_on, ' +
  'emergency_contact_name = excluded.emergency_contact_name, ' +
  'emergency_contact_phone = excluded.emergency_contact_phone, ' +
  'private_notes = excluded.private_notes';

const GRANT_SQL =
  'insert into user_role (tenant_id, user_id, role, granted_by, created_by) ' +
  'values ($1, $2, $3::role_kind, $4, $4) on conflict (user_id, role) do nothing';

/** What each refusal is on the wire (design section 7); the screen holds the sentences. */
const REFUSAL_STATUS: Record<(typeof TEAM_REFUSALS)[number], 400 | 409> = {
  locked: 409,
  last_role: 409,
  not_yourself: 400,
  not_a_working_role: 400,
};

/** Postgres: insufficient_privilege. Here, always a refusal raised by a guard. */
function isRefusedBeneath(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: string }).code === '42501'
  );
}

async function readTarget(db: Db, id: string): Promise<Target | null> {
  const { rows } = await db.query<Target>(TARGET_SQL, [id]);
  return rows[0] ?? null;
}

function toMember(row: Row, actorUserId: string): TeamMember {
  return {
    id: row.id,
    displayName: row.display_name,
    email: row.email,
    status: row.status,
    roles: row.roles,
    isYou: row.id === actorUserId,
    locked: isLocked(row.roles as Role[]),
    jobTitle: row.job_title,
  };
}

/** Sixteen characters from a safe alphabet; long enough, and typed once. */
function temporaryPassword(): string {
  return randomBytes(12).toString('base64url');
}

export type TeamOptions = {
  authAdmin: AuthAdminProvider;
  now?: () => Date;
};

export function mountTeam(api: Hono<ApiEnv>, options: TeamOptions): void {
  const now = options.now ?? (() => new Date());

  api.get('/api/team', async (c) => {
    const actor = c.get('actor');
    const db = c.get('db');
    const requestId = c.get('requestId');
    if (!canActor(actor, { type: 'staff.manage' }, {}, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const { rows } = await db.query<Row>(membersSql(hasRole(actor, 'owner')));
    // Names and addresses of the practice's own people, read by a person.
    await logReads(
      db,
      'app_user',
      rows.map((row) => ({ id: row.id, clientId: null })),
      'list',
    );
    return c.json(
      TeamListResponse.parse({ members: rows.map((row) => toMember(row, actor.userId)) }),
    );
  });

  api.post('/api/team', async (c) => {
    const actor = c.get('actor');
    const db = c.get('db');
    const requestId = c.get('requestId');
    if (!canActor(actor, { type: 'staff.access.manage' }, {}, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const body = InviteBody.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) {
      return c.json({ error: 'bad_request', requestId }, 400);
    }
    const password = temporaryPassword();
    let authId: string;
    try {
      ({ authId } = await options.authAdmin.createUser({ email: body.data.email, password }));
    } catch (error) {
      if (isEmailInUse(error)) return c.json({ error: 'email_in_use', requestId }, 409);
      if (isAuthAdminUnavailable(error)) {
        return c.json({ error: 'sign_ins_unavailable', requestId }, 503);
      }
      throw error;
    }
    const userId = randomUUID();
    try {
      await db.query(
        'insert into app_user (id, tenant_id, auth_id, display_name, email, preferred_locale, status, created_by) ' +
          "values ($1, $2, $3, $4, $5, $6::locale, 'active', $7)",
        [
          userId,
          actor.tenantId,
          authId,
          body.data.displayName,
          body.data.email,
          body.data.preferredLocale,
          actor.userId,
        ],
      );
      for (const role of body.data.roles) {
        await db.query(GRANT_SQL, [actor.tenantId, userId, role, actor.userId]);
      }
    } catch (error) {
      // The sign-in was made a moment ago and nothing else knows of it: take it
      // back so the address is free to try again, then fail as this would have.
      await options.authAdmin.deleteUser(authId).catch(() => {
        // Never the address. The next attempt answers 409 until it is removed.
        console.warn('Team: a sign-in could not be taken back after its rows failed to write.');
      });
      throw error;
    }
    return c.json(InviteResponse.parse({ userId, temporaryPassword: password }), 201);
  });

  api.get('/api/team/:id', async (c) => {
    const actor = c.get('actor');
    const db = c.get('db');
    const requestId = c.get('requestId');
    if (!canActor(actor, { type: 'staff.access.manage' }, {}, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const id = z.uuid().safeParse(c.req.param('id'));
    if (!id.success) return c.json({ error: 'not_found', requestId }, 404);
    const target = await readTarget(db, id.data);
    if (!target) return c.json({ error: 'not_found', requestId }, 404);
    // Opening a profile is a read of a person, as the list already is
    // (design section 6).
    await logReads(db, 'app_user', [{ id: target.id, clientId: null }], 'read');
    const held = (await db.query<ProfileColumns>(PROFILE_SQL, [target.id])).rows[0];
    const member = toMember(
      {
        id: target.id,
        display_name: target.display_name,
        email: target.email,
        status: target.status,
        roles: target.roles,
        job_title: held?.job_title ?? null,
      },
      actor.userId,
    );
    return c.json(
      TeamProfile.parse({
        ...member,
        phone: target.phone,
        preferredLocale: target.preferred_locale,
        startedOn: held?.started_on ?? null,
        emergencyContactName: held?.emergency_contact_name ?? null,
        emergencyContactPhone: held?.emergency_contact_phone ?? null,
        privateNotes: held?.private_notes ?? null,
        editable: canEditProfile({
          actorUserId: actor.userId,
          actorRoles: actor.roles,
          targetUserId: target.id,
          targetRoles: target.roles,
        }),
      }),
    );
  });

  api.patch('/api/team/:id', async (c) => {
    const actor = c.get('actor');
    const db = c.get('db');
    const requestId = c.get('requestId');
    if (!canActor(actor, { type: 'staff.access.manage' }, {}, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const id = z.uuid().safeParse(c.req.param('id'));
    if (!id.success) return c.json({ error: 'not_found', requestId }, 404);
    const body = ProfileBody.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: 'bad_request', requestId }, 400);
    const target = await readTarget(db, id.data);
    if (!target) return c.json({ error: 'not_found', requestId }, 404);
    // Asked before a single write, so an owner reading the other owner's
    // profile is told why rather than meeting guard_owner_identity's raise as
    // a 500.
    if (
      !canEditProfile({
        actorUserId: actor.userId,
        actorRoles: actor.roles,
        targetUserId: target.id,
        targetRoles: target.roles,
      })
    ) {
      return c.json({ error: 'locked', requestId }, 409);
    }

    // An address is the sign-in, so the sign-in service changes first and the
    // row second (design section 7). Non-null while an address has been moved
    // and not yet put back.
    let movedFrom: { authId: string; email: string | null } | null = null;
    if (target.auth_id !== null && body.data.email !== target.email) {
      try {
        await options.authAdmin.setEmail(target.auth_id, body.data.email);
      } catch (error) {
        if (isEmailInUse(error)) return c.json({ error: 'email_in_use', requestId }, 409);
        if (isAuthAdminUnavailable(error)) {
          return c.json({ error: 'sign_ins_unavailable', requestId }, 503);
        }
        throw error;
      }
      movedFrom = { authId: target.auth_id, email: target.email };
    }
    try {
      const updated = await db.query(UPDATE_USER_SQL, [
        target.id,
        body.data.displayName,
        body.data.email,
        body.data.phone,
        body.data.preferredLocale,
      ]);
      // Beneath this route a forbidden update matches no row and raises
      // nothing, so nothing here answers "saved" on none. The guard above
      // makes this unreachable; this is the floor beneath the guard.
      if (updated.rowCount !== 1) {
        throw new Error('A colleague’s row could not be saved.');
      }
      await db.query(UPSERT_PROFILE_SQL, [
        actor.tenantId,
        target.id,
        body.data.jobTitle,
        body.data.startedOn,
        body.data.emergencyContactName,
        body.data.emergencyContactPhone,
        body.data.privateNotes,
        actor.userId,
      ]);
    } catch (error) {
      // The address moved and the rows did not: put it back, so the sign-in
      // and the row say the same thing again. The transaction rolls back on
      // the rethrow, which is what leaves the row as it was. An address that
      // was null before cannot be put back — there is no call that unsets one
      // — and a colleague added here always has one, so that is a row written
      // by a data step and is left as it is rather than guessed at.
      if (movedFrom !== null && movedFrom.email !== null) {
        await options.authAdmin.setEmail(movedFrom.authId, movedFrom.email).catch(() => {
          // Never the address: this line is read by people, and by a log.
          console.warn('Team: an address could not be put back after its row failed to write.');
        });
      }
      throw error;
    }
    return c.json({ ok: true });
  });

  /**
   * One role, on or off, for one colleague. The pure rule answers first — so
   * the screen has a sentence and the refusal is the same one the switch
   * itself greys out — and `app.revoke_staff_role` asks every question again
   * beneath, which is the answer that binds.
   */
  async function switchRole(c: Context<ApiEnv>, on: boolean): Promise<Response> {
    const actor = c.get('actor');
    const db = c.get('db');
    const requestId = c.get('requestId');
    if (!canActor(actor, { type: 'staff.access.manage' }, {}, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const id = z.uuid().safeParse(c.req.param('id'));
    if (!id.success) return c.json({ error: 'not_found', requestId }, 404);
    const target = await readTarget(db, id.data);
    if (!target) return c.json({ error: 'not_found', requestId }, 404);
    const role = c.req.param('role') ?? '';
    const refusal = canSwitchRole({
      actorUserId: actor.userId,
      targetUserId: target.id,
      targetRoles: target.roles,
      role,
      on,
    });
    if (refusal !== null) {
      return c.json({ error: refusal, requestId }, REFUSAL_STATUS[refusal]);
    }
    if (on) {
      // A role they already hold is not an error: the switch is idempotent, so
      // two windows agreeing with each other settle rather than argue.
      await db.query(GRANT_SQL, [actor.tenantId, target.id, role, actor.userId]);
      return c.json({ ok: true });
    }
    // A failed statement poisons the transaction, and the transaction belongs
    // to the middleware, so the call sits in its own savepoint.
    await db.query('savepoint switch_role');
    try {
      await db.query('select app.revoke_staff_role($1, $2::role_kind)', [target.id, role]);
    } catch (error) {
      if (!isRefusedBeneath(error)) throw error;
      await db.query('rollback to savepoint switch_role');
      // The rule above already said yes, so the role set moved between the
      // read and the call — another owner switching something off at the same
      // moment. Which of its six refusals this is cannot be told apart from
      // the SQLSTATE, and guessing `last_role` would put a sentence on the
      // screen that may be untrue. Not retried: the caller reads the profile
      // again and sees what is actually there.
      return c.json({ error: 'conflict', requestId }, 409);
    }
    await db.query('release savepoint switch_role');
    return c.json({ ok: true });
  }

  api.put('/api/team/:id/roles/:role', (c) => switchRole(c, true));
  api.delete('/api/team/:id/roles/:role', (c) => switchRole(c, false));

  api.post('/api/team/:id/status', async (c) => {
    const actor = c.get('actor');
    const db = c.get('db');
    const requestId = c.get('requestId');
    if (!canActor(actor, { type: 'staff.access.manage' }, {}, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const id = z.uuid().safeParse(c.req.param('id'));
    if (!id.success) return c.json({ error: 'not_found', requestId }, 404);
    const body = StatusBody.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: 'bad_request', requestId }, 400);
    if (!canSuspend(actor.userId, id.data)) {
      return c.json({ error: 'not_yourself', requestId }, 400);
    }
    const target = await readTarget(db, id.data);
    if (!target) return c.json({ error: 'not_found', requestId }, 404);
    // An owner's door stays open, for every caller (migration 923). Said here
    // first so the answer is a sentence rather than the trigger's raise.
    if (isLocked(target.roles)) {
      return c.json({ error: 'locked', requestId }, 409);
    }
    // Row security decides the rest, and answers a refusal as nothing to
    // update. An archived sign-in is the end of one and does not come back
    // (canReactivate).
    const updated = await db.query(
      'update app_user set status = $2::user_status where id = $1 and tenant_id = app.current_tenant_id() ' +
        "and status <> 'archived' " +
        "and exists (select 1 from user_role r where r.user_id = app_user.id and r.role <> 'client_contact')",
      [id.data, body.data.status],
    );
    if (updated.rowCount !== 1) return c.json({ error: 'not_found', requestId }, 404);
    return c.json({ ok: true });
  });

  api.post('/api/team/:id/password', async (c) => {
    const actor = c.get('actor');
    const db = c.get('db');
    const requestId = c.get('requestId');
    // The wider guard, deliberately: see the head of this file. An admin's
    // attempt has to reach canResetPassword to be written down.
    if (!canActor(actor, { type: 'staff.manage' }, {}, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const id = z.uuid().safeParse(c.req.param('id'));
    if (!id.success) return c.json({ error: 'not_found', requestId }, 404);
    const target = await db.query<{ auth_id: string | null; roles: Role[] }>(
      'select u.auth_id, ' +
        '(select array_agg(r.role::text) from user_role r where r.user_id = u.id and r.tenant_id = u.tenant_id) as roles ' +
        'from app_user u where u.id = $1 and u.tenant_id = app.current_tenant_id() ' +
        "and u.status = 'active' " +
        "and exists (select 1 from user_role r where r.user_id = u.id and r.role <> 'client_contact')",
      [id.data],
    );
    const authId = target.rows[0]?.auth_id ?? null;
    if (target.rowCount !== 1 || authId === null) {
      return c.json({ error: 'not_found', requestId }, 404);
    }
    // Nothing in the database stands beneath this act — the password is set at
    // the sign-in service, past row security — so the rule is asked here, of
    // the roles just read and never of anything the caller sent.
    if (!canResetPassword(actor.roles, target.rows[0]?.roles ?? [])) {
      // The screen offers no such button, so this was a request made by hand.
      // A 4xx commits, so the row survives the refusal it records
      // (docs/SPEC/audit.md: unauthorised use is demonstrable, not only
      // forbidden).
      await logAction(
        db,
        'password_reset_refused',
        { type: 'app_user', id: id.data, clientId: null },
        {},
      );
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const password = temporaryPassword();
    try {
      await options.authAdmin.setPassword(authId, password);
    } catch (error) {
      if (isAuthAdminUnavailable(error)) {
        return c.json({ error: 'sign_ins_unavailable', requestId }, 503);
      }
      throw error;
    }
    // The act is in the trail — who reset whose sign-in — and the password is not.
    await logAction(db, 'password_reset', { type: 'app_user', id: id.data, clientId: null }, {});
    return c.json(InviteResponse.parse({ userId: id.data, temporaryPassword: password }));
  });
}
