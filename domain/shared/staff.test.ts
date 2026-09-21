import { describe, expect, it } from 'vitest';
import {
  STAFF_ROLES,
  canGrantTo,
  canReactivate,
  canResetPassword,
  canSuspend,
  isStaffRole,
} from './staff';

describe('the roles Settings › Team may grant', () => {
  it('are the four working roles, never ownership and never a household contact', () => {
    expect([...STAFF_ROLES]).toEqual(['admin', 'finance', 'practitioner', 'lead_practitioner']);
    expect(isStaffRole('owner')).toBe(false);
    expect(isStaffRole('client_contact')).toBe(false);
    expect(isStaffRole('lead_practitioner')).toBe(true);
  });
});

describe('widening access', () => {
  it('is never your own to do', () => {
    const me = '00000002-0000-4000-8000-000000000010';
    expect(canGrantTo(me, me)).toBe(false);
    expect(canGrantTo(me, '00000002-0000-4000-8000-000000000011')).toBe(true);
  });
});

describe('an archived sign-in', () => {
  it('does not come back; a suspended one does', () => {
    expect(canReactivate('archived')).toBe(false);
    expect(canReactivate('suspended')).toBe(true);
    expect(canReactivate('active')).toBe(false);
  });
});

describe('suspending a sign-in', () => {
  it('is refused on your own row', () => {
    const me = '00000002-0000-4000-8000-000000000010';
    expect(canSuspend(me, me)).toBe(false);
    expect(canSuspend(me, '00000002-0000-4000-8000-000000000011')).toBe(true);
  });
});

describe('minting a temporary password', () => {
  it("is never an admin's to do for an owner, because the password is the sign-in", () => {
    expect(canResetPassword(['admin'], ['owner', 'lead_practitioner'])).toBe(false);
    expect(canResetPassword(['admin', 'lead_practitioner'], ['owner'])).toBe(false);
  });

  it("is an owner's for another owner, which is how a locked-out owner gets back in", () => {
    expect(canResetPassword(['owner'], ['owner'])).toBe(true);
  });

  it("is refused when the target's roles could not be read, so a blind check never permits", () => {
    expect(canResetPassword(['admin'], [])).toBe(false);
    expect(canResetPassword(['owner'], [])).toBe(false);
  });

  it("is an admin's and an owner's for everybody else", () => {
    expect(canResetPassword(['admin'], ['finance'])).toBe(true);
    expect(canResetPassword(['admin'], ['admin', 'practitioner'])).toBe(true);
    expect(canResetPassword(['owner'], ['practitioner'])).toBe(true);
  });
});
