/**
 * The five EEG frequency bands: their order, their words in both languages,
 * and their hues in the form a printed page can carry.
 *
 * **Why this is the shared zone's and not a stream's.** The five names existed
 * twice, in English only, in two streams' own files — `BAND_LABELS` in
 * `app/admin/assessments/copy.ts`, which the comparison screen renders, and
 * `BAND_WORDS` in `app/api/reports/gather.ts`, which quoted it rather than
 * importing it because `docs/SPEC/OWNERSHIP.md` rule 3 holds a route out of
 * another stream's folder. Neither had an Arabic half, and neither was the
 * place to invent one: whichever added it first, the other would copy it, and
 * two copies of a vocabulary drift. Rule 3 says a thing two modules need
 * belongs here; `docs/CHANGE-REQUESTS/qa-01.md` asks for exactly this, and the
 * precedent is `fileSignature.ts`, which round 31 moved here for the same
 * reason.
 *
 * **The Arabic words are proposed, not held.** The repository has no Arabic
 * vocabulary for the bands, so these are the plain transliterations of the
 * Greek letters, which is what the bands are called in Arabic-language
 * writing. They are the operator's to approve, as every Arabic string
 * in this repository is, and they are written in exactly one place so that
 * approving them changes one file (`docs/CHANGE-REQUESTS/trunk-notes.md`,
 * round 34).
 *
 * Pure and browser-safe: plain data, no I/O, no clock, no Node built-in.
 */

/**
 * The five bands, slow to fast, as `docs/DESIGN-BRIEF.md` section 3.1 orders
 * them. The order is the hue ramp's order — cool to warm — and every screen
 * and every figure reads them in it.
 *
 * **This is the only list of the five in the repository.** The keys stood in
 * four places before this file: `domain/assessment/types.ts`,
 * `domain/reports/types.ts` and `domain/session/events.ts` all re-export this
 * one under the names they already exported, so no caller of any of them
 * moved, and `db/seed/generate.ts` imports it. A search of the repository for
 * the five keys finds this file and nothing else, which is what makes the
 * sentence checkable rather than a hope.
 */
export const BANDS = ['delta', 'theta', 'alpha', 'beta', 'gamma'] as const;
export type Band = (typeof BANDS)[number];

/** The units a figure may be reported in (`docs/SPEC/assessment.md` section 5). */
export const UNITS = ['uV2', 'percent', 'ratio', 'sd', 'points'] as const;
export type Unit = (typeof UNITS)[number];

/**
 * What a band is called, for a reader.
 *
 * The hue is the token's and never a word's: naming a band does not say
 * anything about a measurement, and nothing here carries a threshold, a
 * cut-off or an interpretation.
 */
export const BAND_NAMES: Record<Band, { en: string; ar: string }> = {
  delta: { en: 'Delta', ar: 'دلتا' },
  theta: { en: 'Theta', ar: 'ثيتا' },
  alpha: { en: 'Alpha', ar: 'ألفا' },
  beta: { en: 'Beta', ar: 'بيتا' },
  gamma: { en: 'Gamma', ar: 'غاما' },
};

/**
 * What a figure is measured in, short enough for a column head.
 *
 * **One string, not two.** Unlike a band name these do not change language:
 * `µV²` and `%` are symbols everywhere, and a report's own comparison line
 * carries a single `unit` (`ComparisonLine`, `domain/reports/types.ts`) with
 * no Arabic twin to fill. Inventing Arabic prose for `ratio`, `SD` and
 * `points` would put three more strings in front of the operator for
 * approval that nothing on any page would print.
 *
 * The longer English sentences a screen sets beside a table stay the screen's
 * own (`UNIT_LABELS`, `app/admin/assessments/copy.ts`): those are prose, and
 * this is a name.
 */
export const UNIT_NAMES: Record<Unit, string> = {
  uV2: 'µV²',
  percent: '%',
  ratio: 'ratio',
  sd: 'SD',
  points: 'points',
};

/**
 * The band spectrum as a document writer wants it: red, green and blue, each
 * from 0 to 1.
 *
 * **These are `app/shell/tokens.css`'s five `--<band>-base` values and nothing
 * else.** Colour in this platform is declared once, in the stylesheet, and no
 * component may hold a hex literal (CLAUDE.md, "Visual system"). A PDF cannot
 * read a stylesheet, so the same five colours have to exist here in the form a
 * content stream writes them — and `bands.test.ts` reads `tokens.css` and
 * proves the two agree, so the paper and the screen cannot drift apart.
 *
 * This is the only place in the platform where a colour is written as numbers,
 * and the ribbon is the only figure that may draw with them
 * (`docs/DESIGN-BRIEF.md` section 5: "the one place hue enters a report").
 */
export const BAND_RGB: Record<Band, readonly [number, number, number]> = {
  // #3b4a87 — deep indigo
  delta: [0x3b / 255, 0x4a / 255, 0x87 / 255],
  // #2c7387 — teal
  theta: [0x2c / 255, 0x73 / 255, 0x87 / 255],
  // #3d8557 — green
  alpha: [0x3d / 255, 0x85 / 255, 0x57 / 255],
  // #b8863a — amber
  beta: [0xb8 / 255, 0x86 / 255, 0x3a / 255],
  // #a8553f — rust
  gamma: [0xa8 / 255, 0x55 / 255, 0x3f / 255],
};
