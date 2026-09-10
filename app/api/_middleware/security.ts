import { randomBytes } from 'node:crypto';
import type { Context, MiddlewareHandler } from 'hono';
import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import { secureHeaders } from 'hono/secure-headers';
import type { ApiEnv } from './request-context';

/**
 * Two documents, from trunk round 43: the day map and the pin picker. Each is
 * its own page and carries the wider policy; the console around them stays
 * strict. A constant rather than a guess: the middleware compares the
 * request path against this list exactly, so no `/admin/schedule/map-something`
 * can widen itself into it (docs/SPEC/route-planning.md section 8.2).
 */
export const MAP_DOCUMENT_PATHS: readonly string[] = ['/admin/schedule/map', '/admin/clients/pin'];

/**
 * A content security policy, as the directives that make it up.
 *
 * One value, rendered twice and never written twice: `hono/secure-headers`
 * turns it into the response header, and `policyText` turns the same object
 * into the string the document carries in its own `<meta>`. A test builds
 * both from one input and compares them directive for directive, so the two
 * renderings cannot drift into two policies (tests/security/static.test.ts).
 */
export type CspPolicy = Record<string, string[]>;

/**
 * The origins a browser may open a connection to: the app's own, and the
 * Supabase project it signs in against directly (a vendor in the register),
 * which is the one connection allowed beyond `'self'`.
 */
export function connectSources(supabaseUrl: string | undefined): string[] {
  const sources = ["'self'"];
  if (supabaseUrl) {
    try {
      sources.push(new URL(supabaseUrl).origin);
    } catch {
      // An unparseable URL adds nothing; sign-in then fails visibly, never silently.
    }
  }
  return sources;
}

/**
 * The policy on every answer but one: only the app's own scripts and styles,
 * so injected code cannot run even if some text slipped through unescaped.
 */
export function strictPolicy(connectSrc: string[]): CspPolicy {
  return {
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
  };
}

/**
 * The widened documents' shared policy (docs/SPEC/route-planning.md section
 * 8.3): Google's own strict list, plus what this app already needs. Three of
 * its grants are ones the console would rather not make — `'strict-dynamic'`,
 * `'unsafe-eval'` and `https:` for scripts — and they reach exactly the pages
 * `MAP_DOCUMENT_PATHS` names, the day map and the pin picker, and nowhere
 * else. The nonce is what makes `'strict-dynamic'` safe: only the shell's own
 * tags carry it, and only what they load is trusted onwards.
 */
export function mapDocumentPolicy(nonce: string, connectSrc: string[]): CspPolicy {
  return {
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
  };
}

/**
 * The one directive a document's own copy leaves out. `frame-ancestors` is
 * ignored in a `<meta>` policy — that is the specification, not a bug — so
 * printing it there would only look like protection. Nothing is lost:
 * framing is refused by `X-Frame-Options: DENY`, which does reach the
 * browser, and the directive stays in the header for the day the edge stops
 * replacing it.
 */
const NOT_IN_A_DOCUMENT: readonly string[] = ['frameAncestors'];

/**
 * The policy as a browser reads it. The kebab-casing and the joining are
 * `hono/secure-headers`' own, character for character, which is what lets the
 * header and the document be held to one policy by a test rather than by
 * hope.
 */
export function policyText(policy: CspPolicy, omit: readonly string[] = []): string {
  return Object.entries(policy)
    .filter(([directive]) => !omit.includes(directive))
    .map(([directive, values]) => `${kebab(directive)} ${values.join(' ')}`)
    .join('; ');
}

const kebab = (directive: string): string =>
  directive.replace(/[A-Z]+(?![a-z])|[A-Z]/g, (match: string, offset: number) =>
    offset > 0 ? `-${match.toLowerCase()}` : match.toLowerCase(),
  );

/** The same policy, as the document itself carries it (see `stamp` in ../serve-app.ts). */
export function documentPolicyText(policy: CspPolicy): string {
  return policyText(policy, NOT_IN_A_DOCUMENT);
}

/**
 * The protective headers on every answer (docs/SECURITY.md). The content
 * security policy allows only the app's own scripts and styles, so injected
 * code cannot run even if some text slipped through unescaped; nothing may
 * frame the app; nothing is sniffed; referrers stay home; HTTPS is pinned in
 * production only, where it exists.
 *
 * **Two documents are served differently, and only these two**
 * (`MAP_DOCUMENT_PATHS` above; section 8 of docs/SPEC/route-planning.md): the
 * coordinator's day map and the pin picker, each needing directives this
 * policy refuses and should go on refusing everywhere else. Each is chosen by
 * an exact path match on a GET, and each carries a nonce minted per response.
 *
 * Whichever policy a response gets, the same object is also rendered onto the
 * context as `cspDocumentPolicy`, for the shell to carry in its `<head>`:
 * in production this header does not reach a browser at all, because
 * Hostinger's origin replaces it (docs/SPEC/hosting.md section 2.3). The
 * header is still sent, and is still the right thing.
 */
export function securityHeaders(
  appEnv: string | undefined,
  options: {
    supabaseUrl?: string | undefined;
    /** Paths served with the map document's policy. Empty: nothing is widened. */
    mapDocumentPaths?: readonly string[];
    /**
     * Paths whose answer another origin is meant to read, so their resource
     * policy is `cross-origin` rather than `same-origin`: the website's
     * enquiry door and nothing else (trunk round 41, 2026-09-10). Set here
     * because `secureHeaders` writes after the handler has answered and would
     * overwrite a header the handler set itself.
     */
    crossOriginResourcePaths?: readonly string[];
  } = {},
): MiddlewareHandler {
  const connectSrc = connectSources(options.supabaseUrl);
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

  const strictDirectives = strictPolicy(connectSrc);
  const strictDocument = documentPolicyText(strictDirectives);
  const strict = secureHeaders({ ...shared, contentSecurityPolicy: strictDirectives });

  /**
   * The referrer is the origin rather than nothing, because the browser key
   * is restricted by HTTP referrer and Google refuses a request that carries
   * none. Only the origin crosses; no address of this app names a person
   * (.claude/rules/ui.md).
   */
  const mapDocument = (policy: CspPolicy): MiddlewareHandler =>
    secureHeaders({
      ...shared,
      referrerPolicy: 'strict-origin-when-cross-origin',
      contentSecurityPolicy: policy,
    });

  const mapPaths = new Set(options.mapDocumentPaths ?? []);
  const crossOriginPaths = new Set(options.crossOriginResourcePaths ?? []);
  return createMiddleware<ApiEnv>(async (c, next) => {
    if (c.req.method !== 'GET' || !mapPaths.has(c.req.path)) {
      c.set('cspDocumentPolicy', strictDocument);
      await strict(c, next);
    } else {
      const nonce = randomBytes(16).toString('base64');
      const policy = mapDocumentPolicy(nonce, connectSrc);
      c.set('cspNonce', nonce);
      c.set('cspDocumentPolicy', documentPolicyText(policy));
      await mapDocument(policy)(c, next);
    }
    // Only the answers the door itself gives, a preflight and a post: a GET on
    // the same path is the fence's refusal and keeps the strict policy.
    if (
      crossOriginPaths.has(c.req.path) &&
      (c.req.method === 'POST' || c.req.method === 'OPTIONS')
    ) {
      c.res.headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
    }
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
