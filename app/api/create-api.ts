import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import { timeout } from 'hono/timeout';
import type { IdentityKeys } from '@domain/shared/identity';
import type { RoutingProvider } from '../../domain/shared/routing';
import { MeResponse } from './_middleware/actor-schema';
import { withIdentityKeys } from './_middleware/identity-context';
import { addressKey, DEFAULT_LIMITS, rateLimit, type RateLimits } from './_middleware/rate-limit';
import {
  withRequestContext,
  type ApiEnv,
  type RequestContextDeps,
} from './_middleware/request-context';
import {
  isStorageConflict,
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
import { isRoutingUnavailable, withRouting } from './_middleware/routing';
import { mountAppointments } from './appointments/routes';
import { mountTimeline } from './audit/timeline';
import { mountBilling } from './billing/routes';
import { mountClients } from './clients/list';
import { mountClientRecord } from './clients/mount';
import { mountDevSession, type DevSessionOptions } from './dev-session';
import { mountPortal, mountPortalDoor, type AuthAdminProvider } from './portal/mount';
import { mountPractice } from './practice/routes';
import { LOGO_ENVELOPE_ALLOWANCE_BYTES, MAX_LOGO_BASE64_LENGTH } from './practice/schema';
import { mountKit } from './kit/routes';
import { mountRouting } from './routing/day';
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
 *
 * Two routes answer somebody with no session, and both are mounted before the
 * fence with a budget of their own: the development sign-in door, which exists
 * only on a laptop, and the portal's invitation door, whose authorisation is
 * the one-time token in the link (docs/SPEC/client-portal.md section 7).
 */

export const BODY_LIMIT_BYTES = 64 * 1024;
/** The one path with a larger envelope, and what it is allowed (see below). */
const LOGO_PATH = '/api/practice/logo';
export const LOGO_BODY_LIMIT_BYTES = MAX_LOGO_BASE64_LENGTH + LOGO_ENVELOPE_ALLOWANCE_BYTES;
/**
 * The other one, and it is raw bytes rather than a form: the setup photograph,
 * compressed on the device to at most a megabyte
 * (app/therapist/session/photo.ts, docs/SPEC/practitioner-phone.md section
 * 4.3). There is no base64 envelope here because the body *is* the picture, so
 * the cap is the picture's own.
 */
export const PHOTO_LIMIT_BYTES = 1024 * 1024;
/** `PUT /api/sessions/:id/photo`, matched by shape because the id is in the path. */
const PHOTO_PATH = /^\/api\/sessions\/[^/]+\/photo$/;
/**
 * The method as well as the path. The photograph's door is a `PUT` and only a
 * `PUT`; every other method on that address is a 404 the router has not
 * reached yet, and matching on the path alone handed those a megabyte of room
 * and a pass out of `jsonOnly` for nothing.
 */
function isPhotoUpload(c: Context): boolean {
  return c.req.method === 'PUT' && PHOTO_PATH.test(c.req.path);
}
export const REQUEST_TIMEOUT_MS = 10_000;
const MINUTE = 60_000;

export type ApiOptions = RequestContextDeps & {
  /** The development sign-in door. Only the server decides to pass this, and only on a laptop. */
  devSession?: DevSessionOptions;
  now?: () => Date;
  appEnv?: string;
  /** The Supabase project the browser signs in against; named in the content security policy. */
  supabaseUrl?: string;
  /**
   * PUBLIC_APP_URL: where this deployment's app answers, as the practice hands
   * it out. The portal's invitation link is built on it and never on the
   * request's own Host, which is whatever the caller typed
   * (docs/SPEC/client-portal.md section 7).
   */
  publicAppUrl?: string;
  limits?: Partial<RateLimits>;
  /** How many proxies in front of the API are trusted for X-Forwarded-For (0: none). */
  trustedProxyHops?: number;
  /** Tests inject the bucket key; the server uses the caller's address. */
  keyOf?: (c: Context) => string | null;
  /** The Emirates ID keys (domain/shared/identity). Absent: no route can read c.get('identityKeys'). */
  identityKeys?: IdentityKeys;
  /** The document store (domain/shared/storage, docs/SEAMS.md). Absent: no route can read c.get('storage'). */
  storage?: ServerStorageProvider;
  /**
   * The routing seam (domain/shared/routing, docs/SEAMS.md). Absent: no route
   * can read c.get('routing'), and the day's estimates answer 503 rather than
   * a straight line nobody asked for.
   */
  routing?: RoutingProvider;
  /**
   * Whoever holds the sign-ins (app/api/portal/auth-admin.ts, docs/SEAMS.md).
   * Absent: the portal's invitation door is not mounted at all, so a
   * deployment that has not been given one answers 404 there rather than
   * appearing to work (docs/CHANGE-REQUESTS/client-portal-05.md item 3).
   */
  authAdmin?: AuthAdminProvider;
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
    // A store that is down is not a bug in the record it belongs to: it says
    // so. The message is logged here, unlike a database's: every one of them
    // is written in domain/shared/storage.ts and its implementations, none
    // names a key or echoes a vendor's body, and without it an outage and a
    // refusal are the same line in the log.
    if (isStorageUnavailable(error)) {
      console.error(JSON.stringify({ requestId, name: error.name, message: error.message }));
      return c.json({ error: 'storage_unavailable', requestId }, 503);
    }
    // Something is already filed under that key and the caller did not ask to
    // replace it. Not an outage, and not an internal error: a plain refusal.
    if (isStorageConflict(error)) {
      console.error(JSON.stringify({ requestId, name: error.name, message: error.message }));
      return c.json({ error: 'document_exists', requestId }, 409);
    }
    // The same shape for the routing seam: a vendor that is down is not a bug
    // in the day sheet. Every message this can carry is written in
    // app/api/_middleware/routing and names no coordinate and no key.
    if (isRoutingUnavailable(error)) {
      console.error(JSON.stringify({ requestId, name: error.name, message: error.message }));
      return c.json({ error: 'routing_unavailable', requestId }, 503);
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
  // One route carries a file rather than a form and needs more room than the
  // rest: the practice's logo, capped at 512 KiB by
  // app/api/practice/schema.ts and by migration 909's own rules beneath it.
  // Written as a choice between two caps rather than as a second `use` on the
  // narrower path, because both would run and the smaller of the two would
  // decide — which is the opposite of what a per-route exception means. Every
  // other route keeps the 64 KiB envelope, deliberately: the exception is one
  // path, one method's worth of bytes, and not a raised floor for everything.
  const defaultBodyLimit = bodyLimit({ maxSize: BODY_LIMIT_BYTES, onError: payloadTooLarge });
  const logoBodyLimit = bodyLimit({ maxSize: LOGO_BODY_LIMIT_BYTES, onError: payloadTooLarge });
  const photoBodyLimit = bodyLimit({ maxSize: PHOTO_LIMIT_BYTES, onError: payloadTooLarge });
  api.use('/api/*', async (c, next) => {
    if (c.req.path === LOGO_PATH) return logoBodyLimit(c, next);
    if (isPhotoUpload(c)) return photoBodyLimit(c, next);
    return defaultBodyLimit(c, next);
  });
  api.use('/api/*', timeout(REQUEST_TIMEOUT_MS, timedOut));
  // One path carries an image rather than JSON, and it is the only one: the
  // route itself refuses any type but the three it names and verifies the
  // digest the device declared (app/api/sessions/photo.ts).
  api.use('/api/*', async (c, next) => (isPhotoUpload(c) ? next() : jsonOnly(c, next)));

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

  // The portal's invitation door: public, ahead of the fence, with its own
  // budget, because the person on the other end has no account yet
  // (docs/SPEC/client-portal.md section 7). It opens its own transaction and
  // stamps only the request id; nothing else in this API answers unsigned.
  if (deps.authAdmin) {
    api.use(
      '/api/portal/invite/*',
      rateLimit({
        name: 'invite-door',
        windowMs: MINUTE,
        max: limits.inviteDoorPerMinute,
        keyOf: byAddress,
      }),
    );
    mountPortalDoor(api, {
      pool: deps.pool,
      authAdmin: deps.authAdmin,
      appEnv: deps.appEnv,
    });
  }

  api.use('/api/*', withRequestContext(deps));
  // After the fence, like identityKeys and unlike storage: no route ahead of
  // authentication asks how long a drive takes, and the seam's key must not be
  // reachable from one that does.
  if (deps.routing) {
    api.use('/api/*', withRouting(deps.routing));
  }
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
      .query<{ display_name: string; preferred_locale: 'en' | 'ar' }>(
        'select display_name, preferred_locale from app_user where id = $1',
        [actor.userId],
      );
    return c.json(
      MeResponse.parse({
        userId: actor.userId,
        displayName: rows[0]?.display_name ?? '',
        tenantId: actor.tenantId,
        roles: actor.roles,
        capabilities: actor.capabilities,
        // The person's own language, read in the same query the name comes
        // from, so the portal's first render is in it (client-portal-05 item 2).
        preferredLocale: rows[0]?.preferred_locale ?? 'en',
      }),
    );
  });

  mountPractice(api, deps.now);
  mountClients(api, deps.now);
  mountClientRecord(api, deps.now);
  mountTimeline(api, deps.now);
  mountBilling(api, deps.now);
  mountAppointments(api, deps.now);
  mountSessions(api, deps.now);
  mountKit(api, deps.now);
  mountRouting(api, deps.now);
  mountPortal(api, deps.now, { publicAppUrl: deps.publicAppUrl, appEnv: deps.appEnv });

  // An unknown route answers in the same shape as every other refusal.
  api.notFound((c) => c.json({ error: 'not_found', requestId: c.get('requestId') ?? null }, 404));

  return api;
}
