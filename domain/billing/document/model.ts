/**
 * What a rendered money document is made of — and, just as importantly, what it
 * is not allowed to reach for.
 *
 * **Everything here comes off the invoice or payment row itself.** The supplier
 * facts are the `supplier_*` columns migration 402 and 905 snapshot at
 * numbering time, never the live `tenant`. That is the whole reason the
 * snapshot exists: reading the practice at render time would make last year's
 * invoice re-render with this year's registration, this year's address and this
 * year's legal name (docs/CHANGE-REQUESTS/trunk-notes.md round 20, request 1c).
 * The type is the enforcement — there is no tenant in it to read.
 *
 * `vatRegistered` is deliberately nullable. Null is an invoice issued before
 * migration 905, which says nothing about the registration rather than claiming
 * false; the renderer treats it exactly as it treats false, because an invoice
 * that cannot say it was issued under a registration must not be headed "Tax
 * Invoice".
 */

/** The practice as it was on the day, copied onto the row and never read back from `tenant`. */
export type SupplierSnapshot = {
  legalName: string;
  legalNameAr: string | null;
  address: string | null;
  licenceNumber: string | null;
  licensingAuthority: string | null;
  /**
   * `invoice.supplier_trn` — the **corporate-tax** registration the practice
   * held. Never a VAT number, and never printed as one: the column comment on
   * both `tenant.trn` and `invoice.supplier_trn` says so, and mislabelling it is
   * the misstatement the Federal Tax Authority reads an invoice to check.
   */
  corporateTaxNumber: string | null;
  /** Whether the practice was registered for VAT when this document's row was numbered. */
  vatRegistered: boolean | null;
  /** The VAT registration number, present only while `vatRegistered` is true. */
  vatNumber: string | null;
};

/** Who the document is for. A household, which is a private individual. */
export type Recipient = {
  name: string;
  /** The record number a family can quote. Never an id from a URL. */
  recordNumber: string;
};

export type InvoiceLine = {
  description: string;
  descriptionAr: string | null;
  quantity: number;
  /** The list figure, before any discount: `net = quantity x unit - discount`. */
  unitNetFils: number;
  discountFils: number;
  /** The share the discount was typed as, or null when it was a sum. */
  discountBasisPoints: number | null;
  netFils: number;
  /** Basis points: 500 is five per cent, 0 is what an unregistered practice charged. */
  vatRateBasisPoints: number;
  vatFils: number;
  grossFils: number;
};

export type InvoiceDocument = {
  kind: 'invoice';
  supplier: SupplierSnapshot;
  recipient: Recipient;
  /** "INV-000001". */
  reference: string;
  /** YYYY-MM-DD. */
  issuedOn: string;
  /** The date of supply, only when it differs from the issue date; null when it does not. */
  suppliedOn: string | null;
  /**
   * The day the practice forgave this charge, when it has (migration 408's
   * `invoice.waived_at`, in the practice's own time zone); null while it
   * stands.
   *
   * A waived call-out fee keeps its number, its line and its figures — the
   * invoice is append-only and what happened is never rewritten — so without
   * this the document would go on presenting a live charge for money the
   * family does not owe. The renderer says so on the page instead.
   */
  waivedOn: string | null;
  lines: readonly InvoiceLine[];
  netFils: number;
  vatFils: number;
  grossFils: number;
  /** What came off the list figures across every line; nought when nothing did. */
  discountFils: number;
};

export type PaymentMethod = 'cash' | 'transfer' | 'link';

export type ReceiptDocument = {
  kind: 'receipt';
  supplier: SupplierSnapshot;
  recipient: Recipient;
  /** "RCP-000004" — its own book, never the invoice sequence. */
  reference: string;
  /** YYYY-MM-DD, in the practice's own time zone. */
  receivedOn: string;
  method: PaymentMethod;
  amountFils: number;
  /** A bank reference or a payment link's id. Never a card number. */
  paymentReference: string | null;
  /** The invoice this money settles, when it named one. */
  settles: { reference: string; issuedOn: string } | null;
};

export type MoneyDocument = InvoiceDocument | ReceiptDocument;

/**
 * Whether this document may say the word "tax".
 *
 * One question, asked in one place, from the row's own snapshot. Null and false
 * answer the same: a document that cannot say it was issued under a
 * registration is not a tax invoice.
 */
export function chargesVat(supplier: SupplierSnapshot): boolean {
  return supplier.vatRegistered === true;
}
