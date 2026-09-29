/**
 * The type of the brain-map report: a size, a line height, a weight, a
 * colour and whether it is underlined, for each role a piece of text plays.
 *
 * **The sizes and line heights are the practice's**, from the report a
 * household knows (`docs/SPEC/reports-qeeg.md` section 18, decision 2). What
 * changed is the face, which is the system's own, and four things that face
 * and the practice's rules ask for:
 *
 * - **No slanted face.** Arabic has none, so a role that was slanted in the
 *   old report (a card's summary, the words for an empty list) is upright.
 * - **No letter-spacing and no capitals.** A label is set in sentence case.
 * - **One accent.** Where the old report had a second colour for the number
 *   of a row, this has the violet.
 * - **Arabic is never set tighter than its face is tall.** The Arabic face
 *   stands 1.5 em from the top of its tallest letter to the foot of its
 *   deepest, where the Latin stands 1.3. A line height under that would
 *   print one line over the next, so an Arabic line is never under 1.5,
 *   on the page or in a card, whatever the English of the same role has.
 *   (A card was first given 1.45, to keep it short. The review of the
 *   pieces measured the face and found five roles each a twentieth of an
 *   em over their neighbour. The dashboard is scaled to its page in any
 *   case, so a card a little taller costs a little scale and no overlap.)
 *
 * A role's colour is a paint of `palette.ts`, held by identity, or `null`
 * where the colour is the caller's to give: a card's category is set in the
 * hue of its score.
 */

import type { Direction } from './direction';
import type { TextStyle } from './metrics';
import { ACCENT, INK, MUTED } from './palette';
import type { Paint } from './shapes';

export const ROLES = Object.freeze([
  'body',
  'lede',
  'empty',
  'heading',
  'subheading',
  'band',
  'bandMuted',
  'note',
  'panel',
  'panelHead',
  'cardCategory',
  'cardTitle',
  'cardSummary',
  'cardLabel',
  'cardEvidence',
  'cardBullet',
  'cardAdvice',
  'rowNumber',
  'rowName',
  'rowText',
  'pill',
  'signature',
  'signatureLabel',
  'footer',
] as const);
export type Role = (typeof ROLES)[number];

export type RoleStyle = {
  readonly style: TextStyle;
  /** `null` where the colour is the caller's to give. */
  readonly paint: Paint | null;
  readonly underline: boolean;
};

/** The least line height of an Arabic line: how tall the Arabic face stands, in em. */
export const ARABIC_FLOOR = 1.5;

type Weight = TextStyle['weight'];
type Designed = readonly [
  size: number,
  lineHeight: number,
  weight: Weight,
  paint: Paint | null,
  underline?: true,
];

const DESIGNED: Readonly<Record<Role, Designed>> = {
  body: [10.2, 1.5, 'regular', INK],
  lede: [10.2, 1.5, 'regular', MUTED],
  empty: [10.2, 1.5, 'regular', MUTED],
  heading: [14, 1.5, 'bold', ACCENT, true],
  subheading: [11.5, 1.5, 'bold', ACCENT, true],
  band: [10.2, 1.42, 'regular', INK],
  bandMuted: [10.2, 1.42, 'regular', MUTED],
  note: [7.6, 1.4, 'regular', MUTED],
  panel: [10.2, 1.5, 'regular', INK],
  panelHead: [10.2, 1.5, 'bold', ACCENT, true],
  cardCategory: [6.6, 1.5, 'bold', null],
  cardTitle: [10, 1.16, 'bold', INK],
  cardSummary: [8.6, 1.36, 'regular', MUTED],
  cardLabel: [6.8, 1.5, 'bold', MUTED],
  cardEvidence: [8.3, 1.35, 'regular', MUTED],
  cardBullet: [8.4, 1.34, 'regular', INK],
  cardAdvice: [8.4, 1.38, 'regular', INK],
  rowNumber: [11, 1.5, 'bold', ACCENT],
  rowName: [10.2, 1.5, 'bold', INK],
  rowText: [10.2, 1.5, 'regular', MUTED],
  pill: [11, 1.5, 'bold', ACCENT],
  signature: [9, 1.4, 'regular', INK],
  signatureLabel: [9, 1.4, 'regular', MUTED],
  footer: [6.8, 1.45, 'regular', MUTED],
};

function made(role: Role, direction: Direction): RoleStyle {
  const [size, designed, weight, paint, underline] = DESIGNED[role];
  const lineHeight = direction === 'rtl' ? Math.max(designed, ARABIC_FLOOR) : designed;
  return Object.freeze({
    style: Object.freeze({ size, lineHeight, weight }),
    paint,
    underline: underline === true,
  });
}

/**
 * The one cast of this file. `Object.fromEntries` forgets its keys and
 * gives back a record of any string; the keys are `ROLES`, every one of
 * them and no other, so the record is of every role. `styles.test.ts` holds
 * a table of all of them against it.
 */
const entries = (direction: Direction) =>
  Object.freeze(
    Object.fromEntries(ROLES.map((role) => [role, made(role, direction)])) as Record<
      Role,
      RoleStyle
    >,
  );

const STYLES: Readonly<Record<Direction, Readonly<Record<Role, RoleStyle>>>> = Object.freeze({
  ltr: entries('ltr'),
  rtl: entries('rtl'),
});

/** The style of a role in a paragraph of this direction. The same value every time. */
export function styleOf(role: Role, direction: Direction): RoleStyle {
  return STYLES[direction][role];
}
