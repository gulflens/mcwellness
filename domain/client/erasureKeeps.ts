/**
 * What an erasure does not take (docs/SPEC/client-record.md section 8 step 2,
 * docs/SPEC/00-data-model.md section 7: "invoices keep what tax law requires
 * for their 5 years").
 *
 * Everything the practice holds about a person goes when they ask to be
 * forgotten — every document row, and the bytes behind it. The exception is
 * the paperwork a business is required to keep whether or not the customer
 * would rather it did not exist: a tax invoice, and the credit note that
 * corrects one. UAE tax law asks for five years and does not ask the
 * customer's permission, so those rows stay and their files stay with them.
 *
 * **What is deliberately not on this list.** A receipt is not here because
 * billing has not named a kind for one: a receipt acknowledges money against
 * an invoice, and `405_billing_receipt.sql` allocates its number while saying
 * in as many words that the rendered document is a later piece of work. When
 * that work lands, its kind joins this list and the SQL copy of it in
 * `db/migrations/104_erasure_the_act.sql` — both, or the two disagree, and the
 * one that matters is the one the database enforces.
 *
 * **What the erasure blanks on an invoice: nothing.** Worth stating, because
 * "the personal details are snapshotted on the invoice" is the usual shape of
 * this problem and here it is not the case. `invoice`
 * (`db/migrations/402_billing_document.sql`) snapshots the **supplier's**
 * identity — the practice's own legal name, licence and tax numbers — and
 * names its client by `client_id` alone; `invoice_line` snapshots the service
 * description, which is what was sold and not who bought it. The client's name
 * comes from the `client` row at render time, and that row is what the
 * erasure has just turned into "Erased client". So there is no column on an
 * invoice for an erasure to clear, and clearing one anyway would damage a tax
 * record to no purpose.
 */

/**
 * Document kinds an erasure keeps. Mirrored in SQL by
 * `db/migrations/104_erasure_the_act.sql`; a kind added here without being
 * added there changes nothing, because the database is what decides.
 */
export const KEPT_THROUGH_ERASURE_KINDS = ['invoice', 'credit_note'] as const;

/**
 * Whether a document of this kind survives an erasure of the client it is
 * filed against.
 */
export function isKeptThroughErasure(kind: string): boolean {
  return (KEPT_THROUGH_ERASURE_KINDS as readonly string[]).includes(kind);
}
