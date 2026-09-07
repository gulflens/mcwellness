import type { Context } from 'hono';

/**
 * Every write to the books carries `X-Reason`, the practice routes' pattern
 * (app/api/practice/routes.ts): the fence stamps it onto the transaction and
 * the audit trigger records it with the row it changed. This only insists
 * there is something in it; the trail is the trigger's.
 */
export function requiredReason(c: Context): string | null {
  const reason = (c.req.header('x-reason') ?? '').trim();
  return reason.length > 0 ? reason : null;
}
