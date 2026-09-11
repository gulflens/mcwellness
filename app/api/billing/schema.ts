import { z } from 'zod';
import type { Discount } from '../../../domain/billing';
import { fils } from '../../../domain/shared';
import { cleanText } from '../_middleware/text';

/**
 * The shapes the billing catalogue routes return and accept. Imported by the
 * routes and, from the second pull request, by the browser.
 */

export const ServiceTypeOption = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  nameAr: z.string().nullable(),
});
export type ServiceTypeOption = z.infer<typeof ServiceTypeOption>;

export const ServiceTypeOptionsResponse = z.object({
  serviceTypes: z.array(ServiceTypeOption),
});
export type ServiceTypeOptionsResponse = z.infer<typeof ServiceTypeOptionsResponse>;

/**
 * How long the credits something sells last: a whole number with its unit
 * beside it (migration 412, the operator's ruling of 12 September 2026). A
 * `package` carries one and so does a `price`, and both may carry none — and
 * none is expressed as `null` on the field this shape sits in, never as a
 * half-filled pair. That is the point of sending the two together: a number
 * with no unit is the way a term goes wrong, and it cannot be put on the wire
 * at all.
 *
 * Five years is the ceiling in either unit — the sixty months the bundle
 * catalogue always allowed, said in days as well. Migration 412 holds the same
 * ceiling in the database, because the catalogue's lists parse what they read
 * with this very shape: a row written over it by hand, as a data step writes,
 * would otherwise fail every list that reads it. Here it is said first, so a
 * mistyped 3650 in a field set to months is refused with a sentence rather
 * than a constraint violation.
 *
 * It lives in this file rather than in `ledger-schema.ts`, which re-exports
 * it, because that file imports this one and both catalogues need the one
 * declaration.
 */
export const Term = z
  .object({
    amount: z.number().int().min(1),
    unit: z.enum(['day', 'month']),
  })
  .refine(
    (term) => term.amount <= (term.unit === 'month' ? 60 : 1825),
    'A term is at most five years, in either unit.',
  );
export type Term = z.infer<typeof Term>;

export const PriceRow = z.object({
  id: z.uuid(),
  serviceTypeId: z.uuid(),
  serviceTypeCode: z.string(),
  serviceTypeName: z.string(),
  serviceTypeNameAr: z.string().nullable(),
  /** The figure before any discount, net of VAT. */
  listPriceFils: z.number().int().nonnegative(),
  discountFils: z.number().int().nonnegative(),
  /** The share the discount was typed as; null when it was a sum, or none was given. */
  discountBasisPoints: z.number().int().min(0).max(10_000).nullable(),
  /** What a family pays, net of VAT: the list figure less the discount. */
  unitPriceFils: z.number().int().nonnegative(),
  vatRateBasisPoints: z.number().int().min(0).max(10_000),
  vatFils: z.number().int().nonnegative(),
  grossFils: z.number().int().nonnegative(),
  /** YYYY-MM-DD. Inclusive: the price applies from this day on. */
  validFrom: z.string(),
  /** The price this one replaces; null only for a service's first price. */
  supersedesId: z.uuid().nullable(),
  amendmentReason: z.string(),
  /**
   * How long a session bought at this price stays usable, and null when it
   * never stops being usable — which is what every price carries until the
   * practice sets a term on one. It is read off the row rather than taken
   * from a constant in the code, which is what retired
   * `SINGLE_SESSION_MONTHS`.
   */
  term: Term.nullable(),
});
export type PriceRow = z.infer<typeof PriceRow>;

export const PricesResponse = z.object({
  prices: z.array(PriceRow),
  /**
   * Whether the practice is registered for VAT today, which is what decides
   * the `vatFils` and `grossFils` on every row above (migration 406). The
   * screen shows it as one sentence rather than leaving a reader to work out
   * why a VAT column reads nothing.
   */
  vatRegistered: z.boolean(),
});
export type PricesResponse = z.infer<typeof PricesResponse>;

/** The price column is Postgres integer (int4); this is its largest value. */
const INT4_MAX = 2_147_483_647;

/**
 * YYYY-MM-DD, and a real calendar date: 2026-13-45 matches the shape but
 * names no day that exists, so it fails here — a 400, not a database error
 * surfacing as a 500. Exported: the VAT-rate route's `date` query parameter
 * (below) is the same shape as `validFrom`, and shares this one check.
 */
export const IsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Dates are YYYY-MM-DD.')
  .refine((value) => {
    const [year, month, day] = value.split('-').map(Number);
    if (year === undefined || month === undefined || day === undefined) {
      return false;
    }
    const asDate = new Date(Date.UTC(year, month - 1, day));
    return (
      asDate.getUTCFullYear() === year &&
      asDate.getUTCMonth() === month - 1 &&
      asDate.getUTCDate() === day
    );
  }, 'Dates must be a real calendar date.');

/**
 * Why something was done, in enough words to be worth reading a year later.
 *
 * A reason of one character passed every check while saying nothing: "x",
 * ".", "aaaaaaaa". In billing these appear on price changes, on an extra
 * discount given at a sale, and on waivers — the places where somebody gave
 * money away or took a charge back — and the whole purpose of the field is
 * that a person later can see what happened. So: at least eight characters
 * after trimming, and not the same character repeated, which is what a
 * required field collects when nobody means to fill it in.
 */
export const MINIMUM_REASON = 8;

export function isRealText(value: string): boolean {
  if (value.length < MINIMUM_REASON) {
    return false;
  }
  const withoutSpaces = value.replace(/\s/g, '');
  if (withoutSpaces.length < MINIMUM_REASON) {
    return false;
  }
  return new Set(withoutSpaces).size > 1;
}

/**
 * How a discount was expressed: a share of the list figure, or a sum of money
 * (docs/SPEC/billing.md section 2.4). The server turns either into fils
 * through `domain/billing/discount.ts`, so the two never mean different
 * things on two screens.
 */
export const DiscountInput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('percent'), basisPoints: z.number().int().min(0).max(10_000) }),
  z.object({ kind: z.literal('amount'), fils: z.number().int().nonnegative().max(INT4_MAX) }),
]);
export type DiscountInput = z.infer<typeof DiscountInput>;

/**
 * The wire's discount as `domain/billing/discount.ts` wants it: money is
 * `Fils`, not a bare number, so the branding is put back on at the boundary
 * rather than loosened in the rule.
 */
export function toDiscount(input: DiscountInput | null | undefined): Discount | null {
  if (!input) {
    return null;
  }
  return input.kind === 'percent' ? input : { kind: 'amount', fils: fils(input.fils) };
}

export const CreatePriceInput = z
  .object({
    serviceTypeId: z.uuid(),
    /**
     * The figure before any discount. What is charged is this less the
     * discount, worked out on the server: a caller never sends both, so the
     * two cannot disagree.
     */
    listPriceFils: z.number().int().nonnegative().max(INT4_MAX).optional(),
    /**
     * What the list figure was called before a price could carry a discount.
     * Still accepted, and read as a list figure with nothing off it — which is
     * exactly what it meant. The accounting stream writes the practice's
     * prices through this route from its own fixtures, and those are not
     * billing's to edit (docs/SPEC/OWNERSHIP.md), so the older body stays
     * valid; sending it beside a discount is refused, because then the two
     * names would be claiming different figures.
     */
    unitPriceFils: z.number().int().nonnegative().max(INT4_MAX).optional(),
    discount: DiscountInput.nullable().optional(),
    /**
     * **Optional, and the three states are all different.** A term sent is
     * the term written; `null` takes a term away deliberately; **absent
     * carries the superseded row's term forward** (the controller's ruling of
     * 12 September 2026). Required would mean a screen that forgot to prefill
     * silently wiping a term the practice set on purpose — the trap
     * `INSERT_PRICE_SQL` closes — so absence is the safe default and removal
     * is the deliberate act.
     */
    term: Term.nullable().optional(),
    validFrom: IsoDate,
    /**
     * Why, in enough words to be worth reading a year later. The same rule the
     * ledger's own reasons carry (app/api/billing/ledger-schema.ts): eight
     * characters of real text, not one, and not the same character repeated.
     * Required on every price, including a service's first.
     */
    amendmentReason: z
      .string()
      .transform((value) => cleanText(value, 200))
      .refine(isRealText, `A reason is at least ${MINIMUM_REASON} characters, and says something.`),
  })
  .superRefine((value, ctx) => {
    if (value.listPriceFils === undefined && value.unitPriceFils === undefined) {
      ctx.addIssue({ code: 'custom', message: 'A price names the figure it is set at.' });
    }
    if (value.unitPriceFils !== undefined && value.listPriceFils !== undefined) {
      ctx.addIssue({ code: 'custom', message: 'Name the list price once.' });
    }
    if (value.unitPriceFils !== undefined && value.discount) {
      ctx.addIssue({
        code: 'custom',
        message: 'A discount is taken off listPriceFils, not off the older unitPriceFils.',
      });
    }
  })
  .transform((value) => ({
    ...value,
    listPriceFils: value.listPriceFils ?? value.unitPriceFils ?? 0,
  }));
export type CreatePriceInput = z.infer<typeof CreatePriceInput>;

export const CreatePriceResponse = z.object({
  price: PriceRow,
});
export type CreatePriceResponse = z.infer<typeof CreatePriceResponse>;

/**
 * GET /api/billing/prices/../vat-rate's answer: the VAT setting in force on
 * the requested date, never a price row's already-stamped one (a saved
 * price predates the rate a later amendment might carry).
 */
export const VatRateResponse = z.object({
  rateBasisPoints: z.number().int().min(0).max(10_000),
  effectiveFrom: IsoDate,
});
export type VatRateResponse = z.infer<typeof VatRateResponse>;
