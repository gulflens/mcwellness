import { randomBytes, randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import { z } from 'zod';
import { canActor } from '@domain/shared';
import { logReads } from '../_middleware/audit';
import type { ApiEnv, Db } from '../_middleware/request-context';
import { isAuthAdminUnavailable, isEmailInUse, type AuthAdminProvider } from '../portal/auth-admin';
import { AccompanimentBody, HelperBody, HelpersResponse, InviteResponse } from './schema';

/**
 * Helpers in Settings › Team (round 76, docs/SPEC/dispatch.md section 15.12):
 * a member of the practitioner's family who drives and carries kit on the day,
 * signs in, and shares their own location while they help — and reaches
 * nothing else.
 *
 * | Route | What |
 * |---|---|
 * | `GET /api/team/helpers` | (owner and admin) every helper, whom each accompanies, and the practitioners one may accompany |
 * | `POST /api/team/helpers` | a new helper: a sign-in, a temporary password, and whom they accompany |
 * | `PUT /api/team/helpers/:id` | whom an existing helper accompanies |
 * | `DELETE /api/team/helpers/:id` | revoke: the accompaniment ends, their positions go, their sign-in is suspended |
 *
 * **Who may.** The list is the owner's and an admin's (`staff.manage`, as the
 * team list is); every change is the owner's alone (`staff.helper.manage`),
 * because Team access is the owner's (the operator's rule of 21 September
 * 2026, confirmed for helpers on 6 October).
 *
 * **The same path as a colleague.** A new helper is made exactly as
 * `POST /api/team` makes a colleague — the sign-in through the same seam, the
 * temporary password answered once and stored nowhere, the sign-in taken back
 * if the practice's rows cannot be written — and then named through
 * `app.name_helper` (migration 213), which gives the role and the
 * accompaniment together and asks again, of `user_role`, whether the caller is
 * an owner. Revoking is `app.revoke_helper`, the same shape. The
 * API role writes neither the role nor the accompaniment by itself.
 *
 * **Sign-in by email only.** The sign-in seam (`AuthAdminProvider`) makes a
 * sign-in from an email address and a password; a telephone sign-in would need
 * the provider's SMS sending, which is a vendor the practice has not approved
 * (docs/COMPLIANCE/approved-vendors.md). So a helper is added with an email
 * address, as every colleague is.
 */

/** Sixteen characters from a safe alphabet; long enough, and typed once. */
function temporaryPassword(): string {
  return randomBytes(12).toString('base64url');
}

/** Postgres: insufficient_privilege. Here, a refusal raised by 213's doors. */
function isRefusedBeneath(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: string }).code === '42501'
  );
}

async function stampReason(db: Db, reason: string): Promise<void> {
  await db.query("select set_config('app.reason', $1, true)", [reason]);
}

/**
 * Runs one of 213's doors inside its own savepoint, so a refusal beneath —
 * a practitioner who stopped working a moment ago, a person who already holds
 * another role — is answered as a 409 rather than poisoning the transaction.
 */
async function door(db: Db, sql: string, params: unknown[]): Promise<'ok' | 'refused'> {
  await db.query('savepoint helper_door');
  try {
    await db.query(sql, params);
  } catch (error) {
    if (!isRefusedBeneath(error)) throw error;
    await db.query('rollback to savepoint helper_door');
    return 'refused';
  }
  await db.query('release savepoint helper_door');
  return 'ok';
}

const HELPERS_SQL =
  'select u.id, u.display_name, u.status::text as status, a.practitioner_id, ' +
  'pu.display_name as practitioner_name ' +
  'from app_user u ' +
  'left join helper_accompaniment a on a.helper_user_id = u.id and a.tenant_id = u.tenant_id ' +
  'and a.ended_at is null ' +
  'left join practitioner p on p.id = a.practitioner_id and p.tenant_id = u.tenant_id ' +
  'left join app_user pu on pu.id = p.user_id and pu.tenant_id = u.tenant_id ' +
  'where u.tenant_id = app.current_tenant_id() ' +
  "and exists (select 1 from user_role r where r.user_id = u.id and r.tenant_id = u.tenant_id and r.role = 'helper') " +
  'order by u.display_name, u.id';

const PRACTITIONERS_SQL =
  'select p.id, u.display_name from practitioner p ' +
  'join app_user u on u.id = p.user_id and u.tenant_id = p.tenant_id ' +
  "where p.tenant_id = app.current_tenant_id() and p.status = 'active' and u.status = 'active' " +
  'order by u.display_name, p.id';

/** A helper, read as the actor: the person must hold the helper role in this practice. */
const IS_HELPER_SQL =
  'select 1 from user_role r where r.user_id = $1 and r.tenant_id = app.current_tenant_id() ' +
  "and r.role = 'helper'";

export type HelpersOptions = {
  authAdmin: AuthAdminProvider;
  now: () => Date;
};

export function mountTeamHelpers(api: Hono<ApiEnv>, options: HelpersOptions): void {
  const { authAdmin, now } = options;

  api.get('/api/team/helpers', async (c) => {
    const actor = c.get('actor');
    const db = c.get('db');
    const requestId = c.get('requestId');
    if (!canActor(actor, { type: 'staff.manage' }, {}, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const helpers = await db.query<{
      id: string;
      display_name: string;
      status: 'active' | 'suspended' | 'archived';
      practitioner_id: string | null;
      practitioner_name: string | null;
    }>(HELPERS_SQL);
    const practitioners = await db.query<{ id: string; display_name: string }>(PRACTITIONERS_SQL);
    // Names of the practice's own people, read by a person.
    await logReads(
      db,
      'app_user',
      helpers.rows.map((row) => ({ id: row.id, clientId: null })),
      'list',
    );
    return c.json(
      HelpersResponse.parse({
        helpers: helpers.rows.map((row) => ({
          userId: row.id,
          displayName: row.display_name,
          status: row.status,
          accompanies:
            row.practitioner_id === null
              ? null
              : { practitionerId: row.practitioner_id, displayName: row.practitioner_name ?? '' },
        })),
        practitioners: practitioners.rows.map((row) => ({
          practitionerId: row.id,
          displayName: row.display_name,
        })),
      }),
    );
  });

  api.post('/api/team/helpers', async (c) => {
    const actor = c.get('actor');
    const db = c.get('db');
    const requestId = c.get('requestId');
    if (!canActor(actor, { type: 'staff.helper.manage' }, {}, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const body = HelperBody.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: 'bad_request', requestId }, 400);
    const password = temporaryPassword();
    let authId: string;
    try {
      ({ authId } = await authAdmin.createUser({ email: body.data.email, password }));
    } catch (error) {
      if (isEmailInUse(error)) return c.json({ error: 'email_in_use', requestId }, 409);
      if (isAuthAdminUnavailable(error)) {
        return c.json({ error: 'sign_ins_unavailable', requestId }, 503);
      }
      throw error;
    }
    const userId = randomUUID();
    const takeBack = () =>
      authAdmin.deleteUser(authId).catch(() => {
        // Never the address. The next attempt answers 409 until it is removed.
        console.warn('Team: a sign-in could not be taken back after its rows failed to write.');
      });
    // The person and their naming stand or fall together: a refusal beneath
    // (a practitioner who stopped working a moment ago) leaves no row of them,
    // and the sign-in made a moment ago is taken back.
    await stampReason(db, 'added a helper');
    await db.query('savepoint new_helper');
    try {
      await db.query(
        'insert into app_user (id, tenant_id, auth_id, display_name, email, preferred_locale, status, created_by) ' +
          "values ($1, $2, $3, $4, $5, 'en'::locale, 'active', $6)",
        [userId, actor.tenantId, authId, body.data.displayName, body.data.email, actor.userId],
      );
      await db.query('select app.name_helper($1, $2)', [userId, body.data.practitionerId]);
    } catch (error) {
      await db.query('rollback to savepoint new_helper');
      await takeBack();
      if (isRefusedBeneath(error)) return c.json({ error: 'not_a_practitioner', requestId }, 409);
      throw error;
    }
    await db.query('release savepoint new_helper');
    return c.json(InviteResponse.parse({ userId, temporaryPassword: password }), 201);
  });

  api.put('/api/team/helpers/:id', async (c) => {
    const actor = c.get('actor');
    const db = c.get('db');
    const requestId = c.get('requestId');
    if (!canActor(actor, { type: 'staff.helper.manage' }, {}, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const id = z.uuid().safeParse(c.req.param('id'));
    if (!id.success) return c.json({ error: 'not_found', requestId }, 404);
    const body = AccompanimentBody.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: 'bad_request', requestId }, 400);
    if ((await db.query(IS_HELPER_SQL, [id.data])).rowCount !== 1) {
      return c.json({ error: 'not_found', requestId }, 404);
    }
    await stampReason(db, 'named whom a helper accompanies');
    const named = await door(db, 'select app.name_helper($1, $2)', [
      id.data,
      body.data.practitionerId,
    ]);
    if (named === 'refused') return c.json({ error: 'refused', requestId }, 409);
    return c.json({ ok: true });
  });

  api.delete('/api/team/helpers/:id', async (c) => {
    const actor = c.get('actor');
    const db = c.get('db');
    const requestId = c.get('requestId');
    if (!canActor(actor, { type: 'staff.helper.manage' }, {}, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const id = z.uuid().safeParse(c.req.param('id'));
    if (!id.success) return c.json({ error: 'not_found', requestId }, 404);
    if ((await db.query(IS_HELPER_SQL, [id.data])).rowCount !== 1) {
      return c.json({ error: 'not_found', requestId }, 404);
    }
    await stampReason(db, 'revoked a helper');
    const revoked = await door(db, 'select app.revoke_helper($1)', [id.data]);
    if (revoked === 'refused') return c.json({ error: 'refused', requestId }, 409);
    return c.json({ ok: true });
  });
}
