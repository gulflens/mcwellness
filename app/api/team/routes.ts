import { randomBytes, randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import { z } from 'zod';
import { canActor, canSuspend } from '@domain/shared';
import { logReads } from '../_middleware/audit';
import type { ApiEnv } from '../_middleware/request-context';
import { isAuthAdminUnavailable, isEmailInUse, type AuthAdminProvider } from '../portal/auth-admin';
import {
  GrantBody,
  InviteBody,
  InviteResponse,
  StatusBody,
  TeamListResponse,
  type TeamMember,
} from './schema';

/**
 * Who works at the practice: `GET /api/team`, `POST /api/team` (a new
 * sign-in with its roles), `POST /api/team/:id/roles` (one more role) and
 * `POST /api/team/:id/status` (suspend, reactivate). Trunk round 39,
 * 2026-09-10, closing the completeness audit's first item: until this the
 * console could hand a household its access and not a colleague theirs, so
 * every hire was a data step.
 *
 * **Who may.** The owner and an admin (`staff.manage`, domain/shared/actor.ts),
 * and `db/policies/core/role_guard.sql` says the same beneath: only those two
 * insert into `app_user` and `user_role`, only the owner grants or touches
 * ownership, and an admin cannot edit the owner's row. This file offers
 * ownership to nobody; the four working roles are `STAFF_ROLES`.
 *
 * **The sign-in.** Made through the same seam the portal's door uses
 * (`AuthAdminProvider`), with a temporary password minted here, answered once
 * to the person who pressed the button and stored nowhere — the operator's
 * decision of 10 September. If the practice's rows cannot be written after
 * the sign-in exists, the sign-in is taken back, so the address is free to
 * try again.
 *
 * **Nothing is deleted.** A suspended sign-in is refused at the fence
 * (`app.resolve_actor` answers nobody for a status other than active) and can
 * be reactivated; the trail keeps both acts, because both tables carry the
 * audit trigger.
 */

type Row = {
  id: string;
  display_name: string;
  email: string | null;
  status: 'active' | 'suspended' | 'archived';
  roles: string[];
};

const MEMBERS_SQL =
  'select u.id, u.display_name, u.email, u.status::text as status, ' +
  "coalesce(array_agg(r.role::text order by r.role) filter (where r.role is not null), '{}') as roles " +
  'from app_user u left join user_role r on r.user_id = u.id and r.tenant_id = u.tenant_id ' +
  'where u.tenant_id = app.current_tenant_id() ' +
  'group by u.id ' +
  // A household contact is not staff, and lives in Settings › Portal.
  "having bool_or(r.role <> 'client_contact') " +
  'order by u.display_name, u.id';

const IS_STAFF_SQL =
  'select 1 from app_user u where u.id = $1 and u.tenant_id = app.current_tenant_id() ' +
  "and exists (select 1 from user_role r where r.user_id = u.id and r.role <> 'client_contact')";

function toMember(row: Row, actorUserId: string): TeamMember {
  return {
    id: row.id,
    displayName: row.display_name,
    email: row.email,
    status: row.status,
    roles: row.roles,
    isYou: row.id === actorUserId,
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
    const { rows } = await db.query<Row>(MEMBERS_SQL);
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
    if (!canActor(actor, { type: 'staff.manage' }, {}, now())) {
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
        await db.query(
          'insert into user_role (tenant_id, user_id, role, granted_by, created_by) values ($1, $2, $3::role_kind, $4, $4)',
          [actor.tenantId, userId, role, actor.userId],
        );
      }
    } catch (error) {
      // The sign-in was made a moment ago and nothing else knows of it: take it
      // back so the address is free to try again, then fail as this would have.
      await options.authAdmin.deleteUser(authId).catch(() => undefined);
      throw error;
    }
    return c.json(InviteResponse.parse({ userId, temporaryPassword: password }), 201);
  });

  api.post('/api/team/:id/roles', async (c) => {
    const actor = c.get('actor');
    const db = c.get('db');
    const requestId = c.get('requestId');
    if (!canActor(actor, { type: 'staff.manage' }, {}, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const id = z.uuid().safeParse(c.req.param('id'));
    if (!id.success) return c.json({ error: 'not_found', requestId }, 404);
    const body = GrantBody.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: 'bad_request', requestId }, 400);
    const target = await db.query(IS_STAFF_SQL, [id.data]);
    if (target.rowCount !== 1) return c.json({ error: 'not_found', requestId }, 404);
    await db.query(
      'insert into user_role (tenant_id, user_id, role, granted_by, created_by) values ($1, $2, $3::role_kind, $4, $4) ' +
        'on conflict (user_id, role) do nothing',
      [actor.tenantId, id.data, body.data.role, actor.userId],
    );
    return c.json({ ok: true });
  });

  api.post('/api/team/:id/status', async (c) => {
    const actor = c.get('actor');
    const db = c.get('db');
    const requestId = c.get('requestId');
    if (!canActor(actor, { type: 'staff.manage' }, {}, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const id = z.uuid().safeParse(c.req.param('id'));
    if (!id.success) return c.json({ error: 'not_found', requestId }, 404);
    const body = StatusBody.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: 'bad_request', requestId }, 400);
    if (!canSuspend(actor.userId, id.data)) {
      return c.json({ error: 'not_yourself', requestId }, 400);
    }
    // Row security decides the rest: an admin cannot touch the owner's row
    // (role_guard.sql), which answers here as nothing to update.
    const updated = await db.query(
      'update app_user set status = $2::user_status where id = $1 and tenant_id = app.current_tenant_id() ' +
        "and exists (select 1 from user_role r where r.user_id = app_user.id and r.role <> 'client_contact')",
      [id.data, body.data.status],
    );
    if (updated.rowCount !== 1) return c.json({ error: 'not_found', requestId }, 404);
    return c.json({ ok: true });
  });
}
