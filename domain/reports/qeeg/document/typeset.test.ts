import { describe, expect, it } from 'vitest';
import type { Op } from '@domain/shared/document';
import { extentOf } from './block';
import { ACCENT, INK, MUTED, TIER_PAINT } from './palette';
import type { Measure } from './paragraph';
import type { LayoutOp } from './scale';
import { typeset } from './typeset';
import type { Drawing } from './typeset';

/** Every character is half its size wide, so every width in a test is exact. */
const measure: Measure = (text, _weight, size) => [...text].length * size * 0.5;
const FACE = { ascent: 1, descent: -0.25 };

const english: Drawing = { direction: 'ltr', measure, faces: { latin: FACE, arabic: FACE } };
const arabic: Drawing = { ...english, direction: 'rtl' };

const texts = (ops: readonly LayoutOp[]) =>
  ops.filter((op): op is Extract<Op, { kind: 'text' }> => op.kind === 'text');
const rules = (ops: readonly LayoutOp[]) =>
  ops.filter((op): op is Extract<Op, { kind: 'rule' }> => op.kind === 'rule');

describe('typeset', () => {
  it('sets a role in its size, its weight and its colour', () => {
    const block = typeset('heading', 'Your brain map', 300, english);
    for (const op of texts(block.ops)) {
      expect(op.style.size).toBe(14);
      expect(op.style.font).toBe('bold');
      expect(op.style.rgb).toEqual(ACCENT.rgb);
    }
    expect(block.height).toBe(21);
    expect(block.width).toBe(300);
  });

  it('sets the body in ink and a lede in the muted grey', () => {
    expect(texts(typeset('body', 'Words', 300, english).ops)[0]?.style.grey).toBe(INK.grey);
    expect(texts(typeset('lede', 'Words', 300, english).ops)[0]?.style.grey).toBe(MUTED.grey);
  });

  it('underlines a title under its own words and no further', () => {
    const block = typeset('subheading', 'Key findings', 300, english);
    const [rule] = rules(block.ops);
    expect(rules(block.ops)).toHaveLength(1);
    expect(rule?.x).toBe(0);
    expect(rule?.width).toBeCloseTo(12 * 11.5 * 0.5, 9);
    expect(rule?.rgb).toEqual(ACCENT.rgb);
    expect(block.overhang).toBeGreaterThanOrEqual(0);
  });

  it('underlines nothing in a role that is not a title', () => {
    expect(rules(typeset('body', 'Words', 300, english).ops)).toEqual([]);
  });

  it('takes a string, or spans where some words are heavier', () => {
    expect(typeset('body', 'Words', 300, english).ops).toEqual(
      typeset('body', [{ text: 'Words' }], 300, english).ops,
    );
    const block = typeset(
      'body',
      [{ text: 'Findings:', bold: true }, { text: ' steady' }],
      300,
      english,
    );
    expect(texts(block.ops).map((op) => [op.text, op.style.font])).toEqual([
      ['Findings:', 'bold'],
      ['steady', 'regular'],
    ]);
  });

  it('sets fixed wording from the start edge of its report', () => {
    expect(extentOf(typeset('body', 'Words', 300, english).ops, measure).left).toBe(0);
    expect(extentOf(typeset('body', 'كلمات', 300, arabic).ops, measure).right).toBe(300);
  });

  it('sets at the end edge, or in the middle, when it is asked', () => {
    const end = typeset('footer', 'Page 1 of 9', 300, english, { align: 'end' });
    expect(extentOf(end.ops, measure).right).toBe(300);
    const endArabic = typeset('footer', 'صفحة', 300, arabic, { align: 'end' });
    expect(extentOf(endArabic.ops, measure).left).toBe(0);
    const middle = extentOf(typeset('pill', '20', 100, english, { align: 'centre' }).ops, measure);
    expect((middle.left + middle.right) / 2).toBeCloseTo(50, 9);
  });

  it('reads typed English in an Arabic report left to right, set against the report’s start edge', () => {
    const block = typeset('body', 'Typed in English', 300, arabic, { typed: true });
    const [op] = texts(block.ops);
    expect(op?.rtl ?? false).toBe(false);
    expect(extentOf(block.ops, measure).right).toBe(300);
  });

  it('reads typed Arabic in an English report right to left, set against the report’s start edge', () => {
    const block = typeset('body', 'كتب بالعربية', 300, english, { typed: true });
    expect(texts(block.ops).every((op) => op.rtl === true)).toBe(true);
    expect(extentOf(block.ops, measure).left).toBe(0);
  });

  it('gives typed Arabic the room its face needs, in a report of either language', () => {
    expect(typeset('band', 'كلمات', 300, english, { typed: true }).height).toBeCloseTo(15.3, 9);
    expect(typeset('band', 'Words', 300, arabic, { typed: true }).height).toBeCloseTo(
      10.2 * 1.42,
      9,
    );
  });

  it('reads fixed wording in its report’s direction whatever it begins with', () => {
    const block = typeset('body', 'QEEG تقييم', 300, arabic);
    expect(extentOf(block.ops, measure).right).toBe(300);
  });

  it('sets a card’s category in the hue of its score', () => {
    const block = typeset('cardCategory', 'Needs support', 100, english, { tier: 'low' });
    expect(texts(block.ops)[0]?.style.rgb).toEqual(TIER_PAINT.low);
  });

  it('refuses a card’s category with no score to take its hue from, by name', () => {
    expect(() => typeset('cardCategory', 'Needs support', 100, english)).toThrow(
      /typeset needs a tier for cardCategory/,
    );
  });

  it('is cut between its lines as any paragraph is', () => {
    const block = typeset('body', 'aaaa bbbb cccc dddd eeee ffff gggg hhhh', 51, english);
    expect(block.height).toBeCloseTo(4 * 15.3, 9);
    const cut = block.split?.(31);
    expect(cut?.[0].height).toBeCloseTo(2 * 15.3, 9);
    expect(cut?.[1].height).toBeCloseTo(2 * 15.3, 9);
  });

  it('draws nothing, and takes no room, for no words', () => {
    const block = typeset('body', '   ', 300, english);
    expect(block.ops).toEqual([]);
    expect(block.height).toBe(0);
  });
});
