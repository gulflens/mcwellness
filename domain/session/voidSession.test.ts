import { describe, expect, it } from 'vitest';
import { OFFICE_ROLES } from '@domain/shared';
import {
  canVoidRecordedSession,
  isVoidableRow,
  type VoidRecordedSessionInput,
} from './voidSession';

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

describe('isVoidableRow', () => {
  const row = {
    status: 'completed',
    recordedFrom: 'records' as 'device' | 'records' | null,
    sessionId: '00000000-0000-4000-8000-000000000001' as string | null,
  };

  it('offers a void on a completed visit logged from the records', () => {
    expect(isVoidableRow(row)).toBe(true);
  });

  it('offers none on a visit closed on the phone, one with no session, or one not completed', () => {
    expect(isVoidableRow({ ...row, recordedFrom: 'device' })).toBe(false);
    expect(isVoidableRow({ ...row, recordedFrom: null })).toBe(false);
    expect(isVoidableRow({ ...row, sessionId: null })).toBe(false);
    for (const status of ['voided', 'confirmed', 'proposed', 'no_show', 'cancelled']) {
      expect(isVoidableRow({ ...row, status })).toBe(false);
    }
  });
});

describe('the office roles', () => {
  it('are the three the void admits, named once in domain/shared', () => {
    for (const role of OFFICE_ROLES) {
      expect(canVoidRecordedSession(input({ actorRoles: [role] }))).toEqual({ ok: true });
    }
    expect([...OFFICE_ROLES]).toEqual(['owner', 'admin', 'lead_practitioner']);
  });
});
