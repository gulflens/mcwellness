import { createHash, randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import type { ApiEnv, PoolLike } from '../_middleware/request-context';
import { isAuthAdminUnavailable, isEmailInUse, type AuthAdminProvider } from './auth-admin';
import { RedeemInput, RedeemResponse } from './schema';

/**
 * `POST /api/portal/invite/redeem` — the one route in this API that answers
 * somebody who is not signed in (docs/SPEC/client-portal.md sections 7 and
 * 10).
 *
 * It is mounted **before** the authentication fence, because the person on the
 * other end has no account yet; everything the fence would otherwise give it,
 * it does for itself and no more:
 *
 * - Its own connection, its own transaction, `set local role app_role`, and
 *   **only the request id stamped**. No tenant and no actor, because there is
 *   nobody to be. So the two functions it calls are `security definer` and
 *   answer either one word or one id, and nothing else in the database is
 *   reachable from here at all.
 * - Its own budget, `RATE_LIMIT_INVITE_DOOR_PER_MINUTE`, ten per address a
 *   minute by default (app/api/create-api.ts). A link is 32 random bytes;
 *   the budget is what makes guessing pointless rather than merely hard.
 * - Its own vocabulary of refusals, which says as little as it can:
 *   **404 for a link that never existed and 410 for every dead one**, so a
 *   caller cannot tell an invented token from one that has been revoked.
 *
 * **The order is the sign-in first and the database second, and it is undone
 * if the second half fails.** A sign-in with no account behind it is a person
 * who can authenticate and reach nothing; an account with no sign-in is a
 * household that cannot get in and whose link is already spent. So the seam's
 * `deleteUser` puts the first back when the second throws, and the failure is
 * logged by request id alone — never the address, never the token.
 */

const INVITE_DOOR_PATH = '/api/portal/invite/redeem';

/**
 * Only the request id is stamped. `app.portal_invite_status` and
 * `app.redeem_portal_invite` both run `security definer` with a pinned
 * `search_path`, so they answer without a tenant; the row triggers that fire
 * inside the redemption see no actor, which the trail already reads as the
 * system (docs/SPEC/audit.md section 5).
 */
const STAMP_REQUEST_ID = "select set_config('app.request_id', $1, true)";

/** The two environments where a sign-in that verifies nothing is the point. */
const LAPTOP = new Set(['development', 'test']);

export type PortalDoorOptions = {
  pool: PoolLike;
  authAdmin: AuthAdminProvider;
  /**
   * The deployment's own APP_ENV. Anywhere but a laptop or the tests, the door
   * refuses to mint sign-ins that verify nothing — the same two words
   * `authAdminFromEnv` chooses the fallback by.
   */
  appEnv?: string | undefined;
};

/** A uuid the caller may correlate by, or one of our own. The fence's rule. */
function requestIdOf(header: string | undefined): string {
  return header !== undefined && UUID.test(header) ? header : randomUUID();
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function mountPortalDoor(api: Hono<ApiEnv>, options: PortalDoorOptions): void {
  api.post(INVITE_DOOR_PATH, async (c) => {
    // The fence has not run — it is mounted after this — so the door does its
    // own correlation id, by the same rule: the caller's when it is a uuid.
    const requestId = requestIdOf(c.req.header('x-request-id'));
    c.header('X-Request-Id', requestId);

    const body = RedeemInput.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      // A code and never a message: a zod message can echo what was typed,
      // and one of the three fields here is a password.
      const field = body.error.issues[0]?.path[0];
      return c.json({ error: 'bad_request', code: String(field ?? 'invalid') }, 400);
    }
    const { token, email, password } = body.data;
    const tokenHash = createHash('sha256').update(token).digest();

    if (options.authAdmin.kind === 'fake' && !LAPTOP.has(options.appEnv ?? '')) {
      // Belt and braces beneath the environment check in authAdminFromEnv,
      // which asks the same question of the same two words: a deployment that
      // is not a laptop and has no SUPABASE_AUTH_ADMIN_KEY must not mint
      // sign-ins that verify nothing. Staging is such a deployment — the
      // fallback would spend the invitation, write a fabricated uuid onto
      // app_user.auth_id and leave nobody able to sign in behind it — and so
      // is a deployment whose APP_ENV was never set at all.
      return c.json({ error: 'auth_admin_unavailable' }, 503);
    }

    const client = await options.pool.connect();
    let created: { authId: string } | null = null;
    let inTransaction = false;
    try {
      await client.query('begin');
      inTransaction = true;
      await client.query('set local role app_role');
      await client.query(STAMP_REQUEST_ID, [requestId]);

      // One question, one answer: the state, and — only when the link is live
      // — which kind it is and whether a sign-in already stands behind the
      // account. Nothing here reads a table: with no tenant and no actor
      // stamped every row is invisible to this transaction (migration 095),
      // which is why the two facts arrive through the definer function rather
      // than through a join of the door's own.
      const state = await client.query<{
        state: string;
        kind: string | null;
        auth_id: string | null;
      }>('select state, kind, auth_id from app.portal_invite_status($1)', [tokenHash]);
      const invite = state.rows[0];
      const word = invite?.state ?? 'unknown';
      if (word !== 'valid') {
        await client.query('rollback');
        inTransaction = false;
        client.release();
        // Unknown is 404 and the three dead states are 410, and neither says
        // which: a link that never existed and one that has been revoked look
        // the same from outside.
        return word === 'unknown'
          ? c.json({ error: 'not_found' }, 404)
          : c.json({ error: 'gone' }, 410);
      }

      // Which half of the seam this is depends on whether the account already
      // has a sign-in behind it.
      const existingAuthId = invite?.auth_id ?? null;

      let authId: string;
      if (existingAuthId === null) {
        created = await options.authAdmin.createUser({ email, password });
        authId = created.authId;
      } else {
        // A password reset: the sign-in exists and only its password moves.
        // Nothing is created, so nothing has to be put back if this fails.
        await options.authAdmin.setPassword(existingAuthId, password);
        authId = existingAuthId;
      }

      await client.query('select app.redeem_portal_invite($1, $2, $3)', [tokenHash, authId, email]);
      await client.query('commit');
      inTransaction = false;
      client.release();

      // The auth id travels only where the fallback is what is running: on a
      // laptop the development door signs a token for it so the page can land
      // the person on Home. A real project never answers it — the browser
      // signs in with the address and password they have just chosen.
      return c.json(
        RedeemResponse.parse(
          options.authAdmin.kind === 'fake' ? { ok: true, authId } : { ok: true },
        ),
      );
    } catch (error) {
      if (inTransaction) {
        await client.query('rollback').catch(() => undefined);
      }
      client.release(true);

      if (created !== null) {
        // The sign-in was made and the account it belongs to was not. Put it
        // back, so the address is free and the person can try the link again.
        await options.authAdmin.deleteUser(created.authId).catch(() => undefined);
      }
      if (isEmailInUse(error)) {
        // The one refusal worth naming: somebody has typed an address that
        // already signs in. The link is untouched and they may try another.
        return c.json({ error: 'email_in_use' }, 409);
      }
      if (isAuthAdminUnavailable(error)) {
        console.error(JSON.stringify({ requestId, name: (error as Error).name }));
        return c.json({ error: 'auth_admin_unavailable' }, 503);
      }
      // Anything else is this platform's fault, and the person is told to try
      // the link again. Never the message: it can carry the address or a row.
      console.error(
        JSON.stringify({
          requestId,
          door: 'portal-invite',
          name: (error as { name?: string }).name,
          code: (error as { code?: string }).code,
        }),
      );
      return c.json({ error: 'internal' }, 500);
    }
  });
}
