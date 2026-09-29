import { describe, expect, it } from 'vitest';
import type { Op } from '@domain/shared/document';
import { extentOf } from '../block';
import type { Block } from '../block';
import { ROW } from '../geometry';
import { lineBox } from '../metrics';
import { ACCENT, HAIRLINE, INK, MUTED } from '../palette';
import type { LayoutOp } from '../scale';
import { styleOf } from '../styles';
import type { Drawing } from '../typeset';
import { ARABIC, ENGLISH, FACE, across, measure, outside, unmirrored } from './checks';
import { recommendationRow } from './recommendationRow';
import { fixed, typed } from './words';
import type { Words } from './words';

const WIDTH = 480;

/** An English report whose Arabic face stands deeper than its Latin one. */
const DEEP_ARABIC_FACE: Drawing = {
  ...ENGLISH,
  faces: { latin: FACE, arabic: { ascent: 1.3, descent: -0.6 } },
};

const NAME_AT = ROW.number + ROW.gutter;
const TEXT_AT = NAME_AT + ROW.name + ROW.gutter;

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

const row = (drawing: Drawing, text: string | null = 'Ten minutes of quiet breathing daily.') =>
  recommendationRow(
    { number: 3, name: fixed('Breathing'), text: text === null ? null : fixed(text) },
    WIDTH,
    drawing,
  );

const numberOps = (block: Block) => texts(block.ops).filter((op) => op.style.rgb === ACCENT.rgb);
const nameOps = (block: Block) =>
  texts(block.ops).filter((op) => op.style.font === 'bold' && op.style.grey === INK.grey);
const textOps = (block: Block) => texts(block.ops).filter((op) => op.style.grey === MUTED.grey);

describe('recommendationRow', () => {
  for (const [name, drawing] of [
    ['English', ENGLISH],
    ['Arabic', ARABIC],
  ] as const) {
    it(`keeps everything inside its box, in ${name}`, () => {
      expect(outside(row(drawing), measure)).toEqual([]);
      expect(outside(row(drawing, null), measure)).toEqual([]);
    });
  }

  it('draws the Arabic row as the mirror of the English one, words and hairline', () => {
    for (const text of [null, 'Ten minutes of quiet breathing daily.', 'word '.repeat(40)]) {
      for (const name of [fixed('Breathing'), typed('Steady progress.')]) {
        const input = { number: 3, name, text: text === null ? null : typed(text) };
        const en = recommendationRow(input, WIDTH, ENGLISH);
        const ar = recommendationRow(input, WIDTH, ARABIC);
        expect(unmirrored(en, ar, measure)).toEqual([]);
      }
    }
  });

  it('writes the number as two figures in the accent', () => {
    for (const [number, figures] of [
      [1, '01'],
      [12, '12'],
      [99, '99'],
    ] as const) {
      const block = recommendationRow({ number, name: fixed('Sleep'), text: null }, WIDTH, ENGLISH);
      expect(numberOps(block).map((op) => op.text)).toEqual([figures]);
      expect(numberOps(block)[0]?.style.size).toBe(styleOf('rowNumber', 'ltr').style.size);
    }
  });

  it('draws the figures of the number left to right on an Arabic page too', () => {
    const block = recommendationRow({ number: 7, name: fixed('Sleep'), text: null }, WIDTH, ARABIC);
    const [op] = numberOps(block);
    expect(op?.text).toBe('07');
    expect(op?.rtl ?? false).toBe(false);
  });

  it('sets the number, the name and the text in their columns from the start edge', () => {
    const block = row(ENGLISH);
    expect(extentOf(numberOps(block), measure).left).toBeCloseTo(0, 9);
    expect(extentOf(nameOps(block), measure).left).toBeCloseTo(NAME_AT, 9);
    expect(extentOf(textOps(block), measure).left).toBeCloseTo(TEXT_AT, 9);
    expect(extentOf(textOps(block), measure).right).toBeLessThanOrEqual(WIDTH + 1e-9);
  });

  it('sets the columns from the right of an Arabic page', () => {
    const block = row(ARABIC);
    expect(extentOf(numberOps(block), measure).right).toBeCloseTo(WIDTH, 9);
    expect(extentOf(nameOps(block), measure).right).toBeCloseTo(WIDTH - NAME_AT, 9);
    expect(extentOf(textOps(block), measure).right).toBeCloseTo(WIDTH - TEXT_AT, 9);
  });

  it('wraps the name in its own column', () => {
    const block = recommendationRow(
      { number: 1, name: fixed('word '.repeat(20)), text: fixed('Short.') },
      WIDTH,
      ENGLISH,
    );
    expect(extentOf(nameOps(block), measure).right).toBeLessThanOrEqual(NAME_AT + ROW.name + 1e-9);
  });

  it('sets the number, the name and the text on one first baseline', () => {
    const block = row(ENGLISH);
    const firsts = [numberOps(block), nameOps(block), textOps(block)].map((ops) => ops[0]?.y);
    expect(firsts[1]).toBeCloseTo(firsts[0] ?? Number.NaN, 9);
    expect(firsts[2]).toBeCloseTo(firsts[0] ?? Number.NaN, 9);
    const number = lineBox(styleOf('rowNumber', 'ltr').style, FACE);
    expect(block.baseline).toBeCloseTo(ROW.padV + number.firstBaseline, 9);
    expect(firsts[0]).toBeCloseTo(-(block.baseline ?? Number.NaN), 9);
  });

  it('keeps one baseline when a typed name in the other script has a line box of its own', () => {
    const block = recommendationRow(
      { number: 2, name: typed('المشي صباحا'), text: fixed('Twenty minutes, most days.') },
      WIDTH,
      DEEP_ARABIC_FACE,
    );
    const name = texts(block.ops).filter((op) => op.rtl === true);
    expect(name.length).toBeGreaterThan(0);
    const [number] = numberOps(block);
    const [words] = textOps(block);
    expect(name[0]?.y).toBeCloseTo(number?.y ?? Number.NaN, 9);
    expect(words?.y).toBeCloseTo(number?.y ?? Number.NaN, 9);
    expect(outside(block, measure)).toEqual([]);
  });

  it('reads a typed name and a typed text the way their letters do in an Arabic report', () => {
    // The number shares the line, so the words are read without it.
    const words = (block: Block) =>
      across(
        texts(block.ops).filter((op) => op.text !== '03'),
        measure,
      );
    const named = (name: Words) =>
      recommendationRow({ number: 3, name, text: null }, WIDTH, ARABIC);
    expect(words(named(typed('Steady progress.')))).toBe('Steady progress.');
    expect(words(named(fixed('Steady progress.')))).toBe('. Steady progress');
    const told = (text: Words) =>
      recommendationRow({ number: 3, name: typed('نوم'), text }, WIDTH, ARABIC);
    expect(words(told(typed('Steady progress.')))).toBe('Steady progress. نوم');
    expect(words(told(fixed('Steady progress.')))).toBe('. Steady progress نوم');
  });

  it('keeps the padding above and below, the hairline inside the lower edge of it', () => {
    const block = row(ENGLISH);
    const number = styleOf('rowNumber', 'ltr').style;
    // A line takes no room: the hairline is inside the lower edge of the padding.
    expect(block.height).toBeCloseTo(2 * ROW.padV + number.size * number.lineHeight, 9);
    const [hairline] = rules(block.ops);
    expect(rules(block.ops)).toHaveLength(1);
    expect(hairline?.x).toBe(0);
    expect(hairline?.width).toBe(WIDTH);
    expect(hairline?.thickness).toBe(ROW.rule);
    expect(hairline?.grey).toBe(HAIRLINE.grey);
    expect(extentOf(rules(block.ops), measure).bottom).toBeCloseTo(-block.height, 9);
  });

  it('draws the number, then the name, then the text, then the hairline under them', () => {
    const block = row(ENGLISH);
    const at = (op: LayoutOp | undefined) => (op ? block.ops.indexOf(op) : -1);
    expect(at(numberOps(block)[0])).toBe(0);
    expect(at(nameOps(block)[0])).toBeGreaterThan(at(numberOps(block).at(-1)));
    expect(at(textOps(block)[0])).toBeGreaterThan(at(nameOps(block).at(-1)));
    expect(block.ops.at(-1)?.kind).toBe('rule');
  });

  it('gives the name the room of both columns when there is no text', () => {
    for (const text of [null, '   '] as const) {
      const long = recommendationRow(
        {
          number: 4,
          name: fixed('word '.repeat(40)),
          text: text === null ? null : typed(text),
        },
        WIDTH,
        ENGLISH,
      );
      expect(textOps(long)).toEqual([]);
      const extent = extentOf(nameOps(long), measure);
      expect(extent.right).toBeGreaterThan(NAME_AT + ROW.name);
      expect(extent.right).toBeLessThanOrEqual(WIDTH + 1e-9);
    }
    expect(row(ENGLISH, null).height).toBeCloseTo(row(ENGLISH).height, 9);
  });

  it('wraps long words inside its box, and grows', () => {
    for (const drawing of [ENGLISH, ARABIC]) {
      for (const long of ['word '.repeat(90), 'w'.repeat(400)]) {
        const block = recommendationRow(
          { number: 5, name: typed(long), text: typed(long) },
          WIDTH,
          drawing,
        );
        expect(outside(block, measure)).toEqual([]);
        expect(block.height).toBeGreaterThan(row(drawing).height);
      }
    }
  });

  it('refuses a number that is not a whole number from 1 to 99, by name', () => {
    for (const number of [0, 100, 1.5, -3, Number.NaN]) {
      expect(() =>
        recommendationRow({ number, name: fixed('Sleep'), text: null }, WIDTH, ENGLISH),
      ).toThrow(/recommendationRow needs a number that is a whole number from 1 to 99/);
    }
  });

  it('refuses a width that is not a number, is below nothing, or leaves no room, by name', () => {
    const input = { number: 1, name: fixed('Sleep'), text: fixed('Eight hours.') };
    expect(() => recommendationRow(input, Number.POSITIVE_INFINITY, ENGLISH)).toThrow(
      /recommendationRow needs a finite width/,
    );
    expect(() => recommendationRow(input, -1, ENGLISH)).toThrow(
      /recommendationRow needs a width of zero or more/,
    );
    expect(() => recommendationRow(input, TEXT_AT, ENGLISH)).toThrow(
      /recommendationRow is left no room for its words by a width of/,
    );
    expect(() => recommendationRow({ ...input, text: null }, NAME_AT, ENGLISH)).toThrow(
      /recommendationRow is left no room for its words by a width of/,
    );
  });

  it('refuses a width it cannot stand in under its own name, before it calls anything', () => {
    for (const width of [Number.NaN, Number.POSITIVE_INFINITY, -1, 0, ROW.number]) {
      for (const drawing of [ENGLISH, ARABIC]) {
        expect(() =>
          recommendationRow({ number: 1, name: fixed('Sleep'), text: null }, width, drawing),
        ).toThrow(/^recommendationRow (needs|is left)/);
      }
    }
  });

  it('changes nothing it was given', () => {
    const input = deepFreeze({ number: 9, name: typed('Sleep'), text: typed('Eight hours.') });
    expect(() => recommendationRow(input, WIDTH, ARABIC)).not.toThrow();
  });
});
