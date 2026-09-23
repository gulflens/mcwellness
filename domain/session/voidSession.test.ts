import { describe, expect, it } from 'vitest';
import { canVoidRecordedSession, type VoidRecordedSessionInput } from './voidSession';

function input(overrides: Partial<VoidRecordedSessionInput> = {}): VoidRecordedSessionInput {
  return {
    actorRoles: ['owner'],
    session: { recordedFrom: 'records', status: 'completed', voidedAt: null },
    inUseBy: { assessments: 0, invoices: 0, exceptions: 0 },
    ...overrides,
  };
}

describe('canVoidRecordedSession', () => {
  it('lets the owner, an admin and the lead practitioner void a completed records visit nothing else names', () => {
    for (const role of ['owner', 'admin', 'lead_practitioner'] as const) {
      expect(canVoidRecordedSession(input({ actorRoles: [role] }))).toEqual({ ok: true });
    }
  });

  it('refuses a practitioner and finance the office action', () => {
    for (const role of ['practitioner', 'finance', 'client_contact']) {
      expect(canVoidRecordedSession(input({ actorRoles: [role] }))).toEqual({
        ok: false,
        reason: 'wrong_role',
      });
    }
  });

  it('refuses a visit closed on the phone', () => {
    expect(
      canVoidRecordedSession(
        input({ session: { recordedFrom: 'device', status: 'completed', voidedAt: null } }),
      ),
    ).toEqual({ ok: false, reason: 'not_a_records_row' });
  });

  it('refuses a visit that is not yet completed', () => {
    expect(
      canVoidRecordedSession(
        input({ session: { recordedFrom: 'records', status: 'scheduled', voidedAt: null } }),
      ),
    ).toEqual({ ok: false, reason: 'not_completed' });
  });

  it('refuses a visit already voided', () => {
    expect(
      canVoidRecordedSession(
        input({
          session: {
            recordedFrom: 'records',
            status: 'voided',
            voidedAt: '2026-09-20T10:00:00.000Z',
          },
        }),
      ),
    ).toEqual({ ok: false, reason: 'already_voided' });
  });

  it('refuses a visit an assessment still names', () => {
    expect(
      canVoidRecordedSession(input({ inUseBy: { assessments: 1, invoices: 0, exceptions: 0 } })),
    ).toEqual({ ok: false, reason: 'session_in_use' });
  });

  it('refuses a visit an invoice still names', () => {
    expect(
      canVoidRecordedSession(input({ inUseBy: { assessments: 0, invoices: 1, exceptions: 0 } })),
    ).toEqual({ ok: false, reason: 'session_in_use' });
  });

  it('refuses a visit a billing exception still names', () => {
    expect(
      canVoidRecordedSession(input({ inUseBy: { assessments: 0, invoices: 0, exceptions: 1 } })),
    ).toEqual({ ok: false, reason: 'session_in_use' });
  });

  it('checks role before every other reason', () => {
    expect(
      canVoidRecordedSession(
        input({
          actorRoles: ['finance'],
          session: {
            recordedFrom: 'device',
            status: 'voided',
            voidedAt: '2026-09-20T10:00:00.000Z',
          },
          inUseBy: { assessments: 1, invoices: 1, exceptions: 1 },
        }),
      ),
    ).toEqual({ ok: false, reason: 'wrong_role' });
  });
});
