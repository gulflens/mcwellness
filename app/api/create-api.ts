import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import { timeout } from 'hono/timeout';
import type { IdentityKeys } from '@domain/shared/identity';
import { MeResponse } from './_middleware/actor-schema';
import { withIdentityKeys } from './_middleware/identity-context';
import { addressKey, DEFAULT_LIMITS, rateLimit, type RateLimits } from './_middleware/rate-limit';
import {
  withRequestContext,
  type ApiEnv,
  type RequestContextDeps,
} from './_middleware/request-context';
import {
  isStorageUnavailable,
  mountLocalStorage,
  withStorage,
  type ServerStorageProvider,
} from './_middleware/storage';
import {
  jsonOnly,
  noStore,
  payloadTooLarge,
  securityHeaders,
  timedOut,
} from './_middleware/security';
import { mountAppointments } from './appointments/routes';
import { mountTimeline } from './audit/timeline';
import { mountBilling } from './billing/routes';
import { mountClients } from './clients/list';
import { mountClientRecord } from './clients/mount';
import { mountDevSession, type DevSessionOptions } from './dev-session';
import { mountSessions } from './sessions/checkin';

/**
 * Builds the API. Kept separate from the server entry so tests can call
 * `createApi(deps).request(...)` in-process. Order of the stack, outermost
 * first: protective headers on everything; then on /api/*: no caching, the
 * per-address budget and the auth-failure budget (first, so a flood of
 * oversized or malformed bodies is limited too), a body cap, a timeout, JSON
 * only for bodies, the development door with its own budget, the request
 * context (one transaction, fenced to the API role, stamped with who is
 * acting and why), the identity keys context (when configured — after the
 * fence, so no route ahead of authentication can ever see it), the
 * per-person budget, and the routes.
 *
 * The document store (docs/SEAMS.md) is the one dependency published ahead of
 * the fence: the local implementation's signed URLs point back at this API's
 * own /api/storage route, whose authorisation is the signature in the link.
 */

export const BODY_LIMIT_BYTES = 64 * 1024;
export const REQUEST_TIMEOUT_MS = 10_000;
const MINUTE = 60_000;

export type ApiOptions = RequestContextDeps & {
  /** The development sign-in door. Only the server decides to pass this, and only on a laptop. */
  devSession?: DevSessionOptions;
  now?: () => Date;
  appEnv?: string;
  /** The Supabase project the browser signs in against; named in the content security policy. */
  supabaseUrl?: string;
  limits?: Partial<RateLimits>;
  /** How many proxies in front of the API are trusted for X-Forwarded-For (0: none). */
  trustedProxyHops?: number;
  /** Tests inject the bucket key; the server uses the caller's address. */
  keyOf?: (c: Context) => string | null;
  /** The Emirates ID keys (domain/shared/identity). Absent: no route can read c.get('identityKeys'). */
  identityKeys?: IdentityKeys;
  /** The document store (domain/shared/storage, docs/SEAMS.md). Absent: no route can read c.get('storage'). */
  storage?: ServerStorageProvider;
};

export function createApi(deps: ApiOptions): Hono<ApiEnv> {
  const api = new Hono<ApiEnv>();
  const limits: RateLimits = { ...DEFAULT_LIMITS, ...deps.limits };
  const byAddress = deps.keyOf ?? addressKey(deps.trustedProxyHops ?? 0);

  api.onError((error, c) => {
    if (error instanceof HTTPException) {
      return error.getResponse();
    }
    // A database message can carry row values; only the shape of the failure is logged.
    const requestId = c.get('requestId') ?? c.res.headers.get('X-Request-Id') ?? null;
    // A store that is down is not a bug in the record it belongs to: it says so.
    if (isStorageUnavailable(error)) {
      console.error(JSON.stringify({ requestId, name: error.name }));
      return c.json({ error: 'storage_unavailable', requestId }, 503);
    }
    console.error(
      JSON.stringify({ requestId, name: error.name, code: (error as { code?: string }).code }),
    );
    return c.json({ error: 'internal', requestId }, 500);
  });

  api.use('*', securityHeaders(deps.appEnv, { supabaseUrl: deps.supabaseUrl }));
  // Ahead of the fence, unlike identityKeys: the local store's own signed-URL
  // route below carries its authorisation in the link and has no session.
  if (deps.storage) {
    api.use('*', withStorage(deps.storage));
  }
  api.use('/api/*', noStore);
  // Budgets first, so a flood of oversized or malformed bodies is limited too.
  api.use(
    '/api/*',
    rateLimit({ name: 'address', windowMs: MINUTE, max: limits.perMinute, keyOf: byAddress }),
  );
  api.use(
    '/api/*',
    rateLimit({
      name: 'auth-failures',
      windowMs: MINUTE,
      max: limits.authFailuresPerMinute,
      keyOf: byAddress,
      mode: 'failure',
    }),
  );
  api.use('/api/*', bodyLimit({ maxSize: BODY_LIMIT_BYTES, onError: payloadTooLarge }));
  api.use('/api/*', timeout(REQUEST_TIMEOUT_MS, timedOut));
  api.use('/api/*', jsonOnly);

  // Public, registered before the fence. The payload carries nothing
  // environment-specific on purpose.
  api.get('/api/health', (c) => c.json({ ok: true, service: 'mcwellness-api' }));
  // Only when the local implementation is the one chosen: it is the only one
  // whose signed URLs point back here (app/api/_middleware/storage).
  if (deps.storage) {
    mountLocalStorage(api, deps.storage);
  }
  if (deps.devSession) {
    api.use(
      '/api/dev/*',
      rateLimit({
        name: 'dev-door',
        windowMs: MINUTE,
        max: limits.devDoorPerMinute,
        keyOf: byAddress,
      }),
    );
    mountDevSession(api, deps.devSession);
  }

  api.use('/api/*', withRequestContext(deps));
  // After the fence, not before: no route ahead of authentication can ever
  // read c.get('identityKeys'), even by accident (security review, round 3).
  if (deps.identityKeys) {
    api.use('/api/*', withIdentityKeys(deps.identityKeys));
  }
  api.use(
    '/api/*',
    rateLimit({
      name: 'actor',
      windowMs: MINUTE,
      max: limits.actorPerMinute,
      keyOf: (c) => {
        const actor = c.get('actor') as { userId?: string } | undefined;
        return actor?.userId ? `actor:${actor.userId}` : null;
      },
    }),
  );

  api.get('/api/me', async (c) => {
    const actor = c.get('actor');
    // The person's own row, read as themselves under row security.
    const { rows } = await c
      .get('db')
      .query<{ display_name: string }>('select display_name from app_user where id = $1', [
        actor.userId,
      ]);
    return c.json(
      MeResponse.parse({
        userId: actor.userId,
        displayName: rows[0]?.display_name ?? '',
        tenantId: actor.tenantId,
        roles: actor.roles,
        capabilities: actor.capabilities,
      }),
    );
  });

  mountClients(api, deps.now);
  mountClientRecord(api, deps.now);
  mountTimeline(api, deps.now);
  mountBilling(api, deps.now);
  mountAppointments(api, deps.now);
  mountSessions(api, deps.now);

  // An unknown route answers in the same shape as every other refusal.
  api.notFound((c) => c.json({ error: 'not_found', requestId: c.get('requestId') ?? null }, 404));

  return api;
}
