import { z } from 'zod';
import { isValidIban } from '../../../domain/shared';
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
  'A corporate tax registration number is letters, digits and hyphens.',
);

export const PracticeAddress = z.object({
  displayAddress: z.string().nullable(),
  emirate: z.enum(EMIRATES),
  /** The verified entrance coordinate. Null only where the row predates one. */
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
});
export type PracticeAddress = z.infer<typeof PracticeAddress>;

/**
 * The number a household messages the practice on (migration 910,
 * docs/SPEC/client-portal.md section 6.4): E.164, the same shape the column's
 * own check holds, or nothing at all. A practice that has recorded none shows
 * the portal's "ask the practice" sentence without a button.
 */
export const WHATSAPP_MESSAGE = 'A WhatsApp number is +971 50 000 0000.';
const WhatsappNumber = z
  .string()
  .nullable()
  .transform((value) => {
    const cleaned = cleanText(value ?? '', 40).replace(/[\s()-]/g, '');
    return cleaned.length === 0 ? null : cleaned;
  })
  .refine((value) => value === null || /^\+[1-9][0-9]{6,14}$/.test(value), WHATSAPP_MESSAGE);

/**
 * The three facts the footer band of a rendered document is set from
 * (migration 912, docs/SPEC/billing.md section 5.6): where a reader of an
 * invoice rings, writes and looks the practice up.
 *
 * Not `whatsappNumber`, which is where a **household** messages: these go on
 * paper, and the checks below are the columns' own — light enough to accept a
 * local number written the way the practice writes it, strict enough to refuse
 * a sentence typed into the telephone field or an address with no scheme on
 * it.
 */
export const CONTACT_PHONE_MESSAGE = 'A telephone number is digits, spaces and + ( ) -.';
const ContactPhone = optional(32).refine(
  (value) => value === null || /^[0-9+()\- ]{4,32}$/.test(value),
  CONTACT_PHONE_MESSAGE,
);
export const CONTACT_EMAIL_MESSAGE = 'An email address is name@example.com.';
const ContactEmail = optional(200).refine(
  (value) => value === null || /^[^\s@]+@[^\s@]+$/.test(value),
  CONTACT_EMAIL_MESSAGE,
);
export const WEBSITE_MESSAGE = 'A website starts https:// or http://.';
const Website = optional(200).refine(
  (value) => value === null || /^https?:\/\/\S+$/.test(value),
  WEBSITE_MESSAGE,
);

/**
 * The practice's public review page (migration 920,
 * docs/SPEC/client-portal.md section 3.1 as amended 2026-09-17): what the
 * portal's review line opens. The same light check as the website, because
 * it is the same kind of thing — a page a browser can open, with its scheme.
 */
export const REVIEW_URL_MESSAGE = 'A review link starts https:// or http://.';
const ReviewUrl = optional(400).refine(
  (value) => value === null || /^https?:\/\/\S+$/.test(value),
  REVIEW_URL_MESSAGE,
);

/**
 * The practice's bank account (migration 924, round 61): what the invoice's
 * "Pay by bank transfer" block prints. Business facts of the practice, not
 * personal data, so the trail records them like any other `tenant` column.
 *
 * The checks are the columns' own, and one more: the IBAN's mod-97 check
 * digits (`domain/shared/iban.ts`), which catch a mistyped digit the shape
 * cannot and which the database deliberately does not repeat. The IBAN is
 * taken as people write it — lower case, grouped in fours — and kept
 * uppercase with the spaces out; the BIC uppercase. The holder's name and the bank's address are refused rather
 * than cut when they run long: a name shortened on its way to an invoice is a
 * name a bank may not recognise.
 */
export const IBAN_MESSAGE =
  'An IBAN is two letters, two digits, then 11 to 30 letters or digits, exactly as the bank gives it.';
export const BIC_MESSAGE = 'A BIC is 8 or 11 letters and digits.';
export const ACCOUNT_HOLDER_MESSAGE = 'The account holder is at most 120 characters.';
export const BANK_ADDRESS_MESSAGE = "The bank's address is at most 200 characters.";
export const IBAN_REQUIRED_MESSAGE =
  'An account holder, a BIC or a bank address needs the IBAN too.';
export const ACCOUNT_HOLDER_REQUIRED_MESSAGE = 'An IBAN needs the name the account is held in.';

const IBAN_SHAPE = /^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/;

/** A bank code: uppercase, spaces out, blank stored as nothing. */
function bankCode(pattern: RegExp, message: string) {
  return z
    .string()
    .nullable()
    .transform((value) => {
      const cleaned = cleanText(value ?? '', 64)
        .replace(/\s/g, '')
        .toUpperCase();
      return cleaned.length === 0 ? null : cleaned;
    })
    .refine((value) => value === null || pattern.test(value), message);
}

/** Bank text: cleaned, blank stored as nothing, refused rather than cut past `max`. */
function bankText(max: number, message: string) {
  return z
    .string()
    .nullable()
    .transform((value) => {
      const cleaned = cleanText(value ?? '', max + 1);
      return cleaned.length === 0 ? null : cleaned;
    })
    .refine((value) => value === null || Array.from(value).length <= max, message);
}

export const Bank = z.object({
  accountHolder: z.string(),
  /** Uppercase, no spaces; the invoice groups it in fours. */
  iban: z.string(),
  bic: z.string().nullable(),
  bankAddress: z.string().nullable(),
});
export type Bank = z.infer<typeof Bank>;

/**
 * The four as a save sends them: each one `string | null`, null (or blank)
 * clearing it. All four travel together, so the pairings the columns hold
 * (`tenant_bank_holder_with_iban`, `tenant_bank_details_need_iban`) can be
 * checked here before a row moves.
 */
export const BankInput = z
  .object({
    accountHolder: bankText(120, ACCOUNT_HOLDER_MESSAGE),
    iban: bankCode(IBAN_SHAPE, IBAN_MESSAGE).refine(
      // Only once the shape holds, so a malformed IBAN is refused once, not twice.
      (value) => value === null || !IBAN_SHAPE.test(value) || isValidIban(value),
      IBAN_MESSAGE,
    ),
    bic: bankCode(/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/, BIC_MESSAGE),
    bankAddress: bankText(200, BANK_ADDRESS_MESSAGE),
  })
  // The code rides in `params` so the route can answer with it rather than
  // with the sentence.
  .superRefine((value, ctx) => {
    if (
      value.iban === null &&
      (value.accountHolder !== null || value.bic !== null || value.bankAddress !== null)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['iban'],
        message: IBAN_REQUIRED_MESSAGE,
        params: { code: 'iban_required' },
      });
    } else if (value.iban !== null && value.accountHolder === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['accountHolder'],
        message: ACCOUNT_HOLDER_REQUIRED_MESSAGE,
        params: { code: 'account_holder_required' },
      });
    }
  });
export type BankInput = z.infer<typeof BankInput>;

export const Practice = z.object({
  legalName: z.string(),
  legalNameAr: z.string().nullable(),
  /** What the portal's "ask for a visit" button opens (migration 910). */
  whatsappNumber: z.string().nullable(),
  /** The three printed in the footer of every document (migration 912). */
  contactPhone: z.string().nullable(),
  contactEmail: z.string().nullable(),
  website: z.string().nullable(),
  /**
   * The review page the portal's review line opens, and null where the
   * practice shows no such line (migration 920).
   */
  reviewUrl: z.string().nullable(),
  /** The corporate-tax registration, never the VAT one (migration 905). */
  taxRegistrationNumber: z.string().nullable(),
  licenceNumber: z.string().nullable(),
  licensingAuthority: z.string().nullable(),
  licenceExpiresOn: z.string().nullable(),
  vatRegistered: z.boolean(),
  vatTrn: z.string().nullable(),
  /**
   * Whether a visit asks for a reading at all
   * (`db/migrations/918_practice_records_readings.sql`, `tenant`'s own
   * column — the practice IS the tenant row, there is no separate `practice`
   * table). Numbered in the trunk's 900-949 half rather than 950-999: a
   * `tenant` column is a trunk migration a stream may build on, not one that
   * builds on a stream's own table (OWNERSHIP.md line 109). Off by default:
   * the practice runs its brain mapping and neurofeedback on its own
   * software, so the app's own reading capability is dormant rather than
   * deleted, ready for whichever practice later wants it switched back on.
   */
  recordReadings: z.boolean(),
  /**
   * What the practice has supplied, net of VAT, over the twelve months ending
   * on `vatTaxableSuppliesAsOf` (migration 953). Read-only: it is counted from
   * the invoice book, never typed, and `UpdatePracticeInput` has no such
   * field. The screen shows it beside the VAT switch with the authority's two
   * marks; the switch itself stays a hand's act.
   */
  vatTaxableSuppliesFils: z.number().int().nonnegative(),
  /** The day that twelve-month window ends, in the practice's own zone. */
  vatTaxableSuppliesAsOf: z.string(),
  defaultEmirate: z.enum(EMIRATES),
  timezone: z.string(),
  /** The registered address, or null while the practice has recorded none. */
  address: PracticeAddress.nullable(),
  /**
   * The bank account an invoice asks to be paid into (migration 924), or
   * null while the practice has recorded no IBAN.
   */
  bank: Bank.nullable(),
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
    /**
     * Optional, like the three contact fields below it: a body that never
     * mentioned the switch leaves `tenant.record_readings` as it stands
     * rather than forcing every caller to restate it.
     */
    recordReadings: z.boolean().optional(),
    whatsappNumber: WhatsappNumber,
    /**
     * Optional: a body that omits one leaves the column as it is, and one
     * that sends it as null or blank clears it (round 61; until then a null
     * was read as "not sent"). The Practice drawer sends all three on every
     * save; a caller that never saw them need not restate them.
     */
    contactPhone: ContactPhone.optional(),
    contactEmail: ContactEmail.optional(),
    website: Website.optional(),
    /**
     * Optional too, but written whenever it is present — null included —
     * because clearing the review link is how the owner switches the
     * portal's review line off (migration 920). A body that never mentions
     * it leaves it alone, as the three above.
     */
    reviewUrl: ReviewUrl.optional(),
    /**
     * The bank account (migration 924), all four at once. Absent leaves the
     * row's four as they stand; every field null clears the account.
     */
    bank: BankInput.optional(),
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

/**
 * The practice's logo: the two formats a PDF can carry, and a cap.
 *
 * PNG or JPEG and nothing else, because the renderer will draw one as an
 * `/XObject` — a PNG's pixels, or a JPEG passed straight through as
 * `/DCTDecode` (docs/CHANGE-REQUESTS/billing-04.md request 5) — and migration
 * 909 holds the same rule as a check constraint. An SVG is deliberately not
 * on the list: it is a document that can carry script, and it is not
 * something a PDF draws.
 */
export const LOGO_MIME_TYPES = ['image/png', 'image/jpeg'] as const;
export type LogoMimeType = (typeof LOGO_MIME_TYPES)[number];

/**
 * 500 KB, and **500,000 bytes rather than 512 × 1024**, because the number the
 * screen says is the number the server keeps. A person told "up to 500 KB" who
 * is refused a 505,000-byte file has been told something untrue; the kibibyte
 * is the right unit for a buffer and the wrong one for a label.
 *
 * It is a great deal of room for a mark at the top of an invoice and still
 * small enough that the file travels in one JSON body. The API's own body cap
 * is `BODY_LIMIT_BYTES`, 64 KiB, and this is the one route that needs more
 * (`app/api/create-api.ts` gives it its own, larger cap for that reason and no
 * other). Base64 costs four characters for every three bytes, so the envelope
 * has to leave room for a third again on top; `logo-limits.test.ts` pins the
 * arithmetic so neither constant can move without the other.
 */
export const MAX_LOGO_BYTES = 500_000;
/** The longest `bytesBase64` may be, padding included. */
export const MAX_LOGO_BASE64_LENGTH = Math.ceil(MAX_LOGO_BYTES / 3) * 4;
/** Room for the rest of the JSON: the media type, the braces, the field names. */
export const LOGO_ENVELOPE_ALLOWANCE_BYTES = 2 * 1024;

// Standard base64, padded, no line breaks: what btoa and Buffer.toString('base64')
// produce. The URL-safe alphabet is deliberately not accepted — one encoding in,
// so a caller cannot smuggle bytes past a length check by choosing the other.
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** The logo on its way in: what it is, and the file itself. */
export const UploadLogoInput = z.object({
  mimeType: z.enum(LOGO_MIME_TYPES),
  bytesBase64: z
    .string()
    .min(1, 'A logo needs a file.')
    .max(MAX_LOGO_BASE64_LENGTH, 'That file is larger than the practice logo may be.')
    .regex(BASE64, 'The file must be standard base64.'),
});
export type UploadLogoInput = z.infer<typeof UploadLogoInput>;

/**
 * What `GET /api/practice/logo` and `POST /api/practice/logo` answer: the
 * document's id, a short-lived link to its bytes, and how long that link
 * lives. Never a permanent URL and never the bytes themselves (docs/SEAMS.md).
 */
export const PracticeLogo = z.object({
  documentId: z.string(),
  mimeType: z.enum(LOGO_MIME_TYPES),
  url: z.string(),
  expiresInSeconds: z.number().int().positive(),
});
export type PracticeLogo = z.infer<typeof PracticeLogo>;

export const PracticeLogoResponse = z.object({ logo: PracticeLogo });
export type PracticeLogoResponse = z.infer<typeof PracticeLogoResponse>;
