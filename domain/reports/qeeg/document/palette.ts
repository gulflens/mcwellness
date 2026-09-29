/**
 * The colours of the brain-map report.
 *
 * **Ink, two greys, one accent.** The ink and the greys are those of the
 * reports this module already prints (`domain/reports/document/sheet.ts`).
 * The accent is the practice's violet, `--brand` on screen. A panel is filled
 * with the violet's wash and edged with its pale.
 *
 * **Hue is kept for two things**, as `docs/DESIGN-BRIEF.md` has it: the five
 * bands, on their icons, and the three states of a score, on its ring. Four
 * of the report's bands are bands the app already draws, and take the hue it
 * gives them everywhere (`domain/shared/bands.ts`). The report's fifth is
 * high beta, which the app's own scale does not have; it takes that scale's
 * fifth hue, which the report's bands leave free, so that the five icons of
 * a report are the five hues of a ribbon, slow to fast.
 *
 * **Why triples written out.** A PDF cannot read a stylesheet.
 * `palette.test.ts` reads `app/shell/tokens.css` and fails the day a token is
 * adjusted and a triple here is left behind.
 *
 * Nothing a person typed is ever coloured (`docs/SPEC/reports-qeeg.md`
 * section 12, point 7).
 */

import { BAND_RGB } from '@domain/shared/bands';
import { INK as SHEET_INK, MUTED as SHEET_MUTED, RULE as SHEET_RULE } from '../../document/sheet';
import { tintOver } from './shapes';
import type { Paint, Rgb } from './shapes';

const rgb = (red: number, green: number, blue: number): Rgb =>
  Object.freeze([red / 255, green / 255, blue / 255] as const);

const colour = (red: number, green: number, blue: number): Paint =>
  Object.freeze({ rgb: rgb(red, green, blue) });

const grey = (value: number): Paint => Object.freeze({ grey: value });

export const INK: Paint = grey(SHEET_INK);
export const MUTED: Paint = grey(SHEET_MUTED);
export const HAIRLINE: Paint = grey(SHEET_RULE);

/** `--brand`, #380473. */
export const ACCENT: Paint = colour(0x38, 0x04, 0x73);
/** `--brand-wash`, #f6f1fb. */
export const PANEL_FILL: Paint = colour(0xf6, 0xf1, 0xfb);
/** `--brand-pale`, #eadff6. */
export const PANEL_EDGE: Paint = colour(0xea, 0xdf, 0xf6);
/** The part of a score's ring that the score has not filled. */
export const RING_TRACK: Paint = PANEL_EDGE;

/** The report's five bands, slow to fast. `catalogue/ids.ts` names the same five. */
export const REPORT_BANDS = Object.freeze([
  'delta',
  'theta',
  'alpha',
  'beta',
  'high_beta',
] as const);
export type ReportBand = (typeof REPORT_BANDS)[number];

const copied = (triple: readonly [number, number, number]): Rgb =>
  Object.freeze([triple[0], triple[1], triple[2]] as const);

export const BAND_PAINT: Readonly<Record<ReportBand, Rgb>> = Object.freeze({
  delta: copied(BAND_RGB.delta),
  theta: copied(BAND_RGB.theta),
  alpha: copied(BAND_RGB.alpha),
  beta: copied(BAND_RGB.beta),
  high_beta: copied(BAND_RGB.gamma),
});

/** How strongly a band's hue fills the disc behind its wave: eight parts in a hundred. */
const DISC_TINT = 0x14 / 255;

/** The fill of a band icon's disc: its hue laid thinly over white, as a flat colour. */
export function bandDisc(band: ReportBand): Rgb {
  return tintOver(BAND_PAINT[band], DISC_TINT);
}

/** Where a score out of ten falls. `catalogue/ids.ts` names the same three. */
export const TIERS = Object.freeze(['low', 'middle', 'high'] as const);
export type Tier = (typeof TIERS)[number];

export const TIER_PAINT: Readonly<Record<Tier, Rgb>> = Object.freeze({
  /** `--critical`, #94382e. */
  low: rgb(0x94, 0x38, 0x2e),
  /** `--attention`, #8a6a1e. */
  middle: rgb(0x8a, 0x6a, 0x1e),
  /** `--ok`, #2f6b4f. */
  high: rgb(0x2f, 0x6b, 0x4f),
});
