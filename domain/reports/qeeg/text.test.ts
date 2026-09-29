import { describe, expect, it } from 'vitest';
import { clean, isEmpty, plain, richFor, spansOf, textFor, toParagraphs } from './text';
import type { RichText } from './types';

/** Part 2 of brief C1: typed text, in either language, and the wording's bold marks. */

const rich = (text: string, marks: RichText['marks'] = []): RichText => ({ text, marks });

describe('textFor', () => {
  it('gives the Arabic when it is there', () => {
    expect(textFor('ar', { en: 'Calm', ar: 'هدوء' })).toBe('هدوء');
  });

  it('falls back to the English when there is no Arabic', () => {
    expect(textFor('ar', { en: 'Calm', ar: null })).toBe('Calm');
  });

  it('falls back to the English when the Arabic is only white space', () => {
    expect(textFor('ar', { en: 'Calm', ar: '  \n\t ' })).toBe('Calm');
  });

  it('always gives the English for an English report', () => {
    expect(textFor('en', { en: 'Calm', ar: 'هدوء' })).toBe('Calm');
  });
});

describe('richFor', () => {
  const english = rich('Settled', [{ from: 0, to: 7, bold: true }]);

  it('gives the Arabic when it has something in it', () => {
    const arabic = rich('هدوء');
    expect(richFor('ar', { en: english, ar: arabic })).toBe(arabic);
  });

  it('falls back to the English when the Arabic is absent or only white space', () => {
    expect(richFor('ar', { en: english, ar: null })).toBe(english);
    expect(richFor('ar', { en: english, ar: rich('   ') })).toBe(english);
  });

  it('always gives the English for an English report', () => {
    expect(richFor('en', { en: english, ar: rich('هدوء') })).toBe(english);
  });
});

describe('isEmpty and plain', () => {
  it('counts text of nothing but white space as empty', () => {
    expect(isEmpty(rich(''))).toBe(true);
    expect(isEmpty(rich(' \n \t'))).toBe(true);
    expect(isEmpty(rich(' a '))).toBe(false);
  });

  it('gives the text without its marks', () => {
    expect(plain(rich('Settled well', [{ from: 0, to: 7, bold: true }]))).toBe('Settled well');
  });
});

describe('toParagraphs', () => {
  it('splits on a newline and re-bases each mark to its own paragraph', () => {
    const paragraphs = toParagraphs(
      rich('One two\nThree four', [
        { from: 0, to: 3, bold: true },
        { from: 14, to: 18, underline: true },
      ]),
    );
    expect(paragraphs).toEqual([
      rich('One two', [{ from: 0, to: 3, bold: true }]),
      rich('Three four', [{ from: 6, to: 10, underline: true }]),
    ]);
  });

  it('cuts a mark that crosses a newline into one mark per paragraph', () => {
    const paragraphs = toParagraphs(rich('abc\ndef', [{ from: 1, to: 6, bold: true }]));
    expect(paragraphs).toEqual([
      rich('abc', [{ from: 1, to: 3, bold: true }]),
      rich('def', [{ from: 0, to: 2, bold: true }]),
    ]);
  });

  it('drops a mark left with no length', () => {
    const paragraphs = toParagraphs(rich('abc\ndef', [{ from: 3, to: 5, bold: true }]));
    expect(paragraphs).toEqual([rich('abc'), rich('def', [{ from: 0, to: 1, bold: true }])]);
  });

  it('drops empty paragraphs', () => {
    expect(toParagraphs(rich('\nabc\n\n  \ndef\n'))).toEqual([rich('abc'), rich('def')]);
  });

  it('keeps the marks in order', () => {
    const [only] = toParagraphs(
      rich('a b c', [
        { from: 0, to: 1, bold: true },
        { from: 2, to: 3, underline: true },
        { from: 4, to: 5, bold: true, underline: true },
      ]),
    );
    expect(only?.marks.map((mark) => mark.from)).toEqual([0, 2, 4]);
  });

  it('does not change what it was given', () => {
    const given = rich('abc\ndef', [{ from: 1, to: 6, bold: true }]);
    const copy = structuredClone(given);
    toParagraphs(given);
    expect(given).toEqual(copy);
  });
});

describe('spansOf', () => {
  it('reads the bold marks of the wording', () => {
    expect(spansOf('**Final Note:** Every brain')).toEqual([
      { text: 'Final Note:', bold: true },
      { text: ' Every brain', bold: false },
    ]);
  });

  it('gives one span for a sentence with no mark', () => {
    expect(spansOf('Every brain is unique.')).toEqual([
      { text: 'Every brain is unique.', bold: false },
    ]);
  });

  it('reads a bold stretch in the middle of a sentence', () => {
    expect(spansOf('a **b** c')).toEqual([
      { text: 'a ', bold: false },
      { text: 'b', bold: true },
      { text: ' c', bold: false },
    ]);
  });

  it('refuses an odd number of marks as a fault in the wording', () => {
    expect(() => spansOf('**unclosed')).toThrow(/wording/);
  });
});

describe('clean', () => {
  it('normalises to the composed form', () => {
    expect(clean('Café', 100)).toBe('Café');
  });

  it('trims the ends', () => {
    expect(clean('  settled  ', 100)).toBe('settled');
  });

  it('keeps newlines and turns a tab into a space', () => {
    expect(clean('one\ntwo\tthree', 100)).toBe('one\ntwo three');
  });

  it('removes control characters and bidirectional controls', () => {
    const removed = [
      '\u0000',
      '\u0008',
      '\u000b',
      '\u000c',
      '\u000e',
      '\u001f',
      '\u007f',
      '‪',
      '‮',
      '⁦',
      '⁩',
    ];
    expect(clean(`a${removed.join('')}b`, 100)).toBe('ab');
  });

  it('cuts at the length it is given', () => {
    expect(clean('abcdef', 4)).toBe('abcd');
  });

  it('never cuts a surrogate pair in half', () => {
    const cut = clean('ab\u{1F600}cd', 3);
    expect(cut).toBe('ab');
    expect(clean('ab\u{1F600}cd', 4)).toBe('ab\u{1F600}');
  });
});
