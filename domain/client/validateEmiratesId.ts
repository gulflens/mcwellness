import { EMIRATES_ID_DIGITS, normaliseEmiratesId } from '../shared/emirates-id';

export type EmiratesIdValidation =
  { ok: true; normalised: string } | { ok: false; reason: 'length' | 'prefix' | 'checksum' };

/**
 * Sums every digit, doubling every second one counting inward from the check
 * digit and folding a doubled value over nine, per the Luhn algorithm. Valid
 * when the total is a multiple of ten.
 */
function passesLuhn(digits: string): boolean {
  let sum = 0;
  for (let index = 0; index < digits.length; index++) {
    const positionFromRight = digits.length - index;
    let value = Number(digits[index]);
    if (positionFromRight % 2 === 0) {
      value *= 2;
      if (value > 9) {
        value -= 9;
      }
    }
    sum += value;
  }
  return sum % 10 === 0;
}

/**
 * Fifteen digits, starting 784, with a valid Luhn check digit as the last one
 * (docs/SPEC/client-record.md rule 4). No expiry check, by decision: an
 * Emirates ID does not stop identifying its holder when the physical card
 * lapses. Only called when a contact has offered one; never required to
 * enrol (docs/SPEC/00-data-model.md section 3).
 */
export function validateEmiratesId(raw: string): EmiratesIdValidation {
  const digits = raw.replace(/[^0-9]/g, '');

  if (digits.length !== EMIRATES_ID_DIGITS) {
    return { ok: false, reason: 'length' };
  }
  if (!digits.startsWith('784')) {
    return { ok: false, reason: 'prefix' };
  }
  if (!passesLuhn(digits)) {
    return { ok: false, reason: 'checksum' };
  }
  return { ok: true, normalised: normaliseEmiratesId(digits) };
}
