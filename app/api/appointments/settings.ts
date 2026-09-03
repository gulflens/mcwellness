import type { Hono } from 'hono';
import { hasRole } from '@domain/shared';
import { DEFAULT_NOTICE_HOURS } from '@domain/scheduling';
import type { ApiEnv } from '../_middleware/request-context';
import { SchedulingSettingsResponse } from './schema';

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

const SETTINGS_SQL =
  'select notice_hours, unfit_fee_fils from scheduling_setting ' +
  'where tenant_id = app.current_tenant_id()';

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
        unfitFeeFils: row?.unfit_fee_fils ?? 0,
      }),
    );
  });
}
