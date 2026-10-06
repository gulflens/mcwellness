import { createMiddleware } from 'hono/factory';
import type { ApiEnv } from '../_middleware/request-context';

/**
 * A helper reaches their own location and who they are, and nothing else in
 * this API (round 76, docs/SPEC/dispatch.md section 15.12).
 *
 * Every route already refuses a helper, because `canActor` names the helper
 * in no action and row security gives a helper nothing to read
 * (db/policies/core/helper_reach.sql). But a route that checks its input
 * before its caller answers a helper 400 rather than 403, which says "you
 * asked wrongly" to somebody who may not ask at all, and a route written
 * tomorrow may forget to ask. So the answer is said once, here, just inside
 * the fence: a person who holds the helper role and no other is answered 403
 * on every path but these, before any route sees the request. The routes and
 * the database still refuse beneath this; this is the first of three walls,
 * not the only one.
 */

/** The paths a helper may reach. The routes behind them decide the rest. */
const HELPER_PATHS: readonly string[] = [
  // Who they are, and the record that they changed their own password.
  '/api/me',
  '/api/me/password-changed',
  // Their own location (app/api/location/routes.ts). The board's read is
  // among these paths and refuses a helper itself.
  '/api/location/me',
  '/api/location/consent',
  '/api/location/consent/withdraw',
  '/api/location/sharing',
  '/api/location/positions',
];

export function helperMayReach(path: string): boolean {
  return HELPER_PATHS.includes(path);
}

export const helperFence = createMiddleware<ApiEnv>(async (c, next) => {
  const actor = c.get('actor');
  const helperOnly = actor !== undefined && actor.roles.length === 1 && actor.roles[0] === 'helper';
  if (helperOnly && !helperMayReach(c.req.path)) {
    return c.json({ error: 'forbidden', requestId: c.get('requestId') ?? null }, 403);
  }
  return next();
});
