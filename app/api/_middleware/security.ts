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
export function securityHeaders(appEnv: string | undefined): MiddlewareHandler {
  return secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'],
      fontSrc: ["'self'"],
      connectSrc: ["'self'"],
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
    permissionsPolicy: { camera: [], microphone: [], geolocation: [] },
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
