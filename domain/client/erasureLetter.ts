/**
 * The confirmation letter a person gets when their record has been erased
 * (docs/SPEC/client-record.md section 8 step 5; the drafts live in
 * docs/CONSENT/erasure-letter/, one per language, and are the practice's own
 * words rather than this file's).
 *
 * Pure, like every rule in domain/: the template comes in as text, the clock
 * comes in as an argument, and what goes out is the letter. Reading the file
 * and filing the result as a document is the route's work
 * (app/api/clients/erasure-letter.ts).
 *
 * **Why the date is formatted here rather than by Intl.** A letter is filed
 * once and never re-rendered, so the date it carries is the date it will
 * always carry, and a month name that depends on which ICU build the server
 * happens to hold is not a thing to put in a legal confirmation. Two small
 * tables, both languages, no dependency, the same answer everywhere.
 */

export type ErasureLetterLocale = 'en' | 'ar';

/** `document.kind` for a filed letter. Never a client's document: it belongs to the request. */
export const ERASURE_LETTER_KIND = 'erasure_letter';

/** What the letter is filed as; markdown, as the wording documents are. */
export const ERASURE_LETTER_MIME_TYPE = 'text/markdown';

const MONTHS: Record<ErasureLetterLocale, readonly string[]> = {
  en: [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ],
  // The Levantine month names UAE government and press use, not the
  // transliterated Latin ones.
  ar: [
    'يناير',
    'فبراير',
    'مارس',
    'أبريل',
    'مايو',
    'يونيو',
    'يوليو',
    'أغسطس',
    'سبتمبر',
    'أكتوبر',
    'نوفمبر',
    'ديسمبر',
  ],
};

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const FRONT_MATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n/;
const PLACEHOLDER = /\{\{([a-z_]+)\}\}/g;

/** The front matter's own fields, for the version this letter was cut from. */
export type ErasureLetterTemplate = {
  locale: ErasureLetterLocale;
  version: string;
  status: 'draft' | 'approved';
  /** The letter itself, front matter removed: what a person reads. */
  body: string;
};

/**
 * A date a person reads, in their own language: "3 September 2026", "٣ سبتمبر
 * ٢٠٢٦". Arabic takes Arabic-Indic digits, because the rest of the letter is
 * Arabic and a Latin numeral in the middle of it is a seam.
 */
export function formatLetterDate(isoDate: string, locale: ErasureLetterLocale): string {
  const match = ISO_DATE.exec(isoDate);
  if (!match) throw new Error('An erasure letter needs a date as YYYY-MM-DD.');
  const [, year, month, day] = match as unknown as [string, string, string, string];
  const monthName = MONTHS[locale][Number(month) - 1];
  if (!monthName) throw new Error(`There is no month ${month}.`);
  const plain = `${Number(day)} ${monthName} ${year}`;
  return locale === 'ar'
    ? plain.replace(/\d/g, (digit) => '٠١٢٣٤٥٦٧٨٩'[Number(digit)] ?? digit)
    : plain;
}

/**
 * Reads a template file: the four front-matter fields the letter needs, and
 * the body beneath them. Throws rather than guesses — a letter cut from a
 * file nobody can read the language of is worse than no letter.
 */
export function parseErasureLetterTemplate(text: string): ErasureLetterTemplate {
  const matter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  if (!matter?.[1]) throw new Error('The erasure letter template has no front matter.');
  const fields: Record<string, string> = {};
  for (const line of matter[1].split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    fields[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  const locale = fields.locale;
  const status = fields.status;
  const version = fields.version;
  if (fields.purpose !== 'erasure_letter') {
    throw new Error('That template is not an erasure letter.');
  }
  if (locale !== 'en' && locale !== 'ar') {
    throw new Error('An erasure letter template is English or Arabic.');
  }
  if (status !== 'draft' && status !== 'approved') {
    throw new Error('An erasure letter template is draft or approved.');
  }
  if (!version) throw new Error('The erasure letter template names no version.');
  return { locale, version, status, body: text.replace(FRONT_MATTER, '').trimStart() };
}

/**
 * The letter itself: the template's body with the two things only the moment
 * knows put into it — the day the record was erased, and the practice's legal
 * name as the tenant row records it.
 *
 * A placeholder left standing is an error, not a blank: a letter that says
 * "on {{erased_on}} we erased" is worse than no letter, and this is the last
 * place that can tell.
 */
export function renderErasureLetter(
  template: ErasureLetterTemplate,
  values: { erasedOn: string; practiceLegalName: string },
): string {
  const filled: Record<string, string> = {
    erased_on: formatLetterDate(values.erasedOn, template.locale),
    practice_legal_name: values.practiceLegalName.trim(),
  };
  if (!filled.practice_legal_name) {
    throw new Error('An erasure letter names the practice that sent it.');
  }
  const letter = template.body.replace(PLACEHOLDER, (whole, name: string) => filled[name] ?? whole);
  const left = PLACEHOLDER.exec(letter);
  PLACEHOLDER.lastIndex = 0;
  if (left) {
    throw new Error(`The erasure letter template asks for "${left[1]}", which nothing fills.`);
  }
  return letter;
}
