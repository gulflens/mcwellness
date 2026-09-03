import { z } from 'zod';
import { SEND_CHANNELS } from '../../../domain/billing/sending';

/**
 * The shapes the document routes accept and answer. Imported by the routes and
 * by the browser, the same arrangement `schema.ts` and `ledger-schema.ts` have.
 */

export const CreateDocumentInput = z
  .object({
    invoiceId: z.uuid().optional(),
    paymentId: z.uuid().optional(),
  })
  // One or the other, never both and never neither: an invoice and a receipt
  // are different documents and a request that named both would be asking for
  // one of them by accident.
  .refine(
    (value) => (value.invoiceId === undefined) !== (value.paymentId === undefined),
    'Name an invoice or a payment, not both.',
  );
export type CreateDocumentInput = z.infer<typeof CreateDocumentInput>;

export const DocumentRow = z.object({
  id: z.uuid(),
  kind: z.enum(['invoice', 'receipt']),
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
