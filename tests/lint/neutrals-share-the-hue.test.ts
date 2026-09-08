import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The neutrals belong to the same hue family as the mark
 * (docs/SPEC/harmonised-neutrals.md).
 *
 * They did not, until 8 September 2026. The greys were a cool mineral green at
 * hue 165, chosen on 2 September when the interface had no accent colour and
 * correct for that interface. Six days later the rail turned violet at hue 268
 * and the "neutral" ground was suddenly a hundred degrees away from it: the eye
 * stopped reading paper-against-brand and started reading green-against-violet.
 * Nothing was wrong with either colour on its own, which is exactly why it is
 * worth a test — the fault was invisible in any one token and obvious only in
 * the pair.
 *
 * A near-achromatic colour has no meaningful hue, so anything under the
 * saturation floor is exempt: white and true black are not violations.
 */
const tokens = readFileSync('app/shell/tokens.css', 'utf8');

const DARK = "[data-ground='dark']";
/** The mark's own hue, sampled from public/brand/mark.png. */
const BRAND_HUE = 268;
/** Wide enough for a family, narrow enough to exclude a different colour. */
const TOLERANCE = 30;
/** Below this a colour is grey and its hue is noise, not a decision. */
const SATURATION_FLOOR = 0.04;

const NEUTRALS = ['--ink', '--ink-2', '--slate', '--rule', '--paper', '--surface'] as const;

function hueAndSaturation(hex: string): { hue: number; saturation: number } {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const span = max - min;
  const lightness = (max + min) / 2;
  if (span === 0) {
    return { hue: 0, saturation: 0 };
  }
  const saturation = span / (1 - Math.abs(2 * lightness - 1));
  let hue: number;
  if (max === r) {
    hue = ((g - b) / span) % 6;
  } else if (max === g) {
    hue = (b - r) / span + 2;
  } else {
    hue = (r - g) / span + 4;
  }
  return { hue: (hue * 60 + 360) % 360, saturation };
}

/** The shortest way round the wheel between two hues, 0 to 180. */
function apart(a: number, b: number): number {
  const raw = Math.abs(a - b) % 360;
  return raw > 180 ? 360 - raw : raw;
}

function token(name: string, ground: 'light' | 'dark'): string | null {
  const halves = tokens.split(DARK);
  const source = (ground === 'dark' ? halves[1] : halves[0]) ?? '';
  const found = [...source.matchAll(new RegExp(`${name}:\\s*(#[0-9a-f]{6})\\b`, 'g'))];
  return found.at(-1)?.[1] ?? null;
}

describe('the neutrals share the mark’s hue', () => {
  for (const ground of ['light', 'dark'] as const) {
    it(`holds the family together on the ${ground} ground`, () => {
      const strays: string[] = [];
      for (const name of NEUTRALS) {
        const value = token(name, ground);
        if (!value) {
          continue;
        }
        const { hue, saturation } = hueAndSaturation(value);
        if (saturation < SATURATION_FLOOR) {
          continue;
        }
        const distance = apart(hue, BRAND_HUE);
        if (distance > TOLERANCE) {
          strays.push(`${name} ${value} is ${Math.round(distance)}deg from the mark`);
        }
      }
      expect(strays).toEqual([]);
    });
  }

  it('keeps a ground white surfaces can lift off', () => {
    // At the old 94.1% lightness, white sat 1.15 from paper and no shadow could
    // be seen against it, which is why depth had to be drawn in hairlines. The
    // elevation scale only means something while this holds.
    const paper = token('--paper', 'light');
    expect(paper).not.toBeNull();
    const channels = [1, 3, 5].map((i) => Number.parseInt((paper ?? '').slice(i, i + 2), 16));
    const lightest = Math.max(...channels);
    expect(lightest).toBeLessThan(0xf2);
  });
});
