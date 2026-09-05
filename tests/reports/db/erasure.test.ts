import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DeliverResponse, DraftResponse } from '../../../app/api/reports/schema';
import { progressBody, SEEDED, startHarness, type Harness } from './support';

/**
 * An erasure leaves no report bytes and no narrative
 * (docs/SPEC/reports-v1.md section 11, migration `107_erase_report.sql`).
 *
 * This is the whole of decision 2: a report is **deleted**, not kept. An
 * invoice stays five years because UAE tax law requires it of the business and
 * does not ask the customer; nothing requires the practice to keep a report,
 * and a report is the most personal document this platform produces.
 *
 * Run through the API the server actually builds and against the real local
 * document store, so what is asserted is what a household would actually be
 * left with.
 */

const NOW = () => new Date('2026-09-06T08:00:00.000Z');

let h: Harness;

beforeAll(async () => {
  h = await startHarness(NOW);
}, 120_000);

afterAll(async () => {
  await h.close();
});

/**
 * A seeded client with a live participation consent and a contact, which is
 * what section 7.2 requires before a report may be sent at all. Chosen from
 * the record rather than by index: the seed gives some clients no consent yet,
 * which is an ordinary state of a lead.
 */
async function sendableClient(skip: readonly string[] = []): Promise<string> {
  const { rows } = await h.owner.query<{ client_id: string }>(
    'select c.client_id from consent c ' +
      'join contact ct on ct.client_id = c.client_id ' +
      "where c.purpose = 'participation' and c.status = 'active' " +
      'and not (c.client_id = any($1::uuid[])) ' +
      'group by c.client_id order by c.client_id limit 1',
    [skip],
  );
  const id = rows[0]?.client_id;
  if (!id) throw new Error('No seeded client can be sent a report.');
  return id;
}

describe('erasing a household that has reports', () => {
  let erased = '';

  it('takes the PDF, empties the narrative and removes every delivery', async () => {
    const clientId = await sendableClient();
    erased = clientId;

    const draft = await h.call('POST', '/api/reports/draft', SEEDED.owner, {
      clientId,
      kind: 'progress',
      coverageFrom: '2026-06-01',
      coverageTo: '2026-09-01',
      content: progressBody({
        summary: 'Sleeping longer and settling faster across the stretch.',
        suggestion: 'Three more sessions, then a repeat brain map.',
      }),
    });
    expect(draft.status).toBe(201);
    const reportId = ((await draft.json()) as DraftResponse).report.id;

    const issue = await h.call('POST', `/api/reports/${reportId}/issue`, SEEDED.owner, {
      practitionerId: h.practitionerIdOf(SEEDED.owner),
    });
    expect(issue.status).toBe(201);

    const contact = await h.owner.query<{ id: string }>(
      'select id from contact where client_id = $1 order by id limit 1',
      [clientId],
    );
    const contactId = contact.rows[0]?.id;
    if (!contactId) throw new Error('That client has no contact.');
    await h.owner.query(
      'update contact set can_receive_reports = true, whatsapp_opt_in = true where id = $1',
      [contactId],
    );
    const sent = await h.call('POST', `/api/reports/${reportId}/deliver`, SEEDED.owner, {
      contactId,
      channel: 'whatsapp',
    });
    expect(sent.status).toBe(201);
    expect(((await sent.json()) as DeliverResponse).delivered).toBe(false);

    const before = await h.owner.query<{
      document_id: string;
      storage_key: string;
      summary: string;
    }>(
      "select r.document_id, d.storage_key, r.content->>'summary' as summary " +
        'from report r join document d on d.id = r.document_id where r.id = $1',
      [reportId],
    );
    const filed = before.rows[0];
    if (!filed) throw new Error('The report was not filed.');
    expect(filed.summary).toContain('Sleeping longer');
    expect(await h.storage.exists(filed.storage_key)).toBe(true);

    // The erasure itself, through app.erase_client as the record's own route
    // calls it. The request row is what the function attaches its summary to.
    const request = await h.owner.query<{ id: string }>(
      'insert into erasure_request (tenant_id, client_id, reason) ' +
        "values ($1, $2, 'The household asked.') returning id",
      [h.data.tenant.id, clientId],
    );
    const requestId = request.rows[0]?.id;
    if (!requestId) throw new Error('The erasure request was not written.');

    await h.owner.query(
      "select set_config('app.tenant_id', $1, false), set_config('app.actor_roles', 'owner', false)",
      [h.data.tenant.id],
    );
    const summary = await h.owner.query<{ summary: Record<string, unknown> }>(
      'select app.erase_client($1, $2) as summary',
      [clientId, requestId],
    );
    const counts = summary.rows[0]?.summary;
    expect(counts?.reportsCleared).toBe(1);
    expect(counts?.reportDeliveriesDeleted).toBe(1);

    // The document row is gone, and its key is on the worklist the sweep
    // reads: the bytes leave through the storage seam after the commit, never
    // from inside SQL (docs/SEAMS.md).
    const document_ = await h.owner.query<{ n: string }>(
      'select count(*)::text as n from document where id = $1',
      [filed.document_id],
    );
    expect(Number(document_.rows[0]?.n)).toBe(0);
    const pending = await h.owner.query<{ keys: { storageKey: string }[] }>(
      'select storage_keys_pending as keys from erasure_request where id = $1',
      [requestId],
    );
    expect(pending.rows[0]?.keys.map((entry) => entry.storageKey)).toContain(filed.storage_key);

    // The narrative is gone from the row, and the row itself stays, saying a
    // report once existed and by whom.
    const after = await h.owner.query<{
      content: Record<string, unknown>;
      document_id: string | null;
      reference: string;
      signed_by_name: string;
      status: string;
    }>('select content, document_id, reference, signed_by_name, status from report where id = $1', [
      reportId,
    ]);
    const row = after.rows[0];
    if (!row) throw new Error('The report row should still be there.');
    expect(row.content).toEqual({});
    expect(row.document_id).toBeNull();
    expect(row.reference).toMatch(/^RPT-/);
    expect(row.signed_by_name).toBeTruthy();
    expect(row.status).toBe('issued');

    // And no record of who was sent what.
    const deliveries = await h.owner.query<{ n: string }>(
      'select count(*)::text as n from report_delivery where report_id = $1',
      [reportId],
    );
    expect(Number(deliveries.rows[0]?.n)).toBe(0);
  });

  it('erases a household with no reports at all without complaint', async () => {
    const clientId = await sendableClient([erased]);
    await h.owner.query(
      "select set_config('app.tenant_id', $1, false), " +
        "set_config('app.actor_roles', 'owner', false)",
      [h.data.tenant.id],
    );
    const request = await h.owner.query<{ id: string }>(
      'insert into erasure_request (tenant_id, client_id, reason) ' +
        "values ($1, $2, 'Nothing to erase.') returning id",
      [h.data.tenant.id, clientId],
    );
    const summary = await h.owner.query<{ summary: Record<string, unknown> }>(
      'select app.erase_client($1, $2) as summary',
      [clientId, request.rows[0]?.id],
    );
    expect(summary.rows[0]?.summary.reportsCleared).toBe(0);
    expect(summary.rows[0]?.summary.reportDeliveriesDeleted).toBe(0);
  });
});
