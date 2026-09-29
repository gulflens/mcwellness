/**
 * Laying out and drawing a formatted paragraph, in English, in Arabic and in
 * each other, with a fake measure that counts characters so every width is
 * exact. Where direction matters, a line is read back as the engine would
 * put it on the page.
 */

import { describe, expect, it } from 'vitest';
import { forDrawing } from '@domain/shared/document';
import type { Op } from '@domain/shared/document';
import { lineBox } from './metrics';
import type { Face } from './metrics';
import { drawParagraph, layoutParagraph, physicalAlign, splitParagraph } from './paragraph';
import type { Measure, ParagraphInput, Span } from './paragraph';

/** Half the size per character, whatever the character: every width is exact. */
const measure: Measure = (text, _weight, size) => ([...text].length * size) / 2;

const SIZE = 10;
const CHAR = SIZE / 2;
const LATIN: Face = { ascent: 1.025, descent: -0.25 };
const ARABIC: Face = { ascent: 1.1, descent: -0.45 };
const AT = { x: 50, top: 700 };

function input(spans: readonly Span[], extra: Partial<ParagraphInput> = {}): ParagraphInput {
  return {
    spans,
    style: { size: SIZE, lineHeight: 1.5, weight: 'regular' },
    width: 100,
    paragraph: 'ltr',
    align: 'start',
    ink: { grey: 0 },
    accent: { rgb: [0.2, 0.1, 0.4] },
    faces: { latin: LATIN, arabic: ARABIC },
    ...extra,
  };
}

type TextOp = Extract<Op, { kind: 'text' }>;
type RuleOp = Extract<Op, { kind: 'rule' }>;

function draw(spans: readonly Span[], extra: Partial<ParagraphInput> = {}): Op[] {
  return drawParagraph(layoutParagraph(input(spans, extra), measure), AT);
}

function texts(ops: readonly Op[]): TextOp[] {
  return ops.filter((op): op is TextOp => op.kind === 'text');
}

function rules(ops: readonly Op[]): RuleOp[] {
  return ops.filter((op): op is RuleOp => op.kind === 'rule');
}

function widthOf(op: TextOp): number {
  return measure(op.text, 'regular', op.style.size, op.rtl === true);
}

function left(op: TextOp): number {
  if (op.align === 'end') return op.x - widthOf(op);
  if (op.align === 'centre') return op.x - widthOf(op) / 2;
  return op.x;
}

function right(op: TextOp): number {
  return left(op) + widthOf(op);
}

/** The text ops of each line, keyed by baseline, top line first, each line left to right. */
function lines(ops: readonly Op[]): TextOp[][] {
  const byBaseline = new Map<number, TextOp[]>();
  for (const op of texts(ops)) byBaseline.set(op.y, [...(byBaseline.get(op.y) ?? []), op]);
  return [...byBaseline.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, row]) => [...row].sort((a, b) => left(a) - left(b)));
}

/** An Arabic string as the engine's `rtl` op puts it on the page, left to right. */
function engine(text: string): string {
  return String.fromCodePoint(...forDrawing(text));
}

/**
 * The first line as it reaches the page, read left to right: an `rtl` op in
 * the order the engine draws it, any other as typed, a space wherever two ops
 * stand apart.
 */
function onPage(ops: readonly Op[]): string {
  let out = '';
  let edge: number | null = null;
  for (const op of lines(ops)[0] ?? []) {
    if (edge !== null && left(op) > edge + 1e-9) out += ' ';
    out += op.rtl === true ? engine(op.text) : op.text;
    edge = right(op);
  }
  return out;
}

const EIGHT_WORDS = 'alpha beta gamma delta epsilon zeta eta theta';
const TWELVE_WORDS = 'aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj kkkk llll';

describe('layoutParagraph', () => {
  it('wraps at the width and never draws past it', () => {
    const ops = draw([{ text: EIGHT_WORDS }]);
    expect(lines(ops).map((row) => row.map((op) => op.text).join(' '))).toEqual([
      'alpha beta gamma',
      'delta epsilon zeta',
      'eta theta',
    ]);
    for (const op of texts(ops)) {
      expect(left(op)).toBeGreaterThanOrEqual(AT.x);
      expect(right(op)).toBeLessThanOrEqual(AT.x + 100);
    }
  });

  it('breaks a word that is wider than the line', () => {
    const ops = draw([{ text: 'abcdefghijklmnopqrstuvwxyz end' }]);
    expect(lines(ops).map((row) => row.map((op) => op.text).join(' '))).toEqual([
      'abcdefghijklmnopqrst',
      'uvwxyz end',
    ]);
  });

  it('gives no lines and no height for a blank input', () => {
    for (const spans of [[], [{ text: '' }], [{ text: '   ' }, { text: ' ', bold: true }]]) {
      const laid = layoutParagraph(input(spans), measure);
      expect(laid.lines).toHaveLength(0);
      expect(laid.height).toBe(0);
      expect(drawParagraph(laid, AT)).toEqual([]);
    }
  });

  it('is the line count times the line advance tall, exactly', () => {
    const laid = layoutParagraph(input([{ text: EIGHT_WORDS }]), measure);
    expect(laid.lines).toHaveLength(3);
    expect(laid.height).toBe(3 * 1.5 * SIZE);
    expect(laid.box.advance).toBe(15);
  });

  it('keeps its arithmetic when the leading is negative', () => {
    const laid = layoutParagraph(
      input([{ text: EIGHT_WORDS }], { style: { size: SIZE, lineHeight: 1, weight: 'regular' } }),
      measure,
    );
    expect(laid.box.halfLeading).toBeCloseTo(-1.375, 9);
    expect(laid.height).toBe(30);
    const baselines = lines(drawParagraph(laid, AT)).map((row) => row[0]?.y ?? 0);
    expect(baselines[0]).toBeCloseTo(AT.top - (-1.375 + 10.25), 9);
    expect(baselines[1]).toBeCloseTo(AT.top - (-1.375 + 10.25 + 10), 9);
  });

  it('sets line i on the baseline the line box gives it', () => {
    const laid = layoutParagraph(input([{ text: EIGHT_WORDS }]), measure);
    const baselines = lines(drawParagraph(laid, AT)).map((row) => row[0]?.y ?? 0);
    baselines.forEach((y, i) => {
      expect(y).toBeCloseTo(AT.top - (laid.box.firstBaseline + i * laid.box.advance), 9);
    });
  });

  it('merges a start-aligned line into as few ops as its styles allow', () => {
    const ops = draw([{ text: 'one two ' }, { text: 'three' }]);
    expect(texts(ops).map((op) => op.text)).toEqual(['one two three']);
    expect(texts(ops)[0]?.x).toBe(AT.x);
  });

  it('draws a bold run inside a sentence as its own op on the same baseline', () => {
    const ops = texts(draw([{ text: 'one ' }, { text: 'two', bold: true }, { text: ' three' }]));
    expect(ops.map((op) => [op.text, op.style.font])).toEqual([
      ['one', 'regular'],
      ['two', 'bold'],
      ['three', 'regular'],
    ]);
    expect(new Set(ops.map((op) => op.y)).size).toBe(1);
    expect(ops.map((op) => op.x)).toEqual([AT.x, AT.x + 4 * CHAR, AT.x + 8 * CHAR]);
  });

  it('draws an accent span in the accent paint and nothing else in colour', () => {
    const ops = texts(draw([{ text: 'plain ' }, { text: 'marked', accent: true }]));
    expect(ops[0]?.style).toEqual({ font: 'regular', size: SIZE, grey: 0 });
    expect(ops[1]?.style).toEqual({ font: 'regular', size: SIZE, rgb: [0.2, 0.1, 0.4] });
  });

  it('adds justified widths up to the measure on every line but the last', () => {
    const rows = lines(draw([{ text: TWELVE_WORDS }], { justify: true }));
    expect(rows).toHaveLength(3);
    for (const row of rows.slice(0, -1)) {
      expect(row).toHaveLength(4);
      expect(left(row[0] as TextOp)).toBeCloseTo(AT.x, 9);
      expect(right(row[row.length - 1] as TextOp)).toBeCloseTo(AT.x + 100, 9);
    }
    const last = rows[rows.length - 1] ?? [];
    expect(last.map((op) => op.text)).toEqual(['iiii jjjj kkkk llll']);
    expect(last[0]?.x).toBe(AT.x);
  });

  it('leaves a justified line alone when its gaps would stretch too far', () => {
    const rows = lines(draw([{ text: 'aaaaaaaa bbbbbbbb cccccccccccccc dd' }], { justify: true }));
    expect(rows[0]?.map((op) => op.text)).toEqual(['aaaaaaaa bbbbbbbb']);
    expect(rows[0]?.[0]?.x).toBe(AT.x);
  });

  it('never justifies a one-word line', () => {
    const rows = lines(draw([{ text: 'aaaaaaaaaaaaaaaaaa bbbbbbbbbbbb' }], { justify: true }));
    expect(rows[0]?.[0]?.x).toBe(AT.x);
    expect(right(rows[0]?.[0] as TextOp)).toBe(AT.x + 90);
  });

  it('sets an end-aligned or centred line from its own edge', () => {
    const end = texts(draw([{ text: 'one two' }], { align: 'end' }));
    expect(right(end[0] as TextOp)).toBe(AT.x + 100);
    const centre = texts(draw([{ text: 'one two' }], { align: 'centre' }));
    expect(left(centre[0] as TextOp)).toBe(AT.x + (100 - 35) / 2);
  });

  it('anchors a right-to-left paragraph to the right edge', () => {
    const rows = lines(draw([{ text: 'نشاط متزايد في المناطق الجبهية' }], { paragraph: 'rtl' }));
    for (const row of rows) {
      const first = row[row.length - 1] as TextOp;
      expect(first.rtl).toBe(true);
      expect(first.align).toBe('end');
      expect(first.x).toBe(AT.x + 100);
    }
  });

  it('draws a figure inside an Arabic line left to right, in order', () => {
    const ops = texts(draw([{ text: 'هاتف: +971 50 000 0012' }], { paragraph: 'rtl', width: 200 }));
    expect(ops).toHaveLength(2);
    const [label, figure] = ops as [TextOp, TextOp];
    expect(label).toMatchObject({ text: 'هاتف:', rtl: true, align: 'end', x: AT.x + 200 });
    expect(figure.text).toBe('+971 50 000 0012');
    expect(figure.rtl).toBeUndefined();
    expect(figure.align ?? 'start').toBe('start');
    expect(figure.x).toBe(AT.x + 200 - 5 * CHAR - CHAR - 16 * CHAR);
  });

  it('draws an Arabic phrase inside an English line as one right-to-left op', () => {
    const ops = texts(
      draw([{ text: 'The session began with صباح الخير before the recording.' }], {
        width: 400,
      }),
    );
    expect(ops.map((op) => op.text)).toEqual([
      'The session began with',
      'صباح الخير',
      'before the recording.',
    ]);
    const phrase = ops[1] as TextOp;
    expect(phrase).toMatchObject({ rtl: true, align: 'end', x: AT.x + 23 * CHAR + 10 * CHAR });
    expect(left(ops[2] as TextOp)).toBe(right(phrase) + CHAR);
  });

  it('draws a figure typed on an Arabic keyboard in the order it was typed', () => {
    const ops = draw([{ text: 'بعد ١٥ جلسة' }], { paragraph: 'rtl' });
    expect(onPage(ops)).toBe(`${engine('جلسة')} ١٥ ${engine('بعد')}`);
  });

  it('draws a percentage typed on an Arabic keyboard in the order it was typed', () => {
    const ops = draw([{ text: 'انخفاض بنسبة ٢٥٪' }], { paragraph: 'rtl' });
    expect(onPage(ops)).toBe(`٪٢٥ ${engine('انخفاض بنسبة')}`);
  });

  it('ends an English sentence with its full stop after an Arabic phrase', () => {
    const ops = draw([{ text: 'The greeting was صباح الخير.' }], { width: 400 });
    expect(onPage(ops)).toBe(`The greeting was ${engine('صباح الخير')}.`);
  });

  it('keeps a Latin word before its Arabic comma in an English sentence', () => {
    const ops = draw([{ text: 'Alpha، ثم' }]);
    expect(onPage(ops)).toBe(`Alpha، ${engine('ثم')}`);
  });

  it('draws a range inside an Arabic line in the order typed, however it is spaced', () => {
    for (const range of ['8–12', '8 – 12', '8 - 12']) {
      const ops = draw([{ text: `ألفا ${range} هرتز` }], { paragraph: 'rtl', width: 200 });
      expect(onPage(ops)).toBe(`${engine('هرتز')} ${range} ${engine('ألفا')}`);
    }
  });

  it('pairs the brackets round a figure beside another figure in an Arabic line', () => {
    const cases: [string, string][] = [
      ['ألفا 10.2 (8–12) هرتز', `${engine('هرتز')} (8–12) ${engine('ألفا 10.2')}`],
      ['بعد 15 (20) جلسة', `${engine('جلسة')} (20) ${engine('بعد 15')}`],
      ['بعد (15) 20 جلسة', `${engine('20 جلسة')} (15) ${engine('بعد')}`],
      ['ألفا 10.2 [8–12] هرتز', `${engine('هرتز')} [8–12] ${engine('ألفا 10.2')}`],
      ['بعد 15 [20] جلسة', `${engine('جلسة')} [20] ${engine('بعد 15')}`],
      ['بعد [15] 20 جلسة', `${engine('20 جلسة')} [15] ${engine('بعد')}`],
      ['بنسبة 25% (30%) فقط', `${engine('فقط')} (30%) 25% ${engine('بنسبة')}`],
      ['بعد ١٥ (٢٠) جلسة', `${engine('جلسة')} (٢٠) ١٥ ${engine('بعد')}`],
    ];
    for (const [text, page] of cases) {
      const ops = draw([{ text }], { paragraph: 'rtl', width: 200 });
      expect(onPage(ops), text).toBe(page);
    }
  });

  it('keeps the first of figures parted by an Arabic comma at the right', () => {
    const ops = draw([{ text: 'جلسات 15، 20 و 25' }], { paragraph: 'rtl', width: 200 });
    expect(onPage(ops)).toBe(`${engine('20 و 25')} ${engine('،')}${engine('جلسات 15')}`);
  });

  it('draws the ranges, the times and the telephone number of an Arabic line as typed', () => {
    for (const range of ['8–12', '8 – 12', '8 - 12', '8-12', '12:30 — 14:00']) {
      const ops = draw([{ text: `ألفا ${range} هرتز` }], { paragraph: 'rtl', width: 200 });
      expect(onPage(ops), range).toBe(`${engine('هرتز')} ${range} ${engine('ألفا')}`);
    }
    const ops = draw([{ text: 'هاتف: +971 50 000 0012' }], { paragraph: 'rtl', width: 200 });
    expect(onPage(ops)).toBe(`+971 50 000 0012 ${engine('هاتف:')}`);
  });

  it('keeps a plain number inside the Arabic op of an Arabic line', () => {
    const ops = texts(draw([{ text: 'بعد 15 جلسة' }], { paragraph: 'rtl' }));
    expect(ops.map((op) => [op.text, op.rtl])).toEqual([['بعد 15 جلسة', true]]);
  });
});

describe('underline', () => {
  /** Each rule as where it starts, how long it is and its paint, leftmost first. */
  const spans = (ops: readonly Op[]) =>
    rules(ops)
      .map((rule) => ({ x: rule.x, width: rule.width, grey: rule.grey, rgb: rule.rgb }))
      .sort((a, b) => a.x - b.x);

  it('draws two rules for two underlined phrases on one line, and none under the words between', () => {
    const ops = draw([
      { text: 'first', underline: true },
      { text: ' plain ' },
      { text: 'last', underline: true },
    ]);
    expect(spans(ops)).toEqual([
      { x: AT.x, width: 5 * CHAR, grey: 0, rgb: undefined },
      { x: AT.x + 12 * CHAR, width: 4 * CHAR, grey: 0, rgb: undefined },
    ]);
  });

  it('draws an accent word underlined after an ink word as two rules in two paints', () => {
    const ops = draw([
      { text: 'ink ', underline: true },
      { text: 'accent', underline: true, accent: true },
    ]);
    expect(spans(ops)).toEqual([
      { x: AT.x, width: 3 * CHAR, grey: 0, rgb: undefined },
      { x: AT.x + 4 * CHAR, width: 6 * CHAR, grey: 0, rgb: [0.2, 0.1, 0.4] },
    ]);
  });

  it('draws one rule under two underlined words side by side, the space between included', () => {
    const ops = draw([
      { text: 'bold', underline: true, bold: true },
      { text: ' plain', underline: true },
    ]);
    expect(texts(ops)).toHaveLength(2);
    expect(spans(ops)).toEqual([{ x: AT.x, width: 10 * CHAR, grey: 0, rgb: undefined }]);
  });

  it('draws the same rules on a right-to-left line', () => {
    const apart = draw(
      [{ text: 'أول', underline: true }, { text: ' عادي ' }, { text: 'آخر', underline: true }],
      { paragraph: 'rtl' },
    );
    expect(spans(apart)).toEqual([
      { x: AT.x + 100 - 12 * CHAR, width: 3 * CHAR, grey: 0, rgb: undefined },
      { x: AT.x + 100 - 3 * CHAR, width: 3 * CHAR, grey: 0, rgb: undefined },
    ]);
    const together = draw(
      [
        { text: 'نص', underline: true, bold: true },
        { text: ' مسطر', underline: true },
      ],
      { paragraph: 'rtl' },
    );
    expect(texts(together)).toHaveLength(2);
    expect(spans(together)).toEqual([
      { x: AT.x + 100 - 7 * CHAR, width: 7 * CHAR, grey: 0, rgb: undefined },
    ]);
  });

  it('runs under the underlined words of each line, once per line when they are unbroken', () => {
    const ops = draw([{ text: 'aaaa ' }, { text: 'bbbb cccc dddd eeee ffff', underline: true }]);
    const lines = rules(ops);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ x: AT.x + 5 * CHAR, width: 14 * CHAR });
    expect(lines[1]).toMatchObject({ x: AT.x, width: 9 * CHAR });
  });

  it('is the same length whichever way the line runs', () => {
    const ltr = rules(draw([{ text: 'Read ' }, { text: 'صباح الخير', underline: true }]));
    const rtl = rules(
      draw([{ text: 'اقرأ ' }, { text: 'صباح الخير', underline: true }], { paragraph: 'rtl' }),
    );
    expect(ltr).toHaveLength(1);
    expect(rtl).toHaveLength(1);
    expect(rtl[0]?.width).toBe(ltr[0]?.width);
    expect(rtl[0]?.width).toBe(10 * CHAR);
    expect(rtl[0]?.x).toBe(AT.x + 100 - 5 * CHAR - 10 * CHAR);
  });

  it('sits 0.275 em below the baseline, under a descent of 0.25 em, and 0.5 em under Arabic', () => {
    const latinOps = draw([{ text: 'underlined', underline: true }]);
    const latinBaseline = texts(latinOps)[0]?.y ?? 0;
    const latinRule = rules(latinOps)[0] as RuleOp;
    expect(latinBaseline - latinRule.y).toBeCloseTo(0.275 * SIZE, 9);
    expect(latinBaseline - latinRule.y).toBeGreaterThan(-LATIN.descent * SIZE);
    expect(latinRule.thickness).toBeCloseTo(0.6, 9);

    const arabicOps = draw([{ text: 'نص مسطر', underline: true }], { paragraph: 'rtl' });
    const arabicBaseline = texts(arabicOps)[0]?.y ?? 0;
    const arabicRule = rules(arabicOps)[0] as RuleOp;
    expect(arabicBaseline - arabicRule.y).toBeCloseTo(0.5 * SIZE, 9);
  });

  it('is never thinner than half a point, and takes the paint of its text', () => {
    const ops = draw([{ text: 'small', underline: true, accent: true }], {
      style: { size: 5, lineHeight: 1.5, weight: 'regular' },
    });
    expect(rules(ops)[0]).toMatchObject({ thickness: 0.5, rgb: [0.2, 0.1, 0.4] });
  });
});

describe('splitParagraph', () => {
  const six = layoutParagraph(input([{ text: `${TWELVE_WORDS} ${TWELVE_WORDS}` }]), measure);

  it('splits between lines and keeps two on each side', () => {
    expect(six.lines).toHaveLength(6);
    const parts = splitParagraph(six, 5 * six.box.advance + 1);
    expect(parts).not.toBeNull();
    const [first, second] = parts ?? [six, six];
    expect(first.lines).toHaveLength(4);
    expect(second.lines).toHaveLength(2);
    expect(first.height).toBe(4 * six.box.advance);
    expect(second.height).toBe(2 * six.box.advance);
    expect([...first.lines, ...second.lines]).toEqual(six.lines);
  });

  it('takes as many lines as the room holds', () => {
    const [first] = splitParagraph(six, 3 * six.box.advance) ?? [six];
    expect(first.lines).toHaveLength(3);
  });

  it('does not split when the room holds fewer than two lines', () => {
    expect(splitParagraph(six, 1.9 * six.box.advance)).toBeNull();
  });

  it('does not split for a room that is not a number', () => {
    expect(splitParagraph(six, Number.NaN)).toBeNull();
    expect(splitParagraph(six, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('does not split a three-line paragraph', () => {
    const three = layoutParagraph(input([{ text: EIGHT_WORDS }]), measure);
    expect(three.lines).toHaveLength(3);
    expect(splitParagraph(three, 2 * three.box.advance)).toBeNull();
  });

  it('draws the second part from the top of its own box', () => {
    const [, second] = splitParagraph(six, 4 * six.box.advance) ?? [six, six];
    const baseline = texts(drawParagraph(second, AT))[0]?.y ?? 0;
    expect(baseline).toBeCloseTo(AT.top - six.box.firstBaseline, 9);
  });
});

describe('numbers that are not numbers', () => {
  it('refuses a width that is not a number, or is nothing or less', () => {
    for (const width of [Number.NaN, Number.POSITIVE_INFINITY, 0, -5]) {
      expect(() => layoutParagraph(input([{ text: EIGHT_WORDS }], { width }), measure)).toThrow(
        /width/,
      );
    }
  });

  it('refuses a size that is not a number', () => {
    expect(() =>
      layoutParagraph(
        input([{ text: 'one' }], {
          style: { size: Number.NaN, lineHeight: 1.5, weight: 'regular' },
        }),
        measure,
      ),
    ).toThrow(/size/);
  });

  it('refuses a measure that gives a width that is not a number', () => {
    expect(() => layoutParagraph(input([{ text: 'one two' }]), () => Number.NaN)).toThrow(
      /measure/,
    );
  });
});

describe('physicalAlign', () => {
  it('turns an align relative to the paragraph into the engine’s physical one', () => {
    expect(physicalAlign('start', 'ltr')).toBe('start');
    expect(physicalAlign('end', 'ltr')).toBe('end');
    expect(physicalAlign('start', 'rtl')).toBe('end');
    expect(physicalAlign('end', 'rtl')).toBe('start');
    expect(physicalAlign('centre', 'ltr')).toBe('centre');
    expect(physicalAlign('centre', 'rtl')).toBe('centre');
  });
});

describe('the rules a paragraph keeps to', () => {
  it('sets every line of a right-to-left paragraph on the Arabic face, and a left-to-right one on the Latin', () => {
    const style = { size: SIZE, lineHeight: 1.5, weight: 'regular' } as const;
    const rtl = layoutParagraph(input([{ text: 'نص مسطر' }], { paragraph: 'rtl' }), measure);
    expect(rtl.box).toEqual(lineBox(style, ARABIC));
    const ltr = layoutParagraph(input([{ text: 'plain text' }]), measure);
    expect(ltr.box).toEqual(lineBox(style, LATIN));
    expect(rtl.box.firstBaseline).not.toBe(ltr.box.firstBaseline);
    const baseline = texts(drawParagraph(rtl, AT))[0]?.y;
    expect(baseline).toBeCloseTo(AT.top - lineBox(style, ARABIC).firstBaseline, 9);
  });

  it('sets an end-aligned right-to-left line against the left edge', () => {
    const [op] = texts(draw([{ text: 'نص قصير' }], { paragraph: 'rtl', align: 'end' }));
    expect(op?.rtl).toBe(true);
    expect(left(op as TextOp)).toBe(AT.x);
  });

  it('draws the underline in the grey of its text', () => {
    const ops = draw([{ text: 'grey words', underline: true }], { ink: { grey: 0.4 } });
    expect(rules(ops)[0]?.grey).toBe(0.4);
    expect(texts(ops)[0]?.style.grey).toBe(0.4);
  });
});

describe('what a laid paragraph tells its caller', () => {
  it('says how far an Arabic underline on its last line reaches below its box', () => {
    const laid = layoutParagraph(
      input([{ text: 'نص مسطر', underline: true }], { paragraph: 'rtl' }),
      measure,
    );
    // The box ends 15 - 10.75 = 4.25 below the baseline; the rule's lower
    // edge is 0.5 em and half its 0.6 thickness below it, at 5.3.
    expect(laid.overhang).toBeCloseTo(5.3 - 4.25, 9);
  });

  it('says nothing overhangs when no rule reaches below the last line box', () => {
    const latin = layoutParagraph(input([{ text: 'underlined', underline: true }]), measure);
    expect(latin.overhang).toBe(0);
    const plain = layoutParagraph(input([{ text: 'نص' }], { paragraph: 'rtl' }), measure);
    expect(plain.overhang).toBe(0);
    const firstLineOnly = layoutParagraph(
      input([{ text: 'نص مسطر', underline: true }, { text: ' ثم نص عادي طويل بعده كثيرا' }], {
        paragraph: 'rtl',
        width: 50,
      }),
      measure,
    );
    expect(firstLineOnly.lines.length).toBeGreaterThan(1);
    expect(firstLineOnly.overhang).toBe(0);
  });

  it('keeps a no-break space, and never breaks a line there', () => {
    const laid = layoutParagraph(input([{ text: 'alpha beta gamma delta' }]), measure);
    expect(lines(drawParagraph(laid, AT)).map((row) => row.map((op) => op.text).join(' '))).toEqual(
      ['alpha beta', 'gamma delta'],
    );
  });

  it('folds every other white space to one breaking space', () => {
    const ops = texts(draw([{ text: 'alpha\tbeta\ngamma' }]));
    expect(ops.map((op) => op.text)).toEqual(['alpha beta gamma']);
  });
});

describe('a split part laid out again', () => {
  const six = layoutParagraph(
    input([
      { text: 'aaaa bbbb ' },
      { text: 'cccc dddd', bold: true },
      { text: ' eeee ffff gggg hhhh ' },
      { text: 'iiii', underline: true },
      { text: ` jjjj kkkk llll ${TWELVE_WORDS}` },
    ]),
    measure,
  );

  it('holds only its own text, so laying it out again gives the same part', () => {
    const [first, second] = splitParagraph(six, 4 * six.box.advance) ?? [six, six];
    expect(first.lines).toHaveLength(4);
    for (const part of [first, second]) {
      expect(layoutParagraph(part.input, measure).lines).toEqual(part.lines);
    }
    const text = (spans: readonly Span[]): string => spans.map((span) => span.text).join('');
    expect(text(first.input.spans) + ' ' + text(second.input.spans)).toBe(text(six.input.spans));
  });
});
