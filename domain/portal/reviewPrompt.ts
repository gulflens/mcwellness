/**
 * When the portal may ask a household for a review
 * (docs/SPEC/client-portal.md section 5, rule 9; the owner's decision of
 * 16 September 2026 recorded in section 4, and
 * docs/superpowers/specs/2026-09-17-review-prompt-design.md).
 *
 * Two milestones and nothing else: a brain map, which is a completed visit
 * whose service carries the code below, and a finished package, which is a
 * purchase whose last credit has been used. Both are read off rows the portal
 * already reads and neither is stored.
 *
 * Three guards, each a decision the design note records. A milestone counts
 * only within ninety days of the practice's own today, so a history the office
 * logs from paper (trunk round 51) never raises a line for a visit from a year
 * ago. A household is asked once per milestone: an answered one is out. And
 * one line per client, the most recent milestone, so two never stack.
 *
 * Pure: "today" is always an argument (.claude/rules/testing.md).
 */

import type { IsoDate } from '../shared';
import { packageProgress, type ProgressEntitlement, type ProgressPurchase } from './packages';
import type { AppointmentStatus } from './visits';

/** How long after a milestone the line may still appear. */
export const REVIEW_PROMPT_DAYS = 90;

/**
 * The service code a brain-map visit carries. Restated here rather than
 * imported: `domain/accounting/posting.ts` holds the same word for the books
 * and belongs to another stream (docs/SPEC/OWNERSHIP.md rule 3); the seed's
 * catalogue is where both are true at once.
 */
export const BRAIN_MAP_SERVICE_CODE = 'brain-map';

export const REVIEW_MILESTONE_KINDS = ['brain_map', 'package_complete'] as const;
export type ReviewMilestoneKind = (typeof REVIEW_MILESTONE_KINDS)[number];

export type ReviewMilestone = {
  kind: ReviewMilestoneKind;
  /** The appointment, or the purchase. */
  id: string;
  clientId: string;
  /** The practice's day the milestone was reached. */
  reachedOn: IsoDate;
};

/** What the rule needs of a visit. */
export type ReviewVisit = {
  id: string;
  clientId: string;
  serviceCode: string;
  status: AppointmentStatus;
  date: IsoDate;
};

/** A credit, with the day it was used where it was. */
export type ReviewEntitlement = ProgressEntitlement & {
  clientId: string;
  consumedOn: IsoDate | null;
};

export type ReviewPurchase = ProgressPurchase & { clientId: string };

/** A milestone the household has already answered, either way. */
export type ReviewAnswer = { kind: ReviewMilestoneKind; id: string };

export type ReviewInput = {
  visits: readonly ReviewVisit[];
  purchases: readonly ReviewPurchase[];
  entitlements: readonly ReviewEntitlement[];
  answered: readonly ReviewAnswer[];
};

/** Whole days from one calendar day to another; negative when `to` is earlier. */
function daysFromTo(from: IsoDate, to: IsoDate): number {
  const utc = (day: IsoDate): number => {
    const [year, month, date] = day.split('-').map(Number);
    return Date.UTC(year ?? 0, (month ?? 1) - 1, date ?? 1);
  };
  return Math.round((utc(to) - utc(from)) / 86_400_000);
}

function inWindow(reachedOn: IsoDate, today: IsoDate): boolean {
  const age = daysFromTo(reachedOn, today);
  return age >= 0 && age <= REVIEW_PROMPT_DAYS;
}

const KIND_ORDER: Record<ReviewMilestoneKind, number> = { package_complete: 0, brain_map: 1 };

/**
 * Every milestone the household may be asked about today, at most one per
 * client. Stable: the same rows in any order give the same answer.
 */
export function reviewMilestones(input: ReviewInput, today: IsoDate): ReviewMilestone[] {
  const answered = new Set(input.answered.map((row) => `${row.kind}:${row.id}`));

  const maps: ReviewMilestone[] = input.visits
    .filter(
      (row) => row.status === 'completed' && row.serviceCode === BRAIN_MAP_SERVICE_CODE,
    )
    .map((row) => ({ kind: 'brain_map', id: row.id, clientId: row.clientId, reachedOn: row.date }));

  const finished: ReviewMilestone[] = [];
  for (const purchase of input.purchases) {
    const own = input.entitlements.filter((row) => row.clientId === purchase.clientId);
    const progress = packageProgress(purchase, own);
    if (progress.total === 0 || progress.used !== progress.total) continue;
    const lastUsed = own
      .filter(
        (row) =>
          row.packagePurchaseId === purchase.id &&
          row.status === 'consumed' &&
          row.consumedOn !== null,
      )
      .map((row) => row.consumedOn as IsoDate)
      .sort()
      .at(-1);
    if (lastUsed === undefined) continue;
    finished.push({
      kind: 'package_complete',
      id: purchase.id,
      clientId: purchase.clientId,
      reachedOn: lastUsed,
    });
  }

  const candidates = [...maps, ...finished]
    .filter((row) => inWindow(row.reachedOn, today))
    .filter((row) => !answered.has(`${row.kind}:${row.id}`))
    .sort(
      (a, b) =>
        a.clientId.localeCompare(b.clientId) ||
        b.reachedOn.localeCompare(a.reachedOn) ||
        KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
        a.id.localeCompare(b.id),
    );

  const chosen: ReviewMilestone[] = [];
  for (const row of candidates) {
    if (chosen.some((seen) => seen.clientId === row.clientId)) continue;
    chosen.push(row);
  }
  return chosen;
}
