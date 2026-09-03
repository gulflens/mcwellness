import { describe, expect, it } from 'vitest';
import { canGiveConsent, type ConsentGiver } from './canGiveConsent';

const TODAY = '2026-09-03';

const guardian: ConsentGiver = {
  id: '00000000-0000-4000-8000-0000000000c1',
  canConsent: true,
  isLegalGuardian: true,
};
const consentingAdult: ConsentGiver = {
  id: '00000000-0000-4000-8000-0000000000c2',
  canConsent: true,
  isLegalGuardian: false,
};
const sibling: ConsentGiver = {
  id: '00000000-0000-4000-8000-0000000000c3',
  canConsent: false,
  isLegalGuardian: false,
};

const adult = { dateOfBirth: '1990-01-01' };
const child = { dateOfBirth: '2015-04-01' };
const ageUnknown = { dateOfBirth: null };

describe('canGiveConsent', () => {
  it('lets an adult client consent for themselves', () => {
    expect(canGiveConsent(adult, consentingAdult, 'participation', TODAY)).toEqual({ ok: true });
  });

  it('refuses any contact the practice has not marked as able to consent', () => {
    expect(canGiveConsent(adult, sibling, 'participation', TODAY)).toEqual({
      ok: false,
      reason: 'contact_may_not_consent',
    });
  });

  it("refuses a can-consent contact who is not the minor's legal guardian", () => {
    expect(canGiveConsent(child, consentingAdult, 'participation', TODAY)).toEqual({
      ok: false,
      reason: 'guardian_required',
    });
  });

  it("accepts a minor's legal guardian", () => {
    expect(canGiveConsent(child, guardian, 'minor_participation', TODAY)).toEqual({ ok: true });
    expect(canGiveConsent(child, guardian, 'home_visit', TODAY)).toEqual({ ok: true });
  });

  it('still wants a guardian for minor_participation once the client has turned eighteen', () => {
    // The row asserts a guardian gave it, and canActivate reads it that way,
    // so age alone must not open the door after a birthday.
    const eighteenToday = { dateOfBirth: '2008-09-03' };
    expect(canGiveConsent(eighteenToday, consentingAdult, 'minor_participation', TODAY)).toEqual({
      ok: false,
      reason: 'guardian_required',
    });
    expect(canGiveConsent(eighteenToday, guardian, 'minor_participation', TODAY)).toEqual({
      ok: true,
    });
  });

  it('lets a seventeen-year-old become an adult on their birthday', () => {
    const seventeen = { dateOfBirth: '2008-09-04' };
    expect(canGiveConsent(seventeen, consentingAdult, 'participation', TODAY)).toEqual({
      ok: false,
      reason: 'guardian_required',
    });
    expect(canGiveConsent(seventeen, consentingAdult, 'participation', '2026-09-04')).toEqual({
      ok: true,
    });
  });

  it('treats an unknown date of birth as not known to be a minor', () => {
    // requiredConsents reads the same field the same way; activation still
    // refuses the record for want of a date of birth.
    expect(canGiveConsent(ageUnknown, consentingAdult, 'participation', TODAY)).toEqual({
      ok: true,
    });
  });

  it('checks the flag before the guardian rule, so the plainer refusal is the one given', () => {
    expect(canGiveConsent(child, sibling, 'minor_participation', TODAY)).toEqual({
      ok: false,
      reason: 'contact_may_not_consent',
    });
  });

  it('asks nothing extra of the optional purposes for an adult', () => {
    for (const purpose of ['photo_video', 'research', 'marketing'] as const) {
      expect(canGiveConsent(adult, consentingAdult, purpose, TODAY)).toEqual({ ok: true });
    }
  });

  it("wants a guardian for a minor's optional purposes too", () => {
    expect(canGiveConsent(child, consentingAdult, 'photo_video', TODAY)).toEqual({
      ok: false,
      reason: 'guardian_required',
    });
  });
});
