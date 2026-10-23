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
 * **One deliberate exception, and it is not on the supplier.** An invoice's
 * `bank` — how to pay it — is read from the practice as it is when the page is
 * rendered, exactly as its mark is (`docs/SPEC/billing.md` section 5.6), and so
 * it sits on `InvoiceDocument` rather than in the snapshot, where it would
 * claim to be something the row stamped. It says where money should go today;
 * it states nothing about who the practice was when the invoice was numbered.
 *
 * `vatRegistered` is deliberately nullable. Null is an invoice issued before
 * migration 905, which says nothing about the registration rather than claiming
 * false; the renderer treats it exactly as it treats false, because an invoice
 * that cannot say it was issued under a registration must not be headed "Tax
 * Invoice".
 */

import type { Ageing, StatementLine } from '../ageing';

/** The practice as it was on the day, copied onto the row and never read back from `tenant`. */
export type SupplierSnapshot = {
  legalName: string;
  legalNameAr: string | null;
  address: string | null;
  /**
   * The same in Arabic (migration 980), printed on a document in Arabic in its
   * place. Absent or null — never typed, or a document from before — and an
   * Arabic document prints the English one; a document in English or in both
   * never reads it.
   */
  addressAr?: string | null;
  licenceNumber: string | null;
  licensingAuthority: string | null;
  /** As `addressAr`, for the licensing authority. */
  licensingAuthorityAr?: string | null;
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
  /**
   * The three facts the footer band is set from (migrations 912 and 959, and
   * docs/SPEC/billing.md section 5.6): the telephone number a reader of this
   * document rings, the address they write to, and the practice's website.
   *
   * Snapshotted like every other supplier fact, and null like every other one
   * when the practice had not recorded it — a practice that has recorded none
   * gets a footer with the legal name and the address on it and no second
   * line, rather than a line of empty labels.
   */
  contactPhone: string | null;
  contactEmail: string | null;
  website: string | null;
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

/**
 * The one language a money document is set in, fixed when it was issued
 * (migration 413, from the client's `preferred_locale`): the operator's
 * decision of 15 October 2026 that a document is English or Arabic, never
 * both. Null — or absent — on a document issued before then, which was set in
 * both and is still drawn so, because a filed document must re-render to the
 * bytes it was filed as.
 */
export type DocumentLocale = 'en' | 'ar';

export type InvoiceDocument = {
  kind: 'invoice';
  locale?: DocumentLocale | null;
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
  /**
   * The one share every discounted line was given (`sharedDiscountBasisPoints`),
   * printed beside "Discount" in the totals; null when there was no discount,
   * when any of it was typed as a sum, or when the lines disagree.
   */
  discountBasisPoints: number | null;
  /**
   * How to pay: the practice's bank account, read **live** at render time like
   * its mark and never snapshotted (section 5.6). Null when the practice has
   * recorded no account holder and IBAN, and then the page is exactly the page
   * it was before the block existed. A receipt has no such field: it asks for
   * nothing.
   */
  bank: {
    accountHolder: string;
    /** Uppercase with no spaces, as migration 924 stores it; grouped in fours when printed. */
    iban: string;
    bic: string | null;
    bankAddress: string | null;
  } | null;
};

export type PaymentMethod = 'cash' | 'transfer' | 'link';

export type ReceiptDocument = {
  kind: 'receipt';
  /** As `InvoiceDocument.locale`. */
  locale?: DocumentLocale | null;
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

/**
 * A credit note (migration 416): the invoice's own page in the credit note's
 * words. Its lines, supplier, locale and recipient come off the credit note's
 * own rows (snapshotted when it was issued), never off the live invoice.
 *
 * No waiver, no date of supply: a credit note neither forgives a charge nor
 * supplies anything on another day. Its `bank` is always null — it asks for
 * nothing — and its `discountFils` nought, a credit note's lines being the
 * net figures that came off.
 */
export type CreditNoteDocument = Omit<InvoiceDocument, 'kind' | 'waivedOn' | 'suppliedOn'> & {
  kind: 'credit_note';
  /** "CN-000001" is `reference`; this is the invoice it credits. */
  credits: { reference: string; issuedOn: IsoDate };
  /** Why it was issued, in the words the issuer typed. */
  reason: string;
};

/** YYYY-MM-DD. */
export type IsoDate = string;

/**
 * A household's statement of account (docs/superpowers/specs/
 * 2026-10-23-debtors-design.md, "Document"): what was charged, paid and
 * credited between two days, with the balance carried in and the balance at
 * the end. Made on request and never filed, so it has no number of its own and
 * its language is the household's, read when it is made. It is not a tax
 * document and says nothing about tax.
 *
 * Balances may be negative: the household is in credit, and the page says so
 * in words rather than printing a minus sign.
 */
export type StatementDocument = {
  kind: 'statement';
  locale: DocumentLocale;
  supplier: SupplierSnapshot;
  recipient: Recipient;
  from: IsoDate;
  to: IsoDate;
  openingFils: number;
  lines: readonly StatementLine[];
  closingFils: number;
  /** What is owed at the end of the period, by how long it has been owed. */
  ageing: Ageing;
};

/** The documents the practice files. A statement is made on request and is not among them. */
export type MoneyDocument = InvoiceDocument | ReceiptDocument | CreditNoteDocument;

/** Everything `renderDocument` can draw: the filed documents and the statement. */
export type RenderableDocument = MoneyDocument | StatementDocument;

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

/**
 * The percentage a whole invoice's discount can honestly be named by: the one
 * `discountBasisPoints` every discounted line shares.
 *
 * Lines with nothing off them do not break the agreement — a discounted session
 * beside a full-price call-out fee is still "25% off" where it was off at all.
 * But one discounted line typed as a sum, or two typed as different shares,
 * leave no single percentage to print, and the totals then say "Discount" and
 * the figure alone rather than invent one (`domain/billing/discount.ts`).
 */
export function sharedDiscountBasisPoints(
  lines: readonly Pick<InvoiceLine, 'discountFils' | 'discountBasisPoints'>[],
): number | null {
  let shared: number | null = null;
  for (const line of lines) {
    if (line.discountFils <= 0) continue;
    if (line.discountBasisPoints === null) return null;
    if (shared !== null && shared !== line.discountBasisPoints) return null;
    shared = line.discountBasisPoints;
  }
  return shared;
}
