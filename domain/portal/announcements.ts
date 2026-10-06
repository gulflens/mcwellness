/**
 * The practice's announcements on the household's home
 * (docs/SPEC/client-portal.md section 3.1 as amended 2026-10-06 and section 5,
 * rule 10; the push memo's decisions 3 and 4,
 * docs/OPERATOR/2026-09-17-push-notifications.md, answered "as recommended"
 * on 6 October 2026).
 *
 * Three rules and a check, all pure:
 *
 * - **Which are current on a day.** Published, not withdrawn, on or after its
 *   first day and on or before its last, where either was set. Never before
 *   the day it was published, whatever first day it names.
 * - **Who sees them.** Every adult of a household. Never a young person's own
 *   login (decision 3: "never to a young person's own login, whatever the
 *   kind"), which is `moneyVisibleTo`'s question asked of every record the
 *   person is a contact of: one record on which they are a minor's own login
 *   is enough to show nothing, because an announcement is about the person
 *   reading and not about a record.
 * - **What a household sees.** The current ones, newest first, at most three.
 *   Newest is the day it became visible (its first day, or the day it was
 *   published), then the moment it was published.
 * - **The wording check.** Both languages, a title and a body each, within
 *   their lengths, and no refused word in any of the four; the ambiguous
 *   words are named for the writer to confirm (`announcementWords.ts`;
 *   CLAUDE.md rule 1; decision 3, "no medical claim, ever").
 * - **A correction** replaces what it corrects at once, or on its own first
 *   day when that is still to come (`correctionTakesOverNow`).
 *
 * Pure: "today" is always an argument, decided by the caller in the
 * practice's own time zone (.claude/rules/testing.md).
 */

import type { IsoDate } from '../shared';
import { wellnessWords } from './announcementWords';
import { moneyVisibleTo, type MoneyClient, type MoneyContact } from './money';

/** How many a household's home shows at once. */
export const ANNOUNCEMENTS_SHOWN = 3;

/** The longest title, in either language. One line on a phone. */
export const ANNOUNCEMENT_TITLE_MAX = 80;

/** The longest body, in either language. A short paragraph, not a newsletter. */
export const ANNOUNCEMENT_BODY_MAX = 600;

export type Bilingual = { en: string; ar: string };

/** An announcement as the rules need it. */
export type AnnouncementRow = {
  id: string;
  title: Bilingual;
  body: Bilingual;
  /** The first day it shows, or null for "from the day it is published". */
  visibleFrom: IsoDate | null;
  /** The last day it shows, or null for "until it is withdrawn". */
  visibleUntil: IsoDate | null;
  /** The practice's day it was published. */
  publishedOn: IsoDate;
  /** The moment it was published, for the order within one day. */
  publishedAt: string;
  withdrawn: boolean;
  /** The announcement this one corrects, or null. */
  supersedesId: string | null;
};

/** What the wording check reads: what is about to be published. */
export type AnnouncementDraft = {
  title: Bilingual;
  body: Bilingual;
  visibleFrom: IsoDate | null;
  visibleUntil: IsoDate | null;
};

export type AnnouncementField = 'titleEn' | 'titleAr' | 'bodyEn' | 'bodyAr' | 'visibleUntil';
export type AnnouncementProblemCode =
  'empty' | 'too_long' | 'medical_word' | 'before_from' | 'in_the_past';
export type AnnouncementProblem = { field: AnnouncementField; code: AnnouncementProblemCode };

/** One of the signed-in person's contact rows, with its client's date of birth. */
export type AnnouncementViewer = MoneyContact & MoneyClient;

export function isCurrentOn(announcement: AnnouncementRow, today: IsoDate): boolean {
  if (announcement.withdrawn) return false;
  // ISO days compare as strings.
  if (today < announcement.publishedOn) return false;
  if (announcement.visibleFrom !== null && today < announcement.visibleFrom) return false;
  if (announcement.visibleUntil !== null && today > announcement.visibleUntil) return false;
  return true;
}

export function announcementsVisibleTo(
  viewer: readonly AnnouncementViewer[],
  today: IsoDate,
): boolean {
  if (viewer.length === 0) return false;
  return viewer.every((row) => moneyVisibleTo(row, row, today));
}

/** The day an announcement became visible: its first day, or its publication. */
function shownFrom(announcement: AnnouncementRow): IsoDate {
  const from = announcement.visibleFrom;
  return from !== null && from > announcement.publishedOn ? from : announcement.publishedOn;
}

/**
 * Whether a standing correction of this announcement has begun: published,
 * not withdrawn, and its first day come. From that day the correction is what
 * households read and this one is not (round 72's fix round, finding 2.3).
 */
function replacedOn(
  announcement: AnnouncementRow,
  all: readonly AnnouncementRow[],
  today: IsoDate,
): boolean {
  return all.some(
    (other) =>
      other.supersedesId === announcement.id && !other.withdrawn && shownFrom(other) <= today,
  );
}

/** Every announcement a household could be shown today, newest first, before the cap. */
function currentInOrder<T extends AnnouncementRow>(
  announcements: readonly T[],
  today: IsoDate,
): T[] {
  return announcements
    .filter(
      (announcement) =>
        isCurrentOn(announcement, today) && !replacedOn(announcement, announcements, today),
    )
    .sort((a, b) => {
      const day = shownFrom(b).localeCompare(shownFrom(a));
      if (day !== 0) return day;
      const moment = Date.parse(b.publishedAt) - Date.parse(a.publishedAt);
      if (moment !== 0) return moment;
      return b.id.localeCompare(a.id);
    });
}

export function announcementsFor<T extends AnnouncementRow>(
  announcements: readonly T[],
  viewer: readonly AnnouncementViewer[],
  today: IsoDate,
): T[] {
  if (!announcementsVisibleTo(viewer, today)) return [];
  return currentInOrder(announcements, today).slice(0, ANNOUNCEMENTS_SHOWN);
}

export const ANNOUNCEMENT_STATES = [
  'current',
  'current_not_shown',
  'scheduled',
  'ended',
  'replaced',
  'withdrawn',
] as const;
export type AnnouncementState = (typeof ANNOUNCEMENT_STATES)[number];

/**
 * What the practice's own list calls each announcement on a day, decided over
 * the whole list because two of the words depend on the others: `current` is
 * exactly what an adult household's home shows today (the newest three);
 * `current_not_shown` is current by its own days but beyond those three
 * (round 72's review, finding 4.2); `replaced` is one whose correction has
 * begun. Then `withdrawn`, `ended` once its last day has gone, and
 * `scheduled` while its first day (or its publication) is still to come.
 */
export function announcementStates(
  announcements: readonly AnnouncementRow[],
  today: IsoDate,
): Record<string, AnnouncementState> {
  const shown = new Set(
    currentInOrder(announcements, today)
      .slice(0, ANNOUNCEMENTS_SHOWN)
      .map((announcement) => announcement.id),
  );
  const states: Record<string, AnnouncementState> = {};
  for (const announcement of announcements) {
    let state: AnnouncementState;
    if (announcement.withdrawn) state = 'withdrawn';
    else if (replacedOn(announcement, announcements, today)) state = 'replaced';
    else if (shown.has(announcement.id)) state = 'current';
    else if (isCurrentOn(announcement, today)) state = 'current_not_shown';
    else if (announcement.visibleUntil !== null && today > announcement.visibleUntil)
      state = 'ended';
    else state = 'scheduled';
    states[announcement.id] = state;
  }
  return states;
}

/**
 * Whether publishing a correction withdraws the one it corrects at once: yes,
 * unless the correction names a first day still to come. Then the old one
 * stays standing and shown until that day, and from that day
 * `announcementsFor` shows the correction in its place (round 72's fix round,
 * finding 2.3). The simplest honest rule: households never see a gap, and
 * nothing waits on a job to run at midnight.
 */
export function correctionTakesOverNow(
  correction: Pick<AnnouncementDraft, 'visibleFrom'>,
  today: IsoDate,
): boolean {
  return correction.visibleFrom === null || correction.visibleFrom <= today;
}

function checkText(
  field: AnnouncementField,
  text: string,
  most: number,
  problems: AnnouncementProblem[],
): void {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    problems.push({ field, code: 'empty' });
  } else if (trimmed.length > most) {
    problems.push({ field, code: 'too_long' });
  } else if (wellnessWords(trimmed).refused.length > 0) {
    problems.push({ field, code: 'medical_word' });
  }
}

/** Everything wrong with an announcement about to be published, or nothing. */
export function checkAnnouncement(draft: AnnouncementDraft, today: IsoDate): AnnouncementProblem[] {
  const problems: AnnouncementProblem[] = [];
  checkText('titleEn', draft.title.en, ANNOUNCEMENT_TITLE_MAX, problems);
  checkText('titleAr', draft.title.ar, ANNOUNCEMENT_TITLE_MAX, problems);
  checkText('bodyEn', draft.body.en, ANNOUNCEMENT_BODY_MAX, problems);
  checkText('bodyAr', draft.body.ar, ANNOUNCEMENT_BODY_MAX, problems);
  if (draft.visibleUntil !== null) {
    if (draft.visibleFrom !== null && draft.visibleUntil < draft.visibleFrom) {
      problems.push({ field: 'visibleUntil', code: 'before_from' });
    } else if (draft.visibleUntil < today) {
      problems.push({ field: 'visibleUntil', code: 'in_the_past' });
    }
  }
  return problems;
}

/** An ambiguous word an announcement uses, which the writer confirms at preview. */
export type AnnouncementWarning = { field: AnnouncementField; term: string };

/** Every ambiguous word in the four texts, by field (`announcementWords.ts`). */
export function announcementWarnings(draft: AnnouncementDraft): AnnouncementWarning[] {
  const warnings: AnnouncementWarning[] = [];
  const texts: [AnnouncementField, string][] = [
    ['titleEn', draft.title.en],
    ['titleAr', draft.title.ar],
    ['bodyEn', draft.body.en],
    ['bodyAr', draft.body.ar],
  ];
  for (const [field, text] of texts) {
    for (const term of wellnessWords(text).warnings) warnings.push({ field, term });
  }
  return warnings;
}
