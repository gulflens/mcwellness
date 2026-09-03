import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  parseErasureLetterTemplate,
  renderErasureLetter,
  type ErasureLetterLocale,
  type ErasureLetterTemplate,
} from '../../../domain/client';

/**
 * The confirmation letter, from the file on disk to the text a person reads
 * (docs/SPEC/client-record.md section 8 step 5).
 *
 * The words are in docs/CONSENT/erasure-letter/, beside the consent wording
 * and read the same way the seed reads that (db/seed/consent-text.ts): they
 * are the practice's own text, drafts until its lawyer approves them, and a
 * copy of them inside a TypeScript string would be a second version of a
 * legal document that nobody would remember to change.
 *
 * Read once per process and kept, because the file cannot change under a
 * running server without a deploy, and because the alternative is reading
 * from disk in the middle of a transaction that is erasing somebody.
 */

const TEMPLATE_DIR = new URL('../../../docs/CONSENT/erasure-letter/', import.meta.url);
const cache = new Map<ErasureLetterLocale, ErasureLetterTemplate>();

/** The template for a language, parsed and checked. Throws if the file is not one. */
export function erasureLetterTemplate(locale: ErasureLetterLocale): ErasureLetterTemplate {
  const cached = cache.get(locale);
  if (cached) return cached;
  const text = readFileSync(fileURLToPath(new URL(`${locale}.md`, TEMPLATE_DIR)), 'utf8');
  const template = parseErasureLetterTemplate(text);
  if (template.locale !== locale) {
    throw new Error(`The ${locale} erasure letter template says it is ${template.locale}.`);
  }
  cache.set(locale, template);
  return template;
}

/**
 * The letter for this erasure: the practice's own words, the day the record
 * went, and the practice's legal name as the tenant row records it.
 *
 * The language is the client's own preferred one, read before the erasure
 * runs — `client.preferred_locale` survives an erasure (it is not a personal
 * detail, it is how to speak to somebody), but reading it first keeps this
 * function honest about depending on nothing the erasure has touched.
 */
export function erasureLetter(input: {
  locale: ErasureLetterLocale;
  erasedOn: string;
  practiceLegalName: string;
  /** The practice's registered address, where it has recorded one. */
  practiceAddress?: string | null;
}): { text: string; version: string } {
  const template = erasureLetterTemplate(input.locale);
  return {
    text: renderErasureLetter(template, {
      erasedOn: input.erasedOn,
      practiceLegalName: input.practiceLegalName,
      practiceAddress: input.practiceAddress ?? null,
    }),
    version: template.version,
  };
}
