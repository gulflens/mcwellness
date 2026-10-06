import { describe, expect, it } from 'vitest';
import {
  OFFERS_PER_MONTH,
  PUSH_BODY_MAX,
  PUSH_TITLE_MAX,
  checkPushMessage,
  offersLeft,
  pushAudience,
  pushEndpointAllowed,
  pushPayload,
  pushRecipients,
  pushWarnings,
  type PushCandidate,
  type PushDraft,
} from './push';

/**
 * Who receives a phone notification, how often an offer may go, and what it
 * carries (the push memo's decisions 2 and 3,
 * docs/OPERATOR/2026-09-17-push-notifications.md, answered "as recommended" on
 * 6 October 2026).
 *
 * Ids in the reserved shape; nothing here names a person.
 */

const TODAY = '2026-10-06';

const MOTHER = { relationship: 'mother', dateOfBirth: '2014-09-05' };
const ADULT_SELF = { relationship: 'self', dateOfBirth: '1990-01-01' };
const MINOR_SELF = { relationship: 'self', dateOfBirth: '2014-09-05' };

const USERS = {
  mother: '00000001-0000-4000-8000-0000000000e1',
  adult: '00000001-0000-4000-8000-0000000000e2',
  minor: '00000001-0000-4000-8000-0000000000e3',
  quiet: '00000001-0000-4000-8000-0000000000e4',
  nobody: '00000001-0000-4000-8000-0000000000e5',
} as const;
const CONSENT = '00000001-0000-4000-8000-0000000000e9';

function candidate(overrides: Partial<PushCandidate> = {}): PushCandidate {
  return {
    userId: USERS.mother,
    contacts: [MOTHER],
    devices: 1,
    marketingConsentId: null,
    ...overrides,
  };
}

const EVERYONE: PushCandidate[] = [
  candidate({ userId: USERS.mother, devices: 2, marketingConsentId: CONSENT }),
  candidate({ userId: USERS.adult, contacts: [ADULT_SELF] }),
  candidate({ userId: USERS.minor, contacts: [MINOR_SELF], marketingConsentId: CONSENT }),
  candidate({ userId: USERS.quiet, devices: 0, marketingConsentId: CONSENT }),
  candidate({ userId: USERS.nobody, contacts: [] }),
];

function draft(overrides: Partial<PushDraft> = {}): PushDraft {
  return {
    kind: 'announcement',
    title: { en: 'Closed for the holiday', ar: 'مغلق في العطلة' },
    body: {
      en: 'The studio is closed on Thursday. Home visits go ahead as booked.',
      ar: 'الاستوديو مغلق يوم الخميس. تستمر الزيارات المنزلية كما هي محجوزة.',
    },
    ...overrides,
  };
}

describe('pushRecipients', () => {
  it('sends an announcement to every adult portal login with a device', () => {
    expect(pushRecipients(EVERYONE, 'announcement', TODAY)).toEqual([
      { userId: USERS.mother, devices: 2, standing: 'on', consentId: CONSENT },
      { userId: USERS.adult, devices: 1, standing: 'off', consentId: null },
    ]);
  });

  it('sends an offer only to those whose marketing consent stands', () => {
    expect(pushRecipients(EVERYONE, 'offer', TODAY)).toEqual([
      { userId: USERS.mother, devices: 2, standing: 'on', consentId: CONSENT },
    ]);
  });

  it("never sends to a young person's own login, whatever the kind and whatever stands", () => {
    for (const kind of ['announcement', 'offer'] as const) {
      expect(pushRecipients(EVERYONE, kind, TODAY).map((r) => r.userId)).not.toContain(USERS.minor);
    }
  });

  it("never sends to a parent who is also a young person's own login elsewhere", () => {
    const both = candidate({ contacts: [MOTHER, MINOR_SELF], marketingConsentId: CONSENT });
    expect(pushRecipients([both], 'announcement', TODAY)).toEqual([]);
  });

  it('leaves out a withdrawn consent at once: a withdrawal arrives as no standing consent', () => {
    const withdrawn = candidate({ marketingConsentId: null });
    expect(pushRecipients([withdrawn], 'offer', TODAY)).toEqual([]);
    expect(pushRecipients([withdrawn], 'announcement', TODAY)).toEqual([
      { userId: USERS.mother, devices: 1, standing: 'off', consentId: null },
    ]);
  });

  it('leaves out a login with no device, and a login that is nobody’s contact', () => {
    const ids = pushRecipients(EVERYONE, 'announcement', TODAY).map((r) => r.userId);
    expect(ids).not.toContain(USERS.quiet);
    expect(ids).not.toContain(USERS.nobody);
  });
});

describe('pushAudience', () => {
  it('counts the people and the devices each kind would reach, before anything is sent', () => {
    expect(pushAudience(EVERYONE, TODAY)).toEqual({
      announcement: { people: 2, devices: 3 },
      offer: { people: 1, devices: 2 },
    });
  });

  it('counts nobody when nobody has turned notifications on', () => {
    expect(pushAudience([], TODAY)).toEqual({
      announcement: { people: 0, devices: 0 },
      offer: { people: 0, devices: 0 },
    });
  });
});

describe('offersLeft', () => {
  it('allows two offers a calendar month', () => {
    expect(OFFERS_PER_MONTH).toBe(2);
    expect(offersLeft([], TODAY)).toBe(2);
    expect(offersLeft(['2026-10-01'], TODAY)).toBe(1);
    expect(offersLeft(['2026-10-01', '2026-10-03'], TODAY)).toBe(0);
  });

  it('counts only this calendar month, in the practice’s own days', () => {
    expect(offersLeft(['2026-09-29', '2026-09-30'], TODAY)).toBe(2);
    expect(offersLeft(['2026-09-30', '2026-10-01'], TODAY)).toBe(1);
    expect(offersLeft(['2025-10-01', '2025-10-02'], TODAY)).toBe(2);
  });

  it('starts again on the first of the month', () => {
    expect(offersLeft(['2026-10-01', '2026-10-31'], '2026-10-31')).toBe(0);
    expect(offersLeft(['2026-10-01', '2026-10-31'], '2026-11-01')).toBe(2);
  });

  it('never answers below nothing, whatever the record holds', () => {
    expect(offersLeft(['2026-10-01', '2026-10-02', '2026-10-03'], TODAY)).toBe(0);
  });
});

describe('checkPushMessage', () => {
  it('passes a message in both languages within its lengths', () => {
    expect(checkPushMessage(draft())).toEqual([]);
  });

  it('wants all four texts', () => {
    expect(
      checkPushMessage(draft({ title: { en: ' ', ar: '' }, body: { en: '', ar: '\n' } })),
    ).toEqual([
      { field: 'titleEn', code: 'empty' },
      { field: 'titleAr', code: 'empty' },
      { field: 'bodyEn', code: 'empty' },
      { field: 'bodyAr', code: 'empty' },
    ]);
  });

  it('keeps a notification short enough to read on a lock screen', () => {
    const problems = checkPushMessage(
      draft({
        title: { en: 'x'.repeat(PUSH_TITLE_MAX + 1), ar: 'ع'.repeat(PUSH_TITLE_MAX) },
        body: { en: 'y'.repeat(PUSH_BODY_MAX), ar: 'ب'.repeat(PUSH_BODY_MAX + 1) },
      }),
    );
    expect(problems).toEqual([
      { field: 'titleEn', code: 'too_long' },
      { field: 'bodyAr', code: 'too_long' },
    ]);
  });

  it('applies the same wellness word check as an announcement, in either language', () => {
    expect(
      checkPushMessage(
        draft({
          kind: 'offer',
          body: { en: 'A discount on therapy sessions.', ar: 'خصم على جلسات العلاج.' },
        }),
      ),
    ).toEqual([
      { field: 'bodyEn', code: 'medical_word' },
      { field: 'bodyAr', code: 'medical_word' },
    ]);
  });

  it('names the ambiguous words the writer confirms before sending', () => {
    expect(pushWarnings(draft({ body: { en: 'Treat yourself this month.', ar: 'خبر' } }))).toEqual([
      { field: 'bodyEn', term: 'treat' },
    ]);
  });
});

describe('pushEndpointAllowed', () => {
  it('admits the three push services on the vendor register, over https', () => {
    for (const endpoint of [
      'https://fcm.googleapis.com/fcm/send/abc123',
      'https://web.push.apple.com/QGx1c3Q',
      'https://updates.push.services.mozilla.com/wpush/v2/gAAAA',
    ]) {
      expect(pushEndpointAllowed(endpoint), endpoint).toBe(true);
    }
  });

  it('refuses any other host, so the server never posts where a browser told it to', () => {
    for (const endpoint of [
      'https://wns2-par02p.notify.windows.com/w/?token=abc',
      'https://example.com/fcm.googleapis.com/x',
      'https://fcm.googleapis.com.example.com/x',
      'https://evil-push.apple.com.example.com/x',
      'https://127.0.0.1/x',
      'https://localhost/x',
    ]) {
      expect(pushEndpointAllowed(endpoint), endpoint).toBe(false);
    }
  });

  it('refuses plain http, a port, credentials and anything that is not an address', () => {
    for (const endpoint of [
      'http://fcm.googleapis.com/fcm/send/abc',
      'https://fcm.googleapis.com:8443/fcm/send/abc',
      'https://user:pw@fcm.googleapis.com/fcm/send/abc',
      'not a url',
      '',
    ]) {
      expect(pushEndpointAllowed(endpoint), endpoint).toBe(false);
    }
  });
});

describe('pushPayload', () => {
  it('carries an announcement in the person’s own language and opens the portal home', () => {
    expect(pushPayload(draft(), 'ar')).toEqual({
      v: 1,
      kind: 'announcement',
      lang: 'ar',
      dir: 'rtl',
      title: 'مغلق في العطلة',
      body: 'الاستوديو مغلق يوم الخميس. تستمر الزيارات المنزلية كما هي محجوزة.',
      url: '/portal',
      stopUrl: null,
    });
  });

  it('carries a stop in every offer, in words and as an action, leading to the switch', () => {
    const offer = pushPayload(draft({ kind: 'offer' }), 'en');
    expect(offer.stopUrl).toBe('/portal/agreements#offers');
    expect(offer.body.endsWith('To stop offers, turn the switch off under Agreements.')).toBe(true);
    const arabic = pushPayload(draft({ kind: 'offer' }), 'ar');
    expect(arabic.stopUrl).toBe('/portal/agreements#offers');
    expect(arabic.body.endsWith('لإيقاف العروض، أطفئ المفتاح ضمن الموافقات.')).toBe(true);
    expect(arabic.dir).toBe('rtl');
  });

  it('never carries a stop on an announcement, which needs no consent', () => {
    expect(pushPayload(draft(), 'en').body).not.toMatch(/stop/i);
  });
});
