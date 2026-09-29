import { describe, expect, it } from 'vitest';
import { beside, blank, stack } from '../block';
import type { Block } from '../block';
import { typeset } from '../typeset';
import {
  ENGLISH,
  ARABIC,
  across,
  downThePage,
  measure,
  outside,
  unmirrored,
  wordsOf,
} from './checks';

/** A block of one filled box, `width` by `height`, its corner at `left`. */
function filled(left: number, width: number, height: number, boxWidth: number): Block {
  return {
    width: boxWidth,
    height,
    overhang: 0,
    baseline: null,
    ops: [
      {
        kind: 'path',
        segments: [
          ['M', left, 0],
          ['L', left + width, 0],
          ['L', left + width, -height],
          ['L', left, -height],
          ['Z'],
        ],
        fill: { grey: 0.5 },
      },
    ],
  };
}

describe('what is outside its box', () => {
  it('is nothing for a block that holds all it draws', () => {
    expect(outside(filled(10, 30, 20, 100), measure)).toEqual([]);
    expect(outside(typeset('body', 'Words in a line', 300, ENGLISH), measure)).toEqual([]);
    expect(outside(blank(10, 10), measure)).toEqual([]);
  });

  it('names each edge that ink has crossed, and by how much', () => {
    expect(outside(filled(-2, 30, 20, 100), measure)).toEqual(['left by 2']);
    expect(outside(filled(80, 30, 20, 100), measure)).toEqual(['right by 10']);
    expect(outside({ ...filled(0, 30, 20, 100), height: 15 }, measure)).toEqual(['foot by 5']);
    const raised = filled(0, 30, 20, 100);
    expect(
      outside(
        {
          ...raised,
          ops: raised.ops.map((op) =>
            op.kind === 'path' ? { ...op, segments: [...op.segments, ['L', 5, 3] as const] } : op,
          ),
        },
        measure,
      ),
    ).toEqual(['top by 3']);
  });

  it('lets ink hang below by as much as the block says it does, and no more', () => {
    const hanging = { ...filled(0, 30, 20, 100), height: 17, overhang: 3 };
    expect(outside(hanging, measure)).toEqual([]);
    expect(outside({ ...hanging, overhang: 2 }, measure)).toEqual(['foot by 1']);
  });

  it('forgives a rounding error and nothing larger', () => {
    expect(outside(filled(-1e-9, 30, 20, 100), measure)).toEqual([]);
    expect(outside(filled(-1e-5, 30, 20, 100), measure)).toHaveLength(1);
  });
});

describe('what is not the mirror of the other', () => {
  it('is nothing for two blocks that are each other reflected', () => {
    expect(unmirrored(filled(10, 30, 20, 100), filled(60, 30, 20, 100), measure)).toEqual([]);
  });

  it('names a shape that stayed where it was', () => {
    expect(unmirrored(filled(10, 30, 20, 100), filled(10, 30, 20, 100), measure)).toEqual([
      'shape 1 of 1 (path): 10 to 40 in English wants 60 to 90 in Arabic, and is at 10 to 40',
    ]);
  });

  it('names a block that draws more shapes in one language than the other', () => {
    const two = beside(100, [
      { block: filled(0, 10, 20, 10), left: 0 },
      { block: filled(0, 10, 20, 10), left: 90 },
    ]);
    expect(unmirrored(two, filled(0, 10, 20, 100), measure)).toEqual([
      '2 shapes in English and 1 in Arabic',
    ]);
  });

  it('holds words to it too, line by line: where a line stands, not what it says', () => {
    const english = typeset('body', 'aaaa bbbb cccc dddd', 51, ENGLISH);
    const arabic = typeset('body', 'aaaa bbbb cccc dddd', 51, ARABIC);
    expect(unmirrored(english, arabic, measure)).toEqual([]);
  });

  it('names a line of words that stayed at the English edge', () => {
    const english = beside(100, [{ block: typeset('body', 'aaaa', 40, ENGLISH), left: 10 }]);
    const arabic = beside(100, [{ block: typeset('body', 'aaaa', 40, ENGLISH), left: 10 }]);
    expect(unmirrored(english, arabic, measure)).toEqual([
      'line 1 of 1: 10 to 30.4 in English wants 69.6 to 90 in Arabic, and is at 10 to 30.4',
    ]);
  });

  it('names a block that sets more lines in one language than the other', () => {
    const one = typeset('body', 'aaaa', 100, ENGLISH);
    const two = stack(100, [
      typeset('body', 'aaaa', 100, ARABIC),
      typeset('body', 'bbbb', 100, ARABIC),
    ]);
    expect(unmirrored(one, two, measure)).toEqual(['1 line in English and 2 in Arabic']);
  });

  it('asks nothing of how far down a thing stands unless it is told to', () => {
    const lower: Block = { ...filled(60, 30, 20, 100), height: 25 };
    const moved = stack(100, [5, filled(60, 30, 20, 100)]);
    expect(lower.height).toBe(moved.height);
    expect(unmirrored(filled(10, 30, 20, 100), moved, measure)).toEqual([]);
    expect(unmirrored(filled(10, 30, 20, 100), moved, measure, { upAndDown: true })).toEqual([
      'shape 1 of 1 (path): from 0 down to -20 in English, from -5 down to -25 in Arabic',
    ]);
  });

  it('refuses two blocks of different widths, which cannot be mirrors, by name', () => {
    expect(() => unmirrored(filled(0, 1, 1, 100), filled(0, 1, 1, 90), measure)).toThrow(
      /unmirrored needs two blocks of one width/,
    );
  });
});

describe('the words of a block', () => {
  it('are given line by line, each as it stands from the left of the page to its right', () => {
    const block = typeset('body', 'aaaa bbbb cccc dddd', 51, ENGLISH);
    expect(wordsOf(block, measure)).toEqual(['aaaa bbbb', 'cccc dddd']);
    expect(across(block.ops, measure)).toBe('aaaa bbbb cccc dddd');
  });

  it('show which way a line was read: a sentence of English read right to left ends at its left', () => {
    expect(wordsOf(typeset('body', 'Steady progress.', 300, ARABIC), measure)).toEqual([
      '. Steady progress',
    ]);
    expect(
      wordsOf(typeset('body', 'Steady progress.', 300, ARABIC, { typed: true }), measure),
    ).toEqual(['Steady progress.']);
  });
});

describe('the order of things down the page', () => {
  it('is each thing drawn, by its top, highest first, with what it is', () => {
    const block = stack(100, [
      typeset('body', 'first', 100, ENGLISH),
      4,
      filled(0, 10, 6, 100),
      typeset('lede', 'second', 100, ENGLISH),
    ]);
    expect(downThePage(block, measure).map((each) => each.what)).toEqual([
      'first',
      'path',
      'second',
    ]);
  });

  it('gives a line of words once, however many ops it is drawn in', () => {
    const block = typeset(
      'body',
      [{ text: 'Label:', bold: true }, { text: ' value' }],
      100,
      ENGLISH,
    );
    expect(downThePage(block, measure).map((each) => each.what)).toEqual(['Label: value']);
  });
});
