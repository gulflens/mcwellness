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
});
export type PricesResponse = z.infer<typeof PricesResponse>;

/** The price column is Postgres integer (int4); this is its largest value. */
const INT4_MAX = 2_147_483_647;

/**
 * YYYY-MM-DD, and a real calendar date: 2026-13-45 matches the shape but
 * names no day that exists, so it fails here — a 400, not a database error
 * surfacing as a 500.
 */
const IsoDate = z
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

export const CreatePriceInput = z.object({
  serviceTypeId: z.uuid(),
  unitPriceFils: z.number().int().nonnegative().max(INT4_MAX),
  validFrom: IsoDate,
  /** Why: required on every price, including a service's first. */
  amendmentReason: z
    .string()
    .transform((value) => cleanText(value, 200))
    .refine((value) => value.length >= 1, 'A reason is required.'),
});
export type CreatePriceInput = z.infer<typeof CreatePriceInput>;

export const CreatePriceResponse = z.object({
  price: PriceRow,
});
export type CreatePriceResponse = z.infer<typeof CreatePriceResponse>;
