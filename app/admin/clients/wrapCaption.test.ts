import { describe, expect, it } from 'vitest';
import { wrapCaption } from './wrapCaption';

/**
 * `wrapCaption` (SignaturePad.tsx's own caption, which draws the exact words
 * a household read on screen into the filed signature image — fix round of
 * 10 September 2026). A fake measurer stands in for `ctx.measureText`: one
 * unit of width per character, which makes every assertion below arithmetic
 * rather than a guess about a real font's metrics.
 */

const oneUnitPerChar = (text: string): number => text.length;

describe('wrapCaption', () => {
  it('keeps a caption that already fits on one line', () => {
    expect(wrapCaption('Participation', 40, oneUnitPerChar)).toEqual(['Participation']);
  });

  it('breaks on a word boundary once a line would run past maxWidth', () => {
    // "one two three four" is 19 characters; at maxWidth 10 the third word
    // is the first one that would push a line past it.
    expect(wrapCaption('one two three four', 10, oneUnitPerChar)).toEqual([
      'one two',
      'three four',
    ]);
  });

  it('wraps a caption that needs three lines, in word order, dropping nothing', () => {
    const caption =
      "Signed for: Brain-map and neurofeedback information, Visits at home, Guardian's consent for a child, Participation";
    const lines = wrapCaption(caption, 55, oneUnitPerChar);
    expect(lines.length).toBe(3);
    // Every word survives, in order, once the lines are rejoined.
    expect(lines.join(' ')).toBe(caption);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(55);
  });

  it('never splits a single word wider than maxWidth', () => {
    // "antidisestablishmentarianism" alone is wider than 10 units; it must
    // still come back as one line rather than being cut at the edge.
    expect(wrapCaption('antidisestablishmentarianism', 10, oneUnitPerChar)).toEqual([
      'antidisestablishmentarianism',
    ]);
  });

  it('returns no lines for an empty caption', () => {
    expect(wrapCaption('', 100, oneUnitPerChar)).toEqual([]);
  });
});
