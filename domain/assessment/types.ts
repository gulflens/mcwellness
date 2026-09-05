/**
 * What a measurement is, in types (docs/SPEC/assessment.md sections 1 and 5).
 *
 * Pure and browser-safe: no I/O, no clock read inside, no Node built-in
 * (CLAUDE.md rule 4, .claude/rules/testing.md). Everything here is plain data
 * that survives `JSON.stringify` unchanged, because the reports stream quotes
 * a comparison into its own snapshot and a snapshot has to be serialisable
 * (docs/SPEC/reports-v1.md section 6).
 *
 * **Nothing here says what a figure means.** There is no band, no cut-off, no
 * word like high or low anywhere in this module, and a payload carrying one is
 * refused by name (`validateDerived`). What a measurement means is the
 * practitioner's judgement, written in a report and signed by a person.
 */

/**
 * The instruments this platform has a declared shape for.
 *
 * `qeeg` is the brain map. `questionnaire.sample` is a synthetic instrument
 * that exists to exercise the questionnaire *mechanism* — a shape declared by
 * its questions, each answered on a declared scale, totalled to a maximum —
 * while the practice has licensed none. It names no real questionnaire, and
 * no licensed questionnaire's name, questions or scoring appears anywhere in
 * this repository. When the operator names one, it arrives as one more
 * declared shape beside this one (docs/SPEC/assessment.md section 10,
 * decision 5).
 */
export const INSTRUMENTS = ['qeeg', 'questionnaire.sample'] as const;
export type Instrument = (typeof INSTRUMENTS)[number];

export function isInstrument(value: string): value is Instrument {
  return (INSTRUMENTS as readonly string[]).includes(value);
}

/**
 * The five frequency bands, slow to fast, as `docs/DESIGN-BRIEF.md` section
 * 3.1 orders them. The order is the hue ramp's order and the screen reads
 * them in it.
 */
export const BANDS = ['delta', 'theta', 'alpha', 'beta', 'gamma'] as const;
export type Band = (typeof BANDS)[number];

/**
 * The scalp positions a brain map reports, in the international 10-20 system.
 * A closed set on purpose: a site the software did not report is a typing
 * mistake, and a typing mistake in a measurement is worth refusing with the
 * field named.
 */
export const SITES = [
  'Fp1',
  'Fp2',
  'F7',
  'F3',
  'Fz',
  'F4',
  'F8',
  'T3',
  'C3',
  'Cz',
  'C4',
  'T4',
  'T5',
  'P3',
  'Pz',
  'P4',
  'T6',
  'O1',
  'O2',
] as const;
export type Site = (typeof SITES)[number];

/**
 * What a figure is measured in. Every brain-map figure carries one and a
 * comparison refuses a pair whose units disagree, because subtracting a
 * percentage from a power is arithmetic that produces a number and means
 * nothing.
 *
 * - `uV2` — absolute power, microvolts squared, as the equipment's software
 *   reports it.
 * - `percent` — relative power, this band's share of the total at that site.
 * - `ratio` — one band over another at the same site.
 * - `sd` — how far the recording sat from the software's own reference
 *   database, in that database's own standard deviations. It is a figure the
 *   software reported, never one this platform computes, and it carries no
 *   word (section 3.4).
 * - `points` — a questionnaire's own scale, in whole points of the scale the
 *   shape declares. Never a brain-map figure's unit.
 */
export const UNITS = ['uV2', 'percent', 'ratio', 'sd', 'points'] as const;
export type Unit = (typeof UNITS)[number];

/** What the software's reference comparison was made against, as it was made. */
export const REFERENCE_SEXES = ['female', 'male', 'unknown'] as const;
export type ReferenceSex = (typeof REFERENCE_SEXES)[number];

/**
 * What produced a payload (docs/SPEC/assessment.md section 10, decision 6).
 *
 * Beside `instrument_version`, which says which edition of the instrument was
 * administered, this says which program printed the figures and which release
 * of it, so a figure can always be traced back to what computed it. Every
 * payload carries one and a payload without one is refused.
 */
export type Provenance = {
  /** The program that produced the figures, as the practice names it. */
  software: string;
  /** That program's own version string, copied as it is written. */
  softwareVersion: string;
};

/** One band's figure at one site. */
export type BandFigure = {
  site: Site;
  band: Band;
  value: number;
  unit: Unit;
};

/** What a brain map records. */
export type BrainMapPayload = {
  kind: 'brain-map';
  provenance: Provenance;
  /** Eyes open or closed: the two recordings a brain map is made of. */
  condition: BrainMapCondition;
  /** The figures the software reported, one per site and band. */
  figures: readonly BandFigure[];
};

export const BRAIN_MAP_CONDITIONS = ['eyes-open', 'eyes-closed'] as const;
export type BrainMapCondition = (typeof BRAIN_MAP_CONDITIONS)[number];

/** One answer to one question, as the person gave it. */
export type QuestionnaireAnswer = {
  key: string;
  value: number;
};

/** What a questionnaire records: the answers, the total they produce, and the most it could be. */
export type QuestionnairePayload = {
  kind: 'questionnaire';
  provenance: Provenance;
  answers: readonly QuestionnaireAnswer[];
  total: number;
  maximum: number;
};

/** Everything a `derived` column may hold. */
export type DerivedPayload = BrainMapPayload | QuestionnairePayload;

/**
 * One measurement, as every rule in this module reads it. A subset of the
 * `assessment` row (migration 500) and nothing that is not needed to reason
 * about one.
 */
export type Assessment = {
  id: string;
  clientId: string;
  instrument: Instrument;
  instrumentVersion: string;
  /** When the measurement was taken, as an ISO instant. */
  performedAt: string;
  derived: DerivedPayload;
  version: number;
  supersedesId: string | null;
  /** The age the software's reference comparison was made against, as it was made. */
  referenceAgeYears: number | null;
  referenceSex: ReferenceSex | null;
};

/** A refusal that names the field it is about, so a screen can say which one. */
export type FieldRefusal = {
  ok: false;
  /** A dotted path into the payload: `figures.3.unit`, `provenance.software`. */
  field: string;
  reason: RefusalReason;
};

export type RefusalReason =
  | 'unknown_instrument'
  | 'unknown_instrument_version'
  | 'not_an_object'
  | 'wrong_kind'
  | 'missing'
  | 'not_a_number'
  | 'not_finite'
  | 'not_an_integer'
  | 'out_of_scale'
  | 'missing_unit'
  | 'unknown_unit'
  | 'unknown_site'
  | 'unknown_band'
  | 'unknown_condition'
  | 'duplicate_figure'
  | 'unknown_question'
  | 'missing_question'
  | 'total_disagrees'
  | 'maximum_disagrees'
  | 'unknown_field'
  /** A word attached to a figure. Never stored: see `INTERPRETATION_FIELDS`. */
  | 'interpretation_not_stored';

export type Validated<T> = { ok: true; value: T } | FieldRefusal;

/**
 * How long the two free-text columns may be (migration 500). Free text sits
 * beside a typed field and never replaces it (CLAUDE.md rule 3), and the trail
 * truncates what is long anyway (migration 908), so both are bounded here, at
 * the edge, where a person can be told rather than at the database, where they
 * would only see a failure.
 */
export const MAX_CONDITION_NOTE_LENGTH = 500;
export const MAX_SUPERSEDE_REASON_LENGTH = 500;
