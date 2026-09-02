/**
 * Free text from a caller is cleaned before anything reads it: normalised to
 * one Unicode form, stripped of control and invisible characters and of the
 * bidirectional overrides that can make text read as something it is not,
 * collapsed to single spaces, trimmed and capped. Pure.
 *
 * The character classes are built from code points so this source file holds
 * none of the characters it removes: a file that contained them would trip the
 * very scanners that guard against them.
 */

const cp = (n: number): string => String.fromCodePoint(n);
const span = (from: number, to: number): string => `${cp(from)}-${cp(to)}`;

// C0 and C1 controls except tab, newline and carriage return (collapsed below),
// zero-width characters (U+200B to U+200D), the word joiner (U+2060) and the
// byte order mark (U+FEFF).
const CONTROLS = new RegExp(
  `[${span(0x00, 0x08)}${span(0x0b, 0x0c)}${span(0x0e, 0x1f)}${span(0x7f, 0x9f)}${span(0x200b, 0x200d)}${cp(0x2060)}${cp(0xfeff)}]`,
  'g',
);
// Bidirectional embeddings, overrides (U+202A to U+202E) and isolates (U+2066 to U+2069).
const BIDI = new RegExp(`[${span(0x202a, 0x202e)}${span(0x2066, 0x2069)}]`, 'g');

export function cleanText(value: string, max: number): string {
  return value
    .normalize('NFC')
    .replace(CONTROLS, '')
    .replace(BIDI, '')
    .replace(/[\t\n\r]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim()
    .slice(0, max)
    .trim();
}
