/**
 * The Emirates ID's pure, browser-safe shape: parsing, validation-adjacent
 * normalisation and display formatting. No I/O, no crypto, no Node built-in —
 * safe for any screen to import, directly or through the `domain/shared`
 * barrel. The value itself is never stored in plain text; the keyed
 * fingerprint and seal that do that work live in `domain/shared/identity.ts`,
 * which is server-only and imports the normaliser back from here.
 */

export const EMIRATES_ID_DIGITS = 15;

const ARABIC_INDIC = 0x0660; // ٠ to ٩
const EXTENDED_ARABIC_INDIC = 0x06f0; // ۰ to ۹

/**
 * Arabic-Indic and Extended Arabic-Indic digits as their Latin counterparts;
 * everything else untouched. An Arabic keyboard is an ordinary way to type a
 * number in this practice (CLAUDE.md: Arabic is a first-class layout), so the
 * fold lives where the normalising happens rather than in each caller
 * (docs/CHANGE-REQUESTS/client-record-02.md CR-06).
 */
export function toLatinDigits(input: string): string {
  return Array.from(input)
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      if (code >= ARABIC_INDIC && code <= ARABIC_INDIC + 9) return String(code - ARABIC_INDIC);
      if (code >= EXTENDED_ARABIC_INDIC && code <= EXTENDED_ARABIC_INDIC + 9) {
        return String(code - EXTENDED_ARABIC_INDIC);
      }
      return character;
    })
    .join('');
}

/** Digits only, fifteen of them, starting 784: the canonical form that is hashed and sealed. */
export function normaliseEmiratesId(input: string): string {
  const digits = toLatinDigits(input).replace(/[^0-9]/g, '');
  if (digits.length !== EMIRATES_ID_DIGITS || !digits.startsWith('784')) {
    throw new Error('An Emirates ID is fifteen digits starting 784.');
  }
  return digits;
}

/** 784-1900-1234567-1: the display form. Never stored. */
export function formatEmiratesId(input: string): string {
  const d = normaliseEmiratesId(input);
  return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7, 14)}-${d.slice(14)}`;
}
