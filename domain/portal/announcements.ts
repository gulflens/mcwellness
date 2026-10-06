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
 *   their lengths, and no word of another kind of practice in any of the four
 *   (CLAUDE.md rule 1; decision 3, "no medical claim, ever").
 *
 * Pure: "today" is always an argument, decided by the caller in the
 * practice's own time zone (.claude/rules/testing.md).
 */

import type { IsoDate } from '../shared';
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
  | 'empty'
  | 'too_long'
  | 'medical_word'
  | 'before_from'
  | 'in_the_past';
export type AnnouncementProblem = { field: AnnouncementField; code: AnnouncementProblemCode };

/** One of the signed-in person's contact rows, with its client's date of birth. */
export type AnnouncementViewer = MoneyContact & MoneyClient;

/**
 * The words of another kind of practice, by stem, in English and in Arabic.
 *
 * **Restated, not imported.** The list is the brain-map report's
 * (`domain/reports/qeeg/testing/vocabulary.ts`), which is the reports
 * stream's and test-only; docs/SPEC/OWNERSHIP.md rule 3 forbids one module
 * importing another's `domain/`, so it is copied here word for word, and
 * `tests/portal/announcement-vocabulary.test.ts` fails the day the two drift.
 * It errs towards refusing: "a treat for the holiday" is refused for "treat",
 * and the practice rewords it.
 */
const ENGLISH_STEMS =
  /\b(patient|treat|therap|cure|symptom|clinic|diagnos|protocol|prescri|disorder|disease|medical|medicine|illness)/i;

const ARABIC_STEMS =
  /(مريض|مرضى|علاج|سريري|عيادة|أعراض|تشخيص|اضطراب|شفاء|دواء|طبي|يعالج|نعالج|تعالج|عولج|نفسي|انتكاس)/;

/** The one who works in another kind of practice, as a whole word (see the reports' list). */
const ARABIC_WHOLE_WORD = /(^|[^؀-ۿ])(ال|و|وال|لل|بال)?معالج(ك|ه|ها|ين|ون)?(?![؀-ۿ])/;

/** "طبيعي" (natural, normal) begins with the letters of "طبي" and is not it. */
const withoutNatural = (text: string): string => text.replaceAll('طبيع', '');

/** The stems, exported for the test that keeps them in step with the reports' list. */
export const ANNOUNCEMENT_VOCABULARY = Object.freeze({
  english: ENGLISH_STEMS,
  arabic: ARABIC_STEMS,
  arabicWholeWord: ARABIC_WHOLE_WORD,
});

/** Whether a text says a word of another kind of practice, in either language. */
export function speaksMedically(text: string): boolean {
  return (
    ENGLISH_STEMS.test(text) ||
    ARABIC_STEMS.test(withoutNatural(text)) ||
    ARABIC_WHOLE_WORD.test(text)
  );
}

export function isCurrentOn(announcement: AnnouncementRow, today: IsoDate): boolean {
  if (announcement.withdrawn) return false;
  // ISO days compare as strings.
  if (today < announcement.publishedOn) return false;
  if (announcement.visibleFrom !== null && today < announcement.visibleFrom) return false;
  if (announcement.visibleUntil !== null && today > announcement.visibleUntil) return false;
  return true;
}

export const ANNOUNCEMENT_STATES = ['current', 'scheduled', 'ended', 'withdrawn'] as const;
export type AnnouncementState = (typeof ANNOUNCEMENT_STATES)[number];

/**
 * What the practice's own list calls an announcement on a day: withdrawn;
 * scheduled, while its first day (or its publication) is still to come;
 * ended, once its last day has gone; and otherwise current, which is exactly
 * when `isCurrentOn` shows it to a household.
 */
export function announcementState(
  announcement: AnnouncementRow,
  today: IsoDate,
): AnnouncementState {
  if (announcement.withdrawn) return 'withdrawn';
  if (isCurrentOn(announcement, today)) return 'current';
  if (announcement.visibleUntil !== null && today > announcement.visibleUntil) return 'ended';
  return 'scheduled';
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

export function announcementsFor<T extends AnnouncementRow>(
  announcements: readonly T[],
  viewer: readonly AnnouncementViewer[],
  today: IsoDate,
): T[] {
  if (!announcementsVisibleTo(viewer, today)) return [];
  return announcements
    .filter((announcement) => isCurrentOn(announcement, today))
    .sort((a, b) => {
      const day = shownFrom(b).localeCompare(shownFrom(a));
      if (day !== 0) return day;
      const moment = Date.parse(b.publishedAt) - Date.parse(a.publishedAt);
      if (moment !== 0) return moment;
      return b.id.localeCompare(a.id);
    })
    .slice(0, ANNOUNCEMENTS_SHOWN);
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
  } else if (speaksMedically(trimmed)) {
    problems.push({ field, code: 'medical_word' });
  }
}

/** Everything wrong with an announcement about to be published, or nothing. */
export function checkAnnouncement(
  draft: AnnouncementDraft,
  today: IsoDate,
): AnnouncementProblem[] {
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
