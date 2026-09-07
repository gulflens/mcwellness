import { formatFils } from '@domain/shared';

/**
 * Money on the Books screens: formatted in one place and parsed in one place
 * (CLAUDE.md's money rule). `formatFils` lives in `domain/shared/fils.ts`
 * beside the `Fils` type and is re-exported here so every component on this
 * screen reaches it through its own stream's path; the parser below is copied
 * from `app/admin/billing/money.ts` rather than imported, because a stream does
 * not reach into another stream's `app/` folder (docs/SPEC/OWNERSHIP.md rule 3).
 *
 * Both directions are exact. An amount is never multiplied or divided as a
 * floating-point number: `parseAedToFils` reads the whole and fractional parts
 * as integers, so "0.1" becomes 10 rather than the 10.000000000000002 that
 * `0.1 * 100` gives in IEEE 754.
 */
export { formatFils };

/**
 * A non-negative AED amount with an optional one- or two-digit fraction,
 * written plainly or with thousands separators: "0", "120", "12.3", "12.34",
 * "12,150.00". Grouping is accepted because `formatFils` writes it, and a
 * parser that refused its own output would refuse a figure this screen had
 * just handed the person. Only well-formed grouping passes, so a European
 * decimal comma is still refused rather than read a hundredfold.
 */
const AED_INPUT = /^(\d+|[1-9]\d{0,2}(?:,\d{3})+)(?:\.(\d{1,2}))?$/;

/** `journal_line.debit_fils` is bigint, but a line a person types is bounded here. */
export const AED_MAX_FILS = 2_147_483_647;

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

/** The exact number of fils an AED string names, or null when it names none. */
export function parseAedToFils(input: string): number | null {
  const total = readAedFils(input);
  if (total === null || total > AED_MAX_FILS) {
    return null;
  }
  return total;
}

/** True only for a well-formed amount that is larger than a line may carry. */
export function isAedAmountTooLarge(input: string): boolean {
  const total = readAedFils(input);
  return total !== null && total > AED_MAX_FILS;
}

const PRACTICE_TIME_ZONE = 'Asia/Dubai';

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: PRACTICE_TIME_ZONE,
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/** A calendar day read at the practice's midnight, never UTC's. */
export function formatDate(isoDate: string): string {
  return dateFormat.format(new Date(`${isoDate}T00:00:00+04:00`));
}
