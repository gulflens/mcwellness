/**
 * What a report is made of, and what it is never allowed to reach for
 * (docs/SPEC/reports-v1.md sections 3, 5 and 6).
 *
 * **Everything here is a snapshot.** The signer's name and authority, the
 * practice's identity, the figures quoted and the narrative all arrive as
 * values copied onto the row at the moment of issue. There is no tenant in
 * these types, no credential, no live table: a report issued in March must
 * still say who signed it in March and on what authority, five years on, and
 * the type is what enforces that rather than a comment asking the renderer to
 * behave.
 *
 * **Nothing here names an electrode site, a band threshold or a protocol.**
 * That is the practice's own intellectual property and it means nothing to a
 * household (section 5). A band *name* is admitted in one place only — the
 * ribbon's slice, where it is the hue the design brief reserves for exactly
 * that (docs/DESIGN-BRIEF.md sections 3.1 and 5) — and a threshold is not a
 * field on any type in this folder.
 *
 * Pure and browser-safe: types and small pure functions, no I/O, no clock.
 */

/** A calendar date as YYYY-MM-DD. Compares correctly as a string. */
export type IsoDate = string;

/** The two kinds this piece builds (section 1). */
export const REPORT_KINDS = ['session', 'progress'] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

/** Draft, then issued, and superseded when a later version replaces it (section 6). */
export const REPORT_STATUSES = ['draft', 'issued', 'superseded'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

/** Which language the practitioner's own narrative was written in (section 5). */
export const REPORT_LOCALES = ['en', 'ar'] as const;
export type ReportLocale = (typeof REPORT_LOCALES)[number];

/**
 * The five bands, slow to fast (docs/DESIGN-BRIEF.md section 3.1). Named here
 * rather than imported from `domain/session`, which is another module's
 * (docs/SPEC/OWNERSHIP.md rule 3); the list is the design brief's, not that
 * module's, and both read it from the same place.
 */
export const BAND_KEYS = ['delta', 'theta', 'alpha', 'beta', 'gamma'] as const;
export type BandKey = (typeof BAND_KEYS)[number];

/**
 * Who signed, as it was true at signing (section 3). Four values off the
 * credential row, copied, never a pointer back to it.
 */
export type SignerSnapshot = {
  name: string;
  certification: string;
  certifyingBody: string | null;
  certificateNumber: string | null;
};

/**
 * The practice as it was on the day (section 5's frame), stamped exactly as
 * `app.stamp_invoice_supplier` stamps an invoice.
 *
 * **No tax number** (section 10, decision 4). A report is not a tax document;
 * printing a registration number on a document that needs none is how a
 * corporate-tax number ends up read as a VAT number, which migration 905's own
 * comments exist to prevent. There is no field here for one, so there is no
 * branch that could print it.
 */
export type PracticeSnapshot = {
  legalName: string;
  legalNameAr: string | null;
  address: string | null;
  licenceNumber: string | null;
  licensingAuthority: string | null;
};

/** Who the report is about. A household, which is a private individual. */
export type ReportRecipient = {
  name: string;
  /** The record number a family can quote. Never an id from a URL. */
  recordNumber: string;
};

/** A rating question and the two answers either side of the visit. */
export type RatingPair = {
  /** The question's own key from `service_type.rating_questions`. */
  key: string;
  label: string;
  labelAr: string | null;
  /** 0 to 10, or null where the question was not answered on that side. */
  before: number | null;
  after: number | null;
};

/**
 * One slice of the ribbon (docs/DESIGN-BRIEF.md section 5): a completed
 * session, its height the visit's signal quality, its hue the dominant trained
 * band. A slice with no quality score renders at the floor rather than
 * vanishing, and a slice with no band renders in ink.
 */
export type RibbonSlice = {
  /** 1-based, in the order the sessions were delivered. */
  index: number;
  /** 0 to 1, or null where the visit recorded none. */
  quality: number | null;
  band: BandKey | null;
  /** True where a brain map was taken on or before this session and after the last one. */
  mapMark: boolean;
};

/** The whole figure: what has happened, and how much of the programme is left. */
export type Ribbon = {
  slices: readonly RibbonSlice[];
  /** Empty slices ahead. Never negative. */
  remaining: number;
};

/** One goal, and what the practitioner says has moved (section 5). */
export type GoalLine = {
  /** The goal as the household set it. */
  description: string;
  status: string;
  /** What has moved, in the practitioner's own words. May be empty while drafting. */
  movement: string;
};

/**
 * One paired figure from two brain maps, quoted as the comparison screen shows
 * it (docs/SPEC/assessment.md section 3.3): the earlier figure, the later
 * figure, the difference, and nothing else.
 *
 * **No word is attached to a figure.** Nothing here carries a band label, a
 * cut-off or an interpretation: the assessment spec refuses to store one and a
 * report may not invent one. `label` is the measurement's own name as the
 * equipment's software gave it.
 */
export type ComparisonLine = {
  label: string;
  labelAr: string | null;
  unit: string;
  earlier: number;
  later: number;
  /** `later - earlier`, computed once so two readers cannot disagree. */
  difference: number;
};

/**
 * The comparison between two brain maps, or nothing at all.
 *
 * The assessment table lives in another stream's range and may not be on this
 * database (section 6, no foreign key), so the absent case is the ordinary one
 * and it is an empty comparison rather than a missing section: the report then
 * says nothing about brain maps, which is honest, instead of leaving a heading
 * over a hole.
 */
export type BrainMapComparison = {
  instrument: string;
  earlierOn: IsoDate;
  laterOn: IsoDate;
  /** The two assessments the figures came from, so the pair can be found again. */
  earlierAssessmentId: string;
  laterAssessmentId: string;
  /** The age and sex the software's own reference comparison was made against. */
  referenceAgeYears: number | null;
  referenceSex: string | null;
  lines: readonly ComparisonLine[];
};

/** What a session report says (section 5). */
export type SessionReportContent = {
  kind: 'session';
  visitDate: IsoDate;
  serviceName: string;
  serviceNameAr: string | null;
  practitionerName: string;
  durationMinutes: number | null;
  /** The goal area worked on, in words. Never a protocol. */
  goalArea: string | null;
  ratings: readonly RatingPair[];
  /**
   * The structured observations as the practitioner left them: the chips they
   * ticked, in words, and how the visit was tolerated and engaged with.
   */
  observationChips: readonly string[];
  tolerance: number | null;
  engagement: number | null;
  /** The practitioner's short note. */
  note: string;
  /** What to expect before the next visit. */
  beforeNextVisit: string;
};

/** What a progress report says (section 5). */
export type ProgressReportContent = {
  kind: 'progress';
  coverageFrom: IsoDate;
  coverageTo: IsoDate;
  sessionsDelivered: number;
  sessionsEntitled: number;
  goals: readonly GoalLine[];
  ribbon: Ribbon;
  /** Empty where no second brain map exists, or where the table is not there. */
  comparison: BrainMapComparison | null;
  /** The practitioner's summary. */
  summary: string;
  /** What the practice suggests next. */
  suggestion: string;
};

export type ReportContent = SessionReportContent | ProgressReportContent;

/**
 * A report as the renderer receives it: the row's own snapshots and the
 * content it was rendered from, and nothing that could be read from a live
 * table. Re-rendering this produces the same bytes, which is what section 11's
 * byte-identical test proves.
 */
export type ReportDocument = {
  kind: ReportKind;
  /** The language the practitioner's narrative was written in. */
  locale: ReportLocale;
  practice: PracticeSnapshot;
  signer: SignerSnapshot;
  recipient: ReportRecipient;
  /** "RPT-000001". */
  reference: string;
  /** YYYY-MM-DD. */
  issuedOn: IsoDate;
  /** 1 for the first, 2 for the version that corrected it, and so on. */
  version: number;
  /** Why this version exists, on version 2 and after. */
  amendmentReason: string | null;
  content: ReportContent;
};
