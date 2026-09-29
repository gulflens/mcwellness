import { describe, expect, it } from 'vitest';
import { blankInitial } from './blank';
import { validateQeegContent } from './shape';
import { DRAWS_NOTHING } from './testing/drawsNothing';
import {
  UNCUT,
  clean,
  cleanRich,
  isBlank,
  isEmpty,
  isMark,
  isRealDay,
  isRecord,
  plain,
  richFor,
  spansOf,
  textFor,
  toParagraphs,
} from './text';
import type { Mark, RichText } from './types';

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

  it('names the fault and never repeats what it was given', () => {
    expect(() => spansOf('**Willow Harbour typed this')).toThrow(/unclosed bold mark/);
    expect(() => spansOf('**Willow Harbour typed this')).not.toThrow(/Willow/);
  });
});

/**
 * Texts made of characters that are awkward to clean: letters that compose,
 * combining marks, what `clean` removes, white space, pairs and their lone
 * halves. A fixed sequence, so every run tries the same texts.
 */
const AWKWARD = [
  'a',
  'e',
  ' ',
  '\t',
  '\n',
  '\r',
  '\u0000',
  '\u200b',
  '\u200c',
  '\u200d',
  '\ufeff',
  '\u202e',
  '\u0301',
  '\u0327',
  '\u0651',
  '\u064e',
  '\u0628',
  '\u1100',
  '\u1161',
  '\u11a8',
  '\uac00',
  '\u00a0',
  '\u00ad',
  '\ud83d',
  '\ude00',
  '\u{1F600}',
  '\u212b',
];

function generated(count: number, longest: number): string[] {
  let seed = 7;
  const next = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed;
  };
  return Array.from({ length: count }, () =>
    Array.from({ length: next() % longest }, () => AWKWARD[next() % AWKWARD.length]).join(''),
  );
}

describe('clean', () => {
  it('removes before it composes, so a letter and its accent either side of a removed character compose', () => {
    expect(clean('e\u200b\u0301', 100)).toBe('\u00e9');
    expect(clean('\u1100\u0000\u1161', 100)).toBe('\uac00');
  });

  it('is the same cleaned twice as once, and the same as cleanRich of text with no marks', () => {
    for (const text of generated(20_000, 12)) {
      for (const most of [UNCUT, 5]) {
        const once = clean(text, most);
        expect(clean(once, most), JSON.stringify(text)).toBe(once);
        expect(cleanRich({ text, marks: [] }, most).text, JSON.stringify(text)).toBe(once);
      }
    }
  });

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

  it('turns a Windows line end into a newline and removes a lone carriage return', () => {
    expect(clean('one\r\ntwo\rthree', 100)).toBe('one\ntwothree');
  });

  it('removes the second block of controls, the line and paragraph separators, the zero-width characters, the direction marks and the byte-order mark', () => {
    const removed = [
      '\u0080',
      '\u0085',
      '\u009f',
      '\u2028',
      '\u2029',
      '\u200b',
      '\u2060',
      '\u200e',
      '\u200f',
      '\u061c',
      '\ufeff',
    ];
    for (const character of removed) {
      expect(clean(`a${character}b`, 100), character.codePointAt(0)?.toString(16)).toBe('ab');
    }
  });

  it('keeps the two characters that part letters and join them', () => {
    // Neither has a glyph, and both are part of what she typed. The first parts
    // two letters that would otherwise join, in Persian and sometimes in Arabic,
    // and the document writer honours it: removing it changes the printed word.
    // The second joins the parts of a sign made of several. What is stored is
    // the record, and a character taken out of it cannot be put back.
    expect(clean('\u0628\u200c\u0628', 100)).toBe('\u0628\u200c\u0628');
    expect(clean('a\u200db', 100)).toBe('a\u200db');
    expect(clean('\u{1F468}\u200d\u{1F469}', 100)).toBe('\u{1F468}\u200d\u{1F469}');
  });

  it('removes a lone half of a surrogate pair and keeps a whole pair', () => {
    expect(clean('a\ud800b\udc00c', 100)).toBe('abc');
    expect(clean('a\u{1F600}b', 100)).toBe('a\u{1F600}b');
  });

  it('cuts at the length it is given', () => {
    expect(clean('abcdef', 4)).toBe('abcd');
  });

  it('refuses a length that is not a whole number above 0', () => {
    for (const most of [0, -1, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => clean('abc', most), String(most)).toThrow(RangeError);
    }
  });

  it('never cuts a surrogate pair in half', () => {
    const cut = clean('ab\u{1F600}cd', 3);
    expect(cut).toBe('ab');
    expect(clean('ab\u{1F600}cd', 4)).toBe('ab\u{1F600}');
  });
});

describe('isRealDay', () => {
  it('accepts a real day written YYYY-MM-DD, from 2000 to 2100', () => {
    for (const day of ['2000-01-01', '2026-09-29', '2024-02-29', '2000-02-29', '2100-12-31']) {
      expect(isRealDay(day), day).toBe(true);
    }
  });

  it('refuses a day that is not in the calendar', () => {
    for (const day of ['0000-00-00', '2026-02-30', '2026-04-31', '2026-13-01', '2027-02-29']) {
      expect(isRealDay(day), day).toBe(false);
    }
    expect(isRealDay('2100-02-29')).toBe(false);
  });

  it('refuses a year before the practice had an instrument, or far past it', () => {
    for (const day of ['0000-01-01', '0000-02-29', '0050-06-01', '1999-12-31', '2101-01-01']) {
      expect(isRealDay(day), day).toBe(false);
    }
    expect(isRealDay('9999-12-31')).toBe(false);
  });

  it('refuses anything not written YYYY-MM-DD', () => {
    for (const day of ['2026-9-1', '01/09/2026', ' 2026-09-01', '2026-09-01T00:00', '']) {
      expect(isRealDay(day), day).toBe(false);
    }
  });
});

describe('isRecord', () => {
  it('holds a plain set of fields and nothing else', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
    for (const value of [null, undefined, [], 'text', 3, true]) expect(isRecord(value)).toBe(false);
  });
});

describe('cleanRich', () => {
  const B = { bold: true } as const;
  const U = { underline: true } as const;

  /** Each case: what a person's editor handed over, the length to cut at, and what is kept. */
  const CASES: ReadonlyArray<{
    readonly what: string;
    readonly given: RichText;
    readonly most: number;
    readonly kept: RichText;
  }> = [
    {
      what: 'two Korean letters that compose, with the edge of a mark between them',
      // The re-check's input: bold over the first jamo only, the second no
      // combining mark. The next mark must still cover "word".
      given: rich('가 word', [
        { from: 0, to: 1, ...B },
        { from: 3, to: 7, ...U },
      ]),
      most: 100,
      kept: rich('가 word', [
        { from: 0, to: 1, ...B },
        { from: 2, to: 6, ...U },
      ]),
    },
    {
      what: 'a mark that begins on the second of two letters that compose',
      given: rich('x 가', [{ from: 3, to: 4, ...B }]),
      most: 100,
      kept: rich('x 가', [{ from: 2, to: 3, ...B }]),
    },
    {
      what: 'a combining mark outside the mark over the letter it joins',
      given: rich('café au lait', [
        { from: 0, to: 4, ...B },
        { from: 9, to: 13, ...U },
      ]),
      most: 100,
      kept: rich('café au lait', [
        { from: 0, to: 4, ...B },
        { from: 8, to: 12, ...U },
      ]),
    },
    {
      what: 'a mark that begins on a combining mark',
      given: rich('née', [{ from: 2, to: 4, ...B }]),
      most: 100,
      kept: rich('née', [{ from: 1, to: 3, ...B }]),
    },
    {
      what: 'a mark that begins inside a letter written as a pair',
      given: rich('a\u{1F600}b', [{ from: 2, to: 4, ...B }]),
      most: 100,
      kept: rich('a\u{1F600}b', [{ from: 1, to: 4, ...B }]),
    },
    {
      what: 'two marks meeting inside a letter written as a pair',
      given: rich('a\u{1F600}b', [
        { from: 0, to: 2, ...B },
        { from: 2, to: 4, ...U },
      ]),
      most: 100,
      kept: rich('a\u{1F600}b', [
        { from: 0, to: 3, ...B },
        { from: 3, to: 4, ...U },
      ]),
    },
    {
      what: 'control characters, a byte-order mark and direction controls around a mark',
      given: rich('\ufeff\u0000ab\u202e bo\u200bld\u0001', [{ from: 6, to: 11, ...B }]),
      most: 100,
      kept: rich('ab bold', [{ from: 3, to: 7, ...B }]),
    },
    {
      what: 'a tab and Windows line ends',
      given: rich('one\ttwo\r\nthree', [{ from: 4, to: 7, ...U }]),
      most: 100,
      kept: rich('one two\nthree', [{ from: 4, to: 7, ...U }]),
    },
    {
      what: 'text that was not composed',
      given: rich('Café', [{ from: 0, to: 5, ...B }]),
      most: 100,
      kept: rich('Café', [{ from: 0, to: 4, ...B }]),
    },
    {
      what: 'white space at both ends, marked and not',
      given: rich('  lead x \n\n', [
        { from: 0, to: 2, ...B },
        { from: 7, to: 10, ...U },
      ]),
      most: 100,
      kept: rich('lead x', [{ from: 5, to: 6, ...U }]),
    },
    {
      what: 'a mark that straddles the cut, and one past it',
      given: rich(`${'x'.repeat(10)}yyyy zz`, [
        { from: 8, to: 14, ...B },
        { from: 15, to: 17, ...U },
      ]),
      most: 12,
      kept: rich(`${'x'.repeat(10)}yy`, [{ from: 8, to: 12, ...B }]),
    },
    {
      what: 'a cut that would split a letter written as a pair',
      given: rich('ab\u{1F600}cd', [{ from: 2, to: 4, ...B }]),
      most: 3,
      kept: rich('ab'),
    },
    {
      what: 'marks out of order, overlapping, and running past the text',
      given: rich('abcdefgh', [
        { from: 6, to: 40, ...B },
        { from: 0, to: 3, ...U },
        { from: 2, to: 4, ...B },
      ]),
      most: 100,
      kept: rich('abcdefgh', [
        { from: 0, to: 2, ...U },
        { from: 2, to: 3, bold: true, underline: true },
        { from: 3, to: 4, ...B },
        { from: 6, to: 8, ...B },
      ]),
    },
    {
      what: 'neighbours that are alike and touch',
      given: rich('abcdef', [
        { from: 0, to: 2, ...B },
        { from: 2, to: 4, ...B },
        { from: 4, to: 6, bold: true, underline: true },
      ]),
      most: 100,
      kept: rich('abcdef', [
        { from: 0, to: 4, ...B },
        { from: 4, to: 6, bold: true, underline: true },
      ]),
    },
    {
      what: 'marks that end up empty, or are neither bold nor underlined',
      given: rich('ab\u0000cd', [
        { from: 1, to: 1, ...B },
        { from: 2, to: 3, ...U },
        { from: 0, to: 5 },
        { from: 3, to: 4, bold: false, underline: false } as unknown as Mark,
        { from: 4, to: 2, ...B },
      ]),
      most: 100,
      kept: rich('abcd'),
    },
    {
      what: 'edges that are not whole numbers, or not numbers at all',
      given: rich('abcdef', [
        { from: 0.5, to: 2.5, ...B },
        { from: Number.NaN, to: 5, ...U },
        { from: -3, to: Number.POSITIVE_INFINITY, ...U },
      ]),
      most: 100,
      kept: rich('abcdef', [
        { from: 0, to: 1, ...U },
        { from: 1, to: 3, bold: true, underline: true },
        { from: 3, to: 6, ...U },
      ]),
    },
    {
      what: 'Arabic with the two characters that part and join letters',
      given: rich('ب\u200cب مهم', [{ from: 4, to: 7, ...B }]),
      most: 100,
      kept: rich('ب\u200cب مهم', [{ from: 4, to: 7, ...B }]),
    },
    {
      what: 'nothing but what is removed',
      given: rich('\u200b \u0000\t', [{ from: 0, to: 4, ...B }]),
      most: 100,
      kept: rich(''),
    },
  ];

  for (const { what, given, most, kept } of CASES) {
    it(`keeps every mark on the letters it was typed over: ${what}`, () => {
      expect(cleanRich(given, most)).toEqual(kept);
    });
  }

  it('gives back what the shape accepts as a summary, in every case', () => {
    for (const { what, given, most } of CASES) {
      const summary = cleanRich(given, most);
      const answer = validateQeegContent({ ...blankInitial(), summary: { en: summary, ar: null } });
      expect(answer, what).toMatchObject({ ok: true });
    }
  });

  it('gives back the same text and marks when given what it gave back', () => {
    for (const { what, given, most } of CASES) {
      const once = cleanRich(given, most);
      expect(cleanRich(once, most), what).toEqual(once);
    }
  });

  it('gives the same text as clean', () => {
    for (const { what, given, most } of CASES) {
      expect(cleanRich(given, most).text, what).toBe(clean(given.text, most));
    }
  });

  it('never changes what it was given', () => {
    for (const { given, most } of CASES) {
      const frozen = Object.freeze({
        text: given.text,
        marks: Object.freeze(given.marks.map((m) => Object.freeze({ ...m }))),
      });
      const before = JSON.stringify(frozen);
      expect(() => cleanRich(frozen, most)).not.toThrow();
      expect(JSON.stringify(frozen)).toBe(before);
    }
  });

  it('never throws on what JSON can hold: a list of marks that is no list, a mark that is no mark', () => {
    const given = (json: string) => JSON.parse(json) as RichText;
    expect(cleanRich(given('{"text":"ab","marks":null}'), 10)).toEqual(rich('ab'));
    expect(cleanRich(given('{"text":"ab","marks":{"from":0}}'), 10)).toEqual(rich('ab'));
    expect(cleanRich(given('{"text":"ab"}'), 10)).toEqual(rich('ab'));
    expect(
      cleanRich(
        given(
          '{"text":"abcd","marks":[null,5,"x",[],{"from":"0","to":2,"bold":true},{"from":2,"to":4,"underline":true}]}',
        ),
        10,
      ),
    ).toEqual(rich('abcd', [{ from: 2, to: 4, ...U }]));
  });

  it('never counts bold of 1 or of "true" as bold', () => {
    const given = JSON.parse(
      '{"text":"abcd","marks":[{"from":0,"to":2,"bold":1},{"from":2,"to":4,"bold":"true","underline":true}]}',
    ) as RichText;
    expect(cleanRich(given, 10)).toEqual(rich('abcd', [{ from: 2, to: 4, ...U }]));
  });

  it('drops a mark whose start is after its end, and it changes nothing under it', () => {
    expect(
      cleanRich(
        rich('abcdef', [
          { from: 0, to: 5, ...B },
          { from: 4, to: 1, ...B },
          { from: 4, to: 2, ...U },
        ]),
        10,
      ),
    ).toEqual(rich('abcdef', [{ from: 0, to: 5, ...B }]));
  });

  it('refuses text that is no string by name, as it refuses a length', () => {
    for (const json of ['{"marks":[]}', '{"text":null,"marks":[]}', '{"text":5,"marks":[]}']) {
      expect(() => cleanRich(JSON.parse(json) as RichText, 10), json).toThrow(TypeError);
      expect(() => cleanRich(JSON.parse(json) as RichText, 10), json).toThrow(/text/);
    }
  });

  it('moves the edge of a mark between an Arabic letter and the marks over it outward', () => {
    // Beh, shadda, fatha: Arabic never composes, yet the marks are one letter
    // with the beh. Composing puts fatha before shadda.
    const given = rich('\u0628\u0651\u064e \u0628', [
      { from: 0, to: 2, ...B },
      { from: 2, to: 5, ...U },
    ]);
    expect(cleanRich(given, 10)).toEqual(
      rich('\u0628\u064e\u0651 \u0628', [
        { from: 0, to: 3, ...B },
        { from: 3, to: 5, ...U },
      ]),
    );
    const overBehOnly = rich('\u0628\u0651\u064e \u0628', [{ from: 0, to: 1, ...B }]);
    expect(cleanRich(overBehOnly, 10)).toEqual(
      rich('\u0628\u064e\u0651 \u0628', [{ from: 0, to: 3, ...B }]),
    );
  });

  it('gives a letter two marks meet in to the earlier, in one style and not both', () => {
    const given = rich('e\u0301x', [
      { from: 0, to: 1, ...B },
      { from: 1, to: 3, ...U },
    ]);
    expect(cleanRich(given, 10)).toEqual(
      rich('\u00e9x', [
        { from: 0, to: 1, ...B },
        { from: 1, to: 2, ...U },
      ]),
    );
    const jamo = rich('\u1100\u1161', [
      { from: 0, to: 1, ...U },
      { from: 1, to: 2, ...B },
    ]);
    expect(cleanRich(jamo, 10)).toEqual(rich('\uac00', [{ from: 0, to: 1, ...U }]));
  });

  it('leaves no white space at the end where the cut falls after it', () => {
    expect(cleanRich(rich('ab cd', [{ from: 0, to: 5, ...B }]), 3)).toEqual(
      rich('ab', [{ from: 0, to: 2, ...B }]),
    );
  });

  it('refuses a length that is not a whole number above 0, as clean does', () => {
    for (const most of [0, -1, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => cleanRich(rich('abc'), most), String(most)).toThrow(RangeError);
      expect(() => cleanRich(rich('abc'), most), String(most)).toThrow(/whole number above 0/);
    }
  });

  it('cleans a long text in good time', () => {
    const long = rich('가 word '.repeat(20_000), [{ from: 0, to: 1, ...B }]);
    const started = performance.now();
    expect(cleanRich(long, 200_000).text.startsWith('가 word')).toBe(true);
    expect(performance.now() - started).toBeLessThan(2000);
  });
});

describe('isBlank', () => {
  it('holds each character that draws nothing, alone, to be nothing', () => {
    for (const character of DRAWS_NOTHING) {
      expect(isBlank(character), character.codePointAt(0)?.toString(16)).toBe(true);
    }
    expect(isBlank('')).toBe(true);
    expect(isBlank(DRAWS_NOTHING.join(''))).toBe(true);
  });

  it('holds a letter, with or without its marks, to be something', () => {
    for (const text of [
      'a',
      '\u0628',
      '\u0628\u200c\u0628',
      'e\u0301',
      '\u0301a',
      '\u{1F600}',
      '1',
    ]) {
      expect(isBlank(text), text).toBe(false);
    }
  });

  it('changes nothing: what is stored keeps its U+200C', () => {
    expect(clean('\u200c', 10)).toBe('\u200c');
  });

  it('is what textFor and richFor ask before they fall back to the English', () => {
    for (const ar of DRAWS_NOTHING) {
      expect(textFor('ar', { en: 'Calm', ar }), ar.codePointAt(0)?.toString(16)).toBe('Calm');
      const english = rich('Calm');
      expect(richFor('ar', { en: english, ar: rich(ar) })).toBe(english);
      expect(isEmpty(rich(ar))).toBe(true);
    }
  });

  it('drops a paragraph that draws nothing', () => {
    expect(toParagraphs(rich('abc\n\u200c\u00ad\ndef'))).toEqual([rich('abc'), rich('def')]);
  });
});

describe('isMark', () => {
  it('holds a mark to whole-number edges and bold and underline each absent or true', () => {
    for (const mark of [
      { from: 0, to: 1, bold: true },
      { from: 2, to: 9, underline: true },
      { from: 0, to: 1, bold: true, underline: true },
      { from: 0, to: 1 },
    ]) {
      expect(isMark(mark), JSON.stringify(mark)).toBe(true);
    }
    for (const mark of [
      null,
      5,
      'mark',
      [],
      {},
      { from: 0 },
      { from: 0.5, to: 1, bold: true },
      { from: 0, to: Number.POSITIVE_INFINITY, bold: true },
      { from: '0', to: 1, bold: true },
      { from: 0, to: 1, bold: 1 },
      { from: 0, to: 1, bold: 'true' },
      { from: 0, to: 1, underline: false },
    ]) {
      expect(isMark(mark), JSON.stringify(mark)).toBe(false);
    }
  });
});
