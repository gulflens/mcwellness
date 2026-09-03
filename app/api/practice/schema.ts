import { z } from 'zod';
import { cleanText } from '../_middleware/text';

/**
 * What the practice says it is: the shapes `GET /api/practice` returns and
 * `PATCH /api/practice` accepts (migration 905, docs/SPEC/00-data-model.md
 * section 2). Imported by the route and by the Practice settings screen.
 *
 * These are the facts a tax invoice carries about the supplier, so every one
 * of them is validated here rather than trusted from a form: a legal name
 * that is blank, a licence expiry that is not a date, a VAT number that is
 * not the Federal Tax Authority's fifteen digits, or a registration switched
 * on with no number to print are all refused before a row moves.
 */

/**
 * The seven emirates, as the Postgres `emirate` enum holds them
 * (030_location.sql). Written out here rather than imported from a stream's
 * own copy: `domain/client/types.ts` and `app/api/clients/record-schema.ts`
 * each carry the same list and belong to the client-record worktree.
 */
export const EMIRATES = ['DXB', 'AUH', 'SHJ', 'AJM', 'UAQ', 'RAK', 'FUJ'] as const;
export type Emirate = (typeof EMIRATES)[number];

/**
 * YYYY-MM-DD, and a day that exists: 2026-02-31 matches the shape and names
 * no date, so it is refused here as a 400 rather than surfacing as a database
 * error later.
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

/** Text a person typed: cleaned, then required to still say something. */
function required(max: number) {
  return z
    .string()
    .transform((value) => cleanText(value, max))
    .refine((value) => value.length > 0, 'This cannot be blank.');
}

/** The same, but blank is a real answer and is stored as nothing at all. */
function optional(max: number) {
  return z
    .string()
    .nullable()
    .transform((value) => {
      const cleaned = cleanText(value ?? '', max);
      return cleaned.length === 0 ? null : cleaned;
    });
}

/** A registration number: cleaned, stripped of the spaces people type into one. */
function registration(max: number) {
  return z
    .string()
    .nullable()
    .transform((value) => {
      const cleaned = cleanText(value ?? '', max).replace(/\s/g, '');
      return cleaned.length === 0 ? null : cleaned;
    });
}

/**
 * The Federal Tax Authority's format for a VAT registration: fifteen digits.
 * The database holds the same rule as a check constraint (migration 905), so
 * this refuses a typo with a sentence rather than a constraint violation.
 */
export const VAT_TRN_DIGITS = 15;
const VatTrn = registration(40).refine(
  (value) => value === null || new RegExp(`^\\d{${VAT_TRN_DIGITS}}$`).test(value),
  `A VAT registration number is ${VAT_TRN_DIGITS} digits.`,
);

/**
 * The corporate-tax registration the practice already holds. Deliberately
 * looser than the VAT number above: it is not the number an invoice prints as
 * a VAT registration, and refusing a shape nobody has confirmed would be a
 * rule invented here rather than one the tax authority set.
 */
const TaxRegistration = registration(40).refine(
  (value) => value === null || /^[A-Za-z0-9-]{5,30}$/.test(value),
  'A tax registration number is letters, digits and hyphens.',
);

export const PracticeAddress = z.object({
  displayAddress: z.string().nullable(),
  emirate: z.enum(EMIRATES),
  /** The verified entrance coordinate. Null only where the row predates one. */
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
});
export type PracticeAddress = z.infer<typeof PracticeAddress>;

export const Practice = z.object({
  legalName: z.string(),
  legalNameAr: z.string().nullable(),
  /** The corporate-tax registration, never the VAT one (migration 905). */
  taxRegistrationNumber: z.string().nullable(),
  licenceNumber: z.string().nullable(),
  licensingAuthority: z.string().nullable(),
  licenceExpiresOn: z.string().nullable(),
  vatRegistered: z.boolean(),
  vatTrn: z.string().nullable(),
  defaultEmirate: z.enum(EMIRATES),
  timezone: z.string(),
  /** The registered address, or null while the practice has recorded none. */
  address: PracticeAddress.nullable(),
});
export type Practice = z.infer<typeof Practice>;

export const PracticeResponse = z.object({ practice: Practice });
export type PracticeResponse = z.infer<typeof PracticeResponse>;

const AddressInput = z.object({
  displayAddress: required(300),
  emirate: z.enum(EMIRATES),
  // Optional here and required by the route the first time an address is
  // recorded: `location.entrance_point` is not null (030_location.sql), so a
  // row cannot be created without one, and an edit that leaves both out keeps
  // the coordinate already on record.
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
});

/**
 * The whole form, saved at once. A settings screen is not a stream of
 * separate amendments: the VAT switch and its number in particular have to
 * arrive together or the pair can be left half-recorded.
 */
export const UpdatePracticeInput = z
  .object({
    legalName: required(200),
    legalNameAr: optional(200),
    taxRegistrationNumber: TaxRegistration,
    licenceNumber: optional(60),
    licensingAuthority: optional(120),
    licenceExpiresOn: IsoDate.nullable(),
    vatRegistered: z.boolean(),
    vatTrn: VatTrn,
    address: AddressInput.nullable(),
  })
  .refine((value) => !value.vatRegistered || value.vatTrn !== null, {
    path: ['vatTrn'],
    message: 'A VAT registration needs the number that will be printed on invoices.',
  })
  // Half a coordinate is not a place. Both or neither.
  .refine(
    (value) =>
      value.address === null ||
      (value.address.latitude === null) === (value.address.longitude === null),
    { path: ['address'], message: 'A coordinate needs both a latitude and a longitude.' },
  );
export type UpdatePracticeInput = z.infer<typeof UpdatePracticeInput>;
