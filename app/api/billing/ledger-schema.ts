import { z } from 'zod';
import { cleanText } from '../_middleware/text';
import {
  DiscountInput,
  IsoDate,
  isRealText,
  MINIMUM_REASON,
  SaleDiscountInput,
  Term,
} from './schema';

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

/**
 * How long the credits something sells last, declared once in `schema.ts`
 * and re-exported here because a `package` and a `price` carry the same pair
 * (migration 412, the operator's ruling of 12 September 2026). Whole or
 * absent, never half; `null` on the field it sits in is how the practice says
 * these credits never expire.
 */
export { Term };

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
  /**
   * How long the credits this bundle sells last, and null when they never
   * expire — which is what an empty term means and what the three live
   * programmes will carry (the operator's ruling of 12 September 2026).
   */
  term: Term.nullable(),
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
  /** Sent as null, deliberately, for a bundle whose credits never expire. */
  term: Term.nullable(),
  components: z
    .array(z.object({ serviceTypeId: z.uuid(), quantity: z.number().int().min(1).max(1000) }))
    .min(1)
    .max(20),
  /** A bundle is created with the price it goes on sale at; there is no unsellable draft. */
  price: PackagePriceBody,
});
export type CreatePackageInput = z.infer<typeof CreatePackageInput>;

/**
 * Editing a package (operator, 20 October 2026): everything but its name,
 * code and Arabic name. Every edit carries a price, whose reason becomes the
 * row's Notes; `domain/billing/packageEdit.ts` decides whether it is written
 * in place or as a new version.
 */
export const EditPackageInput = z
  .object({
    listPriceFils: Fils,
    term: Term.nullable(),
    components: z
      .array(z.object({ serviceTypeId: z.uuid(), quantity: z.number().int().min(1).max(1000) }))
      .min(1)
      .max(20),
    price: PackagePriceBody,
  })
  .strict();
export type EditPackageInput = z.infer<typeof EditPackageInput>;

export const AddPackagePriceInput = PackagePriceBody;
export type AddPackagePriceInput = z.infer<typeof AddPackagePriceInput>;

/**
 * Withdrawing a bundle the practice no longer offers, or reinstating one
 * (round 62): the one column this touches. Nothing here deletes — a bundle's
 * code, its prices and every purchase against it are untouched either way,
 * and `sellable` on the row this writes back follows from `status` exactly
 * as `readPackages` already computes it for every other bundle.
 */
export const SetPackageStatusInput = z.object({ status: z.enum(['active', 'inactive']) }).strict();
export type SetPackageStatusInput = z.infer<typeof SetPackageStatusInput>;

/** One place up or down the practice's list (operator, 20 October 2026). */
export const MovePackageInput = z.object({ direction: z.enum(['up', 'down']) }).strict();
export type MovePackageInput = z.infer<typeof MovePackageInput>;

/** The packages on offer, every one of them, in the order they are to be listed. */
export const ReorderPackagesInput = z.object({ order: z.array(z.uuid()).min(1).max(500) }).strict();
export type ReorderPackagesInput = z.infer<typeof ReorderPackagesInput>;

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
  extraDiscount: z.object({ discount: SaleDiscountInput, reason: Reason }).optional(),
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
  /**
   * The day these credits stop being usable, and **null when they never do**
   * — the programme was sold with no term, so there is no date to show rather
   * than a date a screen has to invent (the operator's ruling of 12 September
   * 2026). A screen says "No expiry"; it does not leave the cell blank.
   */
  expiresOn: z.string().nullable(),
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
// Selling one session
// ---------------------------------------------------------------------------

/**
 * A trial or a one-off session, sold ahead of the visit rather than charged
 * when it closes (the operator's decision of 10 September 2026). The
 * package sale's own body, with `serviceTypeId` naming the one thing sold in
 * place of `packageId` naming a bundle of them.
 */
export const SellSessionInput = SellPackageInput.omit({ packageId: true }).extend({
  serviceTypeId: z.uuid(),
});
export type SellSessionInput = z.infer<typeof SellSessionInput>;

export const SellSessionResponse = z.object({
  invoiceId: z.uuid(),
  invoiceReference: z.string(),
  entitlementId: z.uuid(),
  serviceTypeName: z.string(),
  netFils: z.number().int().nonnegative(),
  vatFils: z.number().int().nonnegative(),
  grossFils: z.number().int().nonnegative(),
  /** Null when the price this session was sold at carries no term at all. */
  expiresOn: z.string().nullable(),
});
export type SellSessionResponse = z.infer<typeof SellSessionResponse>;

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
  /** What credit notes have taken off the charges, in fils (migration 417). */
  creditedFils: z.number().int().nonnegative(),
  purchases: z.array(PurchaseRow),
});
export type BalanceResponse = z.infer<typeof BalanceResponse>;

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

export const InvoiceKind = z.enum([
  'session',
  'package',
  'statement',
  'call_out_fee',
  'single_session',
]);
export type InvoiceKind = z.infer<typeof InvoiceKind>;

export const InvoiceRow = z.object({
  id: z.uuid(),
  reference: z.string(),
  number: z.number().int().positive(),
  kind: InvoiceKind,
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
  /**
   * The reference of the credit note that corrects this invoice (CN-000001),
   * or null when none has been issued. An invoice has at most one.
   */
  creditNoteReference: z.string().nullable(),
  /** That note's id, which the screen needs to open its PDF. Null with the reference. */
  creditNoteId: z.uuid().nullable(),
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

/**
 * What a person types into a book's search box: cleaned like every other piece
 * of free text, trimmed, and at most a hundred characters. Nothing at all, or
 * nothing but spaces, is no search rather than a search for nothing, so a
 * cleared box is the same request as a box never touched.
 *
 * It travels in a body and never in a query string, because what it holds is
 * usually a name (.claude/rules/ui.md).
 */
export const SearchText = z
  .string()
  .transform((value) => cleanText(value, 101))
  .refine((value) => Array.from(value).length <= 100, 'A search is at most 100 characters.')
  .transform((value) => (value === '' ? undefined : value));

/** True when no value in the list appears twice. */
export function distinct(values: readonly unknown[]): boolean {
  return new Set(values).size === values.length;
}

/**
 * `POST /api/billing/invoices/search` — the invoice book searched, filtered and
 * paged past its first fifty rows.
 *
 * `search` is matched anywhere in the invoice's reference, the client's record
 * number and the client's name as the book shows it. `before` is the `number`
 * the previous page's `nextBefore` named: invoice numbers are gapless and
 * never reused within a practice (402_billing_document.sql), so the number
 * alone is a stable place to resume from.
 */
export const InvoiceSearchInput = z
  .object({
    search: SearchText.optional(),
    kinds: z.array(InvoiceKind).min(1).max(5).refine(distinct, 'Each kind once.').optional(),
    before: z.number().int().positive().max(INT4_MAX).optional(),
  })
  .strict();
export type InvoiceSearchInput = z.infer<typeof InvoiceSearchInput>;

/**
 * The same book as `InvoicesResponse`, with where to resume in place of the
 * `truncated` flag: `nextBefore` is the last row's number when more matched,
 * and null when this page is the end.
 */
export const InvoiceSearchResponse = InvoicesResponse.omit({ truncated: true }).extend({
  nextBefore: z.number().int().positive().nullable(),
});
export type InvoiceSearchResponse = z.infer<typeof InvoiceSearchResponse>;

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

/**
 * Issuing a credit note (migration 417). The key is the drawer's, made when
 * the person presses the button, so the same press retried is the same note.
 */
export const IssueCreditNoteInput = z.object({
  reason: Reason,
  idempotencyKey: IdempotencyKey,
});
export type IssueCreditNoteInput = z.infer<typeof IssueCreditNoteInput>;

export const CreditRefusal = z.enum([
  'statement',
  'waived',
  'already_credited',
  'nothing_left',
  'client_erased',
]);
export type CreditRefusal = z.infer<typeof CreditRefusal>;

/** What a credit note on an invoice would credit, or why none may be issued. */
export const CreditQuoteResponse = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    plan: z.object({
      netFils: z.number().int().nonnegative(),
      vatFils: z.number().int().nonnegative(),
      grossFils: z.number().int().nonnegative(),
      /** The part of the net that comes off sessions owed rather than income. */
      releasedNetFils: z.number().int().nonnegative(),
      usedCredits: z.number().int().nonnegative(),
      unusedCredits: z.number().int().nonnegative(),
    }),
  }),
  z.object({ ok: z.literal(false), refusal: CreditRefusal }),
]);
export type CreditQuoteResponse = z.infer<typeof CreditQuoteResponse>;

export const IssueCreditNoteResponse = z.object({
  creditNote: z.object({
    id: z.uuid(),
    reference: z.string(),
    grossFils: z.number().int().nonnegative(),
    issuedOn: z.string(),
  }),
});
export type IssueCreditNoteResponse = z.infer<typeof IssueCreditNoteResponse>;

// ---------------------------------------------------------------------------
// Who owes the practice what
// ---------------------------------------------------------------------------

/** The as-at day, optional: the route defaults it to today in Dubai. */
export const DebtorsQuery = z.object({ asOf: IsoDate.optional() });
export type DebtorsQuery = z.infer<typeof DebtorsQuery>;

export const DebtorRow = z.object({
  clientId: z.uuid(),
  name: z.string(),
  mrn: z.string(),
  owedFils: Fils,
  b0to30Fils: Fils,
  b31to60Fils: Fils,
  b61to90Fils: Fils,
  over90Fils: Fils,
  inCreditFils: Fils,
  oldestOpenOn: IsoDate.nullable(),
});
export type DebtorRow = z.infer<typeof DebtorRow>;

/**
 * Totals cover every household with a balance and name nobody; `rows` is the
 * largest fifty, and `truncated` says there are more.
 */
export const DebtorsResponse = z.object({
  asOf: IsoDate,
  totals: z.object({
    owedFils: Fils,
    b0to30Fils: Fils,
    b31to60Fils: Fils,
    b61to90Fils: Fils,
    over90Fils: Fils,
    inCreditFils: Fils,
    households: z.number().int().nonnegative(),
  }),
  rows: z.array(DebtorRow),
  truncated: z.boolean(),
});
export type DebtorsResponse = z.infer<typeof DebtorsResponse>;
