/**
 * Phone notifications from the practice: who receives one, how often an
 * offer may go, what a message may say and what it carries (the push memo's
 * decisions 2 and 3, docs/OPERATOR/2026-09-17-push-notifications.md, answered
 * "as recommended" on 6 October 2026).
 *
 * - **Two kinds.** An announcement (practice news) goes to every adult portal
 *   login that has turned notifications on, because it is not advertising. An
 *   offer goes only to those whose marketing consent stands at the moment of
 *   sending. Never to a young person's own login, whatever the kind.
 * - **At most two offers a calendar month**, in the practice's own days. An
 *   announcement has no ceiling.
 * - **No medical claim**, in either kind: the announcements' own word check.
 * - **One press to stop**: every offer carries a stop, in words and as an
 *   action, leading to the switch on the portal.
 * - **Three push services and no others** — Apple's, Google's and Mozilla's,
 *   the vendor register's row — so the server never posts to an address a
 *   browser merely claimed was one.
 *
 * Pure: "today" is always an argument, decided by the caller in the
 * practice's time zone (.claude/rules/testing.md).
 */

import type { IsoDate } from '../shared';
import { announcementsVisibleTo, type AnnouncementViewer, type Bilingual } from './announcements';
import { wellnessWords } from './announcementWords';

export const PUSH_KINDS = ['announcement', 'offer'] as const;
export type PushKind = (typeof PUSH_KINDS)[number];

/** Decision 3: "at most two offers a month". A calendar month, in the practice's days. */
export const OFFERS_PER_MONTH = 2;

/** What a lock screen shows without cutting it short, in either language. */
export const PUSH_TITLE_MAX = 60;
export const PUSH_BODY_MAX = 240;

export type PushDraft = { kind: PushKind; title: Bilingual; body: Bilingual };

export type PushField = 'titleEn' | 'titleAr' | 'bodyEn' | 'bodyAr';
export type PushProblem = { field: PushField; code: 'empty' | 'too_long' | 'medical_word' };
export type PushWarning = { field: PushField; term: string };

/**
 * One portal login that has turned notifications on somewhere, as the
 * database finds it at the moment of sending: their contact rows (to tell a
 * young person's own login), how many devices, and the standing marketing
 * consent if there is one. A withdrawn consent is not a standing one, so a
 * withdrawal reaches this rule as `null` the moment it is made.
 */
export type PushCandidate = {
  userId: string;
  contacts: readonly AnnouncementViewer[];
  devices: number;
  marketingConsentId: string | null;
};

/**
 * One person a message goes to, with their consent standing at that moment —
 * what the record of the send keeps beside them.
 */
export type PushRecipient = {
  userId: string;
  devices: number;
  standing: 'on' | 'off';
  consentId: string | null;
};

const FIELDS: readonly [PushField, (draft: PushDraft) => string, number][] = [
  ['titleEn', (draft) => draft.title.en, PUSH_TITLE_MAX],
  ['titleAr', (draft) => draft.title.ar, PUSH_TITLE_MAX],
  ['bodyEn', (draft) => draft.body.en, PUSH_BODY_MAX],
  ['bodyAr', (draft) => draft.body.ar, PUSH_BODY_MAX],
];

/** Everything wrong with a message about to be sent, or nothing. */
export function checkPushMessage(draft: PushDraft): PushProblem[] {
  const problems: PushProblem[] = [];
  for (const [field, text, most] of FIELDS) {
    const trimmed = text(draft).trim();
    if (trimmed.length === 0) problems.push({ field, code: 'empty' });
    else if (trimmed.length > most) problems.push({ field, code: 'too_long' });
    else if (wellnessWords(trimmed).refused.length > 0) {
      problems.push({ field, code: 'medical_word' });
    }
  }
  return problems;
}

/** The ambiguous words (treat, patient, …) the writer confirms are not a medical claim. */
export function pushWarnings(draft: PushDraft): PushWarning[] {
  const warnings: PushWarning[] = [];
  for (const [field, text] of FIELDS) {
    for (const term of wellnessWords(text(draft)).warnings) warnings.push({ field, term });
  }
  return warnings;
}

/** Who a message of this kind goes to, in the order the database listed them. */
export function pushRecipients(
  candidates: readonly PushCandidate[],
  kind: PushKind,
  today: IsoDate,
): PushRecipient[] {
  const recipients: PushRecipient[] = [];
  for (const candidate of candidates) {
    if (candidate.devices <= 0) continue;
    // An adult of some household, and never a young person's own login on
    // any record — the announcements' rule, because it is the same person.
    if (!announcementsVisibleTo(candidate.contacts, today)) continue;
    const standing = candidate.marketingConsentId === null ? 'off' : 'on';
    if (kind === 'offer' && standing === 'off') continue;
    recipients.push({
      userId: candidate.userId,
      devices: candidate.devices,
      standing,
      consentId: candidate.marketingConsentId,
    });
  }
  return recipients;
}

export type PushReach = { people: number; devices: number };

/** How many each kind would reach today: what the Send screen shows before sending. */
export function pushAudience(
  candidates: readonly PushCandidate[],
  today: IsoDate,
): Record<PushKind, PushReach> {
  const reach = (kind: PushKind): PushReach => {
    const recipients = pushRecipients(candidates, kind, today);
    return {
      people: recipients.length,
      devices: recipients.reduce((sum, recipient) => sum + recipient.devices, 0),
    };
  };
  return { announcement: reach('announcement'), offer: reach('offer') };
}

/**
 * How many more offers may go this calendar month, given the practice days
 * the offers already sent went on. Never below nothing.
 */
export function offersLeft(offerDays: readonly IsoDate[], today: IsoDate): number {
  const month = today.slice(0, 7);
  const sent = offerDays.filter((day) => day.slice(0, 7) === month).length;
  return Math.max(0, OFFERS_PER_MONTH - sent);
}

/**
 * The three push services on the vendor register (docs/COMPLIANCE/
 * approved-vendors.md): Google's (Chrome, Android), Apple's (Safari, an
 * iPhone's home-screen portal) and Mozilla's (Firefox). A subscription
 * naming any other host is refused before it is stored, so the server only
 * ever posts to a service the register names — never to wherever a browser,
 * or somebody pretending to be one, said to.
 */
const PUSH_HOSTS: readonly ((host: string) => boolean)[] = [
  (host) => host === 'fcm.googleapis.com',
  (host) => host === 'web.push.apple.com' || host.endsWith('.push.apple.com'),
  (host) =>
    host === 'updates.push.services.mozilla.com' || host.endsWith('.push.services.mozilla.com'),
];

export function pushEndpointAllowed(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (url.port !== '' || url.username !== '' || url.password !== '') return false;
  const host = url.hostname.toLowerCase();
  return PUSH_HOSTS.some((allowed) => allowed(host));
}

/** The stop every offer carries in its own words (decision 3: "one press to stop"). */
export const OFFER_STOP_LINE: Bilingual = {
  en: 'To stop offers, turn the switch off under Agreements.',
  ar: 'لإيقاف العروض، أطفئ المفتاح ضمن الموافقات.',
};

/** The stop as an action on the notification itself, where the phone shows actions. */
export const OFFER_STOP_ACTION: Bilingual = { en: 'Stop offers', ar: 'إيقاف العروض' };

/** Where a notification opens, and where an offer's stop leads: the switch itself. */
export const PUSH_OPENS = '/portal';
export const OFFER_STOP_URL = '/portal/agreements#offers';

/**
 * What one device is sent, sealed before it leaves the server: one language,
 * the person's own. Nothing in it names anybody.
 */
export type PushPayload = {
  v: 1;
  kind: PushKind;
  lang: 'en' | 'ar';
  dir: 'ltr' | 'rtl';
  title: string;
  body: string;
  url: string;
  stopUrl: string | null;
  stopLabel: string | null;
};

export function pushPayload(draft: PushDraft, locale: 'en' | 'ar'): PushPayload {
  const body = draft.body[locale].trim();
  const offer = draft.kind === 'offer';
  return {
    v: 1,
    kind: draft.kind,
    lang: locale,
    dir: locale === 'ar' ? 'rtl' : 'ltr',
    title: draft.title[locale].trim(),
    body: offer ? `${body}\n${OFFER_STOP_LINE[locale]}` : body,
    url: PUSH_OPENS,
    stopUrl: offer ? OFFER_STOP_URL : null,
    stopLabel: offer ? OFFER_STOP_ACTION[locale] : null,
  };
}
