import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { formatLetterDate, parseErasureLetterTemplate, renderErasureLetter } from './erasureLetter';

/**
 * The real templates, read from docs/CONSENT/erasure-letter/, for the reason
 * db/seed/consent-text.test.ts reads the real wording: the letter a person
 * gets is the practice's own words, and a fixture would prove nothing about
 * them.
 */
const TEMPLATES = new URL('../../docs/CONSENT/erasure-letter/', import.meta.url);
const read = (file: string): string =>
  readFileSync(fileURLToPath(new URL(file, TEMPLATES)), 'utf8');
/** The same text with its line breaks flattened: these files wrap at eighty columns. */
const flat = (text: string): string => text.replace(/\s+/g, ' ');

describe('the date a letter carries', () => {
  it('reads as a person writes it, in English', () => {
    expect(formatLetterDate('2026-09-03', 'en')).toBe('3 September 2026');
    expect(formatLetterDate('2026-12-31', 'en')).toBe('31 December 2026');
  });

  it('takes Arabic month names and Arabic-Indic digits in Arabic', () => {
    expect(formatLetterDate('2026-09-03', 'ar')).toBe('٣ سبتمبر ٢٠٢٦');
  });

  it('refuses anything that is not a plain calendar date', () => {
    expect(() => formatLetterDate('3 September 2026', 'en')).toThrow();
    expect(() => formatLetterDate('2026-13-01', 'en')).toThrow();
  });
});

describe('the erasure letter template', () => {
  it('reads the version and the status from the front matter of each language', () => {
    for (const [file, locale] of [
      ['en.md', 'en'],
      ['ar.md', 'ar'],
    ] as const) {
      const template = parseErasureLetterTemplate(read(file));
      expect(template.locale).toBe(locale);
      // Draft until the practice's lawyer approves it (docs/CONSENT/README.md).
      expect(template.status).toBe('draft');
      expect(template.version).toMatch(/^\d+\.\d+/);
      expect(template.body.startsWith('---')).toBe(false);
      expect(template.body.length).toBeGreaterThan(200);
    }
  });

  it('is real Arabic, not a translation stub', () => {
    const arabic = parseErasureLetterTemplate(read('ar.md'));
    expect(/[؀-ۿ]/.test(arabic.body)).toBe(true);
  });

  it('refuses a template that is some other document', () => {
    expect(() =>
      parseErasureLetterTemplate('---\npurpose: participation\nlocale: en\n---\nHello.\n'),
    ).toThrow(/not an erasure letter/);
    expect(() => parseErasureLetterTemplate('No front matter here.')).toThrow(/front matter/);
  });
});

describe('rendering the letter', () => {
  it('puts the date and the practice into both languages', () => {
    const english = renderErasureLetter(parseErasureLetterTemplate(read('en.md')), {
      erasedOn: '2026-09-03',
      practiceLegalName: 'Synthetic Studio',
    });
    expect(english).toContain('3 September 2026');
    expect(english).toContain('Synthetic Studio');
    expect(english).not.toContain('{{');

    const arabic = renderErasureLetter(parseErasureLetterTemplate(read('ar.md')), {
      erasedOn: '2026-09-03',
      practiceLegalName: 'Synthetic Studio',
    });
    expect(arabic).toContain('٣ سبتمبر ٢٠٢٦');
    expect(arabic).toContain('Synthetic Studio');
    expect(arabic).not.toContain('{{');
  });

  it('names all three things that are kept, and why, in both languages', () => {
    // The files wrap at eighty columns, so a sentence is matched against the
    // text with its line breaks flattened, never against the file's layout.
    const english = flat(
      renderErasureLetter(parseErasureLetterTemplate(read('en.md')), {
        erasedOn: '2026-09-03',
        practiceLegalName: 'Synthetic Studio',
      }),
    );
    // Measurements without an identity, the tax documents, and the practice's
    // own log — each named, each with the reason it is kept.
    expect(english).toMatch(/measurements stay, with nobody attached/i);
    expect(english).toMatch(/invoices and receipts stay for five years/i);
    expect(english).toMatch(/tax law/i);
    expect(english).toMatch(/without any of the values/i);
    // And what the visit record loses, which is the half the first draft of
    // this letter did not mention at all.
    expect(english).toMatch(/checked in and out/i);

    const arabic = flat(parseErasureLetterTemplate(read('ar.md')).body);
    expect(arabic).toContain('خمس سنوات');
    expect(arabic).toContain('القياسات');
    expect(arabic).toContain('الفواتير والإيصالات');
  });

  it('names where to write when the practice has an address, and how to reach them when it has not', () => {
    const withAddress = renderErasureLetter(parseErasureLetterTemplate(read('en.md')), {
      erasedOn: '2026-09-03',
      practiceLegalName: 'Synthetic Studio',
      practiceAddress: 'Office 9, Synthetic Tower, Dubai',
    });
    expect(withAddress).toContain('at Office 9, Synthetic Tower, Dubai');

    // No address on file is a sentence, never a bracket left in a legal letter.
    const without = renderErasureLetter(parseErasureLetterTemplate(read('en.md')), {
      erasedOn: '2026-09-03',
      practiceLegalName: 'Synthetic Studio',
      practiceAddress: '   ',
    });
    expect(without).toContain("through the practice's usual contact");
    expect(without).not.toContain('[');

    const arabic = renderErasureLetter(parseErasureLetterTemplate(read('ar.md')), {
      erasedOn: '2026-09-03',
      practiceLegalName: 'Synthetic Studio',
      practiceAddress: null,
    });
    expect(arabic).toContain('عبر وسيلة التواصل المعتادة مع المركز');
  });

  it('refuses to send a letter with a hole in it', () => {
    const template = {
      locale: 'en',
      version: '0.1-draft',
      status: 'draft' as const,
      body: 'On {{erased_on}}, {{signed_by}} wrote.',
    } as const;
    expect(() =>
      renderErasureLetter(template, {
        erasedOn: '2026-09-03',
        practiceLegalName: 'Synthetic Studio',
      }),
    ).toThrow(/signed_by/);
  });

  it('refuses a letter that cannot name the practice that sent it', () => {
    expect(() =>
      renderErasureLetter(parseErasureLetterTemplate(read('en.md')), {
        erasedOn: '2026-09-03',
        practiceLegalName: '   ',
      }),
    ).toThrow(/names the practice/);
  });
});
