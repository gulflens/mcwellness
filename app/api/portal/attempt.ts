import type { Db } from '../_middleware/request-context';

/**
 * Runs one statement that may be refused by the database on purpose — a
 * definer function raising 42501, 23505 or 23514 with a hint — inside a
 * savepoint, so the refusal becomes an answer and the request's own
 * transaction stays usable. Without it, a refusal aborts the transaction and
 * the fence's own `select 1` turns a 409 into a 500.
 */
export type Attempt<T> =
  | { ok: true; value: T }
  | { ok: false; code: string | undefined; hint: string | undefined; error: unknown };

export async function attempt<T>(db: Db, work: () => Promise<T>): Promise<Attempt<T>> {
  await db.query('savepoint portal_attempt');
  try {
    const value = await work();
    await db.query('release savepoint portal_attempt');
    return { ok: true, value };
  } catch (error) {
    await db.query('rollback to savepoint portal_attempt');
    const shape = (error ?? {}) as { code?: string; hint?: string };
    return { ok: false, code: shape.code, hint: shape.hint, error };
  }
}
