import type { Context, Hono } from 'hono';
import { z } from 'zod';
import { canVoidRecordedSession, type VoidRefusal } from '@domain/session';
import { canActor } from '@domain/shared';
import type { ApiEnv, Db } from '../_middleware/request-context';
import { logRefusal, logSensitive } from './audit';
import { VOID_CONFLICT_CODES, VoidSessionResponse, type VoidConflictCode } from './schema';

/**
 * POST /api/sessions/:id/void — a visit logged from the practice's records
 * that should never have been logged, withdrawn
 * (docs/superpowers/specs/2026-09-23-void-logged-session-design.md; trunk
 * round 60).
 *
 * A void is a stamp, not a delete: `app.void_recorded_session` (migration
 * 969) marks the session and its appointment voided with when, by whom and
 * why, frees the window, and gives back the credit the visit took the way a
 * waiver does. It is the only thing that may void a session, so this route
 * calls it and never writes the row itself.
 *
 * **Who.** The office's three roles (`session.void`, domain/shared/actor.ts).
 * **What it refuses, and logs before refusing:** no reason (400); another
 * role (403); a visit the actor cannot see (404, never a 403 that would
 * confirm it exists); and, from `domain/session/voidSession.ts`, a row not
 * logged from the records, not completed, already voided, or still named by
 * a measurement, an invoice or a billing question (409 with the code). The
 * database asks the same questions again under a row lock, and a refusal
 * there (a race) is answered with the same codes.
 *
 * The request carries no body; a POST is JSON or the door answers 415, so
 * the screen sends `{}`.
 */

const Params = z.object({ id: z.uuid() });

type VoidTargetRow = {
  client_id: string;
  recorded_from: 'device' | 'records';
  status: string;
  voided_at: string | null;
  version: number;
  assessments: number;
  invoices: number;
  exceptions: number;
};

/**
 * The visit a void would withdraw, read as the caller under row security —
 * absent when it is not theirs to see — with what still names it.
 */
export async function loadVoidTarget(db: Db, sessionId: string): Promise<VoidTargetRow | null> {
  const { rows } = await db.query<VoidTargetRow>(
    'select s.client_id, s.recorded_from::text as recorded_from, s.status::text as status, ' +
      's.voided_at::text as voided_at, s.version, ' +
      '(select count(*) from assessment a where a.session_id = s.id)::int as assessments, ' +
      '(select count(*) from invoice i where i.session_id = s.id)::int as invoices, ' +
      '(select count(*) from billing_exception b where b.session_id = s.id)::int as exceptions ' +
      'from session s where s.id = $1',
    [sessionId],
  );
  return rows[0] ?? null;
}

/** The domain's answer for one actor and one loaded visit. */
export function voidRefusalFor(
  actorRoles: readonly string[],
  row: VoidTargetRow,
): VoidRefusal | null {
  const verdict = canVoidRecordedSession({
    actorRoles,
    session: { recordedFrom: row.recorded_from, status: row.status, voidedAt: row.voided_at },
    inUseBy: { assessments: row.assessments, invoices: row.invoices, exceptions: row.exceptions },
  });
  return verdict.ok ? null : verdict.reason;
}

/**
 * Calls the definer function with the request's own reason — the one the
 * middleware cleaned and stamped as `app.reason` — and returns what it did.
 */
export async function voidRecordedSession(db: Db, sessionId: string): Promise<VoidSessionResponse> {
  const { rows } = await db.query<{ result: unknown }>(
    "select app.void_recorded_session($1::uuid, current_setting('app.reason', true)) as result",
    [sessionId],
  );
  return VoidSessionResponse.parse(rows[0]?.result);
}

/** Every refusal the function raises; its message is the code itself. */
export type VoidFunctionRefusal = VoidRefusal | 'reason_required' | 'not_found';

const FUNCTION_REFUSALS: readonly string[] = [
  'wrong_role',
  'reason_required',
  'not_found',
  ...VOID_CONFLICT_CODES,
];

/** The function's refusal code, when the error is one; otherwise null. */
export function voidFunctionRefusal(error: unknown): VoidFunctionRefusal | null {
  const e = error as { code?: string; message?: string };
  if (e.code !== '23001' || !e.message || !FUNCTION_REFUSALS.includes(e.message)) return null;
  return e.message as VoidFunctionRefusal;
}

/**
 * Logs a void's refusal against the visit it was asked of, then answers it:
 * 400 for no reason, 403 for the role, 404 for a visit the caller cannot see
 * (naming nobody), 409 with the code for a visit that may not be voided.
 */
export async function refuseVoid(
  c: Context<ApiEnv>,
  sessionId: string,
  clientId: string | null,
  code: VoidFunctionRefusal,
): Promise<Response> {
  const requestId = c.get('requestId');
  await logRefusal(c.get('db'), 'session', sessionId, clientId, [code]);
  if (code === 'wrong_role') return c.json({ error: 'forbidden', code, requestId }, 403);
  if (code === 'reason_required') return c.json({ error: 'bad_request', code, requestId }, 400);
  if (code === 'not_found') return c.json({ error: 'not_found', requestId }, 404);
  const conflict: VoidConflictCode = code;
  return c.json({ error: 'conflict', code: conflict, requestId }, 409);
}

export function mountVoidSession(api: Hono<ApiEnv>, now: () => Date): void {
  api.post('/api/sessions/:id/void', async (c) => {
    const actor = c.get('actor');
    const requestId = c.get('requestId');
    const db = c.get('db');

    // Validated before anything is logged: an id that is not a uuid would
    // fail on audit_log.entity_id's type and take the refusal down with it.
    const params = Params.safeParse(c.req.param());
    if (!params.success) {
      return c.json({ error: 'bad_request', code: 'invalid_request', requestId }, 400);
    }
    const sessionId = params.data.id;

    const answer = (code: VoidFunctionRefusal, clientId: string | null) =>
      refuseVoid(c, sessionId, clientId, code);

    if (!canActor(actor, { type: 'session.void' }, {}, now())) {
      return answer('wrong_role', null);
    }
    if (!(c.req.header('x-reason') ?? '').trim()) {
      return answer('reason_required', null);
    }

    const row = await loadVoidTarget(db, sessionId);
    if (!row) {
      return answer('not_found', null);
    }
    // The domain's sentence before the database's exception.
    const refusal = voidRefusalFor(actor.roles, row);
    if (refusal) {
      return answer(refusal, row.client_id);
    }

    // Under a savepoint, so a refusal the function raises after all (another
    // request got there first) leaves the transaction usable for its log row.
    await db.query('savepoint void_session');
    let voided: VoidSessionResponse;
    try {
      voided = await voidRecordedSession(db, sessionId);
      await db.query('release savepoint void_session');
    } catch (error) {
      await db.query('rollback to savepoint void_session');
      const code = voidFunctionRefusal(error);
      if (code) return answer(code, row.client_id);
      throw error;
    }

    await logSensitive(db, 'session_voided', 'session', sessionId, row.client_id);
    return c.json(voided, 200);
  });
}
