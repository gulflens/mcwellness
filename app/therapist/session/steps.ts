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

/** "Sleep last night: 6 to 8" — the before-and-after the summary shows. */
export type Delta = { key: string; label: string; before: number | null; after: number | null };

export function deltas(
  questions: readonly RatingQuestion[],
  before: Answers,
  after: Answers,
): Delta[] {
  return questions.map((question) => ({
    key: question.key,
    label: question.labelEn,
    before: before[question.key] ?? null,
    after: after[question.key] ?? null,
  }));
}
