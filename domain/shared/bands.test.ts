import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BAND_NAMES, BAND_RGB, BANDS, UNIT_NAMES } from './bands';

/**
 * The five bands, and the one thing that could silently go wrong: the paper
 * and the screen drifting apart.
 *
 * `app/shell/tokens.css` is where every hue in this platform is declared
 * (CLAUDE.md, "Visual system"), and a component may not hold a hex literal.
 * A PDF cannot read a stylesheet, so `BAND_RGB` is the same five colours in
 * the form a content stream wants — and there is no compiler to notice if
 * somebody adjusts a token and leaves the triples behind. This test reads the
 * stylesheet and does the noticing.
 *
 * The test file itself reads a file, which the domain's own rule forbids of
 * the module under test and not of the test (`.claude/rules/testing.md`:
 * `domain/` functions are pure; `bands.ts` reads nothing).
 */

const TOKENS = fileURLToPath(new URL('../../app/shell/tokens.css', import.meta.url));

/** The `--<band>-base` declarations of the stylesheet, as `#rrggbb`. */
function tokenHexes(): Record<string, string> {
  const css = readFileSync(TOKENS, 'utf8');
  const found: Record<string, string> = {};
  for (const match of css.matchAll(/--([a-z]+)-base:\s*(#[0-9a-fA-F]{6});/g)) {
    found[match[1]!] = match[2]!.toLowerCase();
  }
  return found;
}

/** A `#rrggbb` as the three 0-to-1 numbers a PDF writes. */
function hexToTriple(hex: string): [number, number, number] {
  const byte = (at: number) => Number.parseInt(hex.slice(at, at + 2), 16) / 255;
  return [byte(1), byte(3), byte(5)];
}

describe('the five bands', () => {
  it('are the design brief’s five, slow to fast', () => {
    expect(BANDS).toEqual(['delta', 'theta', 'alpha', 'beta', 'gamma']);
  });

  it('each have a word in both languages, and no word is empty', () => {
    for (const band of BANDS) {
      expect(BAND_NAMES[band].en.length).toBeGreaterThan(0);
      expect(BAND_NAMES[band].ar.length).toBeGreaterThan(0);
    }
  });

  it('name a band in Arabic script in the Arabic half and Latin in the English', () => {
    for (const band of BANDS) {
      expect(BAND_NAMES[band].ar).toMatch(/^[؀-ۿ]+$/);
      expect(BAND_NAMES[band].en).toMatch(/^[A-Za-z]+$/);
    }
  });
});

describe('the printed hue and the screen’s own', () => {
  it('gives every band a triple', () => {
    for (const band of BANDS) {
      expect(BAND_RGB[band]).toHaveLength(3);
      for (const value of BAND_RGB[band]) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });

  it('is the same colour on paper as the stylesheet declares on screen', () => {
    const hexes = tokenHexes();
    for (const band of BANDS) {
      const hex = hexes[band];
      expect(hex, `app/shell/tokens.css declares no --${band}-base`).toBeDefined();
      expect(BAND_RGB[band], `--${band}-base is ${hex}`).toEqual(hexToTriple(hex!));
    }
  });

  it('reads the stylesheet it claims to read', () => {
    // If the file moved or the declarations were renamed, the test above would
    // pass vacuously on an empty map for want of anything to compare.
    expect(Object.keys(tokenHexes()).length).toBeGreaterThanOrEqual(BANDS.length);
  });
});

describe('the units a figure is measured in', () => {
  it('names the five the brain map and the questionnaire report', () => {
    expect(Object.keys(UNIT_NAMES).sort()).toEqual(['percent', 'points', 'ratio', 'sd', 'uV2']);
  });

  it('is short enough for a column head, and none is empty', () => {
    for (const unit of Object.keys(UNIT_NAMES) as (keyof typeof UNIT_NAMES)[]) {
      expect(UNIT_NAMES[unit].length).toBeGreaterThan(0);
      expect(UNIT_NAMES[unit].length).toBeLessThanOrEqual(10);
    }
  });
});
