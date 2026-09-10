import type { Hono } from 'hono';
import type { ApiEnv } from '../_middleware/request-context';
import { mountAppointmentBoard } from './board';
import { mountAppointmentCancel } from './cancel';
import { mountAppointmentConfirm } from './confirm';
import { mountAppointmentCreate } from './create';
import { mountAppointmentList } from './list';
import { mountAppointmentMove } from './move';
import { mountAppointmentOptions } from './options';
import { mountAppointmentReassign } from './reassign';
import { mountAppointmentReorder } from './reorder';
import { mountAppointmentSettings } from './settings';

/**
 * Mounts every appointment route. `app/api/create-api.ts` calls this — it is
 * a shared file, so the mount call was a change request rather than a direct
 * edit (docs/CHANGE-REQUESTS/scheduling-01.md item 1, applied in round 5).
 */
export function mountAppointments(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  mountAppointmentList(api, now);
  mountAppointmentOptions(api);
  mountAppointmentCreate(api, now);
  mountAppointmentConfirm(api);
  mountAppointmentMove(api, now);
  mountAppointmentReorder(api, now);
  mountAppointmentBoard(api, now);
  mountAppointmentReassign(api, now);
  mountAppointmentCancel(api, now);
  mountAppointmentSettings(api);
}
