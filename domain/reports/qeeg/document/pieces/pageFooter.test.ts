import { describe, expect, it } from 'vitest';
import type { Op } from '@domain/shared/document';
import { extentOf } from '../block';
import type { Block } from '../block';
import { FOOTER } from '../geometry';
import { lineBox } from '../metrics';
import { HAIRLINE, MUTED } from '../palette';
import type { Measure } from '../paragraph';
import type { LayoutOp } from '../scale';
import { styleOf } from '../styles';
import type { Drawing } from '../typeset';
import { pageFooter } from './pageFooter';
import { fixed, typed } from './words';

/** Every character is half its size wide, so every width in a test is exact. */
const measure: Measure = (text, _weight, size) => [...text].length * size * 0.5;
const FACE = { ascent: 1, descent: -0.25 };
const english: Drawing = { direction: 'ltr', measure, faces: { latin: FACE, arabic: FACE } };
const arabic: Drawing = { ...english, direction: 'rtl' };
const WIDTH = 480;

const STYLE = styleOf('footer', 'ltr').style;
const LINE = STYLE.size * STYLE.lineHeight;
const WORDS_AT = FOOTER.rule + FOOTER.padTop;
const PHONE = '+971 50 000 0001';

const PLACE = fixed('McWellness, Dubai, United Arab Emirates');
const PHONE_LINE = typed(PHONE);
const LINES = [PLACE, PHONE_LINE];
const ARABIC_LINES = [fixed('دبي، الإمارات العربية المتحدة'), fixed(`هاتف ${PHONE}`)];

const texts = (ops: readonly LayoutOp[]) =>
  ops.filter((op): op is Extract<Op, { kind: 'text' }> => op.kind === 'text');
const rules = (ops: readonly LayoutOp[]) =>
  ops.filter((op): op is Extract<Op, { kind: 'rule' }> => op.kind === 'rule');

function expectInside(block: Block, width: number): void {
  const extent = extentOf(block.ops, measure);
  expect(extent.left).toBeGreaterThanOrEqual(-1e-9);
  expect(extent.right).toBeLessThanOrEqual(width + 1e-9);
  expect(extent.top).toBeLessThanOrEqual(1e-9);
  expect(extent.bottom).toBeGreaterThanOrEqual(-(block.height + block.overhang) - 1e-9);
}

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
    ['English', english, LINES, 'Page 2 of 9'],
    ['Arabic', arabic, ARABIC_LINES, 'صفحة 2 من 9'],
  ] as const) {
    it(`keeps everything inside its box, in ${name}`, () => {
      expectInside(pageFooter({ lines, page }, WIDTH, drawing), WIDTH);
    });
  }

  it('draws the Arabic hairline as the mirror of the English one', () => {
    const en = extentOf(
      rules(pageFooter({ lines: LINES, page: 'Page 2 of 9' }, WIDTH, english).ops),
      measure,
    );
    const ar = extentOf(
      rules(pageFooter({ lines: LINES, page: 'Page 2 of 9' }, WIDTH, arabic).ops),
      measure,
    );
    expect(ar.left).toBeCloseTo(WIDTH - en.right, 9);
    expect(ar.right).toBeCloseTo(WIDTH - en.left, 9);
    expect(ar.top).toBeCloseTo(en.top, 9);
    expect(ar.bottom).toBeCloseTo(en.bottom, 9);
  });

  it('draws a hairline along the top, the full width, first', () => {
    const block = pageFooter({ lines: LINES, page: 'Page 2 of 9' }, WIDTH, english);
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
    const block = pageFooter({ lines: LINES, page }, WIDTH, english);
    const lines = lineOps(block, page);
    expect(lines.map((op) => op.text)).toEqual([PLACE.text, PHONE]);
    expect(extentOf(lines, measure).left).toBeCloseTo(0, 9);
    expect(lines[0]?.style.grey).toBe(MUTED.grey);
    expect(lines[0]?.y).toBeCloseTo(-(WORDS_AT + lineBox(STYLE, FACE).firstBaseline), 9);
    expect(lines[1]?.y).toBeCloseTo((lines[0]?.y ?? Number.NaN) - LINE, 9);
    expect(block.height).toBeCloseTo(WORDS_AT + 2 * LINE, 9);
    const arabicLines = lineOps(pageFooter({ lines: ARABIC_LINES, page }, WIDTH, arabic), page);
    expect(extentOf(arabicLines, measure).right).toBeCloseTo(WIDTH, 9);
  });

  it('sets the page’s words at the end edge, level with the last line', () => {
    const page = 'Page 2 of 9';
    const block = pageFooter({ lines: LINES, page }, WIDTH, english);
    const [words] = pageOps(block, page);
    expect(extentOf(pageOps(block, page), measure).right).toBeCloseTo(WIDTH, 9);
    expect(words?.y).toBeCloseTo(lineOps(block, page).at(-1)?.y ?? Number.NaN, 9);
    const arabicPage = 'صفحة 2 من 9';
    const inArabic = pageFooter({ lines: ARABIC_LINES, page: arabicPage }, WIDTH, arabic);
    const pageExtent = extentOf(
      texts(inArabic.ops).filter((op) => /صفحة|من|^\d+$/.test(op.text)),
      measure,
    );
    expect(pageExtent.left).toBeCloseTo(0, 9);
  });

  it('keeps the last baselines level when a typed line in the other script has a line box of its own', () => {
    const deep = { ascent: 1.3, descent: -0.6 };
    const drawing: Drawing = { ...english, faces: { latin: FACE, arabic: deep } };
    const page = 'Page 2 of 9';
    const block = pageFooter({ lines: [fixed('Dubai'), typed('دبي')], page }, WIDTH, drawing);
    const [words] = pageOps(block, page);
    const last = texts(block.ops).find((op) => op.rtl === true);
    expect(words?.y).toBeCloseTo(last?.y ?? Number.NaN, 9);
    expectInside(block, WIDTH);
  });

  it('keeps at least the gutter between the lines and the page’s words, the lines wrapping in what is left', () => {
    const page = 'Page 2 of 9';
    const long = fixed('word '.repeat(40));
    const block = pageFooter({ lines: [long], page }, WIDTH, english);
    const lines = extentOf(lineOps(block, page), measure);
    const words = extentOf(pageOps(block, page), measure);
    expect(words.left - lines.right).toBeGreaterThanOrEqual(FOOTER.gutter - 1e-9);
    expect(lineOps(block, page).length).toBeGreaterThan(1);
  });

  it('is as tall on every page up to the ninety-ninth, and its lines do not move', () => {
    for (const [drawing, pageOf] of [
      [english, (n: number, of: number) => `Page ${n} of ${of}`],
      [arabic, (n: number, of: number) => `صفحة ${n} من ${of}`],
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

  it('draws a telephone number inside an Arabic footer left to right, in order', () => {
    for (const line of [fixed(`هاتف ${PHONE}`), typed(`هاتف ${PHONE}`), typed(PHONE)]) {
      const block = pageFooter({ lines: [line], page: 'صفحة 2 من 9' }, WIDTH, arabic);
      const number = texts(block.ops).filter((op) => op.text.includes('971'));
      expect(number.map((op) => op.text)).toEqual([PHONE]);
      expect(number[0]?.rtl ?? false).toBe(false);
      expect(number[0]?.align ?? 'start').toBe('start');
    }
  });

  it('leaves out a line that is empty once trimmed, and leaves no room for it', () => {
    const page = 'Page 2 of 9';
    const two = pageFooter({ lines: LINES, page }, WIDTH, english);
    const gapped = pageFooter({ lines: [PLACE, typed('  '), PHONE_LINE], page }, WIDTH, english);
    expect(gapped.ops).toEqual(two.ops);
    const none = pageFooter({ lines: [typed(' ')], page }, WIDTH, english);
    expect(none.height).toBeCloseTo(WORDS_AT + LINE, 9);
    expect(texts(none.ops).map((op) => op.text)).toEqual([page]);
    expect(two.height - pageFooter({ lines: [PLACE], page }, WIDTH, english).height).toBeCloseTo(
      LINE,
      9,
    );
  });

  it('wraps a long line inside its box, and grows', () => {
    for (const drawing of [english, arabic]) {
      for (const long of ['word '.repeat(90), 'w'.repeat(400)]) {
        const block = pageFooter({ lines: [typed(long)], page: 'Page 2 of 9' }, WIDTH, drawing);
        expectInside(block, WIDTH);
        expect(block.height).toBeGreaterThan(WORDS_AT + LINE);
      }
    }
  });

  it('refuses a width that is not a number, is below nothing, or leaves no room, by name', () => {
    const input = { lines: LINES, page: 'Page 2 of 9' };
    expect(() => pageFooter(input, Number.NaN, english)).toThrow(/pageFooter needs a finite width/);
    expect(() => pageFooter(input, -1, english)).toThrow(
      /pageFooter needs a width of zero or more/,
    );
    expect(() => pageFooter(input, 60, english)).toThrow(
      /pageFooter is left no room for its lines by a width of/,
    );
  });

  it('changes nothing it was given', () => {
    const input = deepFreeze({ lines: [...ARABIC_LINES], page: 'صفحة 2 من 9' });
    expect(() => pageFooter(input, WIDTH, deepFreeze({ ...arabic }))).not.toThrow();
  });
});
