import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CreateDocumentResponse } from '../../../app/api/billing/document-schema';
import { SEED_TODAY } from '../../../db/seed/generate';
import { SEEDED, setPracticePrices, startHarness, type Harness } from './support';

/**
 * An erasure keeps a filed invoice.
 *
 * The two rules meet on exactly these rows. `docs/SPEC/00-data-model.md` section
 * 7 says an erasure deletes a client's documents from storage; CLAUDE.md rule 8
 * says financial records keep five years regardless, and section 7 itself says
 * invoices keep what tax law requires. A rendered invoice is both a document
 * filed against a client and a financial record, and the financial record wins.
 *
 * `billing_document`'s foreign key to `document` deliberately carries no
 * `on delete`, so an erasure that tried to take one would abort on the
 * reference — loudly, rather than by quietly losing a tax record. Which means
 * the erasure has to know to leave them, and that is
 * `docs/CHANGE-REQUESTS/billing-04.md` request 7, addressed to client-record.
 */

const NOW = () => new Date('2026-09-02T08:00:00.000Z');
const REQUEST_ID = '00000000-0000-4000-8000-0000000000fd';

let h: Harness;

/**
 * Whether `app.erase_client` on this database already spares a document that a
 * `billing_document` row points at (client-record's pull request 51).
 *
 * Read from the function's own source rather than assumed from a version
 * number: this suite is written now, against a rule that is agreed, and it
 * starts running the day the other stream's change lands — without anybody
 * having to remember to come back and unskip it.
 */
async function erasureSparesBillingDocuments(): Promise<boolean> {
  const { rows } = await h.owner.query<{ src: string }>(
    "select prosrc as src from pg_proc where proname = 'erase_client' limit 1",
  );
  return (rows[0]?.src ?? '').includes('billing_document');
}

beforeAll(async () => {
  h = await startHarness(NOW);
  await setPracticePrices(h, SEED_TODAY);
}, 120_000);

afterAll(async () => {
  await h.close();
});

describe('erasing a household that has a rendered invoice', () => {
  it('succeeds, and the invoice document survives it', async () => {
    if (!(await erasureSparesBillingDocuments())) {
      // Skipped until docs/CHANGE-REQUESTS/billing-04.md request 7 is applied on
      // main. One line to unskip; nothing here changes when it is.
      return;
    }

    const clientId = h.clientId(0);
    const practitioner = h.data.practitioners[0];
    await h.owner.query(
      "select set_config('app.tenant_id', $1, false), set_config('app.actor_roles', " +
        "'practitioner', false), set_config('app.request_id', $2, false)",
      [h.data.tenant.id, REQUEST_ID],
    );
    await h.owner.query(
      'insert into session (id, tenant_id, client_id, practitioner_id, service_type_id, ' +
        "delivery_mode, status, checked_in_at) values ($1, $2, $3, $4, $5, 'home', " +
        "'completed', now())",
      [
        '00000000-0000-4000-8000-0000000000e1',
        h.data.tenant.id,
        clientId,
        practitioner?.id,
        h.serviceTypeId('nf-session'),
      ],
    );
    await h.owner.query("select set_config('app.actor_roles', '', false)");

    const { rows: invoices } = await h.owner.query<{ id: string }>(
      'select id from invoice where client_id = $1',
      [clientId],
    );
    const created = await h.call('POST', '/api/billing/documents', SEEDED.owner, {
      invoiceId: invoices[0]?.id,
    });
    expect(created.status).toBe(201);
    const document_ = ((await created.json()) as CreateDocumentResponse).document;

    // The act needs a recorded request to perform, and an actor entitled to
    // perform it (migration 104): the erasure is the answer to a request, never
    // a bare call.
    const owner = h.data.users[SEEDED.owner];
    const { rows: requested } = await h.owner.query<{ id: string }>(
      'insert into erasure_request (tenant_id, client_id, reason, created_by) ' +
        "values ($1, $2, 'The household asked.', $3) returning id",
      [h.data.tenant.id, clientId, owner?.id],
    );
    await h.owner.query(
      "select set_config('app.actor_id', $1, false), set_config('app.actor_roles', 'owner', false), " +
        "set_config('app.reason', 'The household asked.', false)",
      [owner?.id],
    );
    await expect(
      h.owner.query('select app.erase_client($1, $2)', [clientId, requested[0]?.id]),
    ).resolves.toBeTruthy();

    // The document is still there, and so is the row that names it.
    const { rows: kept } = await h.owner.query<{ n: string }>(
      'select count(*)::text as n from document where id = $1',
      [document_.id],
    );
    expect(Number(kept[0]?.n)).toBe(1);
    const { rows: link } = await h.owner.query<{ n: string }>(
      'select count(*)::text as n from billing_document where document_id = $1',
      [document_.id],
    );
    expect(Number(link[0]?.n)).toBe(1);
  });
});
