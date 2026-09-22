import type { Hono } from 'hono';
import { z } from 'zod';
import { canActor, canEditProfile } from '@domain/shared';
import { logReads } from '../_middleware/audit';
import type { ApiEnv } from '../_middleware/request-context';
import { isAuthAdminUnavailable, isEmailInUse, type AuthAdminProvider } from '../portal/auth-admin';
import { ProfileBody, TeamProfile } from './schema';
import { readTarget, toMember } from './target';

/**
 * One colleague's profile: `GET /api/team/:id` to open it and
 * `PATCH /api/team/:id` to save it. The owner's alone
 * (`staff.access.manage`), and for a row that holds ownership that owner's
 * alone again (`canEditProfile`). Round 58, 2026-09-21; split out of
 * `./routes.ts` for its own sake, because the address's two writes are the
 * longest piece of reasoning in this folder and it belongs beside the only code
 * that performs it.
 *
 * **An address is two writes.** `app_user.email` is what the practice reads and
 * the sign-in service holds the same address as the way in, so the service
 * changes first and the row second. If the row then refuses, the address is put
 * back and the failure is rethrown, which is what rolls the row back with it —
 * see the `catch` below for what that covers and what it does not.
 *
 * `staff_profile` is the owners' alone for reading and for writing
 * (db/policies/core/staff_profile.sql), and none of its five columns reaches the
 * trail's values (migration 967). Opening a profile is a read of a person and of
 * the profile row, and both are logged, as the list already is.
 *
 * **A staff row whose `app_user.email` is null cannot have its profile saved at
 * all**, because `ProfileBody.email` is required and this route sends whatever
 * it parsed. That is unreachable today and is a reachable column state, which is
 * why it is written down rather than guarded: `app.bootstrap_practice` refuses
 * an owner with no address, `POST /api/team` always writes one, and the one
 * insert in the platform that leaves `email` null makes a household's contact
 * (`app/api/portal/access.ts`), whom `STAFF_CLAUSES` answers 404 for. The day a
 * member of staff arrives without an address, this form is the thing that cannot
 * represent them, and the fix is a nullable address on the wire rather than
 * anything here.
 */

type ProfileColumns = {
  id: string;
  job_title: string | null;
  started_on: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  private_notes: string | null;
};

const PROFILE_SQL =
  'select id, job_title, started_on::text as started_on, emergency_contact_name, ' +
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

export type TeamProfileDeps = { authAdmin: AuthAdminProvider; now: () => Date };

export function mountTeamProfile(api: Hono<ApiEnv>, deps: TeamProfileDeps): void {
  api.get('/api/team/:id', async (c) => {
    const actor = c.get('actor');
    const db = c.get('db');
    const requestId = c.get('requestId');
    if (!canActor(actor, { type: 'staff.access.manage' }, {}, deps.now())) {
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
    // And a read of the profile row itself, which is the more sensitive of the
    // two: an emergency contact is a third person's name and number, and the
    // notes are the owners' own words about a colleague. Logged only when a row
    // came back, because a read row for a row that is not there would say
    // somebody looked at something that does not exist.
    if (held !== undefined) {
      await logReads(db, 'staff_profile', [{ id: held.id, clientId: null }], 'read');
    }
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
    if (!canActor(actor, { type: 'staff.access.manage' }, {}, deps.now())) {
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

    // The sign-in service changes first and the row second (design section 7).
    // Non-null while an address has been moved and not yet put back.
    let movedFrom: { authId: string; email: string | null } | null = null;
    if (target.auth_id !== null && body.data.email !== target.email) {
      try {
        await deps.authAdmin.setEmail(target.auth_id, body.data.email);
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
      // makes both of these unreachable; they are the floor beneath the guard.
      if (updated.rowCount !== 1) {
        throw new Error('A colleague’s row could not be saved.');
      }
      const written = await db.query(UPSERT_PROFILE_SQL, [
        actor.tenantId,
        target.id,
        body.data.jobTitle,
        body.data.startedOn,
        body.data.emergencyContactName,
        body.data.emergencyContactPhone,
        body.data.privateNotes,
        actor.userId,
      ]);
      if (written.rowCount !== 1) {
        throw new Error('A colleague’s profile could not be saved.');
      }
    } catch (error) {
      // The address moved and the rows did not: put it back, so the sign-in and
      // the row say the same thing again. The transaction rolls back on the
      // rethrow, which is what leaves the row as it was.
      //
      // **What this covers is a failed statement, and not a failed commit.**
      // The commit happens after this route has returned
      // (app/api/_middleware/request-context.ts), so a commit that fails
      // afterwards leaves the sign-in holding the new address while
      // `app_user.email` holds the old one, and nothing marks it. Deliberately
      // not compensated: the consequence is bounded, because the fence resolves
      // a person by `auth_id` and never by their address
      // (`app.resolve_actor`, migration 095), so they can still sign in with
      // either — and sending the same save again repairs the row.
      //
      // An address that was null before cannot be put back either: nothing in
      // `AuthAdminProvider` unsets one. That is reachable for any row whose
      // `email` is null, not only for one written by a data step, so the
      // sign-in keeps the new address and the row keeps its null until somebody
      // saves again.
      if (movedFrom !== null && movedFrom.email !== null) {
        await deps.authAdmin.setEmail(movedFrom.authId, movedFrom.email).catch(() => {
          // Never the address: this line is read by people, and by a log.
          console.warn('Team: an address could not be put back after its row failed to write.');
        });
      }
      throw error;
    }
    return c.json({ ok: true });
  });
}
