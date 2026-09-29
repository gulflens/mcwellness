/**
 * What a brain-map report holds.
 *
 * **Two editions, one report.** A first report says what was seen. A
 * follow-up says what has changed since an earlier report and what comes
 * next. They share their layout and most of their content; they differ in
 * the choices a practitioner is offered for a band or a measure, and in the
 * page a follow-up adds. `edition` tells them apart, and each validates
 * against its own lists (`catalogue/ids.ts`), so a choice made in one can
 * never be read as a choice made in the other.
 *
 * **Judgement lives here and nowhere else.** The app's measurements carry no
 * word beside a figure (`docs/SPEC/assessment.md` section 3). A level, a
 * change, a score out of ten are a practitioner's judgement, and a judgement
 * belongs in a report she signs. Nothing in this file is ever written back to
 * an assessment.
 *
 * **Names, not positions, and objects, not arrays, for anything typed.**
 * Choices from a list are stored as the names of what was chosen. Anything a
 * person typed sits under a key of its own: the audit trail shortens a long
 * string inside an object and does not look inside an array
 * (`docs/SPEC/audit.md`), so a typed sentence in an array would be copied
 * whole into a log that is never erased. `Ordered` is how a list of typed
 * things keeps its order without being one.
 *
 * **Typed once, printed in either language.** A practitioner fills one form.
 * Each thing she types is `Bilingual`: her English, and an Arabic version if
 * she gave one. `textFor` prints the Arabic when it is there and her English
 * when it is not. Which language a report is signed in is the report row's
 * `locale`, not this content's, which is why one draft can become an English
 * report and an Arabic one and the two cannot disagree on a finding.
 *
 * **What is gathered is not typed.** Name, age and sex come from the client's
 * record, read again by the server on every save and once more at signing.
 * The signer is whoever signs, from their credential. Neither can be set by
 * the form.
 *
 * **No figure is ever read off a picture.** A change figure says where it
 * came from: `typed` is the practitioner's own estimate, `calculated` is
 * arithmetic on two recorded assessments, and the page prints a note that
 * follows from which was used.
 */

import type {
  ApproachId,
  BandChange,
  BandId,
  BenefitId,
  ConnectivityChange,
  ConnectivityId,
  DimensionId,
  FindingId,
  FocusId,
  InitialBandLevel,
  InitialConnectivityLevel,
  MeasureId,
  NextStageId,
  RecommendationId,
  RegionId,
} from './catalogue/ids';

export type { Edition, Locale } from './wording';

/** What the practitioner called the assessment. */
export const STAGES = Object.freeze(['initial', 'follow_up', 'final'] as const);
export type Stage = (typeof STAGES)[number];

export const EYES = Object.freeze(['closed', 'open', 'closed_and_open'] as const);
export type Eyes = (typeof EYES)[number];

export const HANDEDNESS = Object.freeze(['right', 'left', 'ambidextrous'] as const);
export type Handedness = (typeof HANDEDNESS)[number];

export const SEXES = Object.freeze(['female', 'male'] as const);
export type Sex = (typeof SEXES)[number];

export const CONDITIONS = Object.freeze(['eyes_open', 'eyes_closed'] as const);
export type Condition = (typeof CONDITIONS)[number];

/** How long a typed thing may be, and how many of a thing there may be. */
export const LIMITS = Object.freeze({
  /** What the shape accepts. The editor holds a new summary to `summaryTyped`. */
  summary: 4000,
  summaryTyped: 1500,
  marks: 200,
  label: 160,
  note: 400,
  evidence: 400,
  caption: 120,
  customPerList: 12,
  maps: 8,
  tiles: 2,
  sessionsMost: 200,
});

// ---------------------------------------------------------------------------
// Typed text
// ---------------------------------------------------------------------------

/** Typed once in English. The Arabic is hers to add, and optional. */
export type Bilingual = { readonly en: string; readonly ar: string | null };

/**
 * A stretch of the text that is bold, underlined, or both. `from` and `to`
 * count UTF-16 units of the text, `to` exclusive.
 *
 * Colour and italic are not here. Hue is reserved in this app for band data
 * and three states, and Arabic has no italic, so a slant could be honoured in
 * one language only.
 */
export type Mark = {
  readonly from: number;
  readonly to: number;
  readonly bold?: true;
  readonly underline?: true;
};

/** A newline in `text` ends a paragraph. Marks are in order and never overlap. */
export type RichText = { readonly text: string; readonly marks: readonly Mark[] };

export type BilingualRich = { readonly en: RichText; readonly ar: RichText | null };

/**
 * A list of typed things that keeps its order without being an array: each
 * item under a key of its own, with its place. Places run from 0 with no gap
 * and no repeat.
 */
export type Ordered<T> = Readonly<Record<string, T & { readonly position: number }>>;

// ---------------------------------------------------------------------------
// Choices
// ---------------------------------------------------------------------------

/** Something she added to a list herself. */
export type CustomItem = {
  readonly label: Bilingual;
  /** The second half of a recommendation she added. Absent elsewhere. */
  readonly note: Bilingual | null;
  readonly chosen: boolean;
};

/** What was ticked from a list, and what she added to it. */
export type Picked<Id extends string> = {
  readonly chosen: readonly Id[];
  readonly custom: Ordered<CustomItem>;
};

export type Regions = readonly RegionId[];

// ---------------------------------------------------------------------------
// Brain maps
// ---------------------------------------------------------------------------

/**
 * A stored brain map, by the id of its document and the digest of its bytes.
 * The digest is what lets a signed report be rendered again, years on, and
 * proved to be the same file.
 */
export type FigureRef = {
  readonly figureId: string;
  readonly sha256: string;
  readonly widthPx: number;
  readonly heightPx: number;
};

export type MapEntry = FigureRef & {
  readonly condition: Condition | null;
  /** Her own label, when it is not one of the two the practice uses. */
  readonly caption: Bilingual | null;
};

// ---------------------------------------------------------------------------
// Where a report came from
// ---------------------------------------------------------------------------

export const IMPORT_NOTE_CODES = Object.freeze([
  /** The old tool printed 5 for a score nobody set. The record keeps what was printed. */
  'score_defaulted',
  /** A value the old file held that this app has no name for. `at` says which field. */
  'value_not_recognised',
  'extra_positions_ignored',
  'summary_colour_dropped',
  'summary_slant_dropped',
  /** A picture, or formatting of a kind this app does not keep, inside the old summary. */
  'summary_content_dropped',
  'summary_formatting_unreadable',
  'signature_image_dropped',
  'map_label_kept_as_caption',
  'map_without_image_dropped',
  'text_shortened',
] as const);
export type ImportNoteCode = (typeof IMPORT_NOTE_CODES)[number];

/** Something the importer changed or could not carry, and where. Never what was typed. */
export type ImportNote = { readonly code: ImportNoteCode; readonly at: string | null };

export type Provenance =
  | { readonly origin: 'app' }
  | {
      readonly origin: 'legacy_tool';
      readonly format: 'qeeg.json/1';
      readonly sourceSha256: string;
      readonly notes: readonly ImportNote[];
      /** Who the old report named beneath its signature. A record of what was printed. */
      readonly asPrinted: {
        readonly signerName: string | null;
        readonly signerRole: string | null;
      };
    };

// ---------------------------------------------------------------------------
// The head of the report
// ---------------------------------------------------------------------------

/** Gathered from the client's record by the server. Never taken from the form. */
export type Subject = {
  readonly nameAr: string | null;
  readonly ageYears: number | null;
  readonly sex: Sex | null;
};

export type Recording = {
  /** The day of the recording, as `YYYY-MM-DD`. */
  readonly recordedOn: string | null;
  readonly eyes: Eyes | null;
  readonly handedness: Handedness | null;
};

// ---------------------------------------------------------------------------
// Both editions
// ---------------------------------------------------------------------------

export type Score = {
  /** A whole number from 0 to 10. Unset until she sets it: no score is signed unexamined. */
  readonly score: number | null;
  readonly evidence: Bilingual | null;
};

export type QeegCommon = {
  readonly kind: 'qeeg';
  readonly schema: 1;
  /** Which version of the wording this report prints. */
  readonly wording: 1;
  readonly stage: Stage;
  readonly provenance: Provenance;
  readonly subject: Subject;
  readonly recording: Recording;
  readonly findings: Picked<FindingId>;
  readonly focus: Picked<FocusId>;
  readonly maps: Ordered<MapEntry>;
  readonly recommendations: Picked<RecommendationId>;
  readonly summary: BilingualRich;
  readonly benefits: Picked<BenefitId>;
};

// ---------------------------------------------------------------------------
// A first report
// ---------------------------------------------------------------------------

export type InitialBand = { readonly level: InitialBandLevel | null; readonly regions: Regions };

export type InitialConnectivity = {
  readonly [K in ConnectivityId]: {
    readonly level: InitialConnectivityLevel<K> | null;
    readonly regions: Regions;
  };
};

export type QeegInitial = QeegCommon & {
  readonly edition: 'initial';
  readonly bands: Readonly<Record<BandId, InitialBand>>;
  readonly connectivity: InitialConnectivity;
  readonly dashboard: Readonly<Record<DimensionId, Score>>;
  readonly plan: { readonly sessions: number | null; readonly approach: ApproachId | null };
};

// ---------------------------------------------------------------------------
// A follow-up
// ---------------------------------------------------------------------------

/**
 * The earlier report this one is compared with, as it stood when chosen.
 *
 * A report this app signed has a printed reference. A past record from the
 * old tool has none, and the two are told apart by the type, so that neither
 * can be written with the other's.
 */
export type ComparedWith = {
  readonly reportId: string;
  readonly recordedOn: string;
  /** Whether it is the client's first report or a later one. Chooses the words. */
  readonly relation: 'initial' | 'previous';
} & (
  | { readonly origin: 'issued'; readonly reference: string }
  | { readonly origin: 'imported'; readonly reference: null }
);

export type FigureSource = 'typed' | 'calculated';

/** What a calculated figure was calculated from. */
export type Basis = {
  readonly earlierAssessmentId: string;
  readonly laterAssessmentId: string;
  readonly unit: 'uV2';
  readonly sitesPaired: number;
};

/** What a figure says. */
export type FigureValue =
  | {
      readonly kind: 'percent';
      readonly direction: 'increase' | 'decrease';
      /** A whole number of percent, from 1 to 100. */
      readonly low: number;
      /** The top of a range, as in "about 25 to 30". Absent for a single figure. */
      readonly high: number | null;
    }
  | { readonly kind: 'no_appreciable_change' };

/** The practitioner's own estimate. It has nothing it was calculated from. */
export type TypedFigure = FigureValue & { readonly source: 'typed'; readonly basis: null };

/** Arithmetic on two recorded assessments, which it names. */
export type CalculatedFigure = FigureValue & {
  readonly source: 'calculated';
  readonly basis: Basis;
};

/**
 * A figure on the page of what has changed. Where it came from and what it
 * was calculated from are one fact, held by the type: a typed figure has no
 * basis and a calculated one always has.
 */
export type ChangeFigure = TypedFigure | CalculatedFigure;

/**
 * A headline at the top of the page: a figure, and her words for what it is.
 * Always hers. A headline such as an overall change is no row of the table
 * and nothing it could be calculated from.
 */
export type Tile = { readonly figure: TypedFigure; readonly caption: Bilingual };

export type Pair = { readonly earlier: FigureRef | null; readonly later: FigureRef | null };

export type ChangeRow = {
  readonly position: number;
  readonly eyesOpen: ChangeFigure | null;
  readonly eyesClosed: ChangeFigure | null;
};

export type ChangeSection = {
  readonly tiles: Ordered<Tile>;
  readonly sessionsCompleted: {
    readonly count: number;
    /** Counted from the client's visits, or typed when some were elsewhere. */
    readonly source: 'gathered' | 'typed';
  } | null;
  readonly pairs: Readonly<Record<Condition, Pair>>;
  /** The rows she chose to show, by measure. */
  readonly table: Readonly<Partial<Record<MeasureId, ChangeRow>>>;
  readonly summary: BilingualRich;
};

export type FollowUpBand = { readonly change: BandChange | null; readonly regions: Regions };

export type FollowUpScore = Score & {
  /** The score this dimension had in the earlier report, brought forward. */
  readonly earlierScore: number | null;
};

export type QeegFollowUp = QeegCommon & {
  readonly edition: 'follow-up';
  /** A follow-up is never the first. */
  readonly stage: 'follow_up' | 'final';
  /**
   * Always written in this app. The old tool offered only the first report's
   * lists, so nothing it wrote is a follow-up, whatever it was called; and a
   * past record is frozen, so none is ever turned into one.
   */
  readonly provenance: { readonly origin: 'app' };
  readonly comparedWith: ComparedWith;
  readonly bands: Readonly<Record<BandId, FollowUpBand>>;
  readonly connectivity: Readonly<
    Record<
      ConnectivityId,
      { readonly change: ConnectivityChange | null; readonly regions: Regions }
    >
  >;
  readonly dashboard: Readonly<Record<DimensionId, FollowUpScore>>;
  readonly change: ChangeSection;
  readonly plan: { readonly sessions: number | null; readonly next: NextStageId | null };
};

export type QeegContent = QeegInitial | QeegFollowUp;

/** Something a report still needs before it can be signed. Names, never words. */
export type Missing = {
  /** Which part of the form it is in, by the key of its heading in the wording. */
  readonly section: string;
  /** What is missing, by a key of its own. */
  readonly what: string;
};
