/**
 * Phone notifications for events (the practice's list of 6 October 2026,
 * items 6 and 7; docs/OPERATOR/2026-10-15-event-notifications.md): a visit
 * booked, moved or called off and a report ready, to the household; a new
 * website enquiry, to the members of staff who can see Enquiries.
 *
 * - **Which change to a visit makes one.** Only a change the household can
 *   see: a `proposed` visit is one the practice has not put to them yet
 *   (visits.ts), so placing, moving or calling off a proposed visit says
 *   nothing. Confirming it says "booked". Moving a confirmed visit to a new
 *   start says "moved". Calling off a confirmed visit for the practice's own
 *   reason says "called off"; when the household called it off, or it could
 *   not go ahead at the door, they already know.
 * - **Who in a household.** A service message, not marketing: every adult
 *   portal login with a device, whatever their marketing consent, and never a
 *   young person's own login (the announcements' rule, `announcementsVisibleTo`).
 *   A report is told only to those who may read it on the portal: a legal
 *   guardian, or the person themselves once an adult (`reportsVisibleTo`).
 * - **Which members of staff.** Whoever `canActor` lets see Enquiries, and
 *   nobody else.
 * - **Nothing sensitive on a lock screen.** A visit carries its day and time in
 *   the practice's zone, in the UAE's formats, and nothing else: no
 *   practitioner, no address, no service. A report never says which kind (a
 *   brain map is about a person's own measurements). An enquiry never says who
 *   sent it. The functions that write the words are given nothing more, so
 *   they cannot say more.
 *
 * Pure: "today" and "now" are always arguments (.claude/rules/testing.md).
 */

import { canActor, displayFromIso, isoDateIn, ROLES, type IsoDate, type Role } from '../shared';
import { announcementsVisibleTo, type AnnouncementViewer } from './announcements';
import type { AppointmentStatus } from './visits';
import { reportsVisibleTo, type ReportClient, type ReportContact } from './reports';

export const PUSH_EVENT_KINDS = [
  'visit_booked',
  'visit_moved',
  'visit_called_off',
  'report_ready',
  'enquiry_new',
] as const;
export type PushEventKind = (typeof PUSH_EVENT_KINDS)[number];

export type VisitEventKind = 'visit_booked' | 'visit_moved' | 'visit_called_off';
export type HouseholdEventKind = VisitEventKind | 'report_ready';

const HOUSEHOLD_KINDS: readonly PushEventKind[] = [
  'visit_booked',
  'visit_moved',
  'visit_called_off',
  'report_ready',
];

export function isHouseholdEvent(kind: PushEventKind): kind is HouseholdEventKind {
  return HOUSEHOLD_KINDS.includes(kind);
}

/**
 * What happened to a visit, as much as the rule needs. `reason` is the
 * calendar's cancellation reason; restated as a string because
 * `domain/scheduling` is another stream's (docs/SPEC/OWNERSHIP.md rule 3).
 */
export type VisitChange =
  | { act: 'created'; status: AppointmentStatus }
  | { act: 'confirmed'; from: AppointmentStatus }
  | { act: 'moved'; from: AppointmentStatus; previousStart: Date; newStart: Date }
  | { act: 'cancelled'; from: AppointmentStatus; reason: string };

/** The reason the practice gives when it calls a visit off itself. */
const PRACTICE_CALLED_IT_OFF = 'practice_request';

export function visitEventFor(change: VisitChange): VisitEventKind | null {
  switch (change.act) {
    case 'created':
      return change.status === 'confirmed' ? 'visit_booked' : null;
    case 'confirmed':
      return change.from === 'proposed' ? 'visit_booked' : null;
    case 'moved':
      if (change.from !== 'confirmed') return null;
      return change.previousStart.getTime() === change.newStart.getTime() ? null : 'visit_moved';
    case 'cancelled':
      return change.from === 'confirmed' && change.reason === PRACTICE_CALLED_IT_OFF
        ? 'visit_called_off'
        : null;
  }
}

/**
 * One portal login of the visit's or the report's household, holding at least
 * one device, as the database finds it at the moment of sending: every
 * contact row they hold (to tell a young person's own login), and their own
 * contact row on this record (to tell who may read a report about it).
 */
export type HouseholdEventCandidate = {
  userId: string;
  devices: number;
  contacts: readonly AnnouncementViewer[];
  onThisRecord: ReportContact & ReportClient;
};

export type EventRecipient = { userId: string; devices: number };

export function householdEventRecipients(
  candidates: readonly HouseholdEventCandidate[],
  kind: PushEventKind,
  today: IsoDate,
): EventRecipient[] {
  if (!isHouseholdEvent(kind)) return [];
  const recipients: EventRecipient[] = [];
  for (const candidate of candidates) {
    if (candidate.devices <= 0) continue;
    if (!announcementsVisibleTo(candidate.contacts, today)) continue;
    if (
      kind === 'report_ready' &&
      !reportsVisibleTo(candidate.onThisRecord, candidate.onThisRecord, today)
    ) {
      continue;
    }
    recipients.push({ userId: candidate.userId, devices: candidate.devices });
  }
  return recipients;
}

/** One member of staff holding at least one device, with the roles they hold now. */
export type StaffEventCandidate = { userId: string; roles: readonly string[]; devices: number };

function knownRoles(roles: readonly string[]): Role[] {
  return roles.filter((role): role is Role => (ROLES as readonly string[]).includes(role));
}

/** Whether these roles may see Enquiries, and so be offered the console's switch. */
export function staffNotificationsOffered(roles: readonly string[], now: Date): boolean {
  return canActor(
    { userId: '', tenantId: '', roles: knownRoles(roles), capabilities: [] },
    { type: 'enquiry.list' },
    {},
    now,
  );
}

export function staffEventRecipients(
  candidates: readonly StaffEventCandidate[],
  kind: PushEventKind,
  now: Date,
): EventRecipient[] {
  if (kind !== 'enquiry_new') return [];
  return candidates
    .filter((candidate) => candidate.devices > 0)
    .filter((candidate) => staffNotificationsOffered(candidate.roles, now))
    .map((candidate) => ({ userId: candidate.userId, devices: candidate.devices }));
}

/** What the words of an event are written from, and nothing more. */
export type EventFacts =
  | { kind: VisitEventKind; startsAt: Date; timeZone: string }
  | { kind: 'report_ready' }
  | { kind: 'enquiry_new' };

export type EventMessage = { title: string; body: string };

const LTR_ISOLATE = '⁦';
const POP_ISOLATE = '⁩';

const clocks = new Map<string, Intl.DateTimeFormat>();
function clockIn(timeZone: string): Intl.DateTimeFormat {
  let clock = clocks.get(timeZone);
  if (!clock) {
    clock = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    clocks.set(timeZone, clock);
  }
  return clock;
}

/** `20/10/2026` and `09:30`, in the practice's zone (the UAE formats, round 48). */
function dayAndTime(at: Date, timeZone: string): { day: string; time: string } {
  const day = displayFromIso(isoDateIn(at, timeZone));
  // Some engines write midnight as 24:00 on a twenty-four hour clock.
  const time = clockIn(timeZone).format(at).replace(/^24:/, '00:');
  return { day, time };
}

const isolate = (text: string) => `${LTR_ISOLATE}${text}${POP_ISOLATE}`;

/**
 * The words, in one language. Staff messages are English only (the console
 * is), whatever language is asked for.
 */
export function eventMessage(facts: EventFacts, locale: 'en' | 'ar'): EventMessage {
  switch (facts.kind) {
    case 'visit_booked':
    case 'visit_moved':
    case 'visit_called_off': {
      const { day, time } = dayAndTime(facts.startsAt, facts.timeZone);
      if (locale === 'ar') {
        const when = `يوم ${isolate(day)} الساعة ${isolate(time)}`;
        if (facts.kind === 'visit_booked') {
          return { title: 'تم حجز الزيارة', body: `تم حجز زيارتكم ${when}.` };
        }
        if (facts.kind === 'visit_moved') {
          return { title: 'تم تغيير موعد الزيارة', body: `تم نقل زيارتكم إلى ${when}.` };
        }
        return { title: 'أُلغيت الزيارة', body: `ألغى المركز زيارتكم ${when}.` };
      }
      if (facts.kind === 'visit_booked') {
        return { title: 'Visit booked', body: `Your visit is booked for ${day} at ${time}.` };
      }
      if (facts.kind === 'visit_moved') {
        return { title: 'Visit moved', body: `Your visit has moved to ${day} at ${time}.` };
      }
      return {
        title: 'Visit called off',
        body: `The practice has called off your visit on ${day} at ${time}.`,
      };
    }
    case 'report_ready':
      return locale === 'ar'
        ? { title: 'تقرير جديد', body: 'يوجد تقرير جديد جاهز في بوابتكم.' }
        : { title: 'New report', body: 'A new report is ready in your portal.' };
    case 'enquiry_new':
      return { title: 'New website enquiry', body: 'Open Enquiries in the console to read it.' };
  }
}

/** Where pressing the notification leads: a screen of this app, never elsewhere. */
export const EVENT_OPENS: Readonly<Record<PushEventKind, string>> = {
  visit_booked: '/portal/visits',
  visit_moved: '/portal/visits',
  visit_called_off: '/portal/visits',
  report_ready: '/portal/reports',
  enquiry_new: '/admin/enquiries',
};

/**
 * What one device is sent for an event: the announcement's shape
 * (`PushPayload`) with the kind `event`, and never a stop — a service message
 * has none, and the person turns notifications off where they turned them on.
 */
export type EventPushPayload = {
  v: 1;
  kind: 'event';
  lang: 'en' | 'ar';
  dir: 'ltr' | 'rtl';
  title: string;
  body: string;
  url: string;
  stopUrl: null;
  stopLabel: null;
};

export function eventPayload(facts: EventFacts, locale: 'en' | 'ar'): EventPushPayload {
  const lang = facts.kind === 'enquiry_new' ? 'en' : locale;
  const message = eventMessage(facts, lang);
  return {
    v: 1,
    kind: 'event',
    lang,
    dir: lang === 'ar' ? 'rtl' : 'ltr',
    title: message.title,
    body: message.body,
    url: EVENT_OPENS[facts.kind],
    stopUrl: null,
    stopLabel: null,
  };
}
