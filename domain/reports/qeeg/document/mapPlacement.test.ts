/**
 * How large a brain map is drawn and how sharp it prints there. The first
 * three cases are the Dart tool's own numbers, on its own page: A4 less 17 mm
 * margins each side.
 */

import { describe, expect, it } from 'vitest';
import {
  GOOD_PRINT_DPI,
  MAX_MAP_SCALE,
  POOR_PRINT_DPI,
  placeImage,
  printQualityKey,
  printQualityOf,
} from './mapPlacement';
import { MM } from './metrics';

const BODY_WIDTH = 595.28 - 2 * 17 * MM;
/** A box tall enough that only the width binds, as the Dart estimate assumed. */
const fullWidth = { maxWidth: BODY_WIDTH, maxHeight: 10_000 };

describe('placing a map in its box', () => {
  it('prints a 736 by 976 map across the full body width near 106 dpi, which is poor', () => {
    const placed = placeImage({ width: 736, height: 976 }, fullWidth);
    expect(placed.width).toBeCloseTo(BODY_WIDTH, 9);
    expect(Math.abs(placed.dpi - 106)).toBeLessThan(1);
    expect(printQualityOf(placed.dpi)).toBe('poor');
    expect(printQualityKey(printQualityOf(placed.dpi))).toBe('map.print.poor');
  });

  it('prints a 2200 by 1500 map above 300 dpi, which is good and needs no note', () => {
    const placed = placeImage({ width: 2200, height: 1500 }, fullWidth);
    expect(placed.dpi).toBeGreaterThan(300);
    expect(printQualityOf(placed.dpi)).toBe('good');
    expect(printQualityKey(printQualityOf(placed.dpi))).toBeNull();
  });

  it('holds a 200 by 150 map at two and a half times, near 38.4 dpi', () => {
    const placed = placeImage({ width: 200, height: 150 }, fullWidth);
    expect(placed.scale).toBe(MAX_MAP_SCALE);
    expect(placed.width).toBeCloseTo(200 * 0.75 * 2.5, 9);
    expect(placed.dpi).toBeCloseTo(96 / 2.5, 6);
    expect(printQualityOf(placed.dpi)).toBe('poor');
  });

  it('gives 0 dpi and a zero placement for a size of nothing, without throwing', () => {
    expect(placeImage({ width: 0, height: 0 }, fullWidth)).toEqual({
      width: 0,
      height: 0,
      scale: 0,
      dpi: 0,
    });
    expect(placeImage({ width: -3, height: 40 }, fullWidth).dpi).toBe(0);
    expect(placeImage({ width: 100, height: 100 }, { maxWidth: 0, maxHeight: 100 }).dpi).toBe(0);
    expect(printQualityOf(0)).toBe('poor');
  });

  it('hands every caller its own answer for nothing, so one caller’s change reaches no other', () => {
    const first = placeImage({ width: 0, height: 0 }, fullWidth);
    (first as { width: number }).width = 99;
    expect(placeImage({ width: 0, height: 0 }, fullWidth)).toEqual({
      width: 0,
      height: 0,
      scale: 0,
      dpi: 0,
    });
  });

  it('prints the same map about twice as sharp in a box half as wide', () => {
    const map = { width: 736, height: 976 };
    const whole = placeImage(map, fullWidth);
    const half = placeImage(map, { maxWidth: BODY_WIDTH / 2, maxHeight: 10_000 });
    expect(half.dpi / whole.dpi).toBeCloseTo(2, 9);
  });

  it('is bound by the height when a tall map is placed in a short box', () => {
    const placed = placeImage(
      { width: 736, height: 976 },
      { maxWidth: BODY_WIDTH, maxHeight: 300 },
    );
    expect(placed.height).toBeCloseTo(300, 9);
    expect(placed.width).toBeLessThan(BODY_WIDTH);
  });

  it('keeps the map’s own proportions', () => {
    for (const map of [
      { width: 736, height: 976 },
      { width: 2200, height: 1500 },
      { width: 200, height: 150 },
    ]) {
      const placed = placeImage(map, { maxWidth: 300, maxHeight: 280 });
      expect(placed.width / placed.height).toBeCloseTo(map.width / map.height, 9);
    }
  });

  it('takes a smaller magnification cap when one is given', () => {
    expect(placeImage({ width: 200, height: 150 }, fullWidth, 1).width).toBeCloseTo(150, 9);
  });
});

describe('the print quality at a resolution', () => {
  it('is good from 220 dpi, fair from 140, and poor below', () => {
    expect(GOOD_PRINT_DPI).toBe(220);
    expect(POOR_PRINT_DPI).toBe(140);
    expect(printQualityOf(220)).toBe('good');
    expect(printQualityOf(219)).toBe('fair');
    expect(printQualityOf(140)).toBe('fair');
    expect(printQualityOf(139)).toBe('poor');
  });

  it('names a wording key for fair and poor, never a sentence', () => {
    expect(printQualityKey('good')).toBeNull();
    expect(printQualityKey('fair')).toBe('map.print.fair');
    expect(printQualityKey('poor')).toBe('map.print.poor');
  });
});
