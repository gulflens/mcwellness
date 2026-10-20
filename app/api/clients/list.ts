import { randomUUID } from 'node:crypto';
import type { Context, Hono } from 'hono';
import { z } from 'zod';
import { ageOn, canActor, hasRole, isoDateIn } from '../../../domain/shared';
import { EMIRATES } from '../../../domain/client/types';
import { emiratesIdHash } from '../../../domain/shared/identity';
import { isEmiratesIdShaped, wholeEmiratesIdDigits } from './emirates-id-shape';
import { logReads } from '../_middleware/audit';
import { cleanText } from '../_middleware/text';
import type { ApiEnv, Db } from '../_middleware/request-context';
import { canListErasedClients } from './access';
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
 * its 32 bytes do.
 *
 * POST /api/clients/search: the same table, searched by name or record number
 * (operator, 20 October 2026). For the same reason as the lookup: what a
 * person types into a client search is usually a name, so it travels in a
 * body. The GET keeps its two filters, which name nobody, and refuses a `q`
 * outright, so no caller can put a name or an identity number in a query
 * string by accident or otherwise. The search itself refuses an identity
 * number too, whole or half-typed, and sends the caller to the lookup.
 */

import { CLIENT_STATUSES as STATUSES, ClientListResponse, type ClientRow } from './schema';

const PRACTICE_TIME_ZONE = 'Asia/Dubai';

// A single keystroke must never sweep the whole practice: a `q` shorter than
// this is treated as absent (the unfiltered first page, as if `q` were never
// sent) rather than searched. The page itself is capped the same way for the
// same reason — one audit row per listed client, never per matching client.
const MIN_SEARCH_LENGTH = 2;
const PAGE_SIZE = 50;

const Filters = {
  status: z.enum(STATUSES).optional(),
  // One of the seven, or the request is refused: a misspelt emirate must never
  // quietly list the whole practice as if no filter had been asked for.
  emirate: z.enum(EMIRATES).optional(),
};

/**
 * The address's half: the two filters, which name nobody, and nothing else.
 * Strict, so a parameter this route does not read — a name under another
 * key, say — is refused rather than quietly dropped after the proxy has
 * already logged it.
 */
const Query = z.object(Filters).strict();

/**
 * The body's half: the filters and the text a person typed, which is usually
 * a name and so never travels in an address (operator, 20 October 2026;
 * .claude/rules/ui.md).
 */
const SearchBody = z
  .object({
    ...Filters,
    q: z
      .string()
      .transform((value) => cleanText(value, 80))
      .optional(),
  })
  .strict();
type SearchBody = z.infer<typeof SearchBody>;

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
  // No status asked for lists every status but erased: an erased record is shown
  // only when the filter asks for it by name (the practice's request, 6 October
  // 2026), and the booking drawer's client search, which sends no status, never
  // offers one.
  "where (($1::client_status is null and c.status <> 'erased') or c.status = $1::client_status) " +
  // Erased records stay with the lead practitioner (client-record.md section 2).
  "and ($3::boolean or c.status <> 'erased') " +
  // The emirate the column shows: the primary address's, never another address
  // on file, so the filter and the column cannot disagree about a row. A client
  // with no address yet is in no emirate.
  'and ($5::emirate is null or l.emirate = $5::emirate) ' +
  "and ($2::text is null or c.mrn ilike $2 escape '\\' or c.given_name ilike $2 escape '\\' " +
  "or c.family_name ilike $2 escape '\\' or coalesce(c.given_name_ar, '') ilike $2 escape '\\' " +
  "or coalesce(c.family_name_ar, '') ilike $2 escape '\\' " +
  // The name as it is written on the screen. Without this line a search for
  // "Dahlia Bay" — the client's own displayed name, typed exactly, with the
  // space a real person types — matched nothing at all, because every column
  // above holds one half of it and neither holds both
  // (docs/CHANGE-REQUESTS/qa-01.md item 4). The concatenation is the
  // *fourth* thing searched, not a replacement for the three: a given name
  // alone and a family name alone still match on their own columns.
  "or (c.given_name || ' ' || c.family_name) ilike $2 escape '\\' " +
  "or (coalesce(c.given_name_ar, '') || ' ' || coalesce(c.family_name_ar, '')) " +
  "ilike $2 escape '\\') " +
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

/**
 * A search by identity number that named nobody: refused by role, unanswerable
 * for want of a key, or simply matching no one. Every one of those is still
 * somebody asking after a person's identity number, and the trail owes an answer
 * to "who looked, and when" even when the answer to the search was nothing
 * (audit.md section 5). It never records what was searched for.
 *
 * The entity is a fresh id, not the request id: `x-request-id` is supplied by the
 * caller, so using it here would let any signed-in actor mint an audit row
 * pointing at a uuid of their choosing — a real client's, for instance. The
 * request id still reaches `request_id` from the transaction's own setting, so
 * correlation is unharmed.
 */
async function logSearched(db: Db): Promise<void> {
  await logReads(db, 'client', [{ id: randomUUID(), clientId: null }], 'list');
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

/**
 * Whether this person may list clients at all, answered before anything they
 * sent is read: a refusal is recorded as one whatever was asked. A collection
 * action: nothing here names a specific row (client-record.md section 9), so a
 * fresh id stands in as the entity, the same convention POST /api/clients uses
 * (issue 13, third review round).
 */
async function refusedToList(c: Context<ApiEnv>, now: () => Date): Promise<Response | null> {
  if (canActor(c.get('actor'), { type: 'client.list' }, {}, now())) return null;
  await logRefused(c.get('db'), 'client', randomUUID(), null);
  return c.json({ error: 'forbidden', requestId: c.get('requestId') }, 403);
}

/** The client table, filtered and searched, for both routes that read it. */
async function listClients(
  c: Context<ApiEnv>,
  input: SearchBody,
  now: () => Date,
): Promise<Response> {
  const actor = c.get('actor');
  const requestId = c.get('requestId');
  // A practitioner lists only the clients on their own schedule. This used to answer
  // them an unconditional empty list, which was honest while
  // app.client_visible_to_practitioner was a stub: there was no schedule to consult.
  // Migration 201 gives it the real window, so the query below now runs under the
  // read policies that call it and comes back with exactly the clients this
  // practitioner is booked with — audited per client like any other list read. The
  // note still travels, because an empty table means something different to them
  // than to an admin: not "nobody matches" but "you are booked with nobody".
  const scheduleScoped = !hasRole(actor, 'owner', 'admin', 'lead_practitioner', 'finance');
  // An identity number is looked up, never searched as text, even in a body: the
  // lookup hashes it and searches by fingerprint, and a text search would put the
  // number itself into this query's parameters (app/admin/clients/ClientsPage.tsx
  // keeps the browser to the same rule).
  if (input.q && isEmiratesIdShaped(input.q)) {
    return c.json({ error: 'bad_request', code: 'use_lookup', requestId }, 400);
  }
  // Below the minimum, the term is dropped rather than searched (see
  // MIN_SEARCH_LENGTH above): the unfiltered first page comes back, same as
  // when `q` is absent. Measured on the escaped form, not the raw one: a
  // lone wildcard character (`%` or `_`) escapes to two characters and is
  // never a sweep risk in the first place — escaped, it matches only that
  // literal punctuation, not "everything" — so it still searches.
  const escaped = input.q ? escapeLike(input.q) : null;
  const search = escaped && escaped.length >= MIN_SEARCH_LENGTH ? escaped : null;
  const { rows } = await c
    .get('db')
    .query<Row>(SQL, [
      input.status ?? null,
      search ? likePattern(search) : null,
      canListErasedClients(actor),
      PAGE_SIZE + 1,
      input.emirate ?? null,
    ]);
  const truncated = rows.length > PAGE_SIZE;
  const page = truncated ? rows.slice(0, PAGE_SIZE) : rows;
  const clients = toClientRows(page, isoDateIn(now(), PRACTICE_TIME_ZONE));
  await logListed(c.get('db'), clients);
  return c.json(
    ClientListResponse.parse({
      clients,
      note: scheduleScoped ? 'schedule' : null,
      ...(truncated ? { truncated: true } : {}),
    }),
  );
}

export function mountClients(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  // The table with no text to search: the first page, or one status or
  // emirate. Nothing in the address names anybody. A `q` here is refused
  // rather than searched, so no caller can put a name — or an identity number
  // — in a query string, by accident or otherwise: by the time a route could
  // look at it, the proxy has already logged the URL. The search is
  // POST /api/clients/search.
  api.get('/api/clients', async (c) => {
    const refused = await refusedToList(c, now);
    if (refused) return refused;
    if (c.req.query('q') !== undefined) {
      return c.json(
        { error: 'bad_request', code: 'use_search', requestId: c.get('requestId') },
        400,
      );
    }
    const query = Query.safeParse(c.req.query());
    if (!query.success) {
      return c.json({ error: 'bad_request', requestId: c.get('requestId') }, 400);
    }
    return listClients(c, query.data, now);
  });

  // The same table, searched by name or record number, with the text in the
  // request body (operator, 20 October 2026). Everything else is the GET's:
  // the rule, the schedule scope, the page, one audit row per client listed.
  api.post('/api/clients/search', async (c) => {
    const refused = await refusedToList(c, now);
    if (refused) return refused;
    const body = SearchBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return c.json({ error: 'bad_request', requestId: c.get('requestId') }, 400);
    }
    return listClients(c, body.data, now);
  });

  api.post('/api/clients/lookup', async (c) => {
    const actor = c.get('actor');
    const requestId = c.get('requestId');
    if (!canActor(actor, { type: 'client.list' }, {}, now())) {
      await logRefused(c.get('db'), 'client', randomUUID(), null);
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const bodyJson = await c.req.json().catch(() => null);
    const body = LookupBody.safeParse(bodyJson);
    if (!body.success) return c.json({ error: 'bad_request', requestId }, 400);
    const digits = wholeEmiratesIdDigits(body.data.emiratesId);
    if (digits === null) {
      // The shape, not the checksum: a mistyped digit is a search that finds nothing,
      // which is the truth, and not a lecture about a number the practice may not hold.
      return c.json({ error: 'bad_request', code: 'invalid_emirates_id', requestId }, 400);
    }
    // Finance lists the practice by name and record number (the table above) but never
    // searches by identity number: the stated need for holding one at all is verifying
    // the adult who consents for a minor or who is refunded, and finance does neither
    // (docs/SPEC/client-record.md section 2, 00-data-model.md section 11). A role that
    // may not ask is told nothing about whether the number is on file.
    if (!hasRole(actor, 'owner', 'admin', 'lead_practitioner')) {
      await logSearched(c.get('db'));
      return c.json(ClientListResponse.parse({ clients: [], note: 'schedule' }));
    }
    const identityKeys = c.get('identityKeys');
    if (identityKeys === undefined) {
      // No key, no fingerprint. An empty list would read as "no such client", which
      // would be a lie about the practice rather than about the deployment.
      //
      // Deliberately not audited, because it cannot be: the request-context fence
      // rolls back every response of 500 or above (app/api/_middleware/request-context.ts),
      // so an audit row written here would never be committed, and a logSearched call
      // on this branch would read as a promise the code does not keep. Nothing was
      // disclosed on this path either — no client, and no word on whether the number
      // is on file — and the deployment is misconfigured rather than the caller
      // suspect. Recorded in docs/CHANGE-REQUESTS/client-record-02.md rather than
      // papered over by answering 200 to a deployment that cannot answer at all.
      return c.json({ error: 'emirates_id_unavailable', requestId }, 503);
    }
    const { rows } = await c
      .get('db')
      .query<Row>(ID_SQL, [emiratesIdHash(digits, identityKeys), canListErasedClients(actor)]);
    const clients = toClientRows(rows, isoDateIn(now(), PRACTICE_TIME_ZONE));
    if (clients.length === 0) {
      await logSearched(c.get('db'));
    } else {
      await logListed(c.get('db'), clients);
    }
    return c.json(ClientListResponse.parse({ clients, note: null }));
  });
}
