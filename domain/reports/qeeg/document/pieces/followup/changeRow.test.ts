import { describe, expect, it } from 'vitest';
import { extentOf } from '../../block';
import { CHANGE, MARKER } from '../../geometry';
import { HAIRLINE, INK } from '../../palette';
import type { LayoutOp } from '../../scale';
import type { PathOp } from '../../shapes';
import { styleOf } from '../../styles';
import { ARABIC, ENGLISH, measure, outside, unmirrored, wordsOf } from '../checks';
import { fixed } from '../words';
import { changeHead, changeRow } from './changeRow';
import type { ChangeRowInput } from './changeRow';

/**
 * docs/SPEC/reports-qeeg.md section 10, "Change by frequency band": the rows
 * she chose, each a measure with a figure for eyes open and one for eyes
 * closed, and a figure that moved marked by a shape in the ink.
 */

const WIDTH = 480;
const FIGURE = (WIDTH - CHANGE.measure - 2 * CHANGE.cellGutter) / 2;
const OPEN_AT = CHANGE.measure + CHANGE.cellGutter;
const CLOSED_AT = OPEN_AT + FIGURE + CHANGE.cellGutter;

const ROW: ChangeRowInput = {
  measure: 'Delta, 1 to 4 Hz',
  eyesOpen: { words: fixed('about 25 to 30% lower'), points: 'down' },
  eyesClosed: { words: fixed('No appreciable change'), points: null },
};
const HEAD = { measure: 'Measure', eyesOpen: 'Eyes Open', eyesClosed: 'Eyes Closed' };

const texts = (ops: readonly LayoutOp[]) =>
  ops.filter((op): op is Extract<LayoutOp, { kind: 'text' }> => op.kind === 'text');
const paths = (ops: readonly LayoutOp[]) => ops.filter((op): op is PathOp => op.kind === 'path');
const rules = (ops: readonly LayoutOp[]) => ops.filter((op) => op.kind === 'rule');

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

describe('changeRow', () => {
  for (const [name, drawing] of [
    ['English', ENGLISH],
    ['Arabic', ARABIC],
  ] as const) {
    it(`keeps everything inside its box, in ${name}`, () => {
      expect(outside(changeRow(ROW, WIDTH, drawing), measure)).toEqual([]);
      expect(outside(changeHead(HEAD, WIDTH, drawing), measure)).toEqual([]);
    });
  }

  it('draws the Arabic row as the mirror of the English one, marker, words and hairline', () => {
    expect(
      unmirrored(changeRow(ROW, WIDTH, ENGLISH), changeRow(ROW, WIDTH, ARABIC), measure),
    ).toEqual([]);
    expect(
      unmirrored(changeHead(HEAD, WIDTH, ENGLISH), changeHead(HEAD, WIDTH, ARABIC), measure),
    ).toEqual([]);
  });

  it('sets the measure at the start, then eyes open, then eyes closed', () => {
    const block = changeRow(
      { ...ROW, eyesClosed: { words: fixed('about 40% lower'), points: 'down' } },
      WIDTH,
      ENGLISH,
    );
    const at = (words: string) =>
      texts(block.ops).find((op) => op.text === words.split(' ')[0] || op.text.startsWith(words))
        ?.x;
    expect(at('Delta')).toBeCloseTo(0, 9);
    const [open, closed] = paths(block.ops).map((op) => extentOf([op], measure));
    expect(open?.left).toBeCloseTo(OPEN_AT, 9);
    expect(closed?.left).toBeCloseTo(CLOSED_AT, 9);
    const head = changeHead(HEAD, WIDTH, ENGLISH);
    const heads = texts(head.ops).map((op) => op.x);
    for (const left of [0, OPEN_AT, CLOSED_AT]) {
      expect(heads.some((x) => Math.abs(x - left) < 1e-9)).toBe(true);
    }
  });

  it('marks only a figure that moved, with a filled shape in the ink', () => {
    const block = changeRow(ROW, WIDTH, ENGLISH);
    expect(paths(block.ops)).toHaveLength(1);
    expect(paths(block.ops)[0]?.fill).toEqual(INK);
    const steady = changeRow(
      { ...ROW, eyesOpen: { words: fixed('No appreciable change'), points: null } },
      WIDTH,
      ENGLISH,
    );
    expect(paths(steady.ops)).toEqual([]);
  });

  it('sets every cell on one first baseline', () => {
    for (const drawing of [ENGLISH, ARABIC]) {
      const block = changeRow(ROW, WIDTH, drawing);
      const firsts = [
        ...new Set(
          [0, OPEN_AT, CLOSED_AT].map((left) => {
            const inColumn = texts(block.ops).filter((op) => {
              const reach = extentOf([op], measure);
              const x = drawing === ENGLISH ? reach.left : WIDTH - reach.right;
              return x >= left - 1e-6 && x < left + (left === 0 ? CHANGE.measure : FIGURE) - 1e-6;
            });
            return Math.max(...inColumn.map((op) => op.y));
          }),
        ),
      ];
      expect(firsts).toHaveLength(1);
      expect(-(firsts[0] ?? 0)).toBeCloseTo(block.baseline ?? 0, 9);
    }
  });

  it('draws a hairline inside the foot of its padding, after what it holds', () => {
    for (const block of [changeRow(ROW, WIDTH, ENGLISH), changeHead(HEAD, WIDTH, ENGLISH)]) {
      const [line] = rules(block.ops);
      expect(rules(block.ops)).toHaveLength(1);
      expect(line?.kind === 'rule' && line.thickness).toBe(CHANGE.rule);
      expect(line?.kind === 'rule' && line.grey).toBe(HAIRLINE.grey);
      expect(line?.kind === 'rule' && line.y).toBeCloseTo(-block.height + CHANGE.rule / 2, 9);
      expect(block.ops.at(-1)?.kind).toBe('rule');
    }
  });

  it('is its tallest cell and its padding above and below', () => {
    const block = changeRow(ROW, WIDTH, ENGLISH);
    const { size, lineHeight } = styleOf('body', 'ltr').style;
    // Every cell is one line of the body's size here.
    expect(block.height).toBeCloseTo(size * lineHeight + 2 * CHANGE.cellPadV, 9);
  });

  it('leaves a figure it was not given empty, and takes no room for it', () => {
    const open = changeRow({ ...ROW, eyesClosed: null }, WIDTH, ENGLISH);
    expect(wordsOf(open, measure).join(' ')).not.toContain('No appreciable');
    expect(open.height).toBe(changeRow(ROW, WIDTH, ENGLISH).height);
    const none = changeRow({ ...ROW, eyesOpen: null, eyesClosed: null }, WIDTH, ENGLISH);
    expect(paths(none.ops)).toEqual([]);
    expect(wordsOf(none, measure)).toEqual(['Delta, 1 to 4 Hz']);
  });

  it('sets the head in its own role, and the measure in a name’s', () => {
    for (const op of texts(changeHead(HEAD, WIDTH, ENGLISH).ops)) {
      expect(op.style.size).toBe(styleOf('tableHead', 'ltr').style.size);
      expect(op.style.font).toBe('bold');
    }
    const [name] = texts(changeRow(ROW, WIDTH, ENGLISH).ops);
    expect(name?.style.size).toBe(styleOf('rowName', 'ltr').style.size);
  });

  it('wraps words wider than a column, inside the row, and grows', () => {
    for (const drawing of [ENGLISH, ARABIC]) {
      for (const text of ['lower '.repeat(40), 'w'.repeat(400)]) {
        const long = changeRow(
          { ...ROW, eyesOpen: { words: fixed(text), points: 'up' }, measure: text },
          WIDTH,
          drawing,
        );
        expect(outside(long, measure)).toEqual([]);
        expect(long.height).toBeGreaterThan(changeRow(ROW, WIDTH, drawing).height);
      }
    }
  });

  it('refuses a width it cannot stand in, by name', () => {
    for (const make of [
      (width: number) => changeRow(ROW, width, ENGLISH),
      (width: number) => changeHead(HEAD, width, ENGLISH),
    ]) {
      expect(() => make(Number.NaN)).toThrow(/^change(Row|Head) needs a finite width/);
      expect(() => make(-1)).toThrow(/^change(Row|Head) needs a width of zero or more/);
      expect(() =>
        make(CHANGE.measure + 2 * CHANGE.cellGutter + 2 * (MARKER.cell + MARKER.gutter) - 1),
      ).toThrow(/^change(Row|Head) is left no room for a figure by a width of/);
    }
  });

  it('changes nothing it was given', () => {
    expect(() => changeRow(deepFreeze({ ...ROW }), WIDTH, ARABIC)).not.toThrow();
    expect(() => changeHead(deepFreeze({ ...HEAD }), WIDTH, ARABIC)).not.toThrow();
  });
});
