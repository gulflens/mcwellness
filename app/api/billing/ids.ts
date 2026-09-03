import { z } from 'zod';

/**
 * An id from a path or a query string, checked before it reaches a query.
 *
 * `z.uuid()`, not a hand-written pattern: `^[0-9a-f-]{36}$` matched thirty-six
 * dashes as readily as a uuid, so a malformed id reached the database to be
 * refused there — a 500 dressed as a 400, and a needless round trip on a path
 * a stranger can call.
 */
export function isUuid(value: string): boolean {
  return z.uuid().safeParse(value).success;
}
