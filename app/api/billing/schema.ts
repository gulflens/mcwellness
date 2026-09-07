import { z } from 'zod';
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

export const PriceRow = z.object({
  id: z.uuid(),
  serviceTypeId: z.uuid(),
  serviceTypeCode: z.string(),
  serviceTypeName: z.string(),
  serviceTypeNameAr: z.string().nullable(),
  unitPriceFils: z.number().int().nonnegative(),
  vatRateBasisPoints: z.number().int().min(0).max(10_000),
  vatFils: z.number().int().nonnegative(),
  grossFils: z.number().int().nonnegative(),
  /** YYYY-MM-DD. Inclusive: the price applies from this day on. */
  validFrom: z.string(),
  /** The price this one replaces; null only for a service's first price. */
  supersedesId: z.uuid().nullable(),
  amendmentReason: z.string(),
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
 * ".", "aaaaaaaa". These appear on price changes, waivers and extensions —
 * the three places where somebody gave money away or took a charge back — and
 * the whole purpose of the field is that a person later can see what
 * happened. So: at least eight characters after trimming, and not the same
 * character repeated, which is what a required field collects when nobody
 * means to fill it in.
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

export const CreatePriceInput = z.object({
  serviceTypeId: z.uuid(),
  unitPriceFils: z.number().int().nonnegative().max(INT4_MAX),
  validFrom: IsoDate,
  /** Why: required on every price, including a service's first. */
  /**
   * Why, in enough words to be worth reading a year later. The same rule the
   * ledger's own reasons carry (app/api/billing/ledger-schema.ts): eight
   * characters of real text, not one, and not the same character repeated.
   */
  amendmentReason: z
    .string()
    .transform((value) => cleanText(value, 200))
    .refine(isRealText, `A reason is at least ${MINIMUM_REASON} characters, and says something.`),
});
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
