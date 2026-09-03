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
 * non-breaking spaces, zero-width joiners, brackets, a stray plus — folds
 * Arabic-Indic digits to Latin first, because an Arabic keyboard is a first
 * class way to type a number here, and finds a whole number anywhere in the
 * run rather than only at its start. Being generous costs almost nothing: it
 * turns away a term whose digits open 784 or contain a whole identity number,
 * and — through the two-digit floor below — one whose whole digit run is 7 or
 * 78. `q` searches names and record numbers, and a record number reads
 * MW-000001, so the terms lost are theoretical.
 *
 * It lives here rather than in `domain/client` or `domain/shared` because
 * both are the shared zone; `docs/CHANGE-REQUESTS/client-record-02.md` CR-06
 * asks for the fold to move to `domain/shared/emirates-id.ts`, beside the
 * normaliser it exists to feed, and says what becomes of this file when it
 * does.
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

// A whole Emirates ID anywhere in the digit run, not only at its start. The
// security review of pull request 35 found the anchored version blind to a
// complete number with anything in front of it — "MW-1 784-1900-0000013-4",
// or a stray leading zero — which was therefore neither refused from `?q=`
// nor routed to the lookup, and reached the query string entire.
const EMBEDDED = /784\d{12}/;
// The same, but not running on into a sixteenth digit. A term that does is a
// typo, not a number: it is still refused from `?q=` (EMBEDDED matches), and
// the screen asks for the number again rather than quietly searching for the
// first fifteen digits of something the person did not type.
const EMBEDDED_WHOLE = /784\d{12}(?!\d)/;

/**
 * True when the term is an Emirates ID being typed, or holds a whole one
 * anywhere inside it. The two-digit floor lets "7" and "78" count as the
 * start of one; both are below the search's own minimum term length in any
 * case.
 */
export function isEmiratesIdShaped(term: string): boolean {
  const digits = digitsOf(term);
  if (digits.length === 0) return false;
  if (EMBEDDED.test(digits)) return true;
  return digits.length < 3 ? '784'.startsWith(digits) : digits.startsWith('784');
}

/**
 * The fifteen digits when the term holds a whole one — wherever in the term
 * it sits — and null while it does not. Returning the embedded match is what
 * routes such a term to the lookup rather than leaving it stuck behind the
 * "keep typing" hint with nowhere to go.
 */
export function wholeEmiratesIdDigits(term: string): string | null {
  return EMBEDDED_WHOLE.exec(digitsOf(term))?.[0] ?? null;
}
