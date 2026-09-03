import type { Hono } from 'hono';
import { hasRole } from '@domain/shared';
import { DEFAULT_NOTICE_HOURS, DEFAULT_UNFIT_FEE_FILS } from '@domain/scheduling';
import { cleanText } from '../_middleware/text';
import type { ApiEnv } from '../_middleware/request-context';
import { SchedulingSettingsResponse, UpdateSchedulingSettingsRequest } from './schema';

/**
 * `GET /api/appointments/settings` — the practice's cancellation policy, as
 * two figures: how much notice a visit must be called off with, and what a
 * visit costs when the practitioner arrives and it cannot go ahead
 * (db/migrations/202_scheduling_setting.sql, the operator's decisions of
 * 2026-09-03).
 *
 * **Why a screen needs them before it acts.** The cancel confirmation has to
 * name the consequence — "this is inside the practice's twenty-four hours and
 * uses one of the client's sessions" — while the person can still change
 * their mind. Reading the figure back off the answer would name it only after
 * the visit had already been called off.
 *
 * Not a secret: the notice period is a promise made to households, and the
 * row policy lets anyone in the practice read it
 * (db/policies/scheduling/scheduling_setting_access.sql). This route is
 * narrower than that policy on purpose — the people who see a cancel button.
 * A client contact is refused; the portal will publish the policy in its own
 * words when it exists, rather than through the coordinator's route.
 *
 * Nothing personal is read, so nothing is logged: docs/SPEC/audit.md's read
 * logging is about records of people, and this is a practice setting.
 */

/** The length app/api/_middleware/request-context.ts itself trims a reason to. */
const REASON_MAX = 500;

const SETTINGS_SQL =
  'select notice_hours, unfit_fee_fils from scheduling_setting ' +
  'where tenant_id = app.current_tenant_id()';

const UPDATE_SQL =
  'update scheduling_setting set notice_hours = coalesce($1, notice_hours), ' +
  'unfit_fee_fils = coalesce($2, unfit_fee_fils) ' +
  'where tenant_id = app.current_tenant_id() ' +
  'returning notice_hours, unfit_fee_fils';

export function mountAppointmentSettings(api: Hono<ApiEnv>): void {
  api.get('/api/appointments/settings', async (c) => {
    const actor = c.get('actor');
    const requestId = c.get('requestId');
    if (!hasRole(actor, 'owner', 'admin', 'lead_practitioner', 'practitioner')) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const db = c.get('db');
    const { rows } = await db.query<{ notice_hours: number; unfit_fee_fils: number }>(SETTINGS_SQL);
    const row = rows[0];
    // 202 gives every practice this row and never lets it be deleted, so the
    // fallback is for a database mid-migration rather than for ordinary life.
    // The same figures app/api/appointments/cancel.ts falls back to, so a
    // screen and the route it calls can never disagree about them.
    return c.json(
      SchedulingSettingsResponse.parse({
        noticeHours: row?.notice_hours ?? DEFAULT_NOTICE_HOURS,
        unfitFeeFils: row?.unfit_fee_fils ?? DEFAULT_UNFIT_FEE_FILS,
      }),
    );
  });

  /**
   * `PATCH /api/appointments/settings` — the owner changing the practice's own
   * cancellation policy.
   *
   * Both figures were described as the owner's to change from the day they
   * were added, and until now nothing could change them: they were editable in
   * the way a column is editable, which is to say by somebody with a database
   * client (compliance review of this pull request). This is the route that
   * makes the claim true.
   *
   * The owner and an admin, and nobody else. It is the same class of decision
   * as the practice's own identity — what a household is charged when it calls
   * a visit off late — so it takes the audience `practice.settings.write` has,
   * and `scheduling_setting_write` (db/policies/scheduling) says the same
   * beneath. Finance records money without deciding the policy the money is
   * taken under.
   *
   * A reason is required, and the row's own audit trigger carries it: this
   * changes what every future cancellation costs, and "who moved it, when and
   * why" is exactly what the trail should be able to answer about it.
   */
  api.patch('/api/appointments/settings', async (c) => {
    const actor = c.get('actor');
    const requestId = c.get('requestId');
    if (!hasRole(actor, 'owner', 'admin')) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    if (cleanText(c.req.header('x-reason') ?? '', REASON_MAX).length === 0) {
      return c.json({ error: 'bad_request', code: 'reason_required', requestId }, 400);
    }
    const body = UpdateSchedulingSettingsRequest.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return c.json({ error: 'bad_request', code: 'invalid_request', requestId }, 400);
    }
    const db = c.get('db');
    const { rows } = await db.query<{ notice_hours: number; unfit_fee_fils: number }>(UPDATE_SQL, [
      body.data.noticeHours ?? null,
      body.data.unfitFeeFils ?? null,
    ]);
    const row = rows[0];
    if (!row) {
      // Row security refused, or the practice somehow has no settings row.
      // Neither is something a caller can fix by trying again with different
      // words, and neither should be described as an internal failure.
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    return c.json(
      SchedulingSettingsResponse.parse({
        noticeHours: row.notice_hours,
        unfitFeeFils: row.unfit_fee_fils,
      }),
    );
  });
}
