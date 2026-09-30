import { describe, expect, it } from 'vitest';
import type { Mark } from '../types';
import { fromQuillDelta } from './quill';

/** The rich text of a delta that must read, or the test fails loudly. */
function read(delta: unknown) {
  const result = fromQuillDelta(JSON.stringify(delta));
  if (!result.ok) throw new Error('expected the delta to be read');
  return result;
}

function marked(text: string, marks: readonly Mark[]): string[] {
  return marks.map((m) => text.slice(m.from, m.to));
}

describe('reading a formatted summary from the old tool', () => {
  it('reads the old tool own example, in English and Arabic', () => {
    // The shape of the delta in the old tool's rich summary test, typed out
    // afresh. Its colour is a named one: the value is dropped either way.
    const result = read({
      ops: [
        { insert: 'Plain and ' },
        { insert: 'bold', attributes: { bold: true } },
        { insert: ' and ' },
        { insert: 'coloured', attributes: { color: 'purple', underline: true } },
        { insert: '\n' },
        { insert: 'ملخص عربي ' },
        { insert: 'مهم', attributes: { bold: true } },
        { insert: '\n', attributes: { direction: 'rtl', align: 'right' } },
      ],
    });
    expect(result.rich.text).toBe('Plain and bold and coloured\nملخص عربي مهم');
    expect(result.rich.marks).toEqual([
      { from: 10, to: 14, bold: true },
      { from: 19, to: 27, underline: true },
      { from: 38, to: 41, bold: true },
    ]);
    expect(marked(result.rich.text, result.rich.marks)).toEqual(['bold', 'coloured', 'مهم']);
    expect(result.dropped).toEqual(['colour', 'direction']);
  });

  it('makes one mark of a stretch that is bold and underlined', () => {
    const result = read({
      ops: [
        { insert: 'Both at once', attributes: { bold: true, underline: true } },
        { insert: '\n' },
      ],
    });
    expect(result.rich.marks).toEqual([{ from: 0, to: 12, bold: true, underline: true }]);
    expect(result.dropped).toEqual([]);
  });

  it('drops colour and slant and names each', () => {
    const result = read({
      ops: [
        { insert: 'Tinted', attributes: { color: 'purple' } },
        { insert: ' and ' },
        { insert: 'slanted', attributes: { italic: true } },
        { insert: ' and ' },
        { insert: 'tinted again', attributes: { color: 'teal', bold: true } },
        { insert: '\n' },
      ],
    });
    expect(result.rich.text).toBe('Tinted and slanted and tinted again');
    expect(result.rich.marks).toEqual([{ from: 23, to: 35, bold: true }]);
    expect(result.dropped).toEqual(['colour', 'slant']);
  });

  it('joins two bold inserts in a row into one mark', () => {
    const result = read({
      ops: [
        { insert: 'one ', attributes: { bold: true } },
        { insert: 'two', attributes: { bold: true } },
        { insert: '\n' },
      ],
    });
    expect(result.rich.marks).toEqual([{ from: 0, to: 7, bold: true }]);
  });

  it('keeps apart neighbouring marks that differ', () => {
    const result = read({
      ops: [
        { insert: 'bold', attributes: { bold: true } },
        { insert: 'both', attributes: { bold: true, underline: true } },
        { insert: '\n' },
      ],
    });
    expect(result.rich.marks).toEqual([
      { from: 0, to: 4, bold: true },
      { from: 4, to: 8, bold: true, underline: true },
    ]);
  });

  it('never lets a mark run past the end of the text', () => {
    const result = read({
      ops: [
        { insert: 'Closing words', attributes: { bold: true } },
        { insert: '\n\n\n', attributes: { bold: true } },
        { insert: '  \n' },
      ],
    });
    expect(result.rich.text).toBe('Closing words');
    expect(result.rich.marks).toEqual([{ from: 0, to: 13, bold: true }]);
    for (const m of result.rich.marks) {
      expect(m.to).toBeLessThanOrEqual(result.rich.text.length);
      expect(m.from).toBeLessThan(m.to);
    }
  });

  it('drops a mark that lies wholly in the empty paragraphs at the end', () => {
    const result = read({
      ops: [{ insert: 'Words\n' }, { insert: '\n', attributes: { underline: true } }],
    });
    expect(result.rich.text).toBe('Words');
    expect(result.rich.marks).toEqual([]);
  });

  it('keeps the paragraphs inside the text', () => {
    const result = read({ ops: [{ insert: 'First\n\nSecond\n' }] });
    expect(result.rich.text).toBe('First\n\nSecond');
  });

  it('keeps every letter of text typed in Arabic', () => {
    const arabic = 'تحسن ملحوظ في التركيز والنوم';
    const result = read({
      ops: [
        { insert: 'تحسن ' },
        { insert: 'ملحوظ', attributes: { bold: true } },
        { insert: ' في التركيز والنوم' },
        { insert: '\n', attributes: { direction: 'rtl' } },
      ],
    });
    expect(result.rich.text).toBe(arabic);
    expect(marked(result.rich.text, result.rich.marks)).toEqual(['ملحوظ']);
  });

  it('counts an emoji as the text does, so a mark after it still lands', () => {
    const result = read({
      ops: [
        { insert: 'Calm 🌿 then ' },
        { insert: 'steady', attributes: { underline: true } },
        { insert: ' 👍🏽', attributes: { bold: true } },
        { insert: '\n' },
      ],
    });
    expect(marked(result.rich.text, result.rich.marks)).toEqual(['steady', ' 👍🏽']);
  });

  it('writes each insert in composed form', () => {
    const decomposed = 'Café';
    const result = read({ ops: [{ insert: decomposed }, { insert: '\n' }] });
    expect(result.rich.text).toBe('Café');
  });

  it('reads a delta that is only its list of ops', () => {
    const result = read([{ insert: 'Bare' }, { insert: '\n' }]);
    expect(result.rich.text).toBe('Bare');
  });

  it('leaves out an embed and names it', () => {
    const result = read({
      ops: [{ insert: 'Before' }, { insert: { image: 'x' } }, { insert: 'after\n' }],
    });
    expect(result.rich.text).toBe('Beforeafter');
    expect(result.dropped).toEqual(['embed']);
  });

  it('names any other attribute as other, once', () => {
    const result = read({
      ops: [
        { insert: 'Big', attributes: { size: 'large' } },
        { insert: ' link', attributes: { link: 'https://example.com', bold: true } },
        { insert: '\n', attributes: { header: 2 } },
      ],
    });
    expect(result.rich.marks).toEqual([{ from: 3, to: 8, bold: true }]);
    expect(result.dropped).toEqual(['other']);
  });

  it('does not count an attribute that was switched off as dropped', () => {
    const result = read({
      ops: [{ insert: 'Plain', attributes: { bold: false, color: null, italic: false } }],
    });
    expect(result.rich.marks).toEqual([]);
    expect(result.dropped).toEqual([]);
  });
});

describe('a mark and a letter written as a pair', () => {
  it('moves a mark that ends between the two halves of a pair out to the edge of the letter', () => {
    const result = read({
      ops: [
        { insert: 'a\ud83d', attributes: { bold: true } },
        { insert: '\ude00b', attributes: { underline: true } },
        { insert: '\n' },
      ],
    });
    expect(result.rich.text).toBe('a\u{1F600}b');
    expect(result.rich.marks).toEqual([
      { from: 0, to: 3, bold: true },
      { from: 3, to: 4, underline: true },
    ]);
  });

  it('composes the text as a whole when an insert opens with a combining mark, and re-bases the marks', () => {
    const result = read({
      ops: [
        { insert: 'cafe', attributes: { bold: true } },
        { insert: '\u0301 au ' },
        { insert: 'lait', attributes: { underline: true } },
        { insert: '\n' },
      ],
    });
    expect(result.rich.text).toBe('caf\u00e9 au lait');
    expect(result.rich.text).toBe(result.rich.text.normalize('NFC'));
    expect(marked(result.rich.text, result.rich.marks)).toEqual(['caf\u00e9', 'lait']);
  });
});

describe('what the delta reader takes out, and what it leaves', () => {
  it('says when it removed something, and not when it did not', () => {
    expect(read({ ops: [{ insert: 'a\u0000b\u202e c\n' }] }).removed).toBe(true);
    expect(read({ ops: [{ insert: 'a\u200bb\n' }] }).removed).toBe(true);
    expect(read({ ops: [{ insert: '  plain\ttext  \n\n' }] }).removed).toBe(false);
    expect(read({ ops: [{ insert: '\u0628\u200c\u0628\n' }] }).removed).toBe(false);
  });

  it('never cuts, however long the summary', () => {
    const long = 'x'.repeat(10_000);
    const result = read({ ops: [{ insert: long }, { insert: 'y', attributes: { bold: true } }] });
    expect(result.rich.text).toHaveLength(10_001);
    expect(result.rich.marks).toEqual([{ from: 10_000, to: 10_001, bold: true }]);
  });
});

describe('what cannot be read', () => {
  const unreadable: ReadonlyArray<readonly [string, unknown]> = [
    ['a broken string', '{"ops": [ { "insert": '],
    ['the number as text', '42'],
    ['null as text', 'null'],
    ['an empty object as text', '{}'],
    ['ops that are not a list', '{"ops": "Words"}'],
    ['a number', 42],
    ['null', null],
    ['an empty object', {}],
    ['undefined', undefined],
  ];

  for (const [what, input] of unreadable) {
    it(`gives no result for ${what}, and never throws`, () => {
      expect(fromQuillDelta(input as string)).toEqual({ ok: false });
    });
  }
});
