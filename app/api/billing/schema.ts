import { z } from 'zod';

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
});
export type PriceRow = z.infer<typeof PriceRow>;

export const PricesResponse = z.object({
  prices: z.array(PriceRow),
});
export type PricesResponse = z.infer<typeof PricesResponse>;

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Dates are YYYY-MM-DD.');

export const CreatePriceInput = z.object({
  serviceTypeId: z.uuid(),
  unitPriceFils: z.number().int().nonnegative(),
  validFrom: IsoDate,
});
export type CreatePriceInput = z.infer<typeof CreatePriceInput>;

export const CreatePriceResponse = z.object({
  price: PriceRow,
});
export type CreatePriceResponse = z.infer<typeof CreatePriceResponse>;
