/**
 * Which words of a line are drawn right to left and which left to right: a
 * table of cases, each asserting the runs and their directions and that the
 * runs put back together give the text, then the rules one by one.
 */

import { describe, expect, it } from 'vitest';
import {
  baseDirection,
  classify,
  isPlainNumber,
  readingDirection,
  resolve,
  runsOf,
  textOf,
  tokenise,
} from './bidi';
import type { Run } from './bidi';
import type { Direction } from './direction';

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
    name: 'a figure typed on an Arabic keyboard',
    text: 'بعد ١٥ جلسة',
    paragraph: 'rtl',
    base: 'rtl',
    runs: [
      { direction: 'rtl', text: 'بعد' },
      { direction: 'ltr', text: '١٥' },
      { direction: 'rtl', text: 'جلسة' },
    ],
  },
  {
    name: 'a percentage typed on an Arabic keyboard',
    text: 'انخفاض بنسبة ٢٥٪',
    paragraph: 'rtl',
    base: 'rtl',
    runs: [
      { direction: 'rtl', text: 'انخفاض بنسبة' },
      { direction: 'ltr', text: '٢٥' },
      { direction: 'rtl', text: '٪' },
    ],
  },
  {
    name: 'a Persian figure',
    text: 'بعد ۱۲ جلسة',
    paragraph: 'rtl',
    base: 'rtl',
    runs: [
      { direction: 'rtl', text: 'بعد' },
      { direction: 'ltr', text: '۱۲' },
      { direction: 'rtl', text: 'جلسة' },
    ],
  },
  {
    name: 'a figure with an Arabic decimal separator',
    text: 'ألفا ١٢٫٥ هرتز',
    paragraph: 'rtl',
    base: 'rtl',
    runs: [
      { direction: 'rtl', text: 'ألفا' },
      { direction: 'ltr', text: '١٢٫٥' },
      { direction: 'rtl', text: 'هرتز' },
    ],
  },
  {
    name: 'a word that runs Arabic letters into Arabic figures',
    text: 'جلسة١٥ اليوم',
    paragraph: 'rtl',
    base: 'rtl',
    runs: [
      { direction: 'rtl', text: 'جلسة' },
      { direction: 'ltr', text: '١٥' },
      { direction: 'rtl', text: 'اليوم' },
    ],
  },
  {
    name: 'a full stop after an Arabic phrase in an English sentence',
    text: 'The greeting was صباح الخير.',
    paragraph: 'ltr',
    base: 'ltr',
    runs: [
      { direction: 'ltr', text: 'The greeting was' },
      { direction: 'rtl', text: 'صباح الخير' },
      { direction: 'ltr', text: '.' },
    ],
  },
  {
    name: 'a comma after an Arabic phrase in an English sentence',
    text: 'She said صباح الخير, then sat down.',
    paragraph: 'ltr',
    base: 'ltr',
    runs: [
      { direction: 'ltr', text: 'She said' },
      { direction: 'rtl', text: 'صباح الخير' },
      { direction: 'ltr', text: ', then sat down.' },
    ],
  },
  {
    name: 'a Latin word followed by an Arabic comma in an English sentence',
    text: 'Alpha، ثم',
    paragraph: 'ltr',
    base: 'ltr',
    runs: [
      { direction: 'ltr', text: 'Alpha،' },
      { direction: 'rtl', text: 'ثم' },
    ],
  },
  {
    name: 'brackets round an Arabic phrase in an English sentence',
    text: 'Read (صباح الخير) aloud',
    paragraph: 'ltr',
    base: 'ltr',
    runs: [
      { direction: 'ltr', text: 'Read (' },
      { direction: 'rtl', text: 'صباح الخير' },
      { direction: 'ltr', text: ') aloud' },
    ],
  },
  {
    name: 'a range typed with a dash and no spaces',
    text: 'ألفا 8–12 هرتز',
    paragraph: 'rtl',
    base: 'rtl',
    runs: [
      { direction: 'rtl', text: 'ألفا' },
      { direction: 'ltr', text: '8–12' },
      { direction: 'rtl', text: 'هرتز' },
    ],
  },
  {
    name: 'a range typed with a dash between spaces',
    text: 'ألفا 8 – 12 هرتز',
    paragraph: 'rtl',
    base: 'rtl',
    runs: [
      { direction: 'rtl', text: 'ألفا' },
      { direction: 'ltr', text: '8 – 12' },
      { direction: 'rtl', text: 'هرتز' },
    ],
  },
  {
    name: 'a range typed with a hyphen between spaces',
    text: 'ألفا 8 - 12 هرتز',
    paragraph: 'rtl',
    base: 'rtl',
    runs: [
      { direction: 'rtl', text: 'ألفا' },
      { direction: 'ltr', text: '8 - 12' },
      { direction: 'rtl', text: 'هرتز' },
    ],
  },
  {
    name: 'a range of times',
    text: 'من 12:30 — 14:00 مساء',
    paragraph: 'rtl',
    base: 'rtl',
    runs: [
      { direction: 'rtl', text: 'من' },
      { direction: 'ltr', text: '12:30 — 14:00' },
      { direction: 'rtl', text: 'مساء' },
    ],
  },
  {
    name: 'a value with its range in brackets',
    text: 'ألفا 10.2 (8–12) هرتز',
    paragraph: 'rtl',
    base: 'rtl',
    runs: [
      { direction: 'rtl', text: 'ألفا 10.2' },
      { direction: 'rtl', text: '(' },
      { direction: 'ltr', text: '8–12' },
      { direction: 'rtl', text: ')' },
      { direction: 'rtl', text: 'هرتز' },
    ],
  },
  {
    name: 'a figure before a figure in brackets',
    text: 'بعد 15 (20) جلسة',
    paragraph: 'rtl',
    base: 'rtl',
    runs: [
      { direction: 'rtl', text: 'بعد 15' },
      { direction: 'rtl', text: '(' },
      { direction: 'ltr', text: '20' },
      { direction: 'rtl', text: ')' },
      { direction: 'rtl', text: 'جلسة' },
    ],
  },
  {
    name: 'a figure in brackets before a figure',
    text: 'بعد (15) 20 جلسة',
    paragraph: 'rtl',
    base: 'rtl',
    runs: [
      { direction: 'rtl', text: 'بعد' },
      { direction: 'rtl', text: '(' },
      { direction: 'ltr', text: '15' },
      { direction: 'rtl', text: ')' },
      { direction: 'rtl', text: '20 جلسة' },
    ],
  },
  {
    name: 'figures separated by an Arabic comma',
    text: 'جلسات 15، 20 و 25',
    paragraph: 'rtl',
    base: 'rtl',
    runs: [
      { direction: 'rtl', text: 'جلسات 15' },
      { direction: 'rtl', text: '،' },
      { direction: 'rtl', text: '20 و 25' },
    ],
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
    // Only letters from U+00C0 to 024F: no plain A to Z to lean on.
    expect(baseDirection('Éé', 'rtl')).toBe('ltr');
  });

  it('falls back when there is no strong character', () => {
    expect(baseDirection('12:30 — 14:00', 'rtl')).toBe('rtl');
    expect(baseDirection('', 'ltr')).toBe('ltr');
  });

  it('counts no figure and no mark of either script as strong', () => {
    expect(baseDirection('١٥ Alpha', 'rtl')).toBe('ltr');
    expect(baseDirection('۱۲٫۵ Alpha', 'rtl')).toBe('ltr');
    expect(baseDirection('، ؛ ؟ ٪ Alpha', 'rtl')).toBe('ltr');
    expect(baseDirection('١٥٪', 'ltr')).toBe('ltr');
    expect(baseDirection('١٥٪', 'rtl')).toBe('rtl');
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

  it('counts figures typed on an Arabic or a Persian keyboard as figures, not letters', () => {
    expect(classify('١٥')).toBe('N');
    expect(classify('۱۲')).toBe('N');
    expect(classify('١٢٫٥')).toBe('N');
    expect(classify('١٬٢٣٤')).toBe('N');
    expect(classify('٢٥٪')).toBe('N');
    expect(classify('،')).toBe('N');
  });
});

describe('isPlainNumber and Arabic figures', () => {
  it('stays ASCII only, so an Arabic figure never joins an Arabic run', () => {
    expect(isPlainNumber('١٥')).toBe(false);
    expect(isPlainNumber('۱۲')).toBe(false);
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

  it('peels nothing off a Latin word in a left-to-right paragraph', () => {
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

describe('the Arabic blocks beyond the first', () => {
  it('counts letters from the supplement and both presentation-form blocks as strong Arabic', () => {
    for (const letter of ['ݐ', 'ﭐ', 'ﻻ']) {
      expect(classify(letter)).toBe('R');
      expect(baseDirection(`${letter} Alpha`, 'ltr')).toBe('rtl');
    }
  });
});

describe('which way typed words read, in a report', () => {
  it('is the report’s way when they hold a letter of its script, wherever it stands', () => {
    expect(readingDirection('EEG ثم كلمات', 'rtl')).toBe('rtl');
    expect(readingDirection('كلمات ثم EEG', 'rtl')).toBe('rtl');
    expect(readingDirection('Alpha موجات', 'ltr')).toBe('ltr');
    expect(readingDirection('موجات Alpha', 'ltr')).toBe('ltr');
  });

  it('is the way of their own letters when they hold none of the report’s script', () => {
    expect(readingDirection('Typed in English', 'rtl')).toBe('ltr');
    expect(readingDirection('بندق مرج', 'ltr')).toBe('rtl');
  });

  it('is the report’s way when they hold no letter at all', () => {
    expect(readingDirection('15', 'rtl')).toBe('rtl');
    expect(readingDirection('15', 'ltr')).toBe('ltr');
    expect(readingDirection('', 'rtl')).toBe('rtl');
    expect(readingDirection('( 8 – 12 )', 'ltr')).toBe('ltr');
  });

  it('does not take a figure typed on an Arabic keyboard for a letter', () => {
    expect(readingDirection('١٥', 'ltr')).toBe('ltr');
    expect(readingDirection('Sessions ١٥', 'rtl')).toBe('ltr');
  });
});
