import { createHash, randomUUID } from 'node:crypto';
import type { Context, Hono, MiddlewareHandler } from 'hono';
import {
  TESTIMONIAL_LANGUAGES,
  parseTestimonial,
  type TestimonialLanguage,
} from '@domain/testimonial';
import type { ApiEnv, PoolLike } from '../_middleware/request-context';
import { PublishedTestimonialsResponse, TestimonialInvalidResponse } from './schema';

/**
 * The website's reviews door, and the read the Testimonials page builds itself
 * from (docs/SPEC/testimonials.md sections 7 and 8). The second public write
 * path, built on the first: the enquiry door (app/api/enquiries/door.ts).
 *
 * Both routes are mounted ahead of the authentication fence, because the
 * person on the other end has no account. Each opens its own transaction,
 * becomes the API role, and stamps only a request id; what is kept and what is
 * read goes through a definer in migration 978, which resolves the practice
 * itself. The API role cannot insert into the table or read it without a
 * practice and a role stamped, so nothing here could reach a row another way.
 *
 * **Where it differs from the enquiry door, and why.**
 *
 *  - **JSON only.** The enquiry door takes a form post so the site can send by
 *    `sendBeacon` without a preflight. A review is written on a page that waits
 *    for the answer and shows which field to fix, so it is sent by `fetch` as
 *    JSON, a preflight is fine, and the API's `jsonOnly` fence applies here as
 *    it does everywhere else (415 for anything else).
 *  - **A foreign origin is refused, not merely left unread.** The enquiry door
 *    answers everyone and lets CORS keep a stranger's page from reading the
 *    reply. Here a post must name one of the website's origins or it is
 *    answered 403 and nothing is kept: a browser always sends `Origin` on a
 *    cross-origin post, and on a same-origin one too, so a missing header is a
 *    script, and a review is something only the website's page ever sends.
 *    This is a cheap filter, not authentication: a script can claim any origin.
 *    The budget and the office's review are the defences.
 *  - **201 and nothing else.** A filled honeypot, an exhausted budget and a
 *    review kept all answer `201` with no body, for the enquiry door's reason:
 *    an answer that differs tells a script what to change. The one refusal a
 *    person sees is a form error, 400, naming the fields to fix.
 *
 * The published read sends four fields per review and nothing that names a
 * row or a time, and may be cached for five minutes by the browser and by
 * anything between, so the page costs the practice one query per visitor at
 * most and usually far fewer.
 */

export const TESTIMONIAL_DOOR_PATH = '/api/testimonials';
export const PUBLISHED_TESTIMONIALS_PATH = '/api/testimonials/published';
/** How long the page and anything in between may keep the published list. */
export const PUBLISHED_CACHE_SECONDS = 300;

const STAMP_REQUEST_ID = "select set_config('app.request_id', $1, true)";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requestIdOf(header: string | undefined): string {
  return header !== undefined && UUID.test(header) ? header : randomUUID();
}

/** sha256 of the address, under this door's own prefix so the two doors' budgets never share a key. */
export function hashTestimonialAddress(address: string): string {
  return createHash('sha256').update(`testimonial:${address}`).digest('hex');
}

/**
 * As the enquiry door's: an unknowable address gets a bucket of its own for
 * this one request rather than one shared "unknown" budget that every such
 * caller would spend between them.
 */
function bucketFor(address: string | null): string {
  return hashTestimonialAddress(address ?? `nobody:${randomUUID()}`);
}

/**
 * The CORS answer for the two public routes, on every answer they give — the
 * fence's 415 for a body that is not JSON, the 413 for one too large and the
 * 429 for a spent budget included — so the website's script can read why it
 * was refused rather than seeing a bare network failure. Registered in
 * create-api ahead of all of those. Only the methods each route answers: the
 * console's own GET of the list shares the door's address, and keeps the
 * same-origin answer every other staff route has.
 */
export function testimonialCors(origins: readonly string[]): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    await next();
    const { path, method } = c.req;
    const door = path === TESTIMONIAL_DOOR_PATH && (method === 'POST' || method === 'OPTIONS');
    const read = path === PUBLISHED_TESTIMONIALS_PATH && (method === 'GET' || method === 'OPTIONS');
    if (!door && !read) return;
    const origin = c.req.header('origin');
    // Echo the caller's origin when it is one of ours, otherwise name the
    // canonical one, which a browser then refuses to hand to the caller.
    c.res.headers.set(
      'Access-Control-Allow-Origin',
      origin && origins.includes(origin) ? origin : (origins[0] ?? ''),
    );
    c.res.headers.set('Vary', 'Origin');
    c.res.headers.set('Access-Control-Allow-Methods', door ? 'POST, OPTIONS' : 'GET, OPTIONS');
    c.res.headers.set('Access-Control-Allow-Headers', 'content-type');
    c.res.headers.set('Access-Control-Max-Age', '600');
  };
}

export type TestimonialDoorOptions = {
  pool: PoolLike;
  /** The website's origins, as `originsFrom` (app/api/enquiries/door.ts) resolves them. */
  origins: readonly string[];
  /** The caller's address as the rate limiter derives it; null when it cannot be known. */
  addressOf: (c: Context<ApiEnv>) => string | null;
};

function languageOf(value: string | undefined): TestimonialLanguage | null {
  if (value === undefined || value === '') return 'en';
  return (TESTIMONIAL_LANGUAGES as readonly string[]).includes(value)
    ? (value as TestimonialLanguage)
    : null;
}

export function mountTestimonialDoor(api: Hono<ApiEnv>, options: TestimonialDoorOptions): void {
  api.options(TESTIMONIAL_DOOR_PATH, (c) => c.body(null, 204));
  api.options(PUBLISHED_TESTIMONIALS_PATH, (c) => c.body(null, 204));

  api.post(TESTIMONIAL_DOOR_PATH, async (c) => {
    const requestId = requestIdOf(c.req.header('x-request-id'));
    c.header('X-Request-Id', requestId);

    const origin = c.req.header('origin');
    if (!origin || !options.origins.includes(origin)) {
      return c.json({ error: 'origin_refused', requestId }, 403);
    }

    // `jsonOnly` has already refused anything that is not JSON. A body that is
    // JSON but not an object is an empty form, refused below field by field.
    let body: Record<string, unknown>;
    try {
      const parsed: unknown = await c.req.json();
      body =
        parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : {};
    } catch {
      body = {};
    }

    const parsed = parseTestimonial(body);
    if (!parsed.ok) {
      if (parsed.reason === 'honeypot') return c.body(null, 201);
      return c.json(
        TestimonialInvalidResponse.parse({ error: 'invalid', fields: parsed.fields, requestId }),
        400,
      );
    }

    const client = await options.pool.connect();
    let inTransaction = false;
    try {
      await client.query('begin');
      inTransaction = true;
      await client.query('set local role app_role');
      await client.query(STAMP_REQUEST_ID, [requestId]);
      // Null for a spent budget exactly as an id for a kept review; neither is
      // reported. What was refused was a script's, not a person's.
      await client.query('select app.submit_testimonial($1::jsonb) as id', [
        JSON.stringify({
          display_name: parsed.testimonial.displayName,
          context: parsed.testimonial.context,
          rating: parsed.testimonial.rating,
          body: parsed.testimonial.body,
          language: parsed.testimonial.language,
          consent_to_publish: true,
          ip_hash: bucketFor(options.addressOf(c)),
        }),
      ]);
      await client.query('commit');
      inTransaction = false;
      client.release();
      return c.body(null, 201);
    } catch (error) {
      if (inTransaction) await client.query('rollback').catch(() => undefined);
      client.release(true);
      // Nothing the person wrote is logged: the request id finds the failure.
      console.error(
        JSON.stringify({ requestId, door: 'testimonial', name: (error as Error).name }),
      );
      return c.json({ error: 'unavailable', requestId }, 503);
    }
  });

  api.get(PUBLISHED_TESTIMONIALS_PATH, async (c) => {
    const requestId = requestIdOf(c.req.header('x-request-id'));
    c.header('X-Request-Id', requestId);
    const language = languageOf(c.req.query('lang'));
    if (language === null) {
      c.header('Cache-Control', 'no-store');
      return c.json({ error: 'bad_request', field: 'lang', requestId }, 400);
    }

    const client = await options.pool.connect();
    let inTransaction = false;
    try {
      await client.query('begin read only');
      inTransaction = true;
      await client.query('set local role app_role');
      await client.query(STAMP_REQUEST_ID, [requestId]);
      const { rows } = await client.query<{
        display_name: string;
        context: string | null;
        rating: number;
        body: string;
      }>('select display_name, context, rating, body from app.published_testimonials($1)', [
        language,
      ]);
      await client.query('commit');
      inTransaction = false;
      client.release();
      c.header('Cache-Control', `public, max-age=${PUBLISHED_CACHE_SECONDS}`);
      return c.json(
        PublishedTestimonialsResponse.parse({
          testimonials: rows.map((row) => ({
            display_name: row.display_name,
            context: row.context,
            rating: row.rating,
            body: row.body,
          })),
        }),
      );
    } catch (error) {
      if (inTransaction) await client.query('rollback').catch(() => undefined);
      client.release(true);
      console.error(
        JSON.stringify({ requestId, door: 'testimonial-read', name: (error as Error).name }),
      );
      c.header('Cache-Control', 'no-store');
      return c.json({ error: 'unavailable', requestId }, 503);
    }
  });
}
