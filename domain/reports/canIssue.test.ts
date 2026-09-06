import { describe, expect, it } from 'vitest';
import { canIssue, credentialValidOn, type SigningCredential } from './canIssue';

/**
 * Rule 1 (docs/SPEC/reports-v1.md sections 8 and 11): every branch, including
 * "a credential that lapsed the day before signing".
 *
 * The ids are the reserved synthetic shapes (.claude/rules/testing.md); no
 * person is named here at all, because the rule does not read a name.
 */

const PRACTITIONER = '00000000-0000-4000-8000-0000000000b9';
const OTHER_PRACTITIONER = '00000000-0000-4000-8000-0000000000ba';
const NEUROFEEDBACK = '00000000-0000-4000-8000-0000000000f1';
const BRAIN_MAP = '00000000-0000-4000-8000-0000000000f2';

function credential(over: Partial<SigningCredential> = {}): SigningCredential {
  return {
    practitionerId: PRACTITIONER,
    serviceTypeId: NEUROFEEDBACK,
    canSignReport: true,
    validFrom: '2024-01-01',
    validTo: null,
    ...over,
  };
}

describe('canIssue', () => {
  it('admits a valid signing credential and answers which one it was', () => {
    const signing = credential();
    const answer = canIssue([signing], { practitionerId: PRACTITIONER, on: '2026-09-06' });
    expect(answer).toEqual({ ok: true, credential: signing });
  });

  it('refuses a practitioner who holds no credential at all', () => {
    expect(canIssue([], { practitionerId: PRACTITIONER, on: '2026-09-06' })).toEqual({
      ok: false,
      code: 'no_credential',
    });
  });

  it('refuses a practitioner whose only credential is somebody else’s', () => {
    const theirs = credential({ practitionerId: OTHER_PRACTITIONER });
    expect(canIssue([theirs], { practitionerId: PRACTITIONER, on: '2026-09-06' })).toEqual({
      ok: false,
      code: 'no_credential',
    });
  });

  it('refuses a credential that does not carry can_sign_report', () => {
    expect(
      canIssue([credential({ canSignReport: false })], {
        practitionerId: PRACTITIONER,
        on: '2026-09-06',
      }),
    ).toEqual({ ok: false, code: 'credential_cannot_sign' });
  });

  it('refuses a credential that lapsed the day before signing', () => {
    // The case section 11 names by hand: valid to the fifth, signing on the sixth.
    expect(
      canIssue([credential({ validTo: '2026-09-05' })], {
        practitionerId: PRACTITIONER,
        on: '2026-09-06',
      }),
    ).toEqual({ ok: false, code: 'credential_lapsed' });
  });

  it('admits a credential on the last day it is valid', () => {
    const last = credential({ validTo: '2026-09-06' });
    expect(canIssue([last], { practitionerId: PRACTITIONER, on: '2026-09-06' })).toEqual({
      ok: true,
      credential: last,
    });
  });

  it('admits a credential on the first day it is valid', () => {
    const first = credential({ validFrom: '2026-09-06' });
    expect(canIssue([first], { practitionerId: PRACTITIONER, on: '2026-09-06' })).toEqual({
      ok: true,
      credential: first,
    });
  });

  it('tells a certificate that has not started apart from one that has run out', () => {
    expect(
      canIssue([credential({ validFrom: '2026-10-01' })], {
        practitionerId: PRACTITIONER,
        on: '2026-09-06',
      }),
    ).toEqual({ ok: false, code: 'credential_not_yet_valid' });
  });

  it('narrows to the service the report is about when one is named', () => {
    const forBrainMaps = credential({ serviceTypeId: BRAIN_MAP });
    expect(
      canIssue([forBrainMaps], {
        practitionerId: PRACTITIONER,
        serviceTypeId: NEUROFEEDBACK,
        on: '2026-09-06',
      }),
    ).toEqual({ ok: false, code: 'no_credential' });
    expect(
      canIssue([forBrainMaps], {
        practitionerId: PRACTITIONER,
        serviceTypeId: BRAIN_MAP,
        on: '2026-09-06',
      }),
    ).toEqual({ ok: true, credential: forBrainMaps });
  });

  it('takes any valid signing credential for a report that names no service', () => {
    // A progress report covers a whole programme and is about no one service.
    const forBrainMaps = credential({ serviceTypeId: BRAIN_MAP });
    expect(
      canIssue([forBrainMaps], {
        practitionerId: PRACTITIONER,
        serviceTypeId: null,
        on: '2026-09-06',
      }),
    ).toEqual({ ok: true, credential: forBrainMaps });
  });

  it('prefers the valid credential where a practitioner holds a lapsed one too', () => {
    const lapsed = credential({ serviceTypeId: BRAIN_MAP, validTo: '2025-06-30' });
    const live = credential();
    expect(canIssue([lapsed, live], { practitionerId: PRACTITIONER, on: '2026-09-06' })).toEqual({
      ok: true,
      credential: live,
    });
  });

  it('grants nothing to a role: an owner with no signing credential is refused', () => {
    // Section 10, decision 6. There is no role in this signature to grant it
    // with, which is the point; the founder signs because she holds the
    // certificate, not because she owns the practice.
    expect(
      canIssue([credential({ canSignReport: false })], {
        practitionerId: PRACTITIONER,
        on: '2026-09-06',
      }),
    ).toEqual({ ok: false, code: 'credential_cannot_sign' });
  });
});

describe('credentialValidOn', () => {
  it('never expires when there is no end date', () => {
    expect(credentialValidOn(credential({ validTo: null }), '2099-12-31')).toBe(true);
  });

  it('is closed at both ends', () => {
    const bounded = credential({ validFrom: '2026-01-01', validTo: '2026-12-31' });
    expect(credentialValidOn(bounded, '2025-12-31')).toBe(false);
    expect(credentialValidOn(bounded, '2026-01-01')).toBe(true);
    expect(credentialValidOn(bounded, '2026-12-31')).toBe(true);
    expect(credentialValidOn(bounded, '2027-01-01')).toBe(false);
  });
});
