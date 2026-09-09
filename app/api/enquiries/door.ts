import { createHash, randomUUID } from 'node:crypto';
import type { Context, Hono } from 'hono';
import { parseEnquiry } from '@domain/enquiry';
import type { ApiEnv, PoolLike } from '../_middleware/request-context';
import { LodgeResponse } from './schema';

/**
 * The website's enquiry door: `POST /api/enquiries`, the practice system's
 * first public write path (docs/superpowers/specs/2026-09-09-enquiries-design.md).
 *
 * Mounted ahead of the authentication fence, like the portal's invitation
 * door and by the same rule: the person on the other end has no account, so
 * the route opens its own transaction, becomes the API role, and stamps only
 * a request id. Everything it keeps goes through `app.lodge_enquiry`, a
 * definer that resolves the practice, holds the budget, and inserts — the API
 * role has no insert on the table at all.
 *
 * **It answers the same to everyone.** A filled honeypot, an exhausted budget
 * and a real enquiry all get `200 {ok:true}`: a form that says "you have been
 * rate limited" tells a script what to change, and one that says "thank you"
 * tells it nothing. The one refusal a person can see is a missing name or
 * number, which is a form error and not a defence.
 *
 * **Form-encoded or JSON**, because the site sends by `sendBeacon` with
 * `URLSearchParams` — a simple request that needs no preflight — and a fetch
 * fallback that could send either. The `jsonOnly` fence exempts exactly this
 * path (app/api/create-api.ts). CORS answers the two origins that have
 * business here, the apex and `www`, which to a browser are different sites.
 */

export const ENQUIRY_DOOR_PATH = '/api/enquiries';
const STAMP_REQUEST_ID = "select set_config('app.request_id', $1, true)";
const DEFAULT_ORIGINS = ['https://mcwellnessuae.com', 'https://www.mcwellnessuae.com'];

export type EnquiryDoorOptions = {
  pool: PoolLike;
  /** Comma-separated override of the origins allowed to post, from ENQUIRY_ORIGINS. */
  origins?: string | undefined;
  /**
   * The caller's address as the rate limiter already derives it — the same
   * function, given the same context — so the two budgets agree on who is who.
   * Null means the address could not be known; see `bucketFor`.
   */
  addressOf: (c: Context<ApiEnv>) => string | null;
};

function requestIdOf(header: string | undefined): string {
  return header && /^[0-9a-f-]{36}$/i.test(header) ? header : randomUUID();
}

function originsFrom(override: string | undefined): string[] {
  const named = (override ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  return named.length > 0 ? named : DEFAULT_ORIGINS;
}

/** sha256 of the address: pseudonymous enough for a ten-minute budget, and scrubbed with the row. */
export function hashAddress(address: string): string {
  return createHash('sha256').update(`enquiry:${address}`).digest('hex');
}

/**
 * The budget's key. An unknowable address gets a bucket of its own for this
 * one request rather than a shared "unknown" one: shared, every caller the
 * platform cannot place would spend one five-in-ten-minutes budget between
 * them and real enquiries would be dropped. The rate limiter makes the same
 * choice for the same reason (`addressKey`: null means "do not limit").
 */
function bucketFor(address: string | null): string {
  return hashAddress(address ?? `nobody:${randomUUID()}`);
}

export function mountEnquiryDoor(api: Hono<ApiEnv>, options: EnquiryDoorOptions): void {
  const origins = originsFrom(options.origins);

  const cors = (origin: string | undefined): Record<string, string> => ({
    // Echo the caller's origin when it is one of ours, otherwise name the
    // canonical one — a browser then blocks the response, which is the right
    // outcome for an origin with no business here.
    'Access-Control-Allow-Origin': origin && origins.includes(origin) ? origin : origins[0]!,
    Vary: 'Origin',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  });

  api.options(ENQUIRY_DOOR_PATH, (c) => {
    for (const [k, v] of Object.entries(cors(c.req.header('origin')))) c.header(k, v);
    return c.body(null, 204);
  });

  api.post(ENQUIRY_DOOR_PATH, async (c) => {
    const requestId = requestIdOf(c.req.header('x-request-id'));
    c.header('X-Request-Id', requestId);
    for (const [k, v] of Object.entries(cors(c.req.header('origin')))) c.header(k, v);

    // JSON or a classic form post; the sender should not have to care.
    const type = c.req.header('content-type') ?? '';
    // Unreadable input is an empty form: refused below as incomplete.
    let body: Record<string, unknown>;
    try {
      if (type.includes('application/json')) {
        body = (await c.req.json()) as Record<string, unknown>;
      } else {
        const form = await c.req.parseBody();
        body = Object.fromEntries(
          Object.entries(form).map(([k, v]) => [k, typeof v === 'string' ? v : '']),
        );
      }
    } catch {
      body = {};
    }

    const parsed = parseEnquiry(body);
    if (!parsed.ok) {
      if (parsed.reason === 'honeypot') return c.json(LodgeResponse.parse({ ok: true }));
      return c.json({ error: 'name and phone are required', requestId }, 400);
    }

    const client = await options.pool.connect();
    let inTransaction = false;
    try {
      await client.query('begin');
      inTransaction = true;
      await client.query('set local role app_role');
      await client.query(STAMP_REQUEST_ID, [requestId]);
      // The budget answers null exactly as success answers an id; neither is
      // reported. What was refused was never a person's enquiry to lose.
      await client.query('select app.lodge_enquiry($1::jsonb) as id', [
        JSON.stringify({
          source: parsed.enquiry.source,
          name: parsed.enquiry.name,
          whatsapp_e164: parsed.enquiry.whatsappE164,
          email: parsed.enquiry.email,
          area: parsed.enquiry.area,
          message: parsed.enquiry.message,
          concern: parsed.enquiry.concern,
          preferred_time: parsed.enquiry.preferredTime,
          contact_method: parsed.enquiry.contactMethod,
          consent: parsed.enquiry.consent,
          ip_hash: bucketFor(options.addressOf(c)),
        }),
      ]);
      await client.query('commit');
      inTransaction = false;
      client.release();
      return c.json(LodgeResponse.parse({ ok: true }));
    } catch (error) {
      if (inTransaction) await client.query('rollback').catch(() => undefined);
      client.release(true);
      // Nothing about the person is logged: the request id is enough to find
      // the failure, and the door owes the caller no explanation.
      console.error(JSON.stringify({ requestId, door: 'enquiry', name: (error as Error).name }));
      return c.json({ ok: false, requestId }, 503);
    }
  });
}
