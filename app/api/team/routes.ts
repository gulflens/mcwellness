import { randomBytes, randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import { z } from 'zod';
import {
  canActor,
  canResetPassword,
  canSuspend,
  hasRole,
  isLocked,
  type Role,
} from '@domain/shared';
import { logAction, logReads } from '../_middleware/audit';
import type { ApiEnv } from '../_middleware/request-context';
import { isAuthAdminUnavailable, isEmailInUse, type AuthAdminProvider } from '../portal/auth-admin';
import { mountTeamProfile } from './profile';
import { GRANT_SQL, mountTeamRoles } from './roles';
import { InviteBody, InviteResponse, StatusBody, TeamListResponse } from './schema';
import { membersSql, readTargetRoles, toMember, type Row } from './target';

/**
 * Who works at the practice, and what each of them may reach: the team list,
 * one colleague's profile, the four working roles switched on and off, a
 * sign-in suspended or reactivated, and a temporary password minted. Trunk
 * round 39, 2026-09-10, opened this file; round 58, 2026-09-21, is what it now
 * says.
 *
 * **Where each route lives.** This file holds the list, a new colleague,
 * suspending and the temporary password, and `mountTeam` mounts the other two
 * halves: `./profile.ts` (open and save one profile, and the address's two
 * writes) and `./roles.ts` (one role on or off). `./target.ts` is how all five
 * read the person they are about, and `./schema.ts` is the wire. The folder was
 * one file until it passed 550 lines (round 58's review, ruling R7).
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
 * row security matches no row and raises nothing — so every update in this
 * folder reads its row count and none of them answers success on none. The
 * routes' own guards make that unreachable; the count is the floor beneath the
 * guard.
 *
 * **The sign-in.** Made through the same seam the portal's door uses
 * (`AuthAdminProvider`), with a temporary password minted here, answered once
 * to the person who pressed the button and stored nowhere — the operator's
 * decision of 10 September. If the practice's rows cannot be written after the
 * sign-in exists, the sign-in is taken back, so the address is free to try
 * again; and when an existing colleague's address changes, the sign-in moves
 * first and the row second, with the address put back if the row refuses
 * (`./profile.ts`).
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
        // Through the role switch's own insert since round 58, so a body that
        // names the same role twice now settles instead of failing on the
        // second one: `on conflict (user_id, role) do nothing`.
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
    // Who they are and what they hold; this route shows nobody a name.
    const target = await readTargetRoles(db, id.data);
    if (!target) return c.json({ error: 'not_found', requestId }, 404);
    // An owner's door stays open, for every caller (migration 923). Said here
    // first so the answer is a sentence rather than the trigger's raise. It is
    // the whole column that is locked, so `active` is refused too: an owner
    // suspended by a data step is reactivated by another one, never from here.
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

  mountTeamProfile(api, { authAdmin: options.authAdmin, now });
  mountTeamRoles(api, now);
}
