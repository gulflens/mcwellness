import type { Context, MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { secureHeaders } from 'hono/secure-headers';

/**
 * The protective headers on every answer (docs/SECURITY.md). The content
 * security policy allows only the app's own scripts and styles, so injected
 * code cannot run even if some text slipped through unescaped; nothing may
 * frame the app; nothing is sniffed; referrers stay home; HTTPS is pinned in
 * production only, where it exists.
 */
export function securityHeaders(
  appEnv: string | undefined,
  options: { supabaseUrl?: string | undefined } = {},
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
  return secureHeaders({
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
    referrerPolicy: 'no-referrer',
    strictTransportSecurity:
      appEnv === 'production' ? 'max-age=31536000; includeSubDomains' : false,
    xFrameOptions: 'DENY',
    crossOriginResourcePolicy: 'same-origin',
    // Location is the app's own to ask for: the check-in's optional "Share my
    // location" and enrolment's "Use my current position" both read the
    // browser's geolocation on a tap, and geolocation=() would silently kill
    // both in the served app. Camera and microphone stay off.
    permissionsPolicy: { camera: [], microphone: [], geolocation: ['self'] },
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
