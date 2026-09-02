import type { Hono } from 'hono';
import { z } from 'zod';
import { ageOn, canActor, hasRole, isoDateIn } from '../../../domain/shared';
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
 */

import { CLIENT_STATUSES as STATUSES, ClientListResponse, type ClientRow } from './schema';

const PRACTICE_TIME_ZONE = 'Asia/Dubai';

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
  'order by c.mrn';

function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, '\\$&')}%`;
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
    const { rows } = await c
      .get('db')
      .query<Row>(SQL, [
        query.data.status ?? null,
        query.data.q ? likePattern(query.data.q) : null,
        hasRole(actor, 'owner', 'lead_practitioner'),
      ]);
    const today = isoDateIn(now(), PRACTICE_TIME_ZONE);
    const clients: ClientRow[] = rows.map((r) => ({
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
    return c.json(ClientListResponse.parse({ clients, note: null }));
  });
}
