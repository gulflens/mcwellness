import { splitE164 } from '@domain/shared';
import { DIALLING_CODES } from './countries';

/**
 * A stored E.164 number as a person reads it: "+971 50 000 0071" rather than
 * "+971500000071" (the operator's Phase 1 brief, 2026-10-16). Display only:
 * the stored value is never changed, and taking the spaces out gives it back
 * exactly, which the tests hold.
 *
 * Only the UAE's own two shapes are grouped, because those are the numbers
 * the practice holds and the grouping people there write by hand: a mobile
 * (5, nine digits) as 50 000 0071 and a landline (a one-digit area code,
 * eight digits) as 4 000 0071. Any other number is split after its dialling
 * code alone, which is never wrong, rather than grouped on a guess about
 * another country's plan. Anything that is not E.164 is shown as stored.
 */
export function displayPhone(stored: string): string {
  const split = splitE164(stored, DIALLING_CODES);
  if (!split) return stored;
  const { diallingCode, national } = split;
  if (diallingCode === '+971') {
    const mobile = /^(5\d)(\d{3})(\d{4})$/.exec(national);
    if (mobile) return `${diallingCode} ${mobile.slice(1).join(' ')}`;
    const landline = /^([234679])(\d{3})(\d{4})$/.exec(national);
    if (landline) return `${diallingCode} ${landline.slice(1).join(' ')}`;
  }
  return `${diallingCode} ${national}`;
}
