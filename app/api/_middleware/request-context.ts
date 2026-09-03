import { randomUUID } from 'node:crypto';
import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import type pg from 'pg';
import { z } from 'zod';
import { cleanText } from './text';
import type { Actor } from '@domain/shared';
import type { IdentityKeys } from '@domain/shared/identity';
import { ResolvedActorRow } from './actor-schema';
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
 */

export type Db = {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<pg.QueryResult<R>>;
};

// identityKeys is set only when create-api.ts was given identityKeys (a route
// reads it via the identity-context middleware, ./identity-context.ts); it is
// never guaranteed the way actor, db and requestId are, so its type says so.
// storage is the same: set only when create-api.ts was given a provider
// (./storage/index.ts's withStorage), and unlike identityKeys it is published
// ahead of the fence, because the local signed-URL route must answer without
// a session.
export type ApiEnv = {
  Variables: {
    actor: Actor;
    db: Db;
    requestId: string;
    identityKeys: IdentityKeys | undefined;
    storage: ServerStorageProvider | undefined;
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
        client.release();
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
        query: <R extends pg.QueryResultRow = pg.QueryResultRow>(
          text: string,
          params?: unknown[],
        ) => client.query<R>(text, params),
      });
      c.set('requestId', requestId);

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
      client.release();
    } catch (error) {
      if (inTransaction) {
        await client.query('rollback').catch(() => undefined);
      }
      // The connection may be in an unknown state: let the pool discard it.
      client.release(true);
      throw error;
    }
  });
}
