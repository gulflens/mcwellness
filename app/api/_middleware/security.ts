import { randomBytes } from 'node:crypto';
import type { Context, MiddlewareHandler } from 'hono';
import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import { secureHeaders } from 'hono/secure-headers';
import type { ApiEnv } from './request-context';

/**
 * The one path served with the wider policy a browser map needs. A constant
 * rather than a guess: the middleware compares the request path against this
 * list exactly, so no `/admin/schedule/map-something` can widen itself into
 * it (docs/SPEC/route-planning.md section 8.2).
 */
export const MAP_DOCUMENT_PATHS: readonly string[] = ['/admin/schedule/map'];

/**
 * The protective headers on every answer (docs/SECURITY.md). The content
 * security policy allows only the app's own scripts and styles, so injected
 * code cannot run even if some text slipped through unescaped; nothing may
 * frame the app; nothing is sniffed; referrers stay home; HTTPS is pinned in
 * production only, where it exists.
 *
 * **One document is served differently, and only one** (section 8 of
 * docs/SPEC/route-planning.md): the coordinator's day map, whose browser map
 * needs directives this policy refuses and should go on refusing. It is chosen
 * by an exact path match on a GET, and it carries a nonce minted per response.
 */
export function securityHeaders(
  appEnv: string | undefined,
  options: {
    supabaseUrl?: string | undefined;
    /** Paths served with the map document's policy. Empty: nothing is widened. */
    mapDocumentPaths?: readonly string[];
  } = {},
): MiddlewareHandler {
  // The browser signs in against the Supabase project directly (a vendor in the
  // register), so its origin is the one connection allowed beyond the app's own.
  const connectSrc = ["'self'"];
  if (options.supabaseUrl) {
    try {
      connectSrc.push(new URL(options.supabaseUrl).origin);
    } catch {
      // An unparseable URL adds nothing; sign-in then fails visibly, never silently.
    }
  }
  const shared = {
    referrerPolicy: 'no-referrer' as const,
    strictTransportSecurity:
      appEnv === 'production' ? ('max-age=31536000; includeSubDomains' as const) : (false as const),
    xFrameOptions: 'DENY' as const,
    crossOriginResourcePolicy: 'same-origin' as const,
    // Location is the app's own to ask for: the check-in's optional "Share my
    // location" and enrolment's "Use my current position" both read the
    // browser's geolocation on a tap, and geolocation=() would silently kill
    // both in the served app. Camera and microphone stay off.
    permissionsPolicy: { camera: [], microphone: [], geolocation: ['self'] },
  };

  const strict = secureHeaders({
    ...shared,
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      // `blob:` beside `data:` for the pictures the app fetches itself: the
      // day's map and the last sensor placement are asked for through
      // `apiFetch`, because every route below the fence authenticates on a
      // bearer header, and the bytes are then shown from a revocable object
      // URL. A `blob:` URL can be created only by this app's own scripts, so
      // this admits nothing third-party (docs/SPEC/practitioner-phone.md
      // section 3.6, amended in the second round).
      imgSrc: ["'self'", 'data:', 'blob:'],
      fontSrc: ["'self'"],
      connectSrc,
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      objectSrc: ["'none'"],
    },
  });

  /**
   * The day map's own document (docs/SPEC/route-planning.md section 8.3):
   * Google's own strict list, plus what this app already needs. Three of its
   * grants are ones the console would rather not make — `'strict-dynamic'`,
   * `'unsafe-eval'` and `https:` for scripts — and they reach exactly one
   * page. The nonce is what makes `'strict-dynamic'` safe: only the shell's
   * own tags carry it, and only what they load is trusted onwards.
   *
   * The referrer is the origin rather than nothing, because the browser key
   * is restricted by HTTP referrer and Google refuses a request that carries
   * none. Only the origin crosses; no address of this app names a person
   * (.claude/rules/ui.md).
   */
  const mapDocument = (nonce: string): MiddlewareHandler =>
    secureHeaders({
      ...shared,
      referrerPolicy: 'strict-origin-when-cross-origin',
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: [`'nonce-${nonce}'`, "'strict-dynamic'", 'https:', "'unsafe-eval'", 'blob:'],
        styleSrc: ["'self'", `'nonce-${nonce}'`, 'https://fonts.googleapis.com'],
        imgSrc: [
          "'self'",
          'data:',
          'blob:',
          'https://*.googleapis.com',
          'https://*.gstatic.com',
          '*.google.com',
          '*.googleusercontent.com',
        ],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        connectSrc: [
          ...connectSrc,
          'https://*.googleapis.com',
          '*.google.com',
          'https://*.gstatic.com',
          'data:',
          'blob:',
        ],
        frameSrc: ['*.google.com'],
        workerSrc: ["'self'", 'blob:'],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        objectSrc: ["'none'"],
      },
    });

  const mapPaths = new Set(options.mapDocumentPaths ?? []);
  return createMiddleware<ApiEnv>(async (c, next) => {
    if (c.req.method !== 'GET' || !mapPaths.has(c.req.path)) {
      return strict(c, next);
    }
    const nonce = randomBytes(16).toString('base64');
    c.set('cspNonce', nonce);
    return mapDocument(nonce)(c, next);
  });
}

/** API answers hold personal data: nothing caches them. */
export const noStore: MiddlewareHandler = async (c, next) => {
  await next();
  c.res.headers.set('Cache-Control', 'no-store');
};

/** A body is read only when it says it is JSON. */
export const jsonOnly: MiddlewareHandler = async (c, next) => {
  if (['POST', 'PUT', 'PATCH'].includes(c.req.method)) {
    const type = c.req.header('content-type') ?? '';
    if (!type.toLowerCase().startsWith('application/json')) {
      return c.json({ error: 'unsupported_media_type', requestId: null }, 415);
    }
  }
  await next();
};

export function payloadTooLarge(c: Context): Response {
  return c.json({ error: 'payload_too_large', requestId: null }, 413);
}

export function timedOut(): HTTPException {
  return new HTTPException(504, {
    res: new Response(JSON.stringify({ error: 'timeout', requestId: null }), {
      status: 504,
      headers: { 'content-type': 'application/json' },
    }),
  });
}
