import type { Hono } from 'hono';
import { creditableFor, type CreditableInvoice } from '../../../domain/billing/creditNote';
import type { EntitlementStatus } from '../../../domain/billing/balance';
import { fils } from '../../../domain/shared';
import { logRead } from '../_middleware/audit';
import { scrubReason } from '../_middleware/request-context';
import type { ApiEnv, Db } from '../_middleware/request-context';
import { mayIssueCreditNote } from './access';
import { isUuid } from './ids';
import {
  CreditQuoteResponse,
  CreditRefusal,
  IssueCreditNoteInput,
  IssueCreditNoteResponse,
} from './ledger-schema';

/**
 * A credit note: the second document that corrects an issued invoice, never an
 * edit of the first (CLAUDE.md rule 7; docs/superpowers/specs/
 * 2026-10-22-credit-notes-design.md).
 *
 * `GET  /api/billing/invoices/:id/credit-quote` says what a note would credit
 *   and why not, by asking `creditableFor` — the rule the SQL mirrors — over
 *   the rows the request's own row security lets this caller read.
 * `POST /api/billing/invoices/:id/credit-note` issues it through
 *   `app.issue_credit_note`, the one writer, which asks the same questions
 *   again under its own locks.
 *
 * Both are the owner's, an admin's or finance's. Reading the quote is a fact
 * about a person's invoice, so it writes one `read` row, as every other
 * personal-data read here does.
 */

const INVOICE_SQL =
  'select i.id, i.client_id, i.kind::text as kind, i.package_purchase_id, ' +
  "i.waived_at is not null as waived, c.status::text = 'erased' as erased, " +
  'exists (select 1 from credit_note n where n.tenant_id = i.tenant_id and n.invoice_id = i.id) ' +
  'as already_credited ' +
  'from invoice i join client c on c.id = i.client_id ' +
  'where i.tenant_id = app.current_tenant_id() and i.id = $1';

const LINES_SQL =
  'select id, net_fils, vat_fils from invoice_line ' +
  'where tenant_id = app.current_tenant_id() and invoice_id = $1 order by line_no';

const CREDITS_SQL =
  'select id, status::text as status, allocated_net_fils from entitlement ' +
  'where tenant_id = app.current_tenant_id() ' +
  'and (invoice_id = $1 or (package_purchase_id is not null and package_purchase_id = $2)) ' +
  'order by created_at, id';

const ISSUE_SQL = 'select app.issue_credit_note($1, $2, $3) as id';

const NOTE_SQL =
  "select id, reference, gross_fils, to_char(issued_on, 'YYYY-MM-DD') as issued_on " +
  'from credit_note where tenant_id = app.current_tenant_id() and id = $1';

type InvoiceDbRow = {
  id: string;
  client_id: string;
  kind: CreditableInvoice['kind'];
  package_purchase_id: string | null;
  waived: boolean;
  erased: boolean;
  already_credited: boolean;
};

/** The function's refusal, as it raises it: `credit_note_refused:<refusal>`. */
function refusalOf(error: { message?: string }): CreditRefusal | null {
  const match = /^credit_note_refused:(\w+)$/.exec(error.message ?? '');
  const parsed = CreditRefusal.safeParse(match?.[1]);
  return parsed.success ? parsed.data : null;
}

/**
 * One call of the issuing function inside a savepoint. The whole request is a
 * single transaction, and a statement that fails aborts all of it; rolling
 * back to the savepoint is what lets the route answer a refusal (or retry a
 * deadlock) and still commit or roll back cleanly afterwards.
 */
async function issueOnce(
  db: Db,
  args: unknown[],
): Promise<{ id: string } | { error: { code?: string; message?: string } }> {
  await db.query('savepoint issue_credit_note');
  try {
    const { rows } = await db.query<{ id: string }>(ISSUE_SQL, args);
    await db.query('release savepoint issue_credit_note');
    return { id: String(rows[0]?.id) };
  } catch (error) {
    await db.query('rollback to savepoint issue_credit_note');
    await db.query('release savepoint issue_credit_note');
    return { error: error as { code?: string; message?: string } };
  }
}

export function mountCreditNotes(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  api.get('/api/billing/invoices/:id/credit-quote', async (c) => {
    const actor = c.get('actor');
    const requestId = c.get('requestId');
    if (!mayIssueCreditNote(actor, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const invoiceId = c.req.param('id');
    if (!isUuid(invoiceId)) {
      return c.json({ error: 'bad_request', code: 'invalid_request', requestId }, 400);
    }
    const db = c.get('db');

    const found = await db.query<InvoiceDbRow>(INVOICE_SQL, [invoiceId]);
    const invoice = found.rows[0];
    if (!invoice) {
      return c.json({ error: 'not_found', requestId }, 404);
    }
    const [lines, credits] = await Promise.all([
      db.query<{ id: string; net_fils: number; vat_fils: number }>(LINES_SQL, [invoiceId]),
      db.query<{ id: string; status: EntitlementStatus; allocated_net_fils: number }>(CREDITS_SQL, [
        invoiceId,
        invoice.package_purchase_id,
      ]),
    ]);

    const verdict = creditableFor(
      {
        id: invoice.id,
        kind: invoice.kind,
        waived: invoice.waived,
        alreadyCredited: invoice.already_credited,
        clientErased: invoice.erased,
        lines: lines.rows.map((line) => ({
          id: line.id,
          netFils: fils(line.net_fils),
          vatFils: fils(line.vat_fils),
        })),
      },
      credits.rows.map((credit) => ({
        id: credit.id,
        status: credit.status,
        allocatedNetFils: fils(credit.allocated_net_fils),
      })),
    );

    await logRead(db, 'invoice', invoice.id, invoice.client_id);

    if (!verdict.ok) {
      return c.json(CreditQuoteResponse.parse({ ok: false, refusal: verdict.refusal }));
    }
    const { plan } = verdict;
    return c.json(
      CreditQuoteResponse.parse({
        ok: true,
        plan: {
          netFils: plan.netFils,
          vatFils: plan.vatFils,
          grossFils: plan.grossFils,
          releasedNetFils: plan.releasedNetFils,
          usedCredits: credits.rows.filter((credit) => credit.status === 'consumed').length,
          unusedCredits: credits.rows.filter((credit) => credit.status === 'available').length,
        },
      }),
    );
  });

  api.post('/api/billing/invoices/:id/credit-note', async (c) => {
    const actor = c.get('actor');
    const requestId = c.get('requestId');
    if (!mayIssueCreditNote(actor, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const invoiceId = c.req.param('id');
    if (!isUuid(invoiceId)) {
      return c.json({ error: 'bad_request', code: 'invalid_request', requestId }, 400);
    }
    const body = IssueCreditNoteInput.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return c.json({ error: 'bad_request', code: 'invalid_request', requestId }, 400);
    }
    const db = c.get('db');

    // Why the note was issued belongs in the audit trail, not only in the
    // column: the rows the function writes are stamped with `app.reason`, and
    // the route is the authority on it (docs/SPEC/audit.md section 5).
    await db.query("select set_config('app.reason', $1, true)", [scrubReason(body.data.reason)]);

    const args = [invoiceId, body.data.reason, body.data.idempotencyKey];
    let outcome = await issueOnce(db, args);
    // A deadlock against another writer is rare but possible: the whole call
    // is retried once, and a second one is the caller's to try again later.
    if ('error' in outcome && outcome.error.code === '40P01') {
      outcome = await issueOnce(db, args);
      if ('error' in outcome && outcome.error.code === '40P01') {
        c.header('Retry-After', '2');
        return c.json({ error: 'unavailable', requestId }, 503);
      }
    }

    if ('error' in outcome) {
      const { code } = outcome.error;
      if (code === 'P0001') {
        const refusal = refusalOf(outcome.error);
        if (refusal) {
          return c.json({ error: 'credit_note_refused', refusal, requestId }, 409);
        }
      }
      // 22023: a reason too short, a missing key, a key already used for
      // another invoice. 23505: two parallel calls racing on the same key.
      if (code === '22023' || code === '23505') {
        return c.json({ error: 'bad_request', code: 'invalid_request', requestId }, 400);
      }
      if (code === 'P0002') {
        return c.json({ error: 'not_found', requestId }, 404);
      }
      if (code === '42501') {
        return c.json({ error: 'forbidden', requestId }, 403);
      }
      throw outcome.error;
    }

    const note = await db.query<{
      id: string;
      reference: string;
      gross_fils: number;
      issued_on: string;
    }>(NOTE_SQL, [outcome.id]);
    const row = note.rows[0];
    if (!row) {
      throw new Error('The credit note that was issued could not be read back.');
    }
    // 201 for a retry of the same key as well: it answers with the note the
    // first call wrote, and the caller need not tell the two apart.
    return c.json(
      IssueCreditNoteResponse.parse({
        creditNote: {
          id: row.id,
          reference: row.reference,
          grossFils: row.gross_fils,
          issuedOn: row.issued_on,
        },
      }),
      201,
    );
  });
}
