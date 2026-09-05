import { randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import { z } from 'zod';
import { canActor, DEFAULT_SIGNED_URL_TTL_SECONDS } from '../../../domain/shared';
import { logAction, logReads } from '../_middleware/audit';
import { auditDocumentRead } from '../_middleware/storage/audit';
import type { ApiEnv, Db } from '../_middleware/request-context';
import { clientsFor, mayReadHousehold, readHousehold, type Household } from './household';
import { logHouseholdRefusal, logPortalRefusal } from './refused';
import {
  AgreementsResponse,
  CreateRequestInput,
  RequestResponse,
  WordingResponse,
  type Agreement,
} from './schema';

/**
 * `GET /api/portal/agreements` — what each person on the record agreed to, and
 * to what exact words (docs/SPEC/client-portal.md section 3.5) — with
 * `GET /api/portal/consents/:consentId/wording` to open the wording itself and
 * `POST /api/portal/requests` to ask the practice for something.
 *
 * **Nothing on this screen withdraws or erases anything.** Both asks write a
 * `portal_request` row and stop. The practice then does the thing on the
 * record's own screens, where a withdrawal is a consent write with a reason
 * and an erasure runs `app.erase_client`. That separation is the whole design:
 * the portal is where a family speaks, not where an irreversible act is
 * triggered by a tap at eleven at night.
 *
 * **The wording is a link, never a payload.** The text comes back as a signed
 * URL good for five minutes, for the reason docs/SEAMS.md gives — bytes are
 * the store's to hand out — and it keeps the words out of the trail:
 * `auditDocumentRead` records that this person opened this document, and what
 * it said is never a value in an audit row.
 */

const ConsentParams = z.object({ consentId: z.uuid() });

const AGREEMENTS_SQL =
  'select cs.id, cs.client_id, cs.purpose::text as purpose, cs.status::text as status, ' +
  'cs.given_at, cs.withdrawn_at, cs.text_document_id, ' +
  'ct.relationship::text as given_by_relationship, ' +
  // Whether the words have moved on. Asked of migration 703's function, not of
  // a join here: the newer wording is a row this household may not read, so a
  // plain query would answer "no" every time by the read policy rather than by
  // the facts.
  'app.portal_wording_is_superseded(cs.text_document_id) as newer_wording_exists ' +
  'from consent cs ' +
  'join contact ct on ct.id = cs.given_by_contact_id and ct.tenant_id = cs.tenant_id ' +
  'where cs.tenant_id = app.current_tenant_id() and cs.client_id = any($1::uuid[]) ' +
  'order by cs.client_id, cs.given_at desc, cs.id';

const OPEN_REQUESTS_SQL =
  'select kind::text as kind, client_id, consent_id from portal_request ' +
  "where tenant_id = app.current_tenant_id() and status = 'open' " +
  'and client_id = any($1::uuid[])';

type AgreementRow = {
  id: string;
  client_id: string;
  purpose: string;
  status: string;
  given_at: Date;
  withdrawn_at: Date | null;
  text_document_id: string | null;
  given_by_relationship: string;
  newer_wording_exists: boolean;
};

async function agreementsFor(db: Db, household: Household): Promise<AgreementsResponse> {
  const clientIds = household.clients.map((client) => client.id);
  if (clientIds.length === 0) {
    return { clients: clientsFor(household), agreements: [], erasureRequested: [] };
  }

  const [rows, open] = await Promise.all([
    db.query<AgreementRow>(AGREEMENTS_SQL, [clientIds]),
    db.query<{ kind: string; client_id: string; consent_id: string | null }>(OPEN_REQUESTS_SQL, [
      clientIds,
    ]),
  ]);

  const withdrawalAsked = new Set(
    open.rows
      .filter((row) => row.kind === 'consent_withdrawal' && row.consent_id !== null)
      .map((row) => row.consent_id as string),
  );

  const agreements: Agreement[] = rows.rows.map((row) => ({
    id: row.id,
    clientId: row.client_id,
    purpose: row.purpose,
    status: row.status,
    givenAt: row.given_at.toISOString(),
    withdrawnAt: row.withdrawn_at?.toISOString() ?? null,
    givenByRelationship: row.given_by_relationship,
    wordingDocumentId: row.text_document_id,
    newerWordingExists: row.newer_wording_exists,
    requestedWithdrawal: withdrawalAsked.has(row.id),
  }));

  return {
    clients: clientsFor(household),
    agreements,
    erasureRequested: [
      ...new Set(open.rows.filter((row) => row.kind === 'erasure').map((row) => row.client_id)),
    ],
  };
}

export function mountPortalAgreements(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  api.get('/api/portal/agreements', async (c) => {
    const requestId = c.get('requestId');
    const db = c.get('db');
    const actor = c.get('actor');
    const household = await readHousehold(db, actor, now());
    if (household === null) return c.json({ error: 'forbidden', requestId }, 403);
    // Section 5, rule 1: `client.read` for every client this answer is about,
    // with the ids the database resolved and never one a request claimed. The
    // policies refuse the rows beneath and `readHousehold` has already turned
    // away anybody who is not a contact; this is the rule stated where the
    // route exercises it, and a refusal on the trail if the three disagree.
    if (!mayReadHousehold(actor, household, now())) {
      await logHouseholdRefusal(db, household);
      return c.json({ error: 'forbidden', requestId }, 403);
    }

    const answer = await agreementsFor(db, household);
    await logReads(
      db,
      'consent',
      answer.agreements.map((agreement) => ({
        id: agreement.id,
        clientId: agreement.clientId,
      })),
      'list',
    );
    return c.json(AgreementsResponse.parse(answer));
  });

  api.get('/api/portal/consents/:consentId/wording', async (c) => {
    const requestId = c.get('requestId');
    const db = c.get('db');
    const params = ConsentParams.safeParse(c.req.param());
    if (!params.success) return c.json({ error: 'bad_request', requestId }, 400);

    const household = await readHousehold(db, c.get('actor'), now());
    if (household === null) return c.json({ error: 'forbidden', requestId }, 403);
    const storage = c.get('storage');
    if (!storage) return c.json({ error: 'storage_unavailable', requestId }, 503);

    const clientIds = household.clients.map((client) => client.id);
    const found = clientIds.length
      ? await db.query<{
          document_id: string;
          purpose: string;
          locale: 'en' | 'ar';
          version: string;
          status: string;
          mime_type: string;
          storage_key: string;
        }>(
          'select d.id as document_id, d.purpose::text as purpose, d.locale::text as locale, ' +
            'd.version, d.status::text as status, d.mime_type, d.storage_key ' +
            'from consent cs join document d on d.id = cs.text_document_id ' +
            'where cs.tenant_id = app.current_tenant_id() and cs.id = $1 ' +
            'and cs.client_id = any($2::uuid[])',
          [params.data.consentId, clientIds],
        )
      : { rows: [] };
    const row = found.rows[0];
    if (!row) return c.json({ error: 'not_found', requestId }, 404);

    // A wording belongs to no client: null is the honest answer in the audit
    // row rather than an invented one (app/api/clients/consent-wording.ts).
    await auditDocumentRead(db, { id: row.document_id, clientId: null });
    const url = await storage.getSignedUrl(row.storage_key, DEFAULT_SIGNED_URL_TTL_SECONDS);

    return c.json(
      WordingResponse.parse({
        id: row.document_id,
        purpose: row.purpose,
        locale: row.locale,
        version: row.version,
        status: row.status,
        mimeType: row.mime_type,
        textUrl: url,
        expiresInSeconds: DEFAULT_SIGNED_URL_TTL_SECONDS,
      }),
    );
  });

  api.post('/api/portal/requests', async (c) => {
    const requestId = c.get('requestId');
    const db = c.get('db');
    const actor = c.get('actor');
    const household = await readHousehold(db, actor, now());
    if (household === null) return c.json({ error: 'forbidden', requestId }, 403);

    const body = CreateRequestInput.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      const field = body.error.issues[0]?.path[0];
      return c.json({ error: 'bad_request', code: String(field ?? 'invalid'), requestId }, 400);
    }
    const { clientId, kind, consentId, note } = body.data;

    const client = household.clients.find((row) => row.id === clientId) ?? null;
    if (client === null) {
      // Not this household's. The id was never in the set the database
      // resolved, so no row was reached and nothing is written to the trail.
      return c.json({ error: 'not_found', requestId }, 404);
    }
    const clientIds = household.clients.map((row) => row.id);
    if (!canActor(actor, { type: 'portal.request.write', clientId }, { clientIds }, now())) {
      await logPortalRefusal(db, 'portal_request', randomUUID(), clientId);
      return c.json({ error: 'forbidden', requestId }, 403);
    }

    if (consentId !== null) {
      // The consent has to be this client's own: a withdrawal naming another
      // household's consent would otherwise be recorded against this one.
      const consent = await db.query<{ id: string }>(
        'select id from consent where tenant_id = app.current_tenant_id() ' +
          'and id = $1 and client_id = $2',
        [consentId, clientId],
      );
      if (consent.rowCount === 0) return c.json({ error: 'not_found', requestId }, 404);
    }

    const id = randomUUID();
    await db.query(
      'insert into portal_request (id, tenant_id, client_id, contact_id, kind, consent_id, ' +
        'note, created_by) values ($1, $2, $3, $4, $5::portal_request_kind, $6, $7, $8)',
      [id, actor.tenantId, clientId, client.contactId, kind, consentId, note, actor.userId],
    );
    // The row trigger has recorded the insert. This says what class of ask it
    // was, with ids alone: the note itself is a household's own words and is
    // on the row, where the practice reads it, and not in the trail as well.
    await logAction(
      db,
      'portal.request.made',
      { type: 'portal_request', id, clientId },
      { kind, contactId: client.contactId },
    );

    const saved = await db.query<{
      id: string;
      client_id: string;
      kind: string;
      consent_id: string | null;
      note: string | null;
      status: string;
      created_at: Date;
      handled_at: Date | null;
    }>(
      'select id, client_id, kind::text as kind, consent_id, note, status::text as status, ' +
        'created_at, handled_at from portal_request where id = $1',
      [id],
    );
    const row = saved.rows[0];
    if (!row) throw new Error('The request was written and could not be read back.');

    return c.json(
      RequestResponse.parse({
        request: {
          id: row.id,
          clientId: row.client_id,
          kind: row.kind,
          consentId: row.consent_id,
          note: row.note,
          status: row.status,
          createdAt: row.created_at.toISOString(),
          handledAt: row.handled_at?.toISOString() ?? null,
        },
      }),
      201,
    );
  });
}
