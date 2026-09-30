import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BAND_RGB } from '@domain/shared/bands';
import { INK as SHEET_INK, MUTED as SHEET_MUTED, RULE as SHEET_RULE } from '../../document/sheet';
import {
  ACCENT,
  BAND_PAINT,
  HAIRLINE,
  INK,
  MUTED,
  PANEL_EDGE,
  PANEL_FILL,
  REPORT_BANDS,
  RING_TRACK,
  TIER_PAINT,
  TIERS,
  bandDisc,
} from './palette';
import type { Paint } from './shapes';

/**
 * The colours of the brain-map report, held to the two places that already
 * say what the practice's colours are: the stylesheet every screen reads
 * (`app/shell/tokens.css`) and the reports this module already prints. A PDF
 * cannot read a stylesheet, so the triples are written out, and this test is
 * what notices when a token is adjusted and they are left behind.
 *
 * The test reads a file; the module under test reads nothing
 * (`.claude/rules/testing.md`).
 */

const TOKENS = fileURLToPath(new URL('../../../../app/shell/tokens.css', import.meta.url));

/** The FIRST declaration of each token: the light theme's, which is paper's. */
function tokens(): Record<string, string> {
  const css = readFileSync(TOKENS, 'utf8');
  const found: Record<string, string> = {};
  for (const match of css.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6});/g)) {
    const name = match[1];
    const hex = match[2];
    if (name && hex && found[name] === undefined) found[name] = hex.toLowerCase();
  }
  return found;
}

function triple(hex: string | undefined): [number, number, number] {
  if (!hex) throw new Error('The stylesheet declares no such token.');
  const byte = (at: number) => Number.parseInt(hex.slice(at, at + 2), 16) / 255;
  return [byte(1), byte(3), byte(5)];
}

describe('the colours of the brain-map report', () => {
  it('reads the stylesheet it claims to read', () => {
    const found = tokens();
    for (const name of ['brand', 'brand-wash', 'brand-pale', 'ok', 'attention', 'critical']) {
      expect(found[name], `app/shell/tokens.css declares no --${name}`).toBeDefined();
    }
  });

  it('has the practice’s violet as its one accent', () => {
    expect(ACCENT).toEqual({ rgb: triple(tokens().brand) });
  });

  it('fills a panel with the violet’s wash and edges it with the violet’s pale', () => {
    expect(PANEL_FILL).toEqual({ rgb: triple(tokens()['brand-wash']) });
    expect(PANEL_EDGE).toEqual({ rgb: triple(tokens()['brand-pale']) });
  });

  it('draws the unfilled part of a score’s ring in the panel’s edge', () => {
    expect(RING_TRACK).toEqual(PANEL_EDGE);
  });

  it('has the ink and the two greys of the reports already printed', () => {
    expect(INK).toEqual({ grey: SHEET_INK });
    expect(MUTED).toEqual({ grey: SHEET_MUTED });
    expect(HAIRLINE).toEqual({ grey: SHEET_RULE });
  });

  it('gives a score the three status hues: low, middle and high', () => {
    expect(TIERS).toEqual(['low', 'middle', 'high']);
    expect(TIER_PAINT.low).toEqual(triple(tokens().critical));
    expect(TIER_PAINT.middle).toEqual(triple(tokens().attention));
    expect(TIER_PAINT.high).toEqual(triple(tokens().ok));
  });

  it('gives four bands the hue the app gives them everywhere', () => {
    expect(REPORT_BANDS).toEqual(['delta', 'theta', 'alpha', 'beta', 'high_beta']);
    for (const band of ['delta', 'theta', 'alpha', 'beta'] as const) {
      expect(BAND_PAINT[band]).toEqual(BAND_RGB[band]);
    }
  });

  it('gives high beta the fifth hue of the app’s scale, which the report’s bands leave free', () => {
    expect(BAND_PAINT.high_beta).toEqual(BAND_RGB.gamma);
  });

  it('fills a band’s disc with its hue at eight parts in a hundred over white', () => {
    const [r, g, b] = BAND_PAINT.delta;
    const alpha = 0x14 / 255;
    expect(bandDisc('delta')).toEqual([
      1 - alpha * (1 - r),
      1 - alpha * (1 - g),
      1 - alpha * (1 - b),
    ]);
    for (const channel of bandDisc('high_beta')) expect(channel).toBeGreaterThan(0.9);
  });

  it('holds every paint as a grey or a colour, never both, and every number from 0 to 1', () => {
    const paints: Paint[] = [
      INK,
      MUTED,
      HAIRLINE,
      ACCENT,
      PANEL_FILL,
      PANEL_EDGE,
      RING_TRACK,
      ...REPORT_BANDS.map((band) => ({ rgb: BAND_PAINT[band] })),
      ...REPORT_BANDS.map((band) => ({ rgb: bandDisc(band) })),
      ...TIERS.map((tier) => ({ rgb: TIER_PAINT[tier] })),
    ];
    for (const paint of paints) {
      expect(paint.grey === undefined).not.toBe(paint.rgb === undefined);
      for (const value of paint.rgb ?? [paint.grey ?? -1]) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });

  it('cannot be changed by whoever holds it', () => {
    for (const held of [
      ACCENT,
      PANEL_FILL,
      PANEL_EDGE,
      INK,
      MUTED,
      HAIRLINE,
      BAND_PAINT,
      TIER_PAINT,
    ]) {
      expect(Object.isFrozen(held)).toBe(true);
    }
    expect(Object.isFrozen(BAND_PAINT.delta)).toBe(true);
    expect(Object.isFrozen(ACCENT.rgb)).toBe(true);
  });
});
