import { z } from 'zod';
import { MAX_EXTENSIONS } from '../../../domain/billing';
import { cleanText } from '../_middleware/text';
import { DiscountInput, IsoDate, isRealText, MINIMUM_REASON } from './schema';

/**
 * The shapes the packages, sales, payments, balance, invoice and refund
 * routes return and accept. Imported by the routes and by the browser, the
 * same arrangement `schema.ts` has for the price list.
 *
 * Money crosses this boundary as an integer number of fils and nothing else
 * (CLAUDE.md rule: doubles are banned for money). Every net, VAT and gross
 * figure is computed server-side and sent whole, so no screen ever does
 * money arithmetic of its own; `app/admin/billing/money.ts` formats and
 * parses, and that is all it does.
 */

/** The price column is Postgres integer (int4); this is its largest value. */
const INT4_MAX = 2_147_483_647;

const Fils = z.number().int().nonnegative().max(INT4_MAX);
const Reason = z
  .string()
  .transform((value) => cleanText(value, 200))
  .refine(isRealText, `A reason is at least ${MINIMUM_REASON} characters, and says something.`);

/**
 * A bank transfer reference or a payment link's own id, and nothing else.
 *
 * Not free text, and the column agrees (402_billing_document.sql). `payment`
 * grants no update and no delete, `app.erase_client` does not reach it yet
 * (docs/CHANGE-REQUESTS/billing-03.md asks for that), and whatever is written
 * here is copied verbatim into the audit trail — so a field a person could
 * type a sentence into would be a place for a family's private circumstances
 * to outlive their record. Forty characters of the alphabet a bank reference
 * is actually made of is longer than any UAE format the practice will meet.
 */
const PaymentReference = z
  .string()
  .transform((value) => cleanText(value, 40))
  .refine(
    (value) => /^[A-Za-z0-9][A-Za-z0-9 /.:#-]{0,39}$/.test(value),
    'A reference is letters, digits, spaces and - / . : # only.',
  );

/**
 * An idempotency key, sent as the `Idempotency-Key` header. The drawer makes
 * one when the person presses the button, so the same press retried is the
 * same sale or the same payment — once.
 */
export const IdempotencyKey = z.uuid();

// ---------------------------------------------------------------------------
// The bundle catalogue
// ---------------------------------------------------------------------------

export const PackageComponentRow = z.object({
  serviceTypeId: z.uuid(),
  serviceTypeCode: z.string(),
  serviceTypeName: z.string(),
  serviceTypeNameAr: z.string().nullable(),
  quantity: z.number().int().positive(),
  lineNo: z.number().int().positive(),
  /** What one costs on its own today; null when the service has no price yet. */
  standaloneNetFils: z.number().int().nonnegative().nullable(),
});
export type PackageComponentRow = z.infer<typeof PackageComponentRow>;

export const PackagePriceRow = z.object({
  id: z.uuid(),
  /** The bundle's list price as it stood when this row was written. */
  listPriceFils: z.number().int().nonnegative(),
  discountFils: z.number().int().nonnegative(),
  /** The share the discount was typed as; null when it was a sum, or none was given. */
  discountBasisPoints: z.number().int().min(0).max(10_000).nullable(),
  /** What the bundle sells for: the list figure less the discount. */
  amountFils: z.number().int().nonnegative(),
  vatRateBasisPoints: z.number().int().min(0).max(10_000),
  vatFils: z.number().int().nonnegative(),
  grossFils: z.number().int().nonnegative(),
  validFrom: z.string(),
  amendmentReason: z.string(),
});
export type PackagePriceRow = z.infer<typeof PackagePriceRow>;

export const PackageRow = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  nameAr: z.string().nullable(),
  /** What the contents come to bought one at a time, as the practice publishes it. */
  listPriceFils: z.number().int().nonnegative(),
  expiryMonths: z.number().int().positive(),
  status: z.enum(['active', 'inactive']),
  components: z.array(PackageComponentRow),
  /** The price in force today; null when none has started yet. */
  currentPrice: PackagePriceRow.nullable(),
  /** The same sum as `listPriceFils`, but at today's prices; null when a component has none. */
  componentsTotalFils: z.number().int().nonnegative().nullable(),
  /** False when a component has no price, or no package price has started: the sale is refused. */
  sellable: z.boolean(),
});
export type PackageRow = z.infer<typeof PackageRow>;

export const PackagesResponse = z.object({
  packages: z.array(PackageRow),
  /**
   * Whether the practice is registered for VAT today, which is what decides
   * the `vatFils` and `grossFils` on every price above (migration 406). The
   * table says it in one sentence rather than leaving a reader to work out
   * why a VAT column reads nothing.
   */
  vatRegistered: z.boolean(),
});
export type PackagesResponse = z.infer<typeof PackagesResponse>;

/**
 * What a bundle is put on sale at, said either way round: the discount off its
 * list price, or the price now, which is the same fact expressed as the figure
 * rather than the gap (docs/SPEC/billing.md section 2.4 — "the Add package
 * drawer accepts either the discount or the price now and computes the
 * other"). Exactly one of the two; the server works out the one that was not
 * sent, so nothing on the wire can contradict itself. `amountFils` is also the
 * older shape of this body, which the accounting stream's own fixtures still
 * send and which billing does not own (docs/SPEC/OWNERSHIP.md).
 */
const PackagePriceBody = z
  .object({
    discount: DiscountInput.nullable().optional(),
    amountFils: Fils.optional(),
    validFrom: IsoDate,
    amendmentReason: Reason,
  })
  .superRefine((value, ctx) => {
    if (value.discount && value.amountFils !== undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'Name either the discount or the price now, not both.',
      });
    }
  });

export const CreatePackageInput = z.object({
  code: z
    .string()
    .regex(
      /^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/,
      'A code is lower case letters, digits and hyphens.',
    ),
  name: z.string().transform((v) => cleanText(v, 120)),
  nameAr: z
    .string()
    .transform((v) => cleanText(v, 120))
    .nullable()
    .optional(),
  listPriceFils: Fils,
  expiryMonths: z.number().int().min(1).max(60),
  components: z
    .array(z.object({ serviceTypeId: z.uuid(), quantity: z.number().int().min(1).max(1000) }))
    .min(1)
    .max(20),
  /** A bundle is created with the price it goes on sale at; there is no unsellable draft. */
  price: PackagePriceBody,
});
export type CreatePackageInput = z.infer<typeof CreatePackageInput>;

export const AddPackagePriceInput = PackagePriceBody;
export type AddPackagePriceInput = z.infer<typeof AddPackagePriceInput>;

export const PackageResponse = z.object({ package: PackageRow });
export type PackageResponse = z.infer<typeof PackageResponse>;

// ---------------------------------------------------------------------------
// Selling one
// ---------------------------------------------------------------------------

export const PAYMENT_METHODS = ['cash', 'transfer', 'link'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const SellPackageInput = z.object({
  packageId: z.uuid(),
  clientId: z.uuid(),
  purchasedOn: IsoDate,
  /**
   * Optional, and taken at the moment of sale rather than typed: a package
   * price is a figure the founder sets on the price list, so a sale never
   * carries one of its own. Selling at a different figure means appending a
   * price row first, which leaves a reason behind it.
   */
  payment: z
    .object({
      method: z.enum(PAYMENT_METHODS),
      amountFils: Fils.refine((v) => v > 0, 'A payment is more than nothing.'),
      reference: PaymentReference.nullable().optional(),
    })
    .optional(),
  /**
   * One more discount for this sale alone, off the same list figure the price
   * list discounts (docs/SPEC/billing.md section 2.4). It always carries a
   * reason — the price list's own discount had its reason when the price was
   * written, and this one has none until somebody gives it — and only the
   * owner, an admin or finance may give one.
   */
  extraDiscount: z.object({ discount: DiscountInput, reason: Reason }).optional(),
});
export type SellPackageInput = z.infer<typeof SellPackageInput>;

export const PurchaseRow = z.object({
  id: z.uuid(),
  clientId: z.uuid(),
  packageId: z.uuid(),
  packageName: z.string(),
  packageNameAr: z.string().nullable(),
  purchasedOn: z.string(),
  netFils: z.number().int().nonnegative(),
  vatFils: z.number().int().nonnegative(),
  grossFils: z.number().int().nonnegative(),
  listPriceFils: z.number().int().nonnegative(),
  /** The list figure less what was charged: the price list's discount and any extra, together. */
  discountFils: z.number().int().nonnegative(),
  /** The combined share, when both discounts were percentages; null otherwise. */
  discountBasisPoints: z.number().int().min(0).max(10_000).nullable(),
  /** Why an extra discount was given at this sale; null when there was none. */
  discountReason: z.string().nullable(),
  expiresOn: z.string(),
  extendedTo: z.string().nullable(),
  extensionReason: z.string().nullable(),
  /** How many of the two extensions this programme has had. */
  extensionsUsed: z.number().int().min(0).max(MAX_EXTENSIONS),
  extensionsAllowed: z.literal(MAX_EXTENSIONS),
  /**
   * The end the next extension would reach; null once the programme has had
   * its two. The screen shows the date it is offering before anybody asks
   * for it, and the count is the database's rather than a drawer's arithmetic
   * (docs/PLAN/package-terms.md, the operator's decision 9 of 2026-09-10).
   */
  extendsTo: z.string().nullable(),
  status: z.enum(['active', 'completed', 'expired', 'refunded', 'cancelled']),
  invoiceId: z.uuid().nullable(),
});
export type PurchaseRow = z.infer<typeof PurchaseRow>;

export const SellPackageResponse = z.object({
  purchase: PurchaseRow,
  invoiceReference: z.string(),
  /** How many credits the sale created. */
  entitlements: z.number().int().nonnegative(),
});
export type SellPackageResponse = z.infer<typeof SellPackageResponse>;

// ---------------------------------------------------------------------------
// Money in
// ---------------------------------------------------------------------------

export const RecordPaymentInput = z.object({
  clientId: z.uuid(),
  method: z.enum(PAYMENT_METHODS),
  amountFils: Fils.refine((v) => v > 0, 'A payment is more than nothing.'),
  /** When the money arrived, as an instant. Defaults to now when absent. */
  receivedAt: z.iso.datetime().optional(),
  reference: PaymentReference.nullable().optional(),
  invoiceId: z.uuid().nullable().optional(),
});
export type RecordPaymentInput = z.infer<typeof RecordPaymentInput>;

export const PaymentRow = z.object({
  id: z.uuid(),
  clientId: z.uuid(),
  method: z.enum(PAYMENT_METHODS),
  amountFils: z.number().int().positive(),
  receivedAt: z.string(),
  reference: z.string().nullable(),
  invoiceId: z.uuid().nullable(),
  /**
   * "RCP-000004" — the number a coordinator can quote when a family rings to
   * ask what was received (405_billing_receipt.sql). Its own sequence, not
   * the invoice book's: a payment settles a tax invoice, it is not one.
   * Null only on a payment recorded before that migration.
   */
  receiptReference: z.string().nullable(),
});
export type PaymentRow = z.infer<typeof PaymentRow>;

export const RecordPaymentResponse = z.object({ payment: PaymentRow });
export type RecordPaymentResponse = z.infer<typeof RecordPaymentResponse>;

// ---------------------------------------------------------------------------
// What a client has left
// ---------------------------------------------------------------------------

export const EXPIRY_WARNINGS = ['none', 'sixty_days', 'thirty_days', 'expired'] as const;

export const ServiceBalanceRow = z.object({
  serviceTypeId: z.uuid(),
  serviceTypeCode: z.string(),
  serviceTypeName: z.string(),
  serviceTypeNameAr: z.string().nullable(),
  purchased: z.number().int().nonnegative(),
  delivered: z.number().int().nonnegative(),
  forfeited: z.number().int().nonnegative(),
  remaining: z.number().int().nonnegative(),
  lapsed: z.number().int().nonnegative(),
  remainingValueNetFils: z.number().int().nonnegative(),
  /** Earned, and still owed in sessions (docs/SPEC/billing.md section 4.1). */
  recognisedNetFils: z.number().int().nonnegative(),
  deferredNetFils: z.number().int().nonnegative(),
  nextExpiryOn: z.string().nullable(),
  expiryWarning: z.enum(EXPIRY_WARNINGS),
});
export type ServiceBalanceRow = z.infer<typeof ServiceBalanceRow>;

export const BalanceResponse = z.object({
  clientId: z.uuid(),
  services: z.array(ServiceBalanceRow),
  delivered: z.number().int().nonnegative(),
  remaining: z.number().int().nonnegative(),
  remainingValueNetFils: z.number().int().nonnegative(),
  /**
   * The two halves of what a package sale really was: what the practice has
   * earned by delivering, and what it still owes in sessions. Cash is not
   * revenue (docs/SPEC/billing.md section 4.1), and the dashboard that puts
   * these side by side across every client is a later piece of work — but
   * the figures come from the ledger as it already stands, so building it
   * needs no schema change and no backfill.
   */
  recognisedNetFils: z.number().int().nonnegative(),
  deferredNetFils: z.number().int().nonnegative(),
  nextExpiryOn: z.string().nullable(),
  expiryWarning: z.enum(EXPIRY_WARNINGS),
  /** Charged less paid, in fils. Positive is owed to the practice. */
  outstandingFils: z.number().int(),
  chargedFils: z.number().int().nonnegative(),
  paidFils: z.number().int().nonnegative(),
  purchases: z.array(PurchaseRow),
});
export type BalanceResponse = z.infer<typeof BalanceResponse>;

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

export const InvoiceRow = z.object({
  id: z.uuid(),
  reference: z.string(),
  number: z.number().int().positive(),
  kind: z.enum(['session', 'package', 'statement', 'call_out_fee']),
  issuedOn: z.string(),
  clientId: z.uuid(),
  clientMrn: z.string(),
  clientName: z.string(),
  netFils: z.number().int().nonnegative(),
  vatFils: z.number().int().nonnegative(),
  grossFils: z.number().int().nonnegative(),
  /** What was taken off the list figures across this invoice's lines. */
  discountFils: z.number().int().nonnegative(),
  /**
   * The day the practice forgave this call-out fee (YYYY-MM-DD, in the
   * practice's own time zone), and null on every row that stands. A waived
   * charge keeps its number, its line and its figures and simply stops
   * counting in `app.billing_ledger` (migration 408), so the book says which
   * is which rather than leaving a balance that does not add up.
   */
  waivedAt: z.string().nullable(),
  /**
   * The rendered PDF, when one has been filed. Null means it has not been
   * rendered yet, not that it cannot be: the screen offers to make it.
   */
  documentId: z.uuid().nullable(),
});
export type InvoiceRow = z.infer<typeof InvoiceRow>;

export const InvoicesResponse = z.object({
  invoices: z.array(InvoiceRow),
  /**
   * Whether the practice is registered for VAT *now*. Not a fact about any
   * invoice in the list — each of those carries its own snapshot of what was
   * true on the day — but what the screen needs to say plainly why the VAT
   * column reads as it does.
   */
  practiceVatRegistered: z.boolean(),
  /** True when more matched than the page holds. */
  truncated: z.boolean().optional(),
});
export type InvoicesResponse = z.infer<typeof InvoicesResponse>;

// ---------------------------------------------------------------------------
// The refund calculator, and the waiver
// ---------------------------------------------------------------------------

export const RefundQuoteResponse = z.object({
  purchaseId: z.uuid(),
  paidNetFils: z.number().int().nonnegative(),
  deliveredChargeNetFils: z.number().int().nonnegative(),
  refundNetFils: z.number().int().nonnegative(),
  lines: z.array(
    z.object({
      serviceTypeId: z.uuid(),
      serviceTypeName: z.string(),
      count: z.number().int().nonnegative(),
      singleRateNetFils: z.number().int().nonnegative(),
      chargeNetFils: z.number().int().nonnegative(),
    }),
  ),
  /**
   * A quote, never an instruction. No route in this pull request issues a
   * refund: the policy wording is with the practice's lawyer and the tax
   * point with its tax adviser (docs/SPEC/billing.md section 10).
   */
  quoteOnly: z.literal(true),
});
export type RefundQuoteResponse = z.infer<typeof RefundQuoteResponse>;

/**
 * Extending a programme's expiry: the coordinator's discretion, with a reason
 * (docs/SPEC/billing.md section 4.3, and the founder's decision of
 * 2026-09-03). A reason and nothing else. The length is not the coordinator's
 * to choose — an extension is always exactly three months from the current
 * end, and a programme may have two (docs/PLAN/package-terms.md, the
 * operator's decision 9 of 2026-09-10) — so there is no date on the wire for
 * a screen to get wrong, and no shortening of a prepaid programme to refuse.
 */
export const ExtendPurchaseInput = z.object({
  reason: Reason,
});
export type ExtendPurchaseInput = z.infer<typeof ExtendPurchaseInput>;

export const ExtendPurchaseResponse = z.object({ purchase: PurchaseRow });
export type ExtendPurchaseResponse = z.infer<typeof ExtendPurchaseResponse>;

export const WaiveEntitlementInput = z.object({ reason: Reason });
export type WaiveEntitlementInput = z.infer<typeof WaiveEntitlementInput>;

export const WaiveEntitlementResponse = z.object({
  waivedEntitlementId: z.uuid(),
  replacementEntitlementId: z.uuid(),
});
export type WaiveEntitlementResponse = z.infer<typeof WaiveEntitlementResponse>;

/**
 * Forgiving a call-out fee (migration 408). The same input as the credit
 * waiver above, because it is the same act with the same reason field
 * (docs/SPEC/billing.md section 4.3) on the row the ledger's shape allows it
 * to reach: a fee is an invoice, and an invoice has no credit to hand back.
 */
export const WaiveCallOutFeeInput = z.object({ reason: Reason });
export type WaiveCallOutFeeInput = z.infer<typeof WaiveCallOutFeeInput>;

export const WaiveCallOutFeeResponse = z.object({
  waivedInvoiceId: z.uuid(),
  /** What the family no longer owes, in fils. */
  waivedGrossFils: z.number().int().nonnegative(),
});
export type WaiveCallOutFeeResponse = z.infer<typeof WaiveCallOutFeeResponse>;
