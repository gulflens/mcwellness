import type { Hono } from 'hono';
import { z } from 'zod';
import { ageOn, canActor, hasRole, isoDateIn } from '../../../domain/shared';
import { normaliseEmiratesId } from '../../../domain/shared/emirates-id';
import { emiratesIdHash } from '../../../domain/shared/identity';
import { logReads } from '../_middleware/audit';
import { cleanText } from '../_middleware/text';
import type { ApiEnv, Db } from '../_middleware/request-context';
import { logRefused } from './refused';

/**
 * GET /api/clients: the admin console's client table. The rule is checked here
 * (canActor) and enforced beneath by row security: the query runs as the
 * signed-in person, so the database limits the rows to their practice. Every
 * listed client is recorded as a read. Seeded by the trunk in PR 5; owned by
 * the client-record worktree from there (docs/SPEC/OWNERSHIP.md).
 *
 * POST /api/clients/lookup: the same table, found by Emirates ID
 * (client-record.md section 4.1). It is deliberately not `?q=`, and
 * deliberately not a GET: `.claude/rules/ui.md` and the security review's
 * fourth check both say no personal data in a URL path or query string, and
 * an identity number is the most sensitive identifier the practice holds — a
 * query string reaches every reverse proxy's access log on the way. In a
 * request body it reaches only this route, which hashes it with the same
 * keyed HMAC that sealed it and looks the client up by that fingerprint. The
 * number never enters this file's SQL text, a log, or an audit payload; only
 * its 32 bytes do. `?q=` still searches names and record numbers, and an
 * identity number typed into it is simply text that matches nothing.
 */

import { CLIENT_STATUSES as STATUSES, ClientListResponse, type ClientRow } from './schema';

const PRACTICE_TIME_ZONE = 'Asia/Dubai';

// A single keystroke must never sweep the whole practice: a `q` shorter than
// this is treated as absent (the unfiltered first page, as if `q` were never
// sent) rather than searched. The page itself is capped the same way for the
// same reason — one audit row per listed client, never per matching client.
const MIN_SEARCH_LENGTH = 2;
const PAGE_SIZE = 50;

const Query = z.object({
  status: z.enum(STATUSES).optional(),
  q: z
    .string()
    .transform((value) => cleanText(value, 80))
    .optional(),
});

/** Digits and hyphens as typed; the shape itself is judged by normaliseEmiratesId. */
const LookupBody = z.object({ emiratesId: z.string().min(1).max(40) });

type Row = {
  id: string;
  mrn: string;
  given_name: string;
  family_name: string;
  given_name_ar: string | null;
  family_name_ar: string | null;
  date_of_birth: string | null;
  status: (typeof STATUSES)[number];
  contact_relationship: string | null;
  contact_phone: string | null;
  emirate: string | null;
};

const COLUMNS =
  'select c.id, c.mrn, c.given_name, c.family_name, c.given_name_ar, c.family_name_ar, ' +
  'c.date_of_birth, c.status, ct.relationship as contact_relationship, ct.phone as contact_phone, ' +
  'l.emirate ';

const JOINS =
  'left join contact ct on ct.id = c.primary_contact_id ' +
  'left join location l on l.id = c.primary_location_id ';

const SQL =
  COLUMNS +
  'from client c ' +
  JOINS +
  'where ($1::client_status is null or c.status = $1::client_status) ' +
  // Erased records stay with the lead practitioner (client-record.md section 2).
  "and ($3::boolean or c.status <> 'erased') " +
  "and ($2::text is null or c.mrn ilike $2 escape '\\' or c.given_name ilike $2 escape '\\' " +
  "or c.family_name ilike $2 escape '\\' or coalesce(c.given_name_ar, '') ilike $2 escape '\\' " +
  "or coalesce(c.family_name_ar, '') ilike $2 escape '\\') " +
  // One row past the page size, so the route can tell whether more matched
  // without a second, count-only query.
  'order by c.mrn limit $4';

// The fingerprint lookup: at most one contact per tenant can carry a given
// fingerprint (contact's own unique (tenant_id, emirates_id_hash)), so this
// finds at most one client — never a text match against name or MRN columns.
const ID_SQL =
  COLUMNS +
  'from client c ' +
  'join contact idc on idc.client_id = c.id and idc.emirates_id_hash = $1 ' +
  JOINS +
  "where ($2::boolean or c.status <> 'erased') " +
  'order by c.mrn limit 2';

function escapeLike(q: string): string {
  return q.replace(/[\\%_]/g, '\\$&');
}

function likePattern(escaped: string): string {
  return `%${escaped}%`;
}

/** The fifteen normalised digits, or null when the input is not shaped like one. */
function emiratesIdShapeOf(value: string): string | null {
  try {
    return normaliseEmiratesId(value);
  } catch {
    return null;
  }
}

function toClientRows(rows: readonly Row[], today: string): ClientRow[] {
  return rows.map((r) => ({
    id: r.id,
    mrn: r.mrn,
    givenName: r.given_name,
    familyName: r.family_name,
    givenNameAr: r.given_name_ar,
    familyNameAr: r.family_name_ar,
    age: r.date_of_birth === null ? null : ageOn(r.date_of_birth, today),
    status: r.status,
    contact:
      r.contact_relationship === null
        ? null
        : { relationship: r.contact_relationship, phone: r.contact_phone },
    emirate: r.emirate,
  }));
}

/** Every client a person sees, listed or looked up, is one audit row (audit.md section 5). */
async function logListed(db: Db, clients: readonly ClientRow[]): Promise<void> {
  await logReads(
    db,
    'client',
    clients.map((client) => ({ id: client.id, clientId: client.id })),
    'list',
  );
}

export function mountClients(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  api.get('/api/clients', async (c) => {
    const actor = c.get('actor');
    const requestId = c.get('requestId');
    if (!canActor(actor, { type: 'client.list' }, {}, now())) {
      // A collection action: nothing here names a specific row (client-record.md
      // section 9), so the request id stands in as the entity, the same convention
      // POST /api/clients uses (issue 13, third review round).
      await logRefused(c.get('db'), 'client', requestId, null);
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const query = Query.safeParse(c.req.query());
    if (!query.success) {
      return c.json({ error: 'bad_request', requestId }, 400);
    }
    // A practitioner lists only the clients on their schedule; there is no
    // schedule yet, so the honest answer is an empty table with a note.
    if (!hasRole(actor, 'owner', 'admin', 'lead_practitioner', 'finance')) {
      return c.json(ClientListResponse.parse({ clients: [], note: 'schedule' }));
    }
    // Below the minimum, the term is dropped rather than searched (see
    // MIN_SEARCH_LENGTH above): the unfiltered first page comes back, same as
    // when `q` is absent. Measured on the escaped form, not the raw one: a
    // lone wildcard character (`%` or `_`) escapes to two characters and is
    // never a sweep risk in the first place — escaped, it matches only that
    // literal punctuation, not "everything" — so it still searches.
    const escaped = query.data.q ? escapeLike(query.data.q) : null;
    const search = escaped && escaped.length >= MIN_SEARCH_LENGTH ? escaped : null;
    const { rows } = await c
      .get('db')
      .query<Row>(SQL, [
        query.data.status ?? null,
        search ? likePattern(search) : null,
        hasRole(actor, 'owner', 'lead_practitioner'),
        PAGE_SIZE + 1,
      ]);
    const truncated = rows.length > PAGE_SIZE;
    const page = truncated ? rows.slice(0, PAGE_SIZE) : rows;
    const clients = toClientRows(page, isoDateIn(now(), PRACTICE_TIME_ZONE));
    await logListed(c.get('db'), clients);
    return c.json(
      ClientListResponse.parse({ clients, note: null, ...(truncated ? { truncated: true } : {}) }),
    );
  });

  api.post('/api/clients/lookup', async (c) => {
    const actor = c.get('actor');
    const requestId = c.get('requestId');
    if (!canActor(actor, { type: 'client.list' }, {}, now())) {
      await logRefused(c.get('db'), 'client', requestId, null);
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const bodyJson = await c.req.json().catch(() => null);
    const body = LookupBody.safeParse(bodyJson);
    if (!body.success) return c.json({ error: 'bad_request', requestId }, 400);
    const digits = emiratesIdShapeOf(body.data.emiratesId);
    if (digits === null) {
      // The shape, not the checksum: a mistyped digit is a search that finds nothing,
      // which is the truth, and not a lecture about a number the practice may not hold.
      return c.json({ error: 'bad_request', code: 'invalid_emirates_id', requestId }, 400);
    }
    if (!hasRole(actor, 'owner', 'admin', 'lead_practitioner', 'finance')) {
      return c.json(ClientListResponse.parse({ clients: [], note: 'schedule' }));
    }
    const identityKeys = c.get('identityKeys');
    if (identityKeys === undefined) {
      // No key, no fingerprint. An empty list would read as "no such client", which
      // would be a lie about the practice rather than about the deployment.
      return c.json({ error: 'emirates_id_unavailable', requestId }, 503);
    }
    const { rows } = await c
      .get('db')
      .query<Row>(ID_SQL, [
        emiratesIdHash(digits, identityKeys),
        hasRole(actor, 'owner', 'lead_practitioner'),
      ]);
    const clients = toClientRows(rows, isoDateIn(now(), PRACTICE_TIME_ZONE));
    await logListed(c.get('db'), clients);
    return c.json(ClientListResponse.parse({ clients, note: null }));
  });
}
