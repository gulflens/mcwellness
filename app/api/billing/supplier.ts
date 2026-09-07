import type { Db } from '../_middleware/request-context';

/**
 * The practice, as far as VAT is concerned: registered, or not.
 *
 * One question, asked once per request, in the one place the charge paths ask
 * it — `app.tenant_charges_vat` (migration 406), which is also what the
 * database's own guards consult before letting an invoice carry VAT. The
 * catalogue routes need it because a price row's stamped rate says what the
 * standard rate was on the day the price was written, and says nothing about
 * whether the practice may charge it: that is the registration's to say, and
 * an unregistered practice's gross is its net (docs/SPEC/billing.md section
 * 5.1, domain/billing/vat.ts's resolveSaleVat).
 *
 * Not a snapshot of anything. An invoice snapshots the answer when it is
 * numbered (`invoice.supplier_vat_registered`, migration 905) and a rendered
 * document reads that snapshot; a catalogue screen is showing what would be
 * charged today, so it asks today.
 */
const SQL = 'select app.tenant_charges_vat(app.current_tenant_id()) as vat_registered';

export async function readVatRegistered(db: Db): Promise<boolean> {
  const { rows } = await db.query<{ vat_registered: boolean }>(SQL);
  return rows[0]?.vat_registered === true;
}
