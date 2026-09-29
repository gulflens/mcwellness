import { describe, expect, it } from 'vitest';
import {
  baseDirection,
  classify,
  isPlainNumber,
  resolve,
  runsOf,
  textOf,
  tokenise,
  type Direction,
  type Run,
} from './bidi';

/** The runs as plain pairs, so a table row reads as what is drawn. */
function drawn(runs: readonly Run[]): { direction: Direction; text: string }[] {
  return runs.map((run) => ({ direction: run.direction, text: textOf(run) }));
}

/** The runs put back together: a space before any run whose first word had one. */
function joined(runs: readonly Run[]): string {
  return runs
    .map((run, index) => (index > 0 && run.tokens[0]?.glued === false ? ' ' : '') + textOf(run))
    .join('');
}

type Case = {
  name: string;
  text: string;
  paragraph: Direction | { detect: Direction };
  base: Direction;
  runs: { direction: Direction; text: string }[];
};

const CASES: Case[] = [
  {
    name: 'a phone number in an Arabic line',
    text: 'هاتف: +971 50 000 0012',
    paragraph: 'rtl',
    base: 'rtl',
    runs: [
      { direction: 'rtl', text: 'هاتف:' },
      { direction: 'ltr', text: '+971 50 000 0012' },
    ],
  },
  {
    name: 'an email in an Arabic line',
    text: 'البريد: info@example.com',
    paragraph: 'rtl',
    base: 'rtl',
    runs: [
      { direction: 'rtl', text: 'البريد:' },
      { direction: 'ltr', text: 'info@example.com' },
    ],
  },
  {
    name: 'a percentage',
    text: 'انخفاض بنسبة 25%',
    paragraph: 'rtl',
    base: 'rtl',
    runs: [
      { direction: 'rtl', text: 'انخفاض بنسبة' },
      { direction: 'ltr', text: '25%' },
    ],
  },
  {
    name: 'a range of hertz in brackets',
    text: 'دلتا (1–4 هرتز)',
    paragraph: 'rtl',
    base: 'rtl',
    runs: [
      { direction: 'rtl', text: 'دلتا' },
      { direction: 'rtl', text: '(' },
      { direction: 'ltr', text: '1–4' },
      { direction: 'rtl', text: 'هرتز)' },
    ],
  },
  {
    name: 'a plain number inside Arabic',
    text: 'بعد 15 جلسة',
    paragraph: 'rtl',
    base: 'rtl',
    runs: [{ direction: 'rtl', text: 'بعد 15 جلسة' }],
  },
  {
    name: 'a date',
    text: '11/08/2026',
    paragraph: 'rtl',
    base: 'rtl',
    runs: [{ direction: 'ltr', text: '11/08/2026' }],
  },
  {
    name: 'English typed into an Arabic report',
    text: 'Follow up in twelve weeks.',
    paragraph: { detect: 'rtl' },
    base: 'ltr',
    runs: [{ direction: 'ltr', text: 'Follow up in twelve weeks.' }],
  },
  {
    name: 'Arabic typed with no direction set',
    text: 'نشاط متزايد في المناطق الجبهية',
    paragraph: { detect: 'ltr' },
    base: 'rtl',
    runs: [{ direction: 'rtl', text: 'نشاط متزايد في المناطق الجبهية' }],
  },
  {
    name: 'an Arabic phrase inside an English sentence',
    text: 'The session began with صباح الخير before the recording.',
    paragraph: 'ltr',
    base: 'ltr',
    runs: [
      { direction: 'ltr', text: 'The session began with' },
      { direction: 'rtl', text: 'صباح الخير' },
      { direction: 'ltr', text: 'before the recording.' },
    ],
  },
  {
    name: 'nothing but figures, in a right-to-left paragraph',
    text: '8–12',
    paragraph: { detect: 'rtl' },
    base: 'rtl',
    runs: [{ direction: 'ltr', text: '8–12' }],
  },
  {
    name: 'nothing but figures, in a left-to-right paragraph',
    text: '8–12',
    paragraph: { detect: 'ltr' },
    base: 'ltr',
    runs: [{ direction: 'ltr', text: '8–12' }],
  },
  {
    name: 'an empty string, right to left',
    text: '',
    paragraph: { detect: 'rtl' },
    base: 'rtl',
    runs: [],
  },
  {
    name: 'an empty string, left to right',
    text: '',
    paragraph: { detect: 'ltr' },
    base: 'ltr',
    runs: [],
  },
];

describe('runsOf', () => {
  for (const row of CASES) {
    const paragraph =
      typeof row.paragraph === 'string'
        ? row.paragraph
        : baseDirection(row.text, row.paragraph.detect);

    it(`draws ${row.name} in the right runs`, () => {
      expect(paragraph).toBe(row.base);
      expect(drawn(runsOf(row.text, paragraph))).toEqual(row.runs);
    });

    it(`gives back the text of ${row.name} when its runs are joined`, () => {
      expect(joined(runsOf(row.text, paragraph))).toBe(row.text);
    });
  }

  it('peels the full stop off an English sentence set right to left', () => {
    expect(drawn(runsOf('Follow up in twelve weeks.', 'rtl'))).toEqual([
      { direction: 'ltr', text: 'Follow up in twelve weeks' },
      { direction: 'rtl', text: '.' },
    ]);
  });

  it('keeps a plain number with the Arabic inside an English sentence', () => {
    expect(drawn(runsOf('Read صباح 15 الخير aloud', 'ltr'))).toEqual([
      { direction: 'ltr', text: 'Read' },
      { direction: 'rtl', text: 'صباح 15 الخير' },
      { direction: 'ltr', text: 'aloud' },
    ]);
  });

  it('collapses runs of spaces to one', () => {
    expect(drawn(runsOf('  two   words ', 'ltr'))).toEqual([
      { direction: 'ltr', text: 'two words' },
    ]);
  });
});

describe('baseDirection', () => {
  it('follows the first strong character', () => {
    expect(baseDirection('12 جلسة then more', 'ltr')).toBe('rtl');
    expect(baseDirection('— Alpha ثم', 'rtl')).toBe('ltr');
    expect(baseDirection('Été', 'rtl')).toBe('ltr');
  });

  it('falls back when there is no strong character', () => {
    expect(baseDirection('12:30 — 14:00', 'rtl')).toBe('rtl');
    expect(baseDirection('', 'ltr')).toBe('ltr');
  });
});

describe('classify', () => {
  it('says whether a word holds Arabic, Latin, or no letter', () => {
    expect(classify('جلسة')).toBe('R');
    expect(classify('info@example.com')).toBe('L');
    expect(classify('Alpha-جلسة')).toBe('R');
    expect(classify('+971')).toBe('N');
    expect(classify('25%')).toBe('N');
    expect(classify('')).toBe('N');
  });
});

describe('tokenise', () => {
  it('peels brackets and punctuation off a figure in a right-to-left paragraph', () => {
    expect(tokenise('(1–4) هرتز', 'rtl')).toEqual([
      { text: '(', class: 'N', glued: false },
      { text: '1–4', class: 'N', glued: true },
      { text: ')', class: 'N', glued: true },
      { text: 'هرتز', class: 'R', glued: false },
    ]);
  });

  it('leaves an Arabic word whole', () => {
    expect(tokenise('هرتز).', 'rtl')).toEqual([{ text: 'هرتز).', class: 'R', glued: false }]);
  });

  it('peels nothing in a left-to-right paragraph', () => {
    expect(tokenise('(see this).', 'ltr')).toEqual([
      { text: '(see', class: 'L', glued: false },
      { text: 'this).', class: 'L', glued: false },
    ]);
  });
});

describe('resolve', () => {
  const tokens = (paragraph: Direction, text: string) =>
    resolve(tokenise(text, paragraph), paragraph);

  it('gives a neutral between two words of one direction that direction', () => {
    expect(tokens('ltr', 'بعد 15 جلسة')).toEqual(['rtl', 'rtl', 'rtl']);
    expect(tokens('rtl', 'after 15 sessions')).toEqual(['ltr', 'ltr', 'ltr']);
  });

  it("gives any other neutral the paragraph's direction", () => {
    expect(tokens('rtl', 'جلسة 15 sessions')).toEqual(['rtl', 'rtl', 'ltr']);
    expect(tokens('ltr', 'جلسة 15 sessions')).toEqual(['rtl', 'ltr', 'ltr']);
    expect(tokens('rtl', '15')).toEqual(['rtl']);
  });
});

describe('isPlainNumber', () => {
  it('accepts digits joined by the separators of a figure or a date', () => {
    for (const text of ['15', '1,234.56', '11/08/2026', '12:30', '2026-09-29']) {
      expect(isPlainNumber(text)).toBe(true);
    }
  });

  it('refuses anything else', () => {
    for (const text of ['', '25%', '+971', '1–4', '15.', '.5', 'A1']) {
      expect(isPlainNumber(text)).toBe(false);
    }
  });
});
