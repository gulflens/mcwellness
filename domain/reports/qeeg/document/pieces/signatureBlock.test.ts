import { describe, expect, it } from 'vitest';
import type { Op } from '@domain/shared/document';
import { extentOf } from '../block';
import { SIGNATURE } from '../geometry';
import { lineBox } from '../metrics';
import { INK, MUTED } from '../palette';
import type { LayoutOp } from '../scale';
import { styleOf } from '../styles';
import type { Drawing } from '../typeset';
import {
  ARABIC,
  ENGLISH,
  FACE,
  downThePage,
  measure,
  outside,
  unmirrored,
  wordsOf,
} from './checks';
import { signatureBlock } from './signatureBlock';
import { fixed, typed } from './words';
import type { Words } from './words';

const WIDTH = 480;
const LABEL = 'Prepared by';

const LABEL_STYLE = styleOf('signatureLabel', 'ltr').style;
const LINE_STYLE = styleOf('signature', 'ltr').style;
const LABEL_LINE = LABEL_STYLE.size * LABEL_STYLE.lineHeight;
const ONE_LINE = LINE_STYLE.size * LINE_STYLE.lineHeight;
/** A line takes no room: the rule is drawn inside the upper edge of the gap. */
const WORDS_AT = SIGNATURE.room + SIGNATURE.gap;

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

const signed = (drawing: Drawing, lines = [typed('Hazel Dune'), fixed('Practitioner')]) =>
  signatureBlock({ label: LABEL, lines }, WIDTH, drawing);

describe('signatureBlock', () => {
  for (const [name, drawing] of [
    ['English', ENGLISH],
    ['Arabic', ARABIC],
  ] as const) {
    it(`keeps everything inside its box, in ${name}`, () => {
      expect(outside(signed(drawing), measure)).toEqual([]);
    });
  }

  it('draws the Arabic signature as the mirror of the English one, words and rule', () => {
    for (const lines of [
      [typed('Hazel Dune'), fixed('Practitioner')],
      [typed('Steady progress.'), typed('word '.repeat(30))],
    ]) {
      const en = signed(ENGLISH, lines);
      const ar = signed(ARABIC, lines);
      expect(unmirrored(en, ar, measure)).toEqual([]);
    }
  });

  it('keeps clear room over a rule in ink, as wide as the layout says, at the start edge', () => {
    const block = signed(ENGLISH);
    const [rule] = rules(block.ops);
    expect(rules(block.ops)).toHaveLength(1);
    expect(rule?.thickness).toBe(SIGNATURE.rule);
    expect(rule?.grey).toBe(INK.grey);
    const extent = extentOf(rules(block.ops), measure);
    expect(extent.left).toBeCloseTo(0, 9);
    expect(extent.right).toBeCloseTo(SIGNATURE.width, 9);
    expect(extent.top).toBeCloseTo(-SIGNATURE.room, 9);
    expect(extent.bottom).toBeCloseTo(-(SIGNATURE.room + SIGNATURE.rule), 9);
    const arabicRule = extentOf(rules(signed(ARABIC).ops), measure);
    expect(arabicRule.right).toBeCloseTo(WIDTH, 9);
  });

  it('sets the label under the rule, then each line on a line of its own', () => {
    const block = signed(ENGLISH);
    const ops = texts(block.ops);
    expect(ops.map((op) => op.text)).toEqual([LABEL, 'Hazel Dune', 'Practitioner']);
    expect(ops[0]?.style.grey).toBe(MUTED.grey);
    expect(ops[1]?.style.grey).toBe(INK.grey);
    const labelBaseline = WORDS_AT + lineBox(LABEL_STYLE, FACE).firstBaseline;
    expect(ops[0]?.y).toBeCloseTo(-labelBaseline, 9);
    expect(block.baseline).toBeCloseTo(labelBaseline, 9);
    const firstLine = WORDS_AT + LABEL_LINE + lineBox(LINE_STYLE, FACE).firstBaseline;
    expect(ops[1]?.y).toBeCloseTo(-firstLine, 9);
    expect(ops[2]?.y).toBeCloseTo(-(firstLine + ONE_LINE), 9);
    expect(extentOf(ops, measure).left).toBeCloseTo(0, 9);
    expect(block.height).toBeCloseTo(WORDS_AT + LABEL_LINE + 2 * ONE_LINE, 9);
  });

  it('sets the rule, then the label, then each line in the order given, down the page, in both languages', () => {
    const lines = [fixed('Hazel'), fixed('Dune'), fixed('Sage')];
    for (const drawing of [ENGLISH, ARABIC]) {
      const block = signatureBlock({ label: 'Signed', lines }, WIDTH, drawing);
      const order = downThePage(block, measure).map((each) => each.what);
      expect(order).toEqual(['rule', 'Signed', 'Hazel', 'Dune', 'Sage']);
    }
  });

  it('draws the rule before the words under it, the label before the lines', () => {
    const ops = signed(ENGLISH).ops;
    expect(ops[0]?.kind).toBe('rule');
    expect(texts(ops)[0]?.text).toBe(LABEL);
  });

  it('reads a typed English name in an Arabic report left to right, from the start edge', () => {
    const block = signed(ARABIC, [typed('Hazel Dune')]);
    const name = texts(block.ops).filter((op) => op.text === 'Hazel Dune');
    expect(name.some((op) => op.rtl === true)).toBe(false);
    expect(extentOf(name, measure).right).toBeCloseTo(WIDTH, 9);
  });

  it('reads a typed line the way its letters do in an Arabic report, and a fixed one the report’s way', () => {
    const block = (line: Words) => signatureBlock({ label: ' ', lines: [line] }, WIDTH, ARABIC);
    expect(wordsOf(block(typed('Steady progress.')), measure)).toEqual(['Steady progress.']);
    expect(wordsOf(block(fixed('Steady progress.')), measure)).toEqual(['. Steady progress']);
  });

  it('leaves out a line that is empty once trimmed, and leaves no room for it', () => {
    const one = signed(ENGLISH, [typed('Hazel Dune')]);
    const two = signed(ENGLISH, [typed('Hazel Dune'), fixed('Practitioner')]);
    const gap = signed(ENGLISH, [typed('Hazel Dune'), typed('   '), fixed('Practitioner')]);
    expect(two.height - one.height).toBeCloseTo(ONE_LINE, 9);
    expect(gap.height).toBeCloseTo(two.height, 9);
    expect(gap.ops).toEqual(two.ops);
  });

  it('wraps a long line inside the width of the signature, and grows', () => {
    for (const drawing of [ENGLISH, ARABIC]) {
      for (const long of ['word '.repeat(60), 'w'.repeat(400)]) {
        const block = signed(drawing, [typed(long)]);
        expect(outside(block, measure)).toEqual([]);
        const extent = extentOf(texts(block.ops), measure);
        expect(extent.right - extent.left).toBeLessThanOrEqual(SIGNATURE.width + 1e-9);
        expect(block.height).toBeGreaterThan(signed(drawing).height);
      }
    }
  });

  it('draws a signature with no line filled: the room, the rule and the label', () => {
    for (const lines of [[], [typed('  '), fixed('')]]) {
      for (const drawing of [ENGLISH, ARABIC]) {
        const block = signatureBlock({ label: LABEL, lines }, WIDTH, drawing);
        expect(texts(block.ops).map((op) => op.text)).toEqual([LABEL]);
        expect(rules(block.ops)).toHaveLength(1);
        const label = styleOf('signatureLabel', drawing.direction).style;
        expect(block.height).toBeCloseTo(WORDS_AT + label.size * label.lineHeight, 9);
        expect(outside(block, measure)).toEqual([]);
      }
      const en = signatureBlock({ label: LABEL, lines }, WIDTH, ENGLISH);
      const ar = signatureBlock({ label: LABEL, lines }, WIDTH, ARABIC);
      expect(unmirrored(en, ar, measure)).toEqual([]);
    }
  });

  it('draws only the room and the rule when neither the label nor a line has words', () => {
    for (const drawing of [ENGLISH, ARABIC]) {
      const block = signatureBlock({ label: '  ', lines: [typed(' ')] }, WIDTH, drawing);
      expect(texts(block.ops)).toEqual([]);
      expect(rules(block.ops)).toHaveLength(1);
      expect(block.height).toBeCloseTo(SIGNATURE.room + SIGNATURE.rule, 9);
      expect(outside(block, measure)).toEqual([]);
    }
  });

  it('leaves out a label that is empty once trimmed, and leaves no room for it', () => {
    const lines = [typed('Hazel Dune')];
    const labelled = signatureBlock({ label: LABEL, lines }, WIDTH, ENGLISH);
    const bare = signatureBlock({ label: ' ', lines }, WIDTH, ENGLISH);
    expect(labelled.height - bare.height).toBeCloseTo(LABEL_LINE, 9);
    expect(texts(bare.ops).map((op) => op.text)).toEqual(['Hazel Dune']);
  });

  it('refuses a width that is not a number, or narrower than the signature, by name', () => {
    const input = { label: LABEL, lines: [fixed('Practitioner')] };
    expect(() => signatureBlock(input, Number.NaN, ENGLISH)).toThrow(
      /signatureBlock needs a finite width/,
    );
    expect(() => signatureBlock(input, SIGNATURE.width - 1, ENGLISH)).toThrow(
      /signatureBlock needs a width of at least/,
    );
  });

  it('refuses a width it cannot stand in under its own name, before it calls anything', () => {
    for (const width of [Number.NaN, Number.POSITIVE_INFINITY, -1, 0, SIGNATURE.width - 1]) {
      for (const drawing of [ENGLISH, ARABIC]) {
        expect(() => signatureBlock({ label: LABEL, lines: [] }, width, drawing)).toThrow(
          /^signatureBlock (needs|is left)/,
        );
      }
    }
  });

  it('changes nothing it was given', () => {
    const input = deepFreeze({ label: LABEL, lines: [typed('Hazel Dune'), fixed('Practitioner')] });
    expect(() => signatureBlock(input, WIDTH, ARABIC)).not.toThrow();
  });
});
