import {
  applyDiscount,
  callOutFeeFor,
  combineDiscounts,
  formatFils,
  resolveVat,
  type AppliedDiscount,
  type CallOutFeeSetting,
  type VatSetting,
} from '@domain/billing';
import { fils } from '@domain/shared';

/**
 * The formatter itself lives in `domain/shared/fils.ts`, beside the `Fils`
 * type. It went to `domain/billing/money.ts` first, when the rendered invoice
 * needed it — a PDF is drawn by pure code that cannot reach into `app/`, and
 * two formatters that happen to agree is exactly what CLAUDE.md's one-place
 * rule exists to prevent — and on to `domain/shared` when two more streams
 * wanted it and `docs/SPEC/OWNERSHIP.md` rule 3 stood between them and
 * billing's domain (`docs/CHANGE-REQUESTS/scheduling-04.md` section 4).
 *
 * It is re-exported here so every screen keeps its import, and what stays in
 * this file is the half that is genuinely the browser's: reading an amount a
 * person typed.
 */
export { formatFils };

/**
 * And the rule for what a visit that did not happen costs a household
 * (the founder's decision of 2026-09-04: one fee, never a session). It lives
 * in `domain/billing/lateCancellation.ts`, beside the notice period, because
 * it is a money rule; it is re-exported here for the same reason `formatFils`
 * is — so a screen outside billing's own folder reaches it through billing's
 * `app/` layer rather than through billing's `domain/`, which
 * docs/SPEC/OWNERSHIP.md rule 3 forbids. The cancel drawer
 * (`app/admin/schedule/CancelAppointmentDrawer.tsx`) is the screen that needs
 * it: it says what calling a visit off will cost while the coordinator can
 * still change their mind.
 */
export { callOutFeeFor };
export type { CallOutFeeSetting };

/**
 * Money is displayed and parsed in exactly one place (CLAUDE.md's "Money"
 * rule: doubles are banned for money everywhere; there is one formatter).
 * Both directions are exact: an amount is never multiplied or divided as a
 * floating-point number. `formatFils` reads the fils integer as two integer
 * parts (whole AED and remaining fils); `parseAedToFils` reads a typed AED
 * string the same way, so "0.1" becomes 10 and "0.2" becomes 20 without ever
 * computing `0.1 * 100` (which drifts to 10.000000000000002 in IEEE 754).
 *
 * `formatFils` returns the bare figure ("1,234.56"), not "AED 1,234.56": the
 * currency word is named once — the "Unit price (AED)" table header, the
 * price field's own label — not repeated on every cell and preview row
 * (docs/DESIGN-BRIEF.md's silence-by-default: a word that means the same
 * thing on every row belongs to the column, not the cell).
 */

/**
 * A non-negative AED amount with an optional one- or two-digit fraction,
 * written plainly or with thousands separators: "0", "120", "12.3", "12.34",
 * "12,150.00".
 *
 * **Grouping is accepted because this file writes it.** `formatFils` returns
 * "12,150.00", and two drawers put that figure straight back into a field the
 * person may then submit unchanged: the package drawer offers the contents'
 * total as the list price, and the payment drawer offers the outstanding
 * amount. A parser that refused a comma refused its own output, so a founder
 * building the practice's Silver programme was told to "enter both prices in
 * AED" about the very figure the screen had just handed her.
 *
 * Only well-formed grouping passes — "1,234.56" yes, "12,34" and "1,23,456"
 * no — so a European decimal comma is still refused outright rather than
 * quietly read as a thousands separator and paid a hundredfold.
 */
const AED_INPUT = /^(\d+|[1-9]\d{0,2}(?:,\d{3})+)(?:\.(\d{1,2}))?$/;

/**
 * The `price.unit_price_fils` column is Postgres `integer` (int4); this is
 * its largest value, AED 21,474,836.47. `parseAedToFils` refuses anything
 * above it before a request is ever sent, rather than letting the server's
 * own column check turn it into a generic 400.
 */
export const AED_MAX_FILS = 2_147_483_647;

/**
 * A live estimate of VAT and the gross total for the "add a price" drawer,
 * computed by the same `resolveVat` (`domain/billing/vat.ts`) the server
 * calls to stamp a saved price — the browser and the server run one
 * arithmetic, not two that happen to agree. The `version` on the setting
 * passed here is a placeholder: nothing has been saved yet, so there is no
 * real `vat_setting` row to cite, and the caller only reads `vatFils` and
 * `grossFils` back out. The server's own call
 * (`app/api/billing/prices.ts`) remains the one place a saved price's VAT
 * is actually computed and stamped; this only estimates the number shown
 * before that request is made.
 */
export function previewVat(
  netFils: number,
  vatRateBasisPoints: number,
): { vatFils: number; grossFils: number } {
  const setting: VatSetting = { rateBasisPoints: vatRateBasisPoints, version: 0 };
  const resolution = resolveVat(fils(netFils), setting);
  return { vatFils: resolution.vatFils, grossFils: resolution.grossFils };
}

/**
 * The exact number of fils an AED string names, or `null` when it is not an
 * AED amount at all. The whole and fractional parts are read as integers and
 * only ever added, never produced by multiplying a decimal — so "0.1"
 * converts to 10 exactly, where `0.1 * 100` drifts to 10.000000000000002 in
 * IEEE 754. The column's own ceiling is not applied here: the two callers
 * below differ only in what they do about it.
 */
function readAedFils(input: string): number | null {
  const match = AED_INPUT.exec(input.trim());
  if (!match) {
    return null;
  }
  const wholeAed = Number((match[1] ?? '0').replaceAll(',', ''));
  const fractionFils = Number((match[2] ?? '').padEnd(2, '0'));
  if (!Number.isSafeInteger(wholeAed)) {
    return null;
  }
  const total = wholeAed * 100 + fractionFils;
  return Number.isSafeInteger(total) ? total : null;
}

/**
 * Parses an AED amount typed by a person, or offered by this file's own
 * `formatFils` ("12.34", "12,150.00"), into an exact integer number of fils.
 * Returns `null` for anything that is not a non-negative amount with at most
 * two decimal places (empty input, a negative sign, more than two decimals,
 * misplaced grouping), and for an amount above `AED_MAX_FILS` — the database
 * column's own ceiling, checked here rather than left to a 400 the caller can
 * only show as "something went wrong".
 */
export function parseAedToFils(input: string): number | null {
  const total = readAedFils(input);
  if (total === null || total > AED_MAX_FILS) {
    return null;
  }
  return total;
}

/**
 * True only for the one shape of `parseAedToFils` returning `null` that
 * deserves its own message: a well-formed AED amount that exceeds
 * `AED_MAX_FILS`. Every other `null` (empty input, letters, a negative sign,
 * misplaced grouping) is the generic "not a price" case instead.
 */
export function isAedAmountTooLarge(input: string): boolean {
  const total = readAedFils(input);
  return total !== null && total > AED_MAX_FILS;
}

/**
 * How a discount was chosen on a drawer: nothing, a share, or a sum.
 * `DiscountFields` sets it and the parent reads it back.
 */
export type DiscountKind = 'none' | 'percent' | 'amount';

/**
 * A percentage a person typed, as basis points: "15" is 1500 and "12.55" is
 * 1255. Two decimal places, which is a hundredth of a per cent — finer than
 * anybody prices in and exactly what the column holds. `null` when it is not a
 * percentage between nought and a hundred.
 *
 * Read as two integers and added, never `Number(x) * 100`, for the reason
 * `parseAedToFils` gives: a decimal multiplied as a float drifts.
 */
const PERCENT_INPUT = /^(\d{1,3})(?:\.(\d{1,2}))?$/;

export function parsePercentToBasisPoints(input: string): number | null {
  const match = PERCENT_INPUT.exec(input.trim());
  if (!match) {
    return null;
  }
  const whole = Number(match[1] ?? '0');
  const fraction = Number((match[2] ?? '').padEnd(2, '0'));
  const basisPoints = whole * 100 + fraction;
  return basisPoints > 10_000 ? null : basisPoints;
}

/**
 * What a discount comes to, before anything is sent: the same
 * `applyDiscount` (`domain/billing/discount.ts`) the server calls when it
 * writes the row, so the figure on the screen and the figure on the invoice
 * are one arithmetic rather than two that happen to agree — exactly the
 * arrangement `previewVat` above has for VAT.
 *
 * `null` when the typed value is not a figure of that kind, or when the
 * discount is larger than the list price. The caller shows the field's own
 * message; the server refuses the same request with `discount_too_large`.
 */
export function previewDiscount(
  listFils: number,
  kind: DiscountKind,
  typed: string,
): AppliedDiscount | null {
  if (kind === 'none') {
    return applyDiscount(fils(listFils), null);
  }
  const discount =
    kind === 'percent'
      ? (() => {
          const basisPoints = parsePercentToBasisPoints(typed);
          return basisPoints === null ? null : ({ kind: 'percent', basisPoints } as const);
        })()
      : (() => {
          const amount = parseAedToFils(typed);
          return amount === null ? null : ({ kind: 'amount', fils: fils(amount) } as const);
        })();
  if (discount === null) {
    return null;
  }
  try {
    return applyDiscount(fils(listFils), discount);
  } catch {
    return null;
  }
}

/** The body a route wants, from what the drawer holds. `null` is no discount. */
export function discountBody(
  kind: DiscountKind,
  typed: string,
): { kind: 'percent'; basisPoints: number } | { kind: 'amount'; fils: number } | null {
  if (kind === 'percent') {
    const basisPoints = parsePercentToBasisPoints(typed);
    return basisPoints === null ? null : { kind: 'percent', basisPoints };
  }
  if (kind === 'amount') {
    const amount = parseAedToFils(typed);
    return amount === null ? null : { kind: 'amount', fils: amount };
  }
  return null;
}

/**
 * The same, for a sale: the price list's own discount and the extra one this
 * sale is giving, combined once against the list figure by
 * `combineDiscounts` — the function the server calls. `null` when the typed
 * value is not a figure of that kind, or when the two together come to more
 * than the list price.
 */
export function previewSaleDiscount(
  listFils: number,
  standing: { discountFils: number; basisPoints: number | null },
  kind: DiscountKind,
  typed: string,
): AppliedDiscount | null {
  const extra = kind === 'none' ? null : discountBody(kind, typed);
  if (kind !== 'none' && extra === null) {
    return null;
  }
  try {
    return combineDiscounts(
      fils(listFils),
      { discountFils: fils(standing.discountFils), basisPoints: standing.basisPoints },
      extra === null
        ? null
        : extra.kind === 'percent'
          ? extra
          : { kind: 'amount', fils: fils(extra.fils) },
    );
  } catch {
    return null;
  }
}

/**
 * A discount in a table cell: the share when that is how it was set, the sum
 * when it was a sum, and an em dash when there is none. One rendering, used by
 * the price list, the bundle catalogue and the invoice book, so a reader
 * learns the column once.
 */
export function formatDiscount(row: {
  discountFils: number;
  discountBasisPoints: number | null;
}): string {
  if (row.discountFils <= 0) {
    return '—';
  }
  return row.discountBasisPoints === null
    ? formatFils(row.discountFils)
    : `${row.discountBasisPoints / 100}%`;
}
