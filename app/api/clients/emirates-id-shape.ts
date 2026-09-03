/**
 * Whether a search term is an Emirates ID being typed. One rule, in one
 * place, because both sides of the search enforce it and they must not drift:
 * the browser refuses to put such a term in a query string
 * (app/admin/clients/ClientsPage.tsx) and `GET /api/clients` refuses to
 * search one (app/api/clients/list.ts), so a hand-written request cannot do
 * what the console will not.
 *
 * Browser-safe on purpose: pure string work, no Node built-in, no crypto, no
 * I/O. The keyed fingerprint an identity number is actually found by is the
 * server's alone (domain/shared/identity.ts).
 *
 * Deliberately generous about what counts. It reads the digits through any
 * separator a person or a paste can put between them — hyphens, spaces,
 * non-breaking spaces, zero-width joiners, brackets, a stray plus — and folds
 * Arabic-Indic digits to Latin first, because an Arabic keyboard is a first
 * class way to type a number here. Being generous costs nothing: the only
 * terms it turns away are those whose digits open 784, and a record number
 * reads MW-000001.
 */

const ARABIC_INDIC = 0x0660; // ٠ to ٩
const EXTENDED_ARABIC_INDIC = 0x06f0; // ۰ to ۹

/** Arabic-Indic and Extended Arabic-Indic digits as their Latin counterparts. */
export function toLatinDigits(value: string): string {
  return Array.from(value)
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      if (code >= ARABIC_INDIC && code <= ARABIC_INDIC + 9) {
        return String(code - ARABIC_INDIC);
      }
      if (code >= EXTENDED_ARABIC_INDIC && code <= EXTENDED_ARABIC_INDIC + 9) {
        return String(code - EXTENDED_ARABIC_INDIC);
      }
      return character;
    })
    .join('');
}

/** Every digit in the term, in order, whatever sat between them. */
export function digitsOf(term: string): string {
  return toLatinDigits(term).replace(/[^0-9]/g, '');
}

/**
 * True when the term's digits open 784 — an Emirates ID whole, half typed, or
 * pasted with anything at all between its groups. The two-digit floor lets
 * "7" and "78" count as the start of one; both are below the search's own
 * minimum term length in any case.
 */
export function isEmiratesIdShaped(term: string): boolean {
  const digits = digitsOf(term);
  if (digits.length === 0) return false;
  return digits.length < 3 ? '784'.startsWith(digits) : digits.startsWith('784');
}

/** The fifteen digits when the term holds a whole one, and null while it does not. */
export function wholeEmiratesIdDigits(term: string): string | null {
  const digits = digitsOf(term);
  return digits.length === 15 && digits.startsWith('784') ? digits : null;
}
