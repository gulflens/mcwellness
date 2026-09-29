import { describe, expect, it } from 'vitest';
import type { Op } from '@domain/shared/document';
import { extentOf } from '../block';
import { CARD, RING } from '../geometry';
import { INK, MUTED, RING_TRACK, TIER_PAINT } from '../palette';
import type { Measure } from '../paragraph';
import type { LayoutOp } from '../scale';
import { boundsOf } from '../shapes';
import type { PathOp } from '../shapes';
import type { Drawing } from '../typeset';
import { scoreRing } from './scoreRing';
import type { ScoreRingInput } from './scoreRing';

/** Every character is half its size wide, so every width in a test is exact. */
const measure: Measure = (text, _weight, size) => [...text].length * size * 0.5;
const FACE = { ascent: 1, descent: -0.25 };
const english: Drawing = { direction: 'ltr', measure, faces: { latin: FACE, arabic: FACE } };
const arabic: Drawing = { ...english, direction: 'rtl' };

const SIZE = CARD.ring;
const UNIT = SIZE / RING.box;
const CENTRE = { x: (RING.box / 2) * UNIT, y: -(RING.box / 2) * UNIT };
const R = RING.radius * UNIT;

const texts = (ops: readonly LayoutOp[]) =>
  ops.filter((op): op is Extract<Op, { kind: 'text' }> => op.kind === 'text');
const paths = (ops: readonly LayoutOp[]) => ops.filter((op): op is PathOp => op.kind === 'path');

const ring = (score: number | null, tier: ScoreRingInput['tier']): ScoreRingInput => ({
  score,
  tier,
  outOf: '/10',
  unset: '-',
});

describe('scoreRing', () => {
  it('is a square block as wide as it is told', () => {
    const block = scoreRing(ring(7, 'high'), SIZE, english);
    expect(block.width).toBe(SIZE);
    expect(block.height).toBe(SIZE);
    expect(block.overhang).toBe(0);
  });

  it('keeps every part inside its box, in either language, at every score', () => {
    for (const drawing of [english, arabic]) {
      for (let score = 0; score <= 10; score += 1) {
        const extent = extentOf(scoreRing(ring(score, 'middle'), SIZE, drawing).ops, measure);
        expect(extent.left).toBeGreaterThanOrEqual(0);
        expect(extent.right).toBeLessThanOrEqual(SIZE);
        expect(extent.top).toBeLessThanOrEqual(0);
        expect(extent.bottom).toBeGreaterThanOrEqual(-SIZE);
      }
      const unset = extentOf(scoreRing(ring(null, null), SIZE, drawing).ops, measure);
      expect(unset.left).toBeGreaterThanOrEqual(0);
      expect(unset.right).toBeLessThanOrEqual(SIZE);
    }
  });

  it('is the same in both languages: a figure is not mirrored', () => {
    expect(scoreRing(ring(4, 'low'), SIZE, arabic)).toEqual(
      scoreRing(ring(4, 'low'), SIZE, english),
    );
  });

  it('draws the whole ring in the track colour, at the radius and line of its grid', () => {
    const [track] = paths(scoreRing(ring(5, 'middle'), SIZE, english).ops);
    expect(track?.fill).toBeUndefined();
    expect(track?.stroke).toEqual({ ...RING_TRACK, width: RING.line * UNIT });
    const bounds = boundsOf(track?.segments ?? []);
    expect(bounds.left).toBeCloseTo(CENTRE.x - R, 9);
    expect(bounds.right).toBeCloseTo(CENTRE.x + R, 9);
    expect(bounds.top).toBeCloseTo(CENTRE.y + R, 9);
    expect(bounds.bottom).toBeCloseTo(CENTRE.y - R, 9);
  });

  it('draws an arc of the score’s share of a turn from the top, clockwise, round-ended', () => {
    const [, arc] = paths(scoreRing(ring(3, 'low'), SIZE, english).ops);
    expect(arc?.stroke).toEqual({ rgb: TIER_PAINT.low, width: RING.line * UNIT, cap: 'round' });
    const segments = arc?.segments ?? [];
    const [start] = segments;
    expect(start?.[0]).toBe('M');
    if (start?.[0] === 'M') {
      expect(start[1]).toBeCloseTo(CENTRE.x, 9);
      expect(start[2]).toBeCloseTo(CENTRE.y + R, 9);
    }
    const end = segments[segments.length - 1];
    const angle = Math.PI / 2 - 2 * Math.PI * 0.3;
    expect(end?.[0]).toBe('C');
    if (end?.[0] === 'C') {
      expect(end[5]).toBeCloseTo(CENTRE.x + R * Math.cos(angle), 9);
      expect(end[6]).toBeCloseTo(CENTRE.y + R * Math.sin(angle), 9);
    }
  });

  it('draws no arc for a score of 0, and the whole turn for a score of 10', () => {
    expect(paths(scoreRing(ring(0, 'low'), SIZE, english).ops)).toHaveLength(1);
    const [, whole] = paths(scoreRing(ring(10, 'high'), SIZE, english).ops);
    const segments = whole?.segments ?? [];
    const [start] = segments;
    const end = segments[segments.length - 1];
    if (start?.[0] === 'M' && end?.[0] === 'C') {
      expect(end[5]).toBeCloseTo(start[1], 9);
      expect(end[6]).toBeCloseTo(start[2], 9);
    } else {
      expect.unreachable('a whole turn is a move and curves');
    }
  });

  it('centres the score, heavier and in ink, and the words under it in the muted grey', () => {
    const [score, outOf, ...rest] = texts(scoreRing(ring(7, 'high'), SIZE, english).ops);
    expect(rest).toEqual([]);
    expect(score).toEqual({
      kind: 'text',
      x: CENTRE.x,
      y: -RING.scoreBaseline * UNIT,
      text: '7',
      style: { font: 'bold', size: RING.scoreSize * UNIT, ...INK },
      align: 'centre',
    });
    expect(outOf).toEqual({
      kind: 'text',
      x: CENTRE.x,
      y: -RING.outOfBaseline * UNIT,
      text: '/10',
      style: { font: 'regular', size: RING.outOfSize * UNIT, ...MUTED },
      align: 'centre',
    });
  });

  it('draws its figures left to right in an Arabic report too', () => {
    for (const op of texts(scoreRing(ring(10, 'high'), SIZE, arabic).ops)) {
      expect(op.rtl).toBeUndefined();
    }
  });

  it('draws the track, then the arc, then the figures', () => {
    const kinds = scoreRing(ring(6, 'middle'), SIZE, english).ops.map((op) => op.kind);
    expect(kinds).toEqual(['path', 'path', 'text', 'text']);
  });

  it('draws the track and the words for no score where the score would be, and nothing else', () => {
    const block = scoreRing({ ...ring(null, null), unset: 'n/a' }, SIZE, english);
    expect(paths(block.ops)).toHaveLength(1);
    const [only, ...rest] = texts(block.ops);
    expect(rest).toEqual([]);
    expect(only?.text).toBe('n/a');
    expect(only?.x).toBe(CENTRE.x);
    expect(only?.y).toBe(-RING.scoreBaseline * UNIT);
    expect(only?.align).toBe('centre');
  });

  it('refuses a score that is not a whole number from 0 to 10, by name', () => {
    for (const score of [-1, 11, 2.5, Number.NaN]) {
      expect(() => scoreRing(ring(score, 'low'), SIZE, english)).toThrow(
        /scoreRing needs a score that is a whole number from 0 to 10, or none/,
      );
    }
  });

  it('refuses a score with no tier, and a tier with no score, by name', () => {
    expect(() => scoreRing(ring(5, null), SIZE, english)).toThrow(
      /scoreRing needs a tier for a score of 5/,
    );
    expect(() => scoreRing(ring(null, 'high'), SIZE, english)).toThrow(
      /scoreRing needs a score for a tier of high/,
    );
  });

  it('refuses a size that is not a number, or is below nothing, by name', () => {
    expect(() => scoreRing(ring(5, 'low'), Number.NaN, english)).toThrow(
      /scoreRing needs a finite size/,
    );
    expect(() => scoreRing(ring(5, 'low'), -1, english)).toThrow(
      /scoreRing needs a size of zero or more/,
    );
  });

  it('changes nothing it was given', () => {
    const input = Object.freeze(ring(8, 'high'));
    expect(() => scoreRing(input, SIZE, english)).not.toThrow();
    expect(input).toEqual(ring(8, 'high'));
  });
});
