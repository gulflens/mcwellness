/**
 * The marketing consent, given and withdrawn by an adult on their own portal
 * (the push memo's decision 1, docs/OPERATOR/2026-09-17-push-notifications.md,
 * answered "as recommended" on 6 October 2026; the wording is
 * docs/CONSENT/marketing.en.md and .ar.md, approved the same day).
 *
 * **It is the person's, not the record's.** The wording says "you, an adult,
 * on your own portal sign-in, and nobody else on your record", so whether
 * offers may reach somebody is a question about the person signed in. The
 * `consent` table files a row per client, so the switch files one row on each
 * record the person is a contact of, every one pointing at the wording they
 * read; the person's standing is read across all of them, and a withdrawal
 * withdraws every one at once (migration 706). This file is the rule over
 * those rows; the database writes them.
 *
 * Pure: "today" is always an argument, decided by the caller in the
 * practice's time zone (.claude/rules/testing.md).
 */

import type { IsoDate } from '../shared';
import { announcementsVisibleTo, type AnnouncementViewer } from './announcements';

/**
 * Whether the switch is offered to this person at all: an adult of some
 * household, and never a young person's own login — on any record, because
 * the switch is about the person and not about one record. The same question
 * the announcements ask (decision 3: "never to a young person's own login,
 * whatever the kind"), and `app.actor_reads_announcements` asks it beneath.
 */
export function marketingConsentOfferedTo(
  viewer: readonly AnnouncementViewer[],
  today: IsoDate,
): boolean {
  return announcementsVisibleTo(viewer, today);
}

/** One of the person's own marketing consent rows, on any record. */
export type MarketingConsentRow = {
  id: string;
  status: 'active' | 'withdrawn' | 'expired' | 'superseded';
  /** ISO instant. */
  givenAt: string;
  /** ISO instant, or null while it stands. */
  withdrawnAt: string | null;
  wordingId: string;
};

/**
 * Where the switch stands for this person: `on` while any row stands, `off`
 * once every row has been withdrawn (or has lapsed), `never` when nothing has
 * been given. `since` is the moment the switch took that position — the
 * latest giving of a standing row, or the latest withdrawal — and
 * `consentIds` the standing rows, which a send records beside each person.
 */
export type MarketingStanding = {
  state: 'on' | 'off' | 'never';
  since: string | null;
  consentIds: string[];
};

function latest(instants: readonly (string | null)[]): string | null {
  let found: string | null = null;
  for (const instant of instants) {
    if (instant !== null && (found === null || Date.parse(instant) > Date.parse(found))) {
      found = instant;
    }
  }
  return found;
}

export function marketingStanding(rows: readonly MarketingConsentRow[]): MarketingStanding {
  if (rows.length === 0) return { state: 'never', since: null, consentIds: [] };
  const standing = rows.filter((row) => row.status === 'active');
  if (standing.length > 0) {
    return {
      state: 'on',
      since: latest(standing.map((row) => row.givenAt)),
      consentIds: standing.map((row) => row.id),
    };
  }
  return { state: 'off', since: latest(rows.map((row) => row.withdrawnAt)), consentIds: [] };
}
