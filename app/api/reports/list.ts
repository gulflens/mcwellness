import type { Hono } from 'hono';
import { z } from 'zod';
import { DELIVERY_CHANNELS, REPORT_KINDS, REPORT_LOCALES } from '../../../domain/reports';
import { logReads } from '../_middleware/audit';
import type { ApiEnv } from '../_middleware/request-context';
import { mayListReports } from './access';
import { contactClientIds } from './household';
import { ReportListResponse, SchemaResponse } from './schema';
import { asRow, readReports } from './source';

/**
 * `GET /api/reports?clientId=` — a client's reports (docs/SPEC/reports-v1.md
 * sections 4.1 and 7.1), and `GET /api/reports/schema`, which is what a screen
 * builds its form from so the two can never disagree about what a report body
 * carries.
 *
 * **Opening the tab is a `list`** (section 8): one row per report on the
 * trail, so a reader of the timeline sees that somebody looked at a
 * household's reports and when.
 *
 * **Superseded versions are not filtered out here.** They sit beneath the ones
 * that replaced them on the screen, which is the tab's own arrangement; the
 * database is what decides which of them a household may see at all
 * (db/policies/reports/reports.sql), and a row this actor may not read is
 * simply not in the answer.
 */

const ListQuery = z.object({ clientId: z.uuid() });

export function mountReportList(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  api.get('/api/reports/schema', (c) =>
    c.json(
      SchemaResponse.parse({
        kinds: [...REPORT_KINDS],
        locales: [...REPORT_LOCALES],
        channels: [...DELIVERY_CHANNELS],
        // The fields only a person writes, per kind. The figures are gathered
        // and are not in this list, because a figure a practitioner could
        // retype is a figure that can disagree with the record (section 4.2).
        fields: {
          session: ['note', 'beforeNextVisit'],
          progress: ['summary', 'suggestion', 'goals.movement'],
        },
      }),
    ),
  );

  api.get('/api/reports', async (c) => {
    const requestId = c.get('requestId');
    const query = ListQuery.safeParse({ clientId: c.req.query('clientId') });
    if (!query.success) {
      return c.json({ error: 'bad_request', code: 'invalid_request', requestId }, 400);
    }
    const actor = c.get('actor');
    const db = c.get('db');

    // The clients a household may be asked about are the database's to
    // resolve, never a request's to claim.
    const clientIds = await contactClientIds(db);
    if (!mayListReports(actor, query.data.clientId, { clientIds }, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }

    const records = await readReports(db, [query.data.clientId]);
    await logReads(
      db,
      'report',
      records.map((record) => ({ id: record.id, clientId: record.client_id })),
      'list',
    );
    return c.json(ReportListResponse.parse({ reports: records.map(asRow) }));
  });
}
