import type { Hono } from 'hono';
import { z } from 'zod';
import { ageOn, canActor, hasRole, isoDateIn } from '../../../domain/shared';
import { normaliseEmiratesId } from '../../../domain/shared/emirates-id';
import { emiratesIdHash } from '../../../domain/shared/identity';
import { logReads } from '../_middleware/audit';
import { cleanText } from '../_middleware/text';
import type { ApiEnv } from '../_middleware/request-context';
import { logRefused } from './refused';

/**
 * GET /api/clients: the admin console's client table. The rule is checked here
 * (canActor) and enforced beneath by row security: the query runs as the
 * signed-in person, so the database limits the rows to their practice. Every
 * listed client is recorded as a read. Seeded by the trunk in PR 5; owned by
 * the client-record worktree from there (docs/SPEC/OWNERSHIP.md).
 *
 * `q` shaped like an Emirates ID (15 digits, starting 784, hyphens allowed —
 * client-record.md section 4.1) is never matched against a name or an MRN:
 * it is hashed with the same keyed HMAC db/seed/apply.ts and
 * emirates-id-capture.ts use and looked up by that fingerprint instead
 * (00-data-model.md section 1). The identity number itself never reaches a
 * log, an audit payload or this file's own SQL text — only its hash does.
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

const SQL =
  'select c.id, c.mrn, c.given_name, c.family_name, c.given_name_ar, c.family_name_ar, ' +
  'c.date_of_birth, c.status, ct.relationship as contact_relationship, ct.phone as contact_phone, ' +
  'l.emirate ' +
  'from client c ' +
  'left join contact ct on ct.id = c.primary_contact_id ' +
  'left join location l on l.id = c.primary_location_id ' +
  'where ($1::client_status is null or c.status = $1::client_status) ' +
  // Erased records stay with the lead practitioner (client-record.md section 2).
  "and ($3::boolean or c.status <> 'erased') " +
  "and ($2::text is null or c.mrn ilike $2 escape '\\' or c.given_name ilike $2 escape '\\' " +
  "or c.family_name ilike $2 escape '\\' or coalesce(c.given_name_ar, '') ilike $2 escape '\\' " +
  "or coalesce(c.family_name_ar, '') ilike $2 escape '\\') " +
  // One row past the page size, so the route can tell whether more matched
  // without a second, count-only query.
  'order by c.mrn limit $4';

// The hash lookup: at most one contact per tenant can carry a given
// fingerprint (contact's own unique (tenant_id, emirates_id_hash)), so this
// finds at most one client — never a text match against name or MRN columns.
const ID_SQL =
  'select c.id, c.mrn, c.given_name, c.family_name, c.given_name_ar, c.family_name_ar, ' +
  'c.date_of_birth, c.status, ct.relationship as contact_relationship, ct.phone as contact_phone, ' +
  'l.emirate ' +
  'from client c ' +
  'join contact idc on idc.client_id = c.id and idc.emirates_id_hash = $2 ' +
  'left join contact ct on ct.id = c.primary_contact_id ' +
  'left join location l on l.id = c.primary_location_id ' +
  'where ($1::client_status is null or c.status = $1::client_status) ' +
  "and ($3::boolean or c.status <> 'erased') " +
  'order by c.mrn limit $4';

function escapeLike(q: string): string {
  return q.replace(/[\\%_]/g, '\\$&');
}

function likePattern(escaped: string): string {
  return `%${escaped}%`;
}

/** The fifteen normalised digits when `q` is shaped like an Emirates ID; null otherwise. */
function emiratesIdShapeOf(q: string): string | null {
  try {
    return normaliseEmiratesId(q);
  } catch {
    return null;
  }
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
    // A query shaped like an Emirates ID is never text-searched: it is hashed and looked
    // up by fingerprint instead (see the module comment). Without identityKeys configured
    // (a deployment that has not set IDENTITY_KEY) there is no key to hash with, so this
    // falls through to the ordinary text search below, same as any other query — a search
    // that finds nothing among names and record numbers rather than a route that errors.
    const identityKeys = c.get('identityKeys');
    const emiratesIdDigits = query.data.q ? emiratesIdShapeOf(query.data.q) : null;

    // Below the minimum, the term is dropped rather than searched (see
    // MIN_SEARCH_LENGTH above): the unfiltered first page comes back, same as
    // when `q` is absent. Measured on the escaped form, not the raw one: a
    // lone wildcard character (`%` or `_`) escapes to two characters and is
    // never a sweep risk in the first place — escaped, it matches only that
    // literal punctuation, not "everything" — so it still searches.
    const escaped = query.data.q ? escapeLike(query.data.q) : null;
    const search = escaped && escaped.length >= MIN_SEARCH_LENGTH ? escaped : null;
    const { rows } =
      emiratesIdDigits !== null && identityKeys !== undefined
        ? await c
            .get('db')
            .query<Row>(ID_SQL, [
              query.data.status ?? null,
              emiratesIdHash(emiratesIdDigits, identityKeys),
              hasRole(actor, 'owner', 'lead_practitioner'),
              PAGE_SIZE + 1,
            ])
        : await c
            .get('db')
            .query<Row>(SQL, [
              query.data.status ?? null,
              search ? likePattern(search) : null,
              hasRole(actor, 'owner', 'lead_practitioner'),
              PAGE_SIZE + 1,
            ]);
    const truncated = rows.length > PAGE_SIZE;
    const page = truncated ? rows.slice(0, PAGE_SIZE) : rows;
    const today = isoDateIn(now(), PRACTICE_TIME_ZONE);
    const clients: ClientRow[] = page.map((r) => ({
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
    await logReads(
      c.get('db'),
      'client',
      clients.map((client) => ({ id: client.id, clientId: client.id })),
      'list',
    );
    return c.json(
      ClientListResponse.parse({ clients, note: null, ...(truncated ? { truncated: true } : {}) }),
    );
  });
}
