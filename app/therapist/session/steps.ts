import type { ChecklistItem, RatingQuestion } from '../../api/sessions/schema';

/**
 * The shapes the five step screens pass between themselves and the runner
 * (docs/SPEC/session-capture.md sections 3.2 to 3.6). Kept apart from the
 * components so each step file is one screen and nothing else.
 */

/** What a service asks. Empty is a real answer: a practice may set neither. */
export type ServiceSettings = {
  preflightChecklist: readonly ChecklistItem[];
  ratingQuestions: readonly RatingQuestion[];
};

export type GeoPoint = { lat: number; lng: number };

/**
 * Whether the household has agreed to photographs. Three answers, not two:
 * a visit resumed with no signal cannot ask, and telling the practitioner
 * the household refused when nobody has been asked is a lie about a person.
 */
export type PhotoConsent = 'given' | 'refused' | 'unknown';

/**
 * What became of the setup photograph on this device, for the one line the
 * post step shows about it. Never an alarm: a picture waiting to sync is the
 * ordinary case in a living room with no signal.
 */
export type PhotoState =
  | { kind: 'none' }
  | { kind: 'preparing' }
  | { kind: 'kept'; sizeBytes: number }
  | { kind: 'failed' };

export type SiteReading = { site: string; quality: number };

/** A reading typed off the amplifier's own software (section 3.3, section 3.4). */
export type Reading = { artefactPercent: number; timeInRewardPercent: number };

export type Observations = {
  chips: readonly string[];
  tolerance: number | null;
  engagement: number | null;
  note: string;
};

export type VisitActuals = {
  parkingCostFils: number;
  salikCrossings: number;
  accessIssues: string;
};

/** Answers as the sliders hold them, keyed by question. */
export type Answers = Record<string, number>;

/** Where a slider sits before anybody moves it. */
export function midpoint(question: { min: number; max: number }): number {
  return Math.round((question.min + question.max) / 2);
}

/**
 * The answers a set of questions starts with: the value each slider is
 * actually showing. Seeded rather than left empty so the summary and the
 * record cannot disagree — a slider nobody moved still files its midpoint,
 * and the summary must say the same number rather than "not asked".
 */
export function seedAnswers(questions: readonly RatingQuestion[]): Answers {
  return Object.fromEntries(questions.map((question) => [question.key, midpoint(question)]));
}

/** "Sleep last night: 6 to 8" — the before-and-after the summary shows. */
export type Delta = { key: string; label: string; labelAr: string; before: number; after: number };

export function deltas(
  questions: readonly RatingQuestion[],
  before: Answers,
  after: Answers,
): Delta[] {
  return questions.map((question) => ({
    key: question.key,
    label: question.labelEn,
    labelAr: question.labelAr,
    // The slider's own value when nobody moved it, which is what was filed.
    before: before[question.key] ?? midpoint(question),
    after: after[question.key] ?? midpoint(question),
  }));
}
