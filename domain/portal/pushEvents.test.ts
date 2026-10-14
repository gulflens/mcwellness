import { describe, expect, it } from 'vitest';
import { PUSH_BODY_MAX, PUSH_TITLE_MAX } from './push';
import {
  PUSH_EVENT_KINDS,
  eventMessage,
  eventPayload,
  householdEventRecipients,
  staffEventRecipients,
  staffNotificationsOffered,
  visitEventFor,
  type EventFacts,
  type HouseholdEventCandidate,
  type StaffEventCandidate,
} from './pushEvents';

/**
 * Phone notifications for events (the practice's list, items 6 and 7): which
 * change to a visit makes one, who in a household receives it, which members
 * of staff hear of a new website enquiry, and what each says on a lock screen.
 *
 * Ids in the reserved shape; nothing here names a person.
 */

const TODAY = '2026-10-15';
const ZONE = 'Asia/Dubai';
/** 20 October 2026, 09:30 in Dubai (UTC+4, no daylight saving). */
const STARTS = new Date('2026-10-20T05:30:00Z');
const EARLIER = new Date('2026-10-19T05:30:00Z');

const USERS = {
  mother: '00000001-0000-4000-8000-0000000000f1',
  adult: '00000001-0000-4000-8000-0000000000f2',
  minor: '00000001-0000-4000-8000-0000000000f3',
  relative: '00000001-0000-4000-8000-0000000000f4',
  none: '00000001-0000-4000-8000-0000000000f5',
} as const;

const CHILD_DOB = '2014-09-05';

function household(overrides: Partial<HouseholdEventCandidate> = {}): HouseholdEventCandidate {
  return {
    userId: USERS.mother,
    devices: 1,
    contacts: [{ relationship: 'mother', dateOfBirth: CHILD_DOB }],
    onThisRecord: { relationship: 'mother', isLegalGuardian: true, dateOfBirth: CHILD_DOB },
    ...overrides,
  };
}

const MOTHER = household();
const ADULT_SELF = household({
  userId: USERS.adult,
  contacts: [{ relationship: 'self', dateOfBirth: '1990-01-01' }],
  onThisRecord: { relationship: 'self', isLegalGuardian: false, dateOfBirth: '1990-01-01' },
});
const MINOR_SELF = household({
  userId: USERS.minor,
  contacts: [{ relationship: 'self', dateOfBirth: CHILD_DOB }],
  onThisRecord: { relationship: 'self', isLegalGuardian: false, dateOfBirth: CHILD_DOB },
});
/** An adult relative on the child's record who is not a legal guardian. */
const RELATIVE = household({
  userId: USERS.relative,
  contacts: [{ relationship: 'grandparent', dateOfBirth: CHILD_DOB }],
  onThisRecord: { relationship: 'grandparent', isLegalGuardian: false, dateOfBirth: CHILD_DOB },
});
const NO_DEVICE = household({ userId: USERS.none, devices: 0 });

describe('visitEventFor', () => {
  it('says nothing when a visit is placed as proposed, because the household has not been told', () => {
    expect(visitEventFor({ act: 'created', status: 'proposed' })).toBeNull();
  });

  it('says a visit is booked when one is placed already confirmed', () => {
    expect(visitEventFor({ act: 'created', status: 'confirmed' })).toBe('visit_booked');
  });

  it('says a visit is booked when a proposed one is confirmed', () => {
    expect(visitEventFor({ act: 'confirmed', from: 'proposed' })).toBe('visit_booked');
  });

  it('says nothing for a confirmation from any other status', () => {
    expect(visitEventFor({ act: 'confirmed', from: 'confirmed' })).toBeNull();
    expect(visitEventFor({ act: 'confirmed', from: 'cancelled' })).toBeNull();
  });

  it('says a visit moved when a confirmed one gets a new time', () => {
    expect(
      visitEventFor({ act: 'moved', from: 'confirmed', previousStart: EARLIER, newStart: STARTS }),
    ).toBe('visit_moved');
  });

  it('says nothing when a proposed visit moves: nobody was told of the old time', () => {
    expect(
      visitEventFor({ act: 'moved', from: 'proposed', previousStart: EARLIER, newStart: STARTS }),
    ).toBeNull();
  });

  it('says nothing when a move keeps the same start', () => {
    expect(
      visitEventFor({
        act: 'moved',
        from: 'confirmed',
        previousStart: new Date(STARTS.getTime()),
        newStart: STARTS,
      }),
    ).toBeNull();
  });

  it('says a visit was called off when the practice calls off a confirmed one', () => {
    expect(visitEventFor({ act: 'cancelled', from: 'confirmed', reason: 'practice_request' })).toBe(
      'visit_called_off',
    );
  });

  it('says nothing when the household itself called the visit off', () => {
    expect(visitEventFor({ act: 'cancelled', from: 'confirmed', reason: 'client_request' })).toBe(
      null,
    );
  });

  it('says nothing when the visit could not go ahead at the door', () => {
    expect(
      visitEventFor({ act: 'cancelled', from: 'confirmed', reason: 'unfit_to_attend' }),
    ).toBeNull();
  });

  it('says nothing when the practice calls off a visit the household was never told of', () => {
    expect(
      visitEventFor({ act: 'cancelled', from: 'proposed', reason: 'practice_request' }),
    ).toBeNull();
  });
});

describe('householdEventRecipients', () => {
  const everyone = [MOTHER, ADULT_SELF, MINOR_SELF, RELATIVE, NO_DEVICE];

  it('sends a visit notice to every adult login with a device, never a young person’s own', () => {
    for (const kind of ['visit_booked', 'visit_moved', 'visit_called_off'] as const) {
      expect(householdEventRecipients(everyone, kind, TODAY).map((r) => r.userId)).toEqual([
        USERS.mother,
        USERS.adult,
        USERS.relative,
      ]);
    }
  });

  it('never sends to a login that is a young person’s own on any record', () => {
    const both = household({
      contacts: [
        { relationship: 'mother', dateOfBirth: CHILD_DOB },
        { relationship: 'self', dateOfBirth: CHILD_DOB },
      ],
    });
    expect(householdEventRecipients([both], 'visit_booked', TODAY)).toEqual([]);
  });

  it('tells only those who may read the report that one is ready: a guardian or an adult themselves', () => {
    expect(householdEventRecipients(everyone, 'report_ready', TODAY).map((r) => r.userId)).toEqual([
      USERS.mother,
      USERS.adult,
    ]);
  });

  it('carries how many devices each person has', () => {
    const two = household({ devices: 2 });
    expect(householdEventRecipients([two], 'visit_booked', TODAY)).toEqual([
      { userId: USERS.mother, devices: 2 },
    ]);
  });

  it('sends a staff event to no household at all', () => {
    expect(householdEventRecipients(everyone, 'enquiry_new', TODAY)).toEqual([]);
  });
});

describe('staffEventRecipients', () => {
  const NOW = new Date('2026-10-15T08:00:00Z');
  function staff(userId: string, roles: string[], devices = 1): StaffEventCandidate {
    return { userId, roles, devices };
  }

  it('tells a new website enquiry to whoever can see Enquiries, with a device', () => {
    const candidates = [
      staff('00000001-0000-4000-8000-0000000000d1', ['owner']),
      staff('00000001-0000-4000-8000-0000000000d2', ['admin']),
      staff('00000001-0000-4000-8000-0000000000d3', ['lead_practitioner']),
      staff('00000001-0000-4000-8000-0000000000d4', ['practitioner']),
      staff('00000001-0000-4000-8000-0000000000d5', ['finance']),
      staff('00000001-0000-4000-8000-0000000000d6', ['helper']),
      staff('00000001-0000-4000-8000-0000000000d7', ['client_contact']),
      staff('00000001-0000-4000-8000-0000000000d8', ['admin'], 0),
      staff('00000001-0000-4000-8000-0000000000d9', []),
    ];
    expect(staffEventRecipients(candidates, 'enquiry_new', NOW).map((r) => r.userId)).toEqual([
      '00000001-0000-4000-8000-0000000000d1',
      '00000001-0000-4000-8000-0000000000d2',
      '00000001-0000-4000-8000-0000000000d3',
    ]);
  });

  it('ignores a role name it does not know', () => {
    expect(
      staffEventRecipients(
        [staff('00000001-0000-4000-8000-0000000000da', ['superuser'])],
        'enquiry_new',
        NOW,
      ),
    ).toEqual([]);
  });

  it('sends a household event to no member of staff', () => {
    expect(
      staffEventRecipients(
        [staff('00000001-0000-4000-8000-0000000000d1', ['owner'])],
        'visit_booked',
        NOW,
      ),
    ).toEqual([]);
  });

  it('offers the console’s switch to the same people and nobody else', () => {
    expect(staffNotificationsOffered(['admin'], NOW)).toBe(true);
    expect(staffNotificationsOffered(['lead_practitioner'], NOW)).toBe(true);
    expect(staffNotificationsOffered(['practitioner'], NOW)).toBe(false);
    expect(staffNotificationsOffered(['client_contact'], NOW)).toBe(false);
  });
});

describe('eventMessage', () => {
  const visit = (kind: 'visit_booked' | 'visit_moved' | 'visit_called_off'): EventFacts => ({
    kind,
    startsAt: STARTS,
    timeZone: ZONE,
  });

  it('says a visit is booked with its day and time in the practice’s zone, in UAE formats', () => {
    expect(eventMessage(visit('visit_booked'), 'en')).toEqual({
      title: 'Visit booked',
      body: 'Your visit is booked for 20/10/2026 at 09:30.',
    });
  });

  it('says a visit moved, with its new day and time', () => {
    expect(eventMessage(visit('visit_moved'), 'en')).toEqual({
      title: 'Visit moved',
      body: 'Your visit has moved to 20/10/2026 at 09:30.',
    });
  });

  it('says a visit was called off, with the day and time it was for', () => {
    expect(eventMessage(visit('visit_called_off'), 'en')).toEqual({
      title: 'Visit called off',
      body: 'The practice has called off your visit on 20/10/2026 at 09:30.',
    });
  });

  it('writes the time on a twenty-four hour clock', () => {
    const evening = {
      kind: 'visit_booked',
      startsAt: new Date('2026-10-20T14:05:00Z'),
      timeZone: ZONE,
    } as const;
    expect(eventMessage(evening, 'en').body).toBe('Your visit is booked for 20/10/2026 at 18:05.');
    const midnight = {
      kind: 'visit_booked',
      startsAt: new Date('2026-10-19T20:00:00Z'),
      timeZone: ZONE,
    } as const;
    expect(eventMessage(midnight, 'en').body).toBe('Your visit is booked for 20/10/2026 at 00:00.');
  });

  it('keeps the day and time left to right inside an Arabic sentence', () => {
    const message = eventMessage(visit('visit_booked'), 'ar');
    expect(message.title).toBe('تم حجز الزيارة');
    expect(message.body).toBe('تم حجز زيارتكم يوم ⁦20/10/2026⁩ الساعة ⁦09:30⁩.');
  });

  it('says a report is ready and never which kind of report it is', () => {
    expect(eventMessage({ kind: 'report_ready' }, 'en')).toEqual({
      title: 'New report',
      body: 'A new report is ready in your portal.',
    });
    expect(eventMessage({ kind: 'report_ready' }, 'ar')).toEqual({
      title: 'تقرير جديد',
      body: 'يوجد تقرير جديد جاهز في بوابتكم.',
    });
  });

  it('says a website enquiry arrived and nothing about who sent it, in English', () => {
    expect(eventMessage({ kind: 'enquiry_new' }, 'ar')).toEqual({
      title: 'New website enquiry',
      body: 'Open Enquiries in the console to read it.',
    });
  });

  it('fits every message on a lock screen in both languages', () => {
    const all: EventFacts[] = [
      visit('visit_booked'),
      visit('visit_moved'),
      visit('visit_called_off'),
      { kind: 'report_ready' },
      { kind: 'enquiry_new' },
    ];
    for (const facts of all) {
      for (const locale of ['en', 'ar'] as const) {
        const message = eventMessage(facts, locale);
        expect(message.title.length).toBeGreaterThan(0);
        expect(message.title.length).toBeLessThanOrEqual(PUSH_TITLE_MAX);
        expect(message.body.length).toBeLessThanOrEqual(PUSH_BODY_MAX);
      }
    }
  });

  it('covers every kind', () => {
    expect(PUSH_EVENT_KINDS).toEqual([
      'visit_booked',
      'visit_moved',
      'visit_called_off',
      'report_ready',
      'enquiry_new',
    ]);
  });
});

describe('eventPayload', () => {
  it('opens the visits screen for a visit, in the person’s own language', () => {
    expect(
      eventPayload({ kind: 'visit_moved', startsAt: STARTS, timeZone: ZONE }, 'ar'),
    ).toMatchObject({
      v: 1,
      kind: 'event',
      lang: 'ar',
      dir: 'rtl',
      url: '/portal/visits',
      stopUrl: null,
      stopLabel: null,
    });
  });

  it('opens the reports screen for a report', () => {
    expect(eventPayload({ kind: 'report_ready' }, 'en')).toMatchObject({
      kind: 'event',
      lang: 'en',
      dir: 'ltr',
      url: '/portal/reports',
      title: 'New report',
    });
  });

  it('opens the console’s Enquiries for an enquiry, in English whatever the setting', () => {
    expect(eventPayload({ kind: 'enquiry_new' }, 'ar')).toMatchObject({
      kind: 'event',
      lang: 'en',
      dir: 'ltr',
      url: '/admin/enquiries',
    });
  });
});
