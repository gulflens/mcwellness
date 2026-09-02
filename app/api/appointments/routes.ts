import type { Hono } from 'hono';
import type { ApiEnv } from '../_middleware/request-context';
import { mountAppointmentCreate } from './create';
import { mountAppointmentList } from './list';
import { mountAppointmentOptions } from './options';

/**
 * Mounts every appointment route. Not wired into app/api/create-api.ts yet —
 * that file is shared, so the mount call itself is a change request
 * (docs/CHANGE-REQUESTS/scheduling-01.md); the database tests mount these
 * routes directly on the Hono instance createApi returns.
 */
export function mountAppointments(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  mountAppointmentList(api);
  mountAppointmentOptions(api);
  mountAppointmentCreate(api, now);
}
