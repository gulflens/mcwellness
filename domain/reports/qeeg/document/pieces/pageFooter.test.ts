import { describe, expect, it } from 'vitest';
import type { Op } from '@domain/shared/document';
import { extentOf } from '../block';
import type { Block } from '../block';
import { FOOTER } from '../geometry';
import { lineBox } from '../metrics';
import { HAIRLINE, MUTED } from '../palette';
import type { LayoutOp } from '../scale';
import { styleOf } from '../styles';
import type { Drawing } from '../typeset';
import { ARABIC, ENGLISH, FACE, measure, outside, unmirrored, wordsOf } from './checks';
import { pageFooter } from './pageFooter';
import { fixed, typed } from './words';
import type { Words } from './words';

const WIDTH = 480;

/** An English report whose Arabic face stands deeper than its Latin one. */
const DEEP_ARABIC_FACE: Drawing = {
  ...ENGLISH,
  faces: { latin: FACE, arabic: { ascent: 1.3, descent: -0.6 } },
};

const STYLE = styleOf('footer', 'ltr').style;
const LINE = STYLE.size * STYLE.lineHeight;
/** A line takes no room: the hairline is drawn inside the upper edge of the padding. */
const WORDS_AT = FOOTER.padTop;
const PHONE = '+971 50 000 0001';

const PLACE = fixed('McWellness, Dubai, United Arab Emirates');
const PHONE_LINE = typed(PHONE);
const LINES = [PLACE, PHONE_LINE];
const ARABIC_LINES = [fixed('دبي، الإمارات العربية المتحدة'), fixed(`هاتف ${PHONE}`)];

const texts = (ops: readonly LayoutOp[]) =>
  ops.filter((op): op is Extract<Op, { kind: 'text' }> => op.kind === 'text');
const rules = (ops: readonly LayoutOp[]) =>
  ops.filter((op): op is Extract<Op, { kind: 'rule' }> => op.kind === 'rule');

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

const pageOps = (block: Block, page: string) => texts(block.ops).filter((op) => op.text === page);
const lineOps = (block: Block, page: string) => texts(block.ops).filter((op) => op.text !== page);

describe('pageFooter', () => {
  for (const [name, drawing, lines, page] of [
    ['English', ENGLISH, LINES, 'Page 2 of 9'],
    ['Arabic', ARABIC, ARABIC_LINES, 'صفحة 2 من 9'],
  ] as const) {
    it(`keeps everything inside its box, in ${name}`, () => {
      expect(outside(pageFooter({ lines, page }, WIDTH, drawing), measure)).toEqual([]);
    });
  }

  it('draws the Arabic footer as the mirror of the English one, words and hairline', () => {
    for (const lines of [LINES, [typed('Steady progress.'), fixed('word '.repeat(40))]]) {
      const en = pageFooter({ lines, page: 'Page 2 of 9' }, WIDTH, ENGLISH);
      const ar = pageFooter({ lines, page: 'Page 2 of 9' }, WIDTH, ARABIC);
      expect(unmirrored(en, ar, measure)).toEqual([]);
    }
  });

  it('draws a hairline along the top, the full width, first', () => {
    const block = pageFooter({ lines: LINES, page: 'Page 2 of 9' }, WIDTH, ENGLISH);
    const [rule] = rules(block.ops);
    expect(block.ops[0]).toBe(rule);
    expect(rule?.x).toBe(0);
    expect(rule?.width).toBe(WIDTH);
    expect(rule?.thickness).toBe(FOOTER.rule);
    expect(rule?.grey).toBe(HAIRLINE.grey);
    const extent = extentOf(rules(block.ops), measure);
    expect(extent.top).toBeCloseTo(0, 9);
    expect(extent.bottom).toBeCloseTo(-FOOTER.rule, 9);
  });

  it('sets the practice’s lines at the start edge, each on a line of its own, under the padding', () => {
    const page = 'Page 2 of 9';
    const block = pageFooter({ lines: LINES, page }, WIDTH, ENGLISH);
    const lines = lineOps(block, page);
    expect(lines.map((op) => op.text)).toEqual([PLACE.text, PHONE]);
    expect(extentOf(lines, measure).left).toBeCloseTo(0, 9);
    expect(lines[0]?.style.grey).toBe(MUTED.grey);
    expect(lines[0]?.y).toBeCloseTo(-(WORDS_AT + lineBox(STYLE, FACE).firstBaseline), 9);
    expect(lines[1]?.y).toBeCloseTo((lines[0]?.y ?? Number.NaN) - LINE, 9);
    expect(block.height).toBeCloseTo(WORDS_AT + 2 * LINE, 9);
    const arabicLines = lineOps(pageFooter({ lines: ARABIC_LINES, page }, WIDTH, ARABIC), page);
    expect(extentOf(arabicLines, measure).right).toBeCloseTo(WIDTH, 9);
  });

  it('sets the page’s words at the end edge, level with the last line', () => {
    const page = 'Page 2 of 9';
    const block = pageFooter({ lines: LINES, page }, WIDTH, ENGLISH);
    const [words] = pageOps(block, page);
    expect(extentOf(pageOps(block, page), measure).right).toBeCloseTo(WIDTH, 9);
    expect(words?.y).toBeCloseTo(lineOps(block, page).at(-1)?.y ?? Number.NaN, 9);
    const arabicPage = 'صفحة 2 من 9';
    const inArabic = pageFooter({ lines: ARABIC_LINES, page: arabicPage }, WIDTH, ARABIC);
    const pageExtent = extentOf(
      texts(inArabic.ops).filter((op) => /صفحة|من|^\d+$/.test(op.text)),
      measure,
    );
    expect(pageExtent.left).toBeCloseTo(0, 9);
  });

  it('keeps the last baselines level when a typed line in the other script has a line box of its own', () => {
    const page = 'Page 2 of 9';
    const block = pageFooter(
      { lines: [fixed('Dubai'), typed('دبي')], page },
      WIDTH,
      DEEP_ARABIC_FACE,
    );
    const [words] = pageOps(block, page);
    const last = texts(block.ops).find((op) => op.rtl === true);
    expect(words?.y).toBeCloseTo(last?.y ?? Number.NaN, 9);
    expect(outside(block, measure)).toEqual([]);
  });

  it('keeps at least the gutter between the lines and the page’s words, the lines wrapping in what is left', () => {
    const page = 'Page 2 of 9';
    const long = fixed('word '.repeat(40));
    const block = pageFooter({ lines: [long], page }, WIDTH, ENGLISH);
    const lines = extentOf(lineOps(block, page), measure);
    const words = extentOf(pageOps(block, page), measure);
    expect(words.left - lines.right).toBeGreaterThanOrEqual(FOOTER.gutter - 1e-9);
    expect(lineOps(block, page).length).toBeGreaterThan(1);
  });

  it('is as tall on every page up to the ninety-ninth, and its lines do not move', () => {
    for (const [drawing, pageOf] of [
      [ENGLISH, (n: number, of: number) => `Page ${n} of ${of}`],
      [ARABIC, (n: number, of: number) => `صفحة ${n} من ${of}`],
    ] as const) {
      const lines = [fixed('word '.repeat(37)), typed(PHONE)];
      const pages = [pageOf(1, 1), pageOf(2, 9), pageOf(10, 12), pageOf(99, 99)];
      const blocks = pages.map((page) => pageFooter({ lines, page }, WIDTH, drawing));
      const heights = new Set(blocks.map((block) => block.height.toFixed(9)));
      expect(heights.size).toBe(1);
      // The lines are of words and a number, and the page's words hold neither.
      const ofTheLines = (block: Block) =>
        texts(block.ops).filter((op) => op.text.includes('word') || op.text.includes('971'));
      const drawn = blocks.map(ofTheLines);
      expect(drawn[0]?.length).toBeGreaterThan(2);
      for (const each of drawn) expect(each).toEqual(drawn[0]);
    }
  });

  it('stands the figures of a telephone number in order on an Arabic page', () => {
    for (const line of [fixed(`هاتف ${PHONE}`), typed(`هاتف ${PHONE}`), typed(PHONE)]) {
      const block = pageFooter({ lines: [line], page: 'صفحة 2 من 9' }, WIDTH, ARABIC);
      const number = texts(block.ops).filter((op) => op.text.includes('971'));
      expect(number.map((op) => op.text)).toEqual([PHONE]);
      expect(number[0]?.rtl ?? false).toBe(false);
      expect(number[0]?.align ?? 'start').toBe('start');
    }
  });

  it('reads a typed line the way its letters do in an Arabic report, and a fixed one the report’s way', () => {
    // The page's words stand level with the last line, so the line asked
    // about is the first of two.
    const block = (line: Words) =>
      pageFooter({ lines: [line, fixed('دبي')], page: 'صفحة 2 من 9' }, WIDTH, ARABIC);
    expect(wordsOf(block(typed('Steady progress.')), measure)[0]).toBe('Steady progress.');
    expect(wordsOf(block(fixed('Steady progress.')), measure)[0]).toBe('. Steady progress');
  });

  it('leaves out a line that is empty once trimmed, and leaves no room for it', () => {
    const page = 'Page 2 of 9';
    const two = pageFooter({ lines: LINES, page }, WIDTH, ENGLISH);
    const gapped = pageFooter({ lines: [PLACE, typed('  '), PHONE_LINE], page }, WIDTH, ENGLISH);
    expect(gapped.ops).toEqual(two.ops);
    const none = pageFooter({ lines: [typed(' ')], page }, WIDTH, ENGLISH);
    expect(none.height).toBeCloseTo(WORDS_AT + LINE, 9);
    expect(texts(none.ops).map((op) => op.text)).toEqual([page]);
    expect(two.height - pageFooter({ lines: [PLACE], page }, WIDTH, ENGLISH).height).toBeCloseTo(
      LINE,
      9,
    );
  });

  it('wraps a long line inside its box, and grows', () => {
    for (const drawing of [ENGLISH, ARABIC]) {
      for (const long of ['word '.repeat(90), 'w'.repeat(400)]) {
        const block = pageFooter({ lines: [typed(long)], page: 'Page 2 of 9' }, WIDTH, drawing);
        expect(outside(block, measure)).toEqual([]);
        expect(block.height).toBeGreaterThan(WORDS_AT + LINE);
      }
    }
  });

  it('refuses a width that is not a number, is below nothing, or leaves no room, by name', () => {
    const input = { lines: LINES, page: 'Page 2 of 9' };
    expect(() => pageFooter(input, Number.NaN, ENGLISH)).toThrow(/pageFooter needs a finite width/);
    expect(() => pageFooter(input, -1, ENGLISH)).toThrow(
      /pageFooter needs a width of zero or more/,
    );
    expect(() => pageFooter(input, 60, ENGLISH)).toThrow(
      /pageFooter is left no room for its lines by a width of/,
    );
  });

  it('changes nothing it was given', () => {
    const input = deepFreeze({ lines: [...ARABIC_LINES], page: 'صفحة 2 من 9' });
    expect(() => pageFooter(input, WIDTH, ARABIC)).not.toThrow();
  });
});
