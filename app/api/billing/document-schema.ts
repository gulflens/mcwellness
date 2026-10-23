import { z } from 'zod';
import { SEND_CHANNELS } from '../../../domain/shared/sending';
import { distinct, SearchText } from './ledger-schema';
import { decodeReceiptCursor } from './search';

/**
 * The shapes the document routes accept and answer. Imported by the routes and
 * by the browser, the same arrangement `schema.ts` and `ledger-schema.ts` have.
 */

export const CreateDocumentInput = z
  .object({
    invoiceId: z.uuid().optional(),
    paymentId: z.uuid().optional(),
    // A credit note is named by kind and source: `{ kind: 'credit_note', sourceId }`.
    kind: z.literal('credit_note').optional(),
    sourceId: z.uuid().optional(),
  })
  // One or the other, never both and never neither: an invoice and a receipt
  // are different documents and a request that named both would be asking for
  // one of them by accident.
  .refine((value) => {
    const creditNote = value.kind !== undefined && value.sourceId !== undefined;
    if ((value.kind === undefined) !== (value.sourceId === undefined)) return false;
    const named = [value.invoiceId, value.paymentId, creditNote ? value.sourceId : undefined];
    return named.filter((id) => id !== undefined).length === 1;
  }, 'Name an invoice, a payment or a credit note, and only one.');
export type CreateDocumentInput = z.infer<typeof CreateDocumentInput>;

export const DocumentRow = z.object({
  id: z.uuid(),
  kind: z.enum(['invoice', 'receipt', 'credit_note']),
  /** "INV-000001" or "RCP-000004" — what a family quotes on the telephone. */
  reference: z.string(),
  clientId: z.uuid(),
});
export type DocumentRow = z.infer<typeof DocumentRow>;

export const CreateDocumentResponse = z.object({ document: DocumentRow });
export type CreateDocumentResponse = z.infer<typeof CreateDocumentResponse>;

export const DocumentLinkResponse = z.object({
  /** A signed URL, good for a few minutes and no longer (docs/SEAMS.md). */
  url: z.string(),
  expiresInSeconds: z.number().int().positive(),
});
export type DocumentLinkResponse = z.infer<typeof DocumentLinkResponse>;

/**
 * Sending a document to a family. The recipient is named by contact id and
 * never by an address: a telephone number in a request body is a telephone
 * number in a log (.claude/rules/ui.md, docs/SPEC/audit.md section 8).
 */
export const SendDocumentInput = z.object({
  channel: z.enum(SEND_CHANNELS),
  contactId: z.uuid(),
});
export type SendDocumentInput = z.infer<typeof SendDocumentInput>;

export const SendDocumentResponse = z.object({
  channel: z.enum(SEND_CHANNELS),
  /** True when a vendor took it. False when the person sends it themselves. */
  delivered: z.boolean(),
  /**
   * Where to hand off: a `wa.me` link with the message already written, or the
   * document's own signed link for the share sheet. Absent when a vendor
   * delivered it and there is nothing for a person to do.
   */
  handoffUrl: z.string().optional(),
  /** The drafted message, so a screen can show what is about to be sent. */
  message: z.string(),
});
export type SendDocumentResponse = z.infer<typeof SendDocumentResponse>;

/**
 * The three figures on the money screen (docs/SPEC/billing.md section 4.1).
 * Fils, like every other amount that crosses this boundary, so no screen ever
 * does arithmetic on money.
 */
export const MonthlyMoneyResponse = z.object({
  /** YYYY-MM. */
  month: z.string(),
  cashCollectedFils: z.number().int().nonnegative(),
  revenueRecognisedFils: z.number().int().nonnegative(),
  deferredNetFils: z.number().int().nonnegative(),
});
export type MonthlyMoneyResponse = z.infer<typeof MonthlyMoneyResponse>;

/** How the money came: in hand, by bank transfer, or through a payment link. */
export const PaymentMethod = z.enum(['cash', 'transfer', 'link']);

/** One payment in the receipt book. */
export const ReceiptRow = z.object({
  id: z.uuid(),
  /** "RCP-000004"; null only on a payment recorded before the receipt book existed. */
  receiptReference: z.string().nullable(),
  method: PaymentMethod,
  amountFils: z.number().int().positive(),
  /** A bank reference or a payment link's own id. Never a card number. */
  reference: z.string().nullable(),
  receivedOn: z.string(),
  clientId: z.uuid(),
  clientMrn: z.string(),
  clientName: z.string(),
  /** The invoice it settles, when it named one. */
  invoiceReference: z.string().nullable(),
  /** The rendered PDF, when one has been filed. */
  documentId: z.uuid().nullable(),
});
export type ReceiptRow = z.infer<typeof ReceiptRow>;

export const ReceiptsResponse = z.object({
  receipts: z.array(ReceiptRow),
  truncated: z.boolean().optional(),
});
export type ReceiptsResponse = z.infer<typeof ReceiptsResponse>;

/**
 * `POST /api/billing/payments/search` — the receipt book searched, filtered
 * and paged, with the same search box the invoice book has.
 *
 * `search` is matched anywhere in the receipt's number, the number of the
 * invoice it settles, the client's record number and the client's name.
 * `before` is the `nextBefore` the previous page handed back, and nothing
 * else: a payment has no gapless number to resume from, so the cursor names
 * the last row's moment and id, and a cursor this API did not make is refused
 * rather than guessed at.
 */
export const PaymentSearchInput = z
  .object({
    search: SearchText.optional(),
    methods: z.array(PaymentMethod).min(1).max(3).refine(distinct, 'Each method once.').optional(),
    before: z
      .string()
      .max(200)
      .refine((value) => decodeReceiptCursor(value) !== null, 'Not a cursor from this book.')
      .optional(),
  })
  .strict();
export type PaymentSearchInput = z.infer<typeof PaymentSearchInput>;

/** The receipt book's page, with where to resume when more matched. */
export const PaymentSearchResponse = ReceiptsResponse.omit({ truncated: true }).extend({
  nextBefore: z.string().nullable(),
});
export type PaymentSearchResponse = z.infer<typeof PaymentSearchResponse>;

/**
 * A contact a document may be sent to. Deliberately without the number or the
 * address: a screen needs to know that there is one, not what it is.
 */
export const SendOption = z.object({
  id: z.uuid(),
  name: z.string().nullable(),
  relationship: z.string(),
  hasPhone: z.boolean(),
  hasEmail: z.boolean(),
  whatsappOptIn: z.boolean(),
});
export type SendOption = z.infer<typeof SendOption>;

export const SendOptionsResponse = z.object({ contacts: z.array(SendOption) });
export type SendOptionsResponse = z.infer<typeof SendOptionsResponse>;

/**
 * What the practitioner's stop card shows, and the whole of what leaves the API
 * for it (`app/api/billing/stop-balance.ts`).
 *
 * Deliberately not a subset of `BalanceResponse` expressed with `.pick()`: the
 * boundary is the point, and a shape derived from the wide one would follow it
 * the next time a field was added to the console's answer. This is written out
 * so that widening it is a decision somebody makes here.
 */
export const StopServiceBalance = z.object({
  /** The service by what it is — "nf-session" — never by an id. */
  serviceTypeCode: z.string(),
  /** The 3 in "Session 3 of 15". */
  delivered: z.number().int().nonnegative(),
  /** The 15. Everything the family still owns, delivered or not. */
  purchased: z.number().int().nonnegative(),
  /** Usable today: available, and not past its expiry. */
  remaining: z.number().int().nonnegative(),
});
export type StopServiceBalance = z.infer<typeof StopServiceBalance>;

export const StopBalanceResponse = z.object({
  clientId: z.uuid(),
  services: z.array(StopServiceBalance),
  /** Charged less paid, in fils. Positive is owed to the practice. */
  outstandingFils: z.number().int(),
});
export type StopBalanceResponse = z.infer<typeof StopBalanceResponse>;
