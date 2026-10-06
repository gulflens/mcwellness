import { describe, expect, it } from 'vitest';
import {
  ANNOUNCEMENT_BODY_MAX,
  ANNOUNCEMENT_TITLE_MAX,
  ANNOUNCEMENTS_SHOWN,
  announcementStates,
  announcementWarnings,
  correctionTakesOverNow,
  announcementsFor,
  announcementsVisibleTo,
  checkAnnouncement,
  isCurrentOn,
  type AnnouncementDraft,
  type AnnouncementRow,
} from './announcements';

/**
 * docs/SPEC/client-portal.md section 5, rule 10, and the push memo's decisions
 * 3 and 4 (docs/OPERATOR/2026-09-17-push-notifications.md).
 *
 * Ids in the reserved shape; nothing here names a person.
 */

const TODAY = '2026-10-06';

const IDS = {
  a: '00000001-0000-4000-8000-0000000000c1',
  b: '00000001-0000-4000-8000-0000000000c2',
  c: '00000001-0000-4000-8000-0000000000c3',
  d: '00000001-0000-4000-8000-0000000000c4',
} as const;

function row(overrides: Partial<AnnouncementRow> = {}): AnnouncementRow {
  return {
    id: IDS.a,
    title: { en: 'Closed for the holiday', ar: 'مغلق في العطلة' },
    body: {
      en: 'The studio is closed on Thursday and Friday. Home visits go ahead as booked.',
      ar: 'الاستوديو مغلق يومي الخميس والجمعة. تستمر الزيارات المنزلية كما هي محجوزة.',
    },
    visibleFrom: null,
    visibleUntil: null,
    publishedOn: '2026-10-01',
    publishedAt: '2026-10-01T08:00:00.000Z',
    withdrawn: false,
    supersedesId: null,
    ...overrides,
  };
}

function draft(overrides: Partial<AnnouncementDraft> = {}): AnnouncementDraft {
  const { title, body } = row();
  return { title, body, visibleFrom: null, visibleUntil: null, ...overrides };
}

const MOTHER = { relationship: 'mother', dateOfBirth: '2014-09-05' };
const ADULT_SELF = { relationship: 'self', dateOfBirth: '1990-01-01' };
const MINOR_SELF = { relationship: 'self', dateOfBirth: '2014-09-05' };

describe('isCurrentOn', () => {
  it('is current from the day it was published when no dates were set', () => {
    expect(isCurrentOn(row(), TODAY)).toBe(true);
    expect(isCurrentOn(row(), '2026-10-01')).toBe(true);
  });

  it('is not current before the day it was published', () => {
    expect(isCurrentOn(row(), '2026-09-30')).toBe(false);
  });

  it('is not current once it has been withdrawn', () => {
    expect(isCurrentOn(row({ withdrawn: true }), TODAY)).toBe(false);
  });

  it('waits for its first day when one was set', () => {
    const later = row({ visibleFrom: '2026-10-08' });
    expect(isCurrentOn(later, '2026-10-07')).toBe(false);
    expect(isCurrentOn(later, '2026-10-08')).toBe(true);
  });

  it('is current through its last day and not the day after', () => {
    const ending = row({ visibleUntil: '2026-10-06' });
    expect(isCurrentOn(ending, '2026-10-06')).toBe(true);
    expect(isCurrentOn(ending, '2026-10-07')).toBe(false);
  });

  it('never shows earlier than its publication, whatever first day it names', () => {
    expect(isCurrentOn(row({ visibleFrom: '2026-09-01' }), '2026-09-15')).toBe(false);
  });
});

describe('announcementsVisibleTo', () => {
  it('shows announcements to an adult of the household', () => {
    expect(announcementsVisibleTo([MOTHER], TODAY)).toBe(true);
    expect(announcementsVisibleTo([ADULT_SELF], TODAY)).toBe(true);
  });

  it("never shows them to a young person's own login", () => {
    expect(announcementsVisibleTo([MINOR_SELF], TODAY)).toBe(false);
  });

  it("shows none to a login that is a young person's own on any record", () => {
    expect(announcementsVisibleTo([MOTHER, MINOR_SELF], TODAY)).toBe(false);
  });

  it('treats a record with no date of birth as an adult’s', () => {
    expect(announcementsVisibleTo([{ relationship: 'self', dateOfBirth: null }], TODAY)).toBe(true);
  });

  it('shows none to somebody who is a contact of nobody', () => {
    expect(announcementsVisibleTo([], TODAY)).toBe(false);
  });

  it('turns on the eighteenth birthday, in the practice’s own day', () => {
    const turning = { relationship: 'self', dateOfBirth: '2008-10-06' };
    expect(announcementsVisibleTo([turning], '2026-10-05')).toBe(false);
    expect(announcementsVisibleTo([turning], '2026-10-06')).toBe(true);
  });
});

describe('announcementsFor', () => {
  it('shows a household the current announcements, newest first', () => {
    const older = row({ id: IDS.a, publishedOn: '2026-09-20', publishedAt: '2026-09-20T08:00Z' });
    const newer = row({ id: IDS.b, publishedOn: '2026-10-02', publishedAt: '2026-10-02T08:00Z' });
    expect(announcementsFor([older, newer], [MOTHER], TODAY).map((a) => a.id)).toEqual([
      IDS.b,
      IDS.a,
    ]);
  });

  it('dates a scheduled announcement from its first day, not from when it was written', () => {
    const scheduled = row({
      id: IDS.a,
      publishedOn: '2026-09-20',
      publishedAt: '2026-09-20T08:00Z',
      visibleFrom: '2026-10-05',
    });
    const written = row({ id: IDS.b, publishedOn: '2026-10-02', publishedAt: '2026-10-02T08:00Z' });
    expect(announcementsFor([written, scheduled], [MOTHER], TODAY).map((a) => a.id)).toEqual([
      IDS.a,
      IDS.b,
    ]);
  });

  it('breaks a tie on one day by the moment each was published', () => {
    const morning = row({ id: IDS.a, publishedAt: '2026-10-01T06:00:00.000Z' });
    const evening = row({ id: IDS.b, publishedAt: '2026-10-01T15:00:00.000Z' });
    expect(announcementsFor([morning, evening], [MOTHER], TODAY).map((a) => a.id)).toEqual([
      IDS.b,
      IDS.a,
    ]);
  });

  it(`shows at most ${ANNOUNCEMENTS_SHOWN}`, () => {
    const rows = [IDS.a, IDS.b, IDS.c, IDS.d].map((id, index) =>
      row({
        id,
        publishedOn: `2026-10-0${index + 1}`,
        publishedAt: `2026-10-0${index + 1}T08:00Z`,
      }),
    );
    const shown = announcementsFor(rows, [MOTHER], TODAY);
    expect(shown).toHaveLength(ANNOUNCEMENTS_SHOWN);
    expect(shown.map((a) => a.id)).toEqual([IDS.d, IDS.c, IDS.b]);
  });

  it('leaves out a withdrawn, an ended and a not-yet-begun announcement', () => {
    const rows = [
      row({ id: IDS.a, withdrawn: true }),
      row({ id: IDS.b, visibleUntil: '2026-10-05' }),
      row({ id: IDS.c, visibleFrom: '2026-10-07' }),
      row({ id: IDS.d }),
    ];
    expect(announcementsFor(rows, [MOTHER], TODAY).map((a) => a.id)).toEqual([IDS.d]);
  });

  it('shows nothing when there are none', () => {
    expect(announcementsFor([], [MOTHER], TODAY)).toEqual([]);
  });

  it("shows nothing to a young person's own login", () => {
    expect(announcementsFor([row()], [MINOR_SELF], TODAY)).toEqual([]);
  });
});

describe('checkAnnouncement', () => {
  it('accepts an announcement written in both languages', () => {
    expect(checkAnnouncement(draft(), TODAY)).toEqual([]);
  });

  it('refuses a title or a body left empty in either language', () => {
    const problems = checkAnnouncement(
      draft({ title: { en: '  ', ar: 'عنوان' }, body: { en: 'Body text.', ar: '' } }),
      TODAY,
    );
    expect(problems).toEqual([
      { field: 'titleEn', code: 'empty' },
      { field: 'bodyAr', code: 'empty' },
    ]);
  });

  it('refuses a title or a body longer than it may be, and never cuts it', () => {
    const problems = checkAnnouncement(
      draft({
        title: { en: 'a'.repeat(ANNOUNCEMENT_TITLE_MAX + 1), ar: 'عنوان' },
        body: { en: 'Body text.', ar: 'ب'.repeat(ANNOUNCEMENT_BODY_MAX + 1) },
      }),
      TODAY,
    );
    expect(problems).toEqual([
      { field: 'titleEn', code: 'too_long' },
      { field: 'bodyAr', code: 'too_long' },
    ]);
  });

  it('accepts a title and a body exactly as long as they may be', () => {
    expect(
      checkAnnouncement(
        draft({
          title: { en: 'a'.repeat(ANNOUNCEMENT_TITLE_MAX), ar: 'عنوان' },
          body: { en: 'b'.repeat(ANNOUNCEMENT_BODY_MAX), ar: 'نص' },
        }),
        TODAY,
      ),
    ).toEqual([]);
  });

  it('refuses a medical word in any of the four texts', () => {
    const problems = checkAnnouncement(
      draft({
        title: { en: 'New therapy hours', ar: 'ساعات جديدة' },
        body: { en: 'Same sessions.', ar: 'علاج في المنزل' },
      }),
      TODAY,
    );
    expect(problems).toEqual([
      { field: 'titleEn', code: 'medical_word' },
      { field: 'bodyAr', code: 'medical_word' },
    ]);
  });

  it('refuses a last day before the first', () => {
    expect(
      checkAnnouncement(draft({ visibleFrom: '2026-10-10', visibleUntil: '2026-10-09' }), TODAY),
    ).toEqual([{ field: 'visibleUntil', code: 'before_from' }]);
  });

  it('refuses a last day already gone', () => {
    expect(checkAnnouncement(draft({ visibleUntil: '2026-10-05' }), TODAY)).toEqual([
      { field: 'visibleUntil', code: 'in_the_past' },
    ]);
  });

  it('accepts a single day, and a last day of today', () => {
    expect(
      checkAnnouncement(draft({ visibleFrom: '2026-10-09', visibleUntil: '2026-10-09' }), TODAY),
    ).toEqual([]);
    expect(checkAnnouncement(draft({ visibleUntil: TODAY }), TODAY)).toEqual([]);
  });
});

describe('announcementStates', () => {
  it('names a standing announcement the home shows current', () => {
    expect(announcementStates([row()], TODAY)[IDS.a]).toBe('current');
  });

  it('names a fourth current one current but not shown, because three newer are', () => {
    const rows = [IDS.a, IDS.b, IDS.c, IDS.d].map((id, index) =>
      row({
        id,
        publishedOn: `2026-10-0${index + 1}`,
        publishedAt: `2026-10-0${index + 1}T08:00Z`,
      }),
    );
    const states = announcementStates(rows, TODAY);
    expect(states[IDS.a]).toBe('current_not_shown');
    expect([states[IDS.b], states[IDS.c], states[IDS.d]]).toEqual([
      'current',
      'current',
      'current',
    ]);
  });

  it('names one whose first day has not come scheduled', () => {
    expect(announcementStates([row({ visibleFrom: '2026-10-08' })], TODAY)[IDS.a]).toBe(
      'scheduled',
    );
  });

  it('names one whose last day has gone ended', () => {
    expect(announcementStates([row({ visibleUntil: '2026-10-05' })], TODAY)[IDS.a]).toBe('ended');
  });

  it('names a withdrawn one withdrawn, whatever its days say', () => {
    expect(
      announcementStates([row({ withdrawn: true, visibleFrom: '2026-10-08' })], TODAY)[IDS.a],
    ).toBe('withdrawn');
  });

  it('names one whose correction has begun replaced, and one whose correction waits current', () => {
    const begun = announcementStates(
      [row({ id: IDS.a }), row({ id: IDS.b, supersedesId: IDS.a, visibleFrom: '2026-10-05' })],
      TODAY,
    );
    expect(begun[IDS.a]).toBe('replaced');
    expect(begun[IDS.b]).toBe('current');
    const waiting = announcementStates(
      [row({ id: IDS.a }), row({ id: IDS.b, supersedesId: IDS.a, visibleFrom: '2026-10-09' })],
      TODAY,
    );
    expect(waiting[IDS.a]).toBe('current');
    expect(waiting[IDS.b]).toBe('scheduled');
  });
});

describe('a correction with a first day still to come', () => {
  it('takes over at once when it has no first day, or its first day has come', () => {
    expect(correctionTakesOverNow({ visibleFrom: null }, TODAY)).toBe(true);
    expect(correctionTakesOverNow({ visibleFrom: TODAY }, TODAY)).toBe(true);
    expect(correctionTakesOverNow({ visibleFrom: '2026-10-09' }, TODAY)).toBe(false);
  });

  it('leaves the old one shown until its first day, and hides it from that day', () => {
    const rows = [
      row({ id: IDS.a }),
      row({ id: IDS.b, supersedesId: IDS.a, visibleFrom: '2026-10-09', publishedOn: TODAY }),
    ];
    expect(announcementsFor(rows, [MOTHER], '2026-10-08').map((a) => a.id)).toEqual([IDS.a]);
    expect(announcementsFor(rows, [MOTHER], '2026-10-09').map((a) => a.id)).toEqual([IDS.b]);
  });

  it('leaves the old one shown when its waiting correction is withdrawn', () => {
    const rows = [
      row({ id: IDS.a }),
      row({ id: IDS.b, supersedesId: IDS.a, visibleFrom: '2026-10-09', withdrawn: true }),
    ];
    expect(announcementsFor(rows, [MOTHER], '2026-10-10').map((a) => a.id)).toEqual([IDS.a]);
  });
});

describe('announcementWarnings', () => {
  it('names each ambiguous word and the field it is in, for the writer to confirm', () => {
    expect(
      announcementWarnings(
        draft({
          title: { en: 'A treat for Eid', ar: 'هدية العيد' },
          body: { en: 'Thank you for being patient.', ar: 'من أجل راحتك النفسية.' },
        }),
      ),
    ).toEqual([
      { field: 'titleEn', term: 'treat' },
      { field: 'bodyEn', term: 'patient' },
      { field: 'bodyAr', term: 'نفسي' },
    ]);
  });

  it('names nothing in ordinary practice news', () => {
    expect(announcementWarnings(draft())).toEqual([]);
  });
});
