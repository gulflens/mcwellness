import type { Hono } from 'hono';
import { z } from 'zod';
import { DEFAULT_SIGNED_URL_TTL_SECONDS } from '../../../domain/shared';
import { logReads } from '../_middleware/audit';
import { auditDocumentRead } from '../_middleware/storage/audit';
import type { ApiEnv, Db } from '../_middleware/request-context';
import {
  clientsFor,
  forReports,
  mayReadHousehold,
  readHousehold,
  type Household,
} from './household';
import { logHouseholdRefusal } from './refused';
import { DocumentLinkResponse, PortalReportsResponse } from './schema';

/**
 * `GET /api/portal/reports` — the household's own reports, and
 * `GET /api/portal/reports/:documentId/link`, which opens one
 * (docs/SPEC/reports-v1.md section 7.3; the sixth screen of
 * docs/SPEC/client-portal.md section 3).
 *
 * **The same shape the money screen keeps**, deliberately: a list, and a
 * short-lived signed link fetched when a button is pressed and never rendered
 * into the page in advance. A link that sits in the markup is a link that ends
 * up in a screenshot, a bookmark or a log.
 *
 * **What the household sees is decided in the database, not here.** The row
 * policies on `report` (db/policies/reports/reports.sql) admit a contact to
 * issued reports for their own client, and to a superseded version only where
 * the practice actually sent them one — never a draft, never another
 * household's. This route asks for their own clients' rows and shows what
 * comes back.
 *
 * **A legal guardian, or the person themselves once they are an adult.** The
 * first build showed a report to every contact on the record, including a
 * young person's own login, and named that as a decision for the operator
 * rather than one for the build (default 4 of pull request 83). She took it
 * the other way on 2026-09-06: a report is a practitioner's written summary of
 * a person, a guardian is who receives it and talks a child through it, and
 * the portal is not where a child meets one alone. `forReports` narrows the
 * household to the people this person may read about, and
 * `app.actor_may_read_reports_of` (migration 955) refuses the rows underneath,
 * which is the boundary — this is the same rule where the screen can see it.
 * The consent and the `can_receive_reports` flag still govern what the
 * practice *sends*, which is a different question.
 */

const DocumentParams = z.object({ documentId: z.uuid() });

const REPORTS_SQL =
  'select r.id, r.client_id, r.kind::text as kind, r.status::text as status, r.reference, ' +
  "to_char(r.issued_on, 'YYYY-MM-DD') as issued_on, " +
  "to_char(r.coverage_from, 'YYYY-MM-DD') as coverage_from, " +
  "to_char(r.coverage_to, 'YYYY-MM-DD') as coverage_to, " +
  'r.version, r.document_id ' +
  'from report r ' +
  'where r.tenant_id = app.current_tenant_id() and r.client_id = any($1::uuid[]) ' +
  'order by r.issued_on desc nulls last, r.created_at desc, r.id';

/** The document, if it belongs to a report of one of this household's clients. */
const DOCUMENT_SQL =
  'select r.document_id, r.client_id, d.storage_key from report r ' +
  'join document d on d.id = r.document_id and d.tenant_id = r.tenant_id ' +
  'where r.tenant_id = app.current_tenant_id() and r.document_id = $1 ' +
  'and r.client_id = any($2::uuid[])';

type PortalReportRow = {
  id: string;
  client_id: string;
  kind: 'session' | 'progress';
  status: 'draft' | 'issued' | 'superseded';
  reference: string | null;
  issued_on: string | null;
  coverage_from: string | null;
  coverage_to: string | null;
  version: number;
  document_id: string | null;
};

/** The reports this household may be shown, for every client on its record. */
export async function householdReports(db: Db, household: Household): Promise<PortalReportRow[]> {
  const clientIds = household.clients.map((client) => client.id);
  if (clientIds.length === 0) return [];
  const found = await db.query<PortalReportRow>(REPORTS_SQL, [clientIds]);
  return found.rows;
}

export function mountPortalReports(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  api.get('/api/portal/reports', async (c) => {
    const requestId = c.get('requestId');
    const db = c.get('db');
    const actor = c.get('actor');
    const whole = await readHousehold(db, actor, now());
    if (whole === null) return c.json({ error: 'forbidden', requestId }, 403);
    if (!mayReadHousehold(actor, whole, now())) {
      await logHouseholdRefusal(db, whole);
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const household = forReports(whole);

    const rows = await householdReports(db, household);
    // Opening the screen is a `list`, the same act the practice's own tab
    // records (docs/SPEC/reports-v1.md section 8).
    await logReads(
      db,
      'report',
      rows.map((row) => ({ id: row.id, clientId: row.client_id })),
      'list',
    );

    return c.json(
      PortalReportsResponse.parse({
        clients: clientsFor(household),
        reports: rows.map((row) => ({
          id: row.id,
          clientId: row.client_id,
          kind: row.kind,
          status: row.status,
          reference: row.reference,
          issuedOn: row.issued_on,
          coverageFrom: row.coverage_from,
          coverageTo: row.coverage_to,
          version: row.version,
          documentId: row.document_id,
        })),
      }),
    );
  });

  api.get('/api/portal/reports/:documentId/link', async (c) => {
    const requestId = c.get('requestId');
    const db = c.get('db');
    const params = DocumentParams.safeParse(c.req.param());
    if (!params.success) return c.json({ error: 'bad_request', requestId }, 400);

    const whole = await readHousehold(db, c.get('actor'), now());
    if (whole === null) return c.json({ error: 'forbidden', requestId }, 403);
    const household = forReports(whole);

    const storage = c.get('storage');
    if (!storage) return c.json({ error: 'storage_unavailable', requestId }, 503);

    const clientIds = household.clients.map((client) => client.id);
    if (clientIds.length === 0) return c.json({ error: 'not_found', requestId }, 404);

    const found = await db.query<{
      document_id: string;
      client_id: string;
      storage_key: string;
    }>(DOCUMENT_SQL, [params.data.documentId, clientIds]);
    const row = found.rows[0];
    if (!row) {
      // Another household's, a draft's, or a version this household was never
      // sent. A 404 either way: a 403 would confirm the document exists.
      return c.json({ error: 'not_found', requestId }, 404);
    }
    if (!(await storage.exists(row.storage_key))) {
      // The row says a document was filed and the store has no bytes under
      // that key. Re-rendering is the practice's route to do, never the
      // household's (app/api/reports/get.ts): here it is simply absent.
      return c.json({ error: 'not_found', requestId }, 404);
    }

    await auditDocumentRead(db, { id: row.document_id, clientId: row.client_id });
    const url = await storage.getSignedUrl(row.storage_key, DEFAULT_SIGNED_URL_TTL_SECONDS);
    return c.json(
      DocumentLinkResponse.parse({ url, expiresInSeconds: DEFAULT_SIGNED_URL_TTL_SECONDS }),
    );
  });
}
