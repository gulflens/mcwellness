import type { Context } from 'hono';
import { isRealText } from './schema';

/**
 * Every write to the books carries `X-Reason`, the practice routes' pattern
 * (app/api/practice/routes.ts): the fence stamps it onto the transaction and
 * the audit trigger records it with the row it changed.
 *
 * What counts as a reason is the same rule on both sides of the wire: eight
 * characters, and not one character repeated — a reason worth reading a year
 * later (`isRealText`, schema.ts). The drawers ask for exactly that before
 * they send; this is what makes it true of anything that is not a drawer. The
 * trail itself is the trigger's.
 */
export function requiredReason(c: Context): string | null {
  const reason = (c.req.header('x-reason') ?? '').trim();
  return isRealText(reason) ? reason : null;
}
