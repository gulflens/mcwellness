import type { Hono } from 'hono';
import { ageing, openItems, statementLines, type LedgerEntry } from '../../../domain/billing';
import { renderDocument } from '../../../domain/billing/document';
import { isoDateIn } from '../../../domain/shared';
import { logRead } from '../_middleware/audit';
import type { ApiEnv } from '../_middleware/request-context';
import { mayReadInvoices } from './access';
import { latestSupplier, practiceLogo } from './document-source';
import { documentFonts } from './fonts';
import { isUuid } from './ids';
import { ledgerEntry, type LedgerDbRow } from './ledger-entries';
import { StatementQuery } from './ledger-schema';

/**
 * `GET /api/billing/clients/:id/statement.pdf?from=&to=` — a household's
 * statement of account (docs/superpowers/specs/2026-10-23-debtors-design.md).
 *
 * Made on request and not filed: the bytes are streamed and nothing is stored,
 * so the household's language is read from the client's row now and the
 * balances are the ledger's as it stands. The sums are `domain/billing/ageing`'s
 * (`statementLines`, and the ageing as at the last day of the period); this
 * route reads, maps and renders.
 *
 * An erased client, one this caller cannot see and one that does not exist are
 * the same answer: 404. Reading a household's account is an access, so it
 * writes one audited read for that client before the bytes leave. The file name
 * carries the record number and the end of the period, never a name.
 */

const PRACTICE_TIME_ZONE = 'Asia/Dubai';

const CLIENT_SQL =
  "select c.mrn, c.given_name || ' ' || c.family_name as name, c.preferred_locale::text as locale " +
  'from client c where c.tenant_id = app.current_tenant_id() and c.id = $1 ' +
  "and c.status <> 'erased'";

const LEDGER_SQL =
  'select l.entry_kind, l.source_id, l.reference, ' +
  "to_char(l.occurred_on, 'YYYY-MM-DD') as occurred_on, l.amount_fils, " +
  'coalesce(p.invoice_id, n.invoice_id) as invoice_id ' +
  'from app.billing_ledger l ' +
  "left join payment p on p.tenant_id = l.tenant_id and l.entry_kind = 'payment' " +
  '  and p.id = l.source_id ' +
  "left join credit_note n on n.tenant_id = l.tenant_id and l.entry_kind = 'credit' " +
  '  and n.id = l.source_id ' +
  'where l.tenant_id = app.current_tenant_id() and l.client_id = $1 and l.occurred_on <= $2::date';

/** The first day of the month two months before the one `today` is in. */
function defaultFrom(today: string): string {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7)) - 2;
  const wrapped = month < 1 ? month + 12 : month;
  const shifted = month < 1 ? year - 1 : year;
  return `${String(shifted).padStart(4, '0')}-${String(wrapped).padStart(2, '0')}-01`;
}

export function mountStatement(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  api.get('/api/billing/clients/:id/statement.pdf', async (c) => {
    const requestId = c.get('requestId');
    if (!mayReadInvoices(c.get('actor'), now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const clientId = c.req.param('id');
    const query = StatementQuery.safeParse({ from: c.req.query('from'), to: c.req.query('to') });
    if (!isUuid(clientId) || !query.success) {
      return c.json({ error: 'bad_request', code: 'invalid_request', requestId }, 400);
    }
    const today = isoDateIn(now(), PRACTICE_TIME_ZONE);
    const from = query.data.from ?? defaultFrom(today);
    const to = query.data.to ?? today;
    if (from > to) {
      return c.json({ error: 'bad_request', code: 'invalid_period', requestId }, 400);
    }

    const db = c.get('db');
    const found = await db.query<{ mrn: string; name: string; locale: 'en' | 'ar' }>(CLIENT_SQL, [
      clientId,
    ]);
    const client = found.rows[0];
    if (!client) return c.json({ error: 'not_found', requestId }, 404);
    // A household that has never been invoiced has no practice details to print
    // and nothing to state.
    const supplier = await latestSupplier(db, clientId);
    if (!supplier) return c.json({ error: 'not_found', requestId }, 404);

    const { rows } = await db.query<LedgerDbRow>(LEDGER_SQL, [clientId, to]);
    const entries = rows.flatMap((row): LedgerEntry[] => {
      const entry = ledgerEntry(row);
      return entry ? [entry] : [];
    });
    const statement = statementLines(entries, from, to);

    // Before the bytes leave, every time: this is the read that is worth recording.
    await logRead(db, 'billing_ledger', clientId, clientId);

    const storage = c.get('storage');
    let logo = null;
    if (storage) {
      try {
        logo = await practiceLogo(db, storage);
      } catch {
        // Nothing is filed here, so a store that cannot be reached costs the
        // page its mark rather than the household its statement. Request id only.
        console.error(JSON.stringify({ requestId, name: 'StatementLogoUnavailable' }));
      }
    }

    const bytes = renderDocument(
      {
        kind: 'statement',
        locale: client.locale === 'ar' ? 'ar' : 'en',
        supplier,
        recipient: { name: client.name, recordNumber: client.mrn },
        from,
        to,
        ...statement,
        ageing: ageing(openItems(entries, to), to),
      },
      documentFonts(),
      logo,
    );
    // A copy, so the body's buffer is a plain ArrayBuffer as the response type asks.
    return c.body(Uint8Array.from(bytes), 200, {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="statement-${client.mrn}-${to}.pdf"`,
      'cache-control': 'no-store',
    });
  });
}
