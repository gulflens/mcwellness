import { randomUUID } from 'node:crypto';
import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import type pg from 'pg';
import { z } from 'zod';
import { cleanText } from './text';
import type { Actor } from '@domain/shared';
import type { IdentityKeys } from '@domain/shared/identity';
import { ResolvedActorRow } from './actor-schema';
import type { RoutingProvider } from '../../../domain/shared/routing';
import type { ServerStorageProvider } from './storage/types';
import type { TokenVerifier } from './token-verifier';

/**
 * The audit session-context middleware (docs/SPEC/audit.md section 5).
 *
 * Every request that reaches a route below this middleware runs inside one
 * database transaction, as the API role fenced to `app_role`, with the
 * actor, their roles, the practice, the request id and the reason stamped as
 * transaction-local settings. The audit trigger reads them; row level
 * security reads the practice and the roles. Nothing leaks between requests
 * on a pooled connection because everything is transaction-scoped.
 *
 * It also owns the one moment after that transaction closes.
 * `c.get('afterCommit')(fn)` registers work to run once the commit has
 * returned — never on a rollback, and so never on a 5xx or on a refusal a
 * route raised rather than returned. Deleting bytes from the document store
 * is what that is for and docs/SEAMS.md says so: a delete cannot be rolled
 * back and a transaction can, so bytes removed inside the transaction that
 * removed the row outlive nothing when the row comes back.
 */

export type Db = {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<pg.QueryResult<R>>;
};

/**
 * Work a route hands back to run once its transaction has committed
 * (docs/CHANGE-REQUESTS/client-record-03.md, CR-12). Takes nothing, answers
 * nothing: by the time it runs the response is settled and the connection is
 * back in the pool, so there is no database to reach and no caller to tell.
 */
export type AfterCommitWork = () => void | Promise<void>;

// identityKeys is set only when create-api.ts was given identityKeys (a route
// reads it via the identity-context middleware, ./identity-context.ts); it is
// never guaranteed the way actor, db and requestId are, so its type says so.
// storage is the same: set only when create-api.ts was given a provider
// (./storage/index.ts's withStorage), and unlike identityKeys it is published
// ahead of the fence, because the local signed-URL route must answer without
// a session.
// routing is the same shape as storage but sits below the fence: no route
// ahead of authentication asks how long a drive takes, and the seam's key must
// never be reachable from one that does (./routing/index.ts's withRouting).
// afterCommit is published by this middleware, so — like actor, db and
// requestId — it exists for every route below the fence and for none above it.
// startedAt is the exception to all of that: ./error-log.ts's withRequestTiming
// is the outermost middleware in the stack, so it exists for every request,
// including the ones refused long before the fence. One place reads it, the
// error line's builder, and no route ever does.
export type ApiEnv = {
  Variables: {
    actor: Actor;
    db: Db;
    requestId: string;
    startedAt: number;
    afterCommit: (work: AfterCommitWork) => void;
    identityKeys: IdentityKeys | undefined;
    storage: ServerStorageProvider | undefined;
    routing: RoutingProvider | undefined;
    /**
     * The content security policy nonce this response was minted with, on the
     * one document that loads a third-party map (docs/SPEC/route-planning.md
     * section 8). Undefined on every other response, which is every other
     * response's answer: they carry the strict policy and stamp nothing.
     */
    cspNonce: string | undefined;
    /**
     * The same response's policy, rendered as the document itself carries it
     * — because in production the header does not reach a browser at all
     * (docs/SPEC/hosting.md section 2.3). Set on every response by
     * ./security.ts, read only by the one handler that answers with the shell
     * (../serve-app.ts); an API answer is not a document and stamps nothing.
     */
    cspDocumentPolicy: string | undefined;
  };
};

export type PoolClientLike = {
  query: Db['query'];
  release(destroy?: Error | boolean): void;
};
export type PoolLike = { connect(): Promise<PoolClientLike> };
export type RequestContextDeps = { pool: PoolLike; verifier: TokenVerifier };

const RequestId = z.uuid();
const Reason = z.string().transform((value) => cleanText(value, 500));

// A pasted token or key must never reach the trail (audit.md section 8): a JWT, or any
// run of 32 or more key-looking characters, is replaced before the reason is stamped.
const TOKEN_LIKE =
  /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}|(?=[A-Za-z0-9_+/=-]*\d)[A-Za-z0-9_+/=-]{32,}/g;
export function scrubReason(reason: string): string {
  return reason.replace(TOKEN_LIKE, '[redacted]');
}

const RESOLVE_ACTOR =
  'select user_id, tenant_id, status, roles, capabilities from app.resolve_actor($1)';
const SET_CONTEXT =
  "select set_config('app.tenant_id', $1, true), set_config('app.actor_id', $2, true), " +
  "set_config('app.actor_roles', $3, true), set_config('app.request_id', $4, true), " +
  "set_config('app.reason', $5, true)";

function bearerToken(header: string | undefined): string | null {
  if (!header) {
    return null;
  }
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : null;
}

/**
 * Runs the work a request registered, in the order it was registered, once
 * the commit has returned.
 *
 * Each piece is isolated: a throw is logged and the next piece still runs.
 * Nothing reaches the caller — the response is already decided and the
 * transaction is already committed, so there is nothing left to refuse and
 * nothing left to roll back. What is logged is the request id and the shape
 * of the failure, never a message: the same rule createApi's own error
 * handler follows, because a message from a store or a driver can carry a
 * key or a row value.
 */
async function runAfterCommit(work: readonly AfterCommitWork[], requestId: string): Promise<void> {
  for (const piece of work) {
    try {
      await piece();
    } catch (error) {
      const shape = error as { name?: string; code?: string };
      console.error(
        JSON.stringify({ requestId, after: 'commit', name: shape.name, code: shape.code }),
      );
    }
  }
}

function unauthorized(c: Context, requestId: string): Response {
  c.header('WWW-Authenticate', 'Bearer');
  return c.json({ error: 'unauthorized', requestId }, 401);
}

function forbidden(c: Context, requestId: string): Response {
  return c.json({ error: 'forbidden', requestId }, 403);
}

export function withRequestContext({ pool, verifier }: RequestContextDeps) {
  return createMiddleware<ApiEnv>(async (c, next) => {
    // A caller-chosen correlation id, echoed back and recorded; never proof of anything.
    const incoming = c.req.header('x-request-id');
    const requestId = RequestId.safeParse(incoming).success ? (incoming as string) : randomUUID();
    c.header('X-Request-Id', requestId);

    // Nothing touches the database until the token has been verified.
    const token = bearerToken(c.req.header('authorization'));
    if (!token) {
      return unauthorized(c, requestId);
    }
    const claims = await verifier.verify(token);
    if (!claims) {
      return unauthorized(c, requestId);
    }
    const reasonParse = Reason.safeParse(c.req.header('x-reason') ?? '');
    const reason = reasonParse.success ? scrubReason(reasonParse.data) : '';

    const client = await pool.connect();
    let inTransaction = false;
    // Once the connection is back in the pool it belongs to whoever the pool
    // hands it to next, which may already be another request in flight. So
    // the wrapper published as c.get('db') stops working the moment it is
    // handed back: a route that closed over it, or after-commit work that
    // reaches for it out of habit, gets a plain error rather than somebody
    // else's transaction (security review, round 20).
    let handedBack = false;
    // Work to run once this transaction has committed, and never if it has
    // not (docs/SEAMS.md, "After the commit"). Registered by routes below.
    const afterCommit: AfterCommitWork[] = [];
    const handBack = (destroy?: true): void => {
      handedBack = true;
      client.release(destroy);
    };
    try {
      await client.query('begin');
      inTransaction = true;
      // Always. The API role inherits nothing, so a request that skipped this
      // would fail on its first query rather than run unfenced.
      await client.query('set local role app_role');

      const { rows } = await client.query(RESOLVE_ACTOR, [claims.sub]);
      const row = rows[0];
      if (!row) {
        // Unknown, suspended and archived people get the same answer.
        await client.query('rollback');
        inTransaction = false;
        handBack();
        return forbidden(c, requestId);
      }
      const resolved = ResolvedActorRow.parse(row);
      const actor: Actor = {
        userId: resolved.user_id,
        tenantId: resolved.tenant_id,
        roles: resolved.roles,
        capabilities: resolved.capabilities,
      };
      await client.query(SET_CONTEXT, [
        actor.tenantId,
        actor.userId,
        actor.roles.join(','),
        requestId,
        reason,
      ]);

      c.set('actor', actor);
      // Only `query` is exposed. This is a trust boundary for route code, not a
      // sandbox: raw SQL could still commit or change a setting, so routes are
      // reviewed; what the fence guarantees is the database role and the stamp.
      c.set('db', {
        // async, so a handle used after the fact rejects rather than throwing
        // synchronously out of something whose type promises a promise.
        query: async <R extends pg.QueryResultRow = pg.QueryResultRow>(
          text: string,
          params?: unknown[],
        ) => {
          if (handedBack) {
            // Never the statement, never a parameter: this throws where a
            // caller can log it, and both can carry a client's own values.
            throw new Error(
              "This request's database connection has been returned to the pool. " +
                'Work registered with afterCommit runs after the transaction is over ' +
                'and cannot query (docs/SEAMS.md).',
            );
          }
          return client.query<R>(text, params);
        },
      });
      c.set('requestId', requestId);
      c.set('afterCommit', (work: AfterCommitWork) => {
        afterCommit.push(work);
      });

      await next();

      let failed = c.error !== undefined || c.res.status >= 500;
      if (!failed) {
        // A route that swallowed a database error would otherwise be told
        // "committed" while Postgres quietly rolled the aborted transaction back.
        try {
          await client.query('select 1');
        } catch {
          failed = true;
          c.res = c.json({ error: 'internal', requestId }, 500);
        }
      }
      await client.query(failed ? 'rollback' : 'commit');
      inTransaction = false;
      handBack();
      // Only now, and only on a commit: a rolled-back request leaves nothing
      // behind for this work to be consistent with.
      if (!failed && afterCommit.length > 0) {
        await runAfterCommit(afterCommit, requestId);
      }
    } catch (error) {
      if (inTransaction) {
        await client.query('rollback').catch(() => undefined);
      }
      // The connection may be in an unknown state: let the pool discard it.
      handBack(true);
      throw error;
    }
  });
}
