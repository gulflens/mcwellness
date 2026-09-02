/**
 * The Emirates ID's pure, browser-safe shape: parsing, validation-adjacent
 * normalisation and display formatting. No I/O, no crypto, no Node built-in —
 * safe for any screen to import, directly or through the `domain/shared`
 * barrel. The value itself is never stored in plain text; the keyed
 * fingerprint and seal that do that work live in `domain/shared/identity.ts`,
 * which is server-only and imports the normaliser back from here.
 */

export const EMIRATES_ID_DIGITS = 15;

/** Digits only, fifteen of them, starting 784: the canonical form that is hashed and sealed. */
export function normaliseEmiratesId(input: string): string {
  const digits = input.replace(/[^0-9]/g, '');
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
