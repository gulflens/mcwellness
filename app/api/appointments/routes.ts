import type { Hono } from 'hono';
import type { ApiEnv } from '../_middleware/request-context';
import { mountAppointmentCreate } from './create';
import { mountAppointmentList } from './list';
import { mountAppointmentOptions } from './options';

/**
 * Mounts every appointment route. `app/api/create-api.ts` calls this — it is
 * a shared file, so the mount call was a change request rather than a direct
 * edit (docs/CHANGE-REQUESTS/scheduling-01.md item 1, applied in round 5).
 */
export function mountAppointments(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  mountAppointmentList(api, now);
  mountAppointmentOptions(api);
  mountAppointmentCreate(api, now);
}
