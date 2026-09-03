import { z } from 'zod';

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
