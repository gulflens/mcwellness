import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The palette is legible, proved from the stylesheet rather than from a table
 * somebody typed out beside it (docs/SPEC/coloured-shell.md sections 4.1
 * and 4.3).
 *
 * Every ratio here was computed before the colour was chosen, and three of
 * them changed the design: no violet ground reaches the 3.0 a state needs
 * against the rail, so the active section is a white pill; the roles line's
 * violet failed at 4.25 and became the pale label; and mixing the brand
 * towards white for the dark ground passes but yields a lilac, so the lift
 * holds saturation instead. Editing a token to something illegible now fails
 * the build rather than shipping.
 */
const tokens = readFileSync('app/shell/tokens.css', 'utf8');

const DARK = "[data-ground='dark']";

/**
 * The value of a custom property on one of the two grounds.
 *
 * The file is split at the dark ground's selector and each half searched on
 * its own, because several tokens are declared in both halves: reading "the
 * last --surface in the file" would hand the light ground the practitioner's
 * near-black and quietly compare the wrong pair.
 */
function token(name: string, ground: 'light' | 'dark' = 'light'): string {
  const halves = tokens.split(DARK);
  const source = (ground === 'dark' ? halves[1] : halves[0]) ?? '';
  const found = [...source.matchAll(new RegExp(`${name}:\\s*(#[0-9a-f]{3,8})\\b`, 'g'))];
  const value = found.at(-1)?.[1];
  if (!value) {
    throw new Error(`no ${name} on the ${ground} ground`);
  }
  return value;
}

function channel(pair: string): number {
  const c = Number.parseInt(pair, 16) / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => channel(hex.slice(i, i + 2))) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The WCAG ratio between two colours, 1 to 21. Order does not matter. */
function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((m, n) => n - m) as [number, number];
  return (high + 0.05) / (low + 0.05);
}

/** Text, and anything smaller than 24px. */
const AA_TEXT = 4.5;
/** A control's own boundary against what is behind it. */
const AA_UI = 3;

describe('the brand palette stays legible', () => {
  const brand = token('--brand');
  const deep = token('--brand-deep');
  const pale = token('--brand-pale');
  const paper = token('--paper');
  const surface = token('--surface');

  it('carries a resting label on the rail', () => {
    expect(contrast(pale, deep)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('separates the active pill from the rail it sits on', () => {
    expect(contrast(surface, deep)).toBeGreaterThanOrEqual(AA_UI);
  });

  it('reads as text on the active pill and on paper', () => {
    expect(contrast(brand, surface)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrast(brand, paper)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('carries white on a filled control', () => {
    expect(contrast(surface, brand)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('is lifted enough to read on the practitioner ground', () => {
    const dark = token('--brand', 'dark');
    const darkPaper = token('--paper', 'dark');
    const darkSurface = token('--surface', 'dark');
    expect(contrast(dark, darkPaper)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrast(dark, darkSurface)).toBeGreaterThanOrEqual(AA_TEXT);
    // Both directions, so the one token serves a link on this ground and a
    // filled control with the ground's own near-black text on it.
    expect(contrast(darkPaper, dark)).toBeGreaterThanOrEqual(AA_TEXT);
  });
});
