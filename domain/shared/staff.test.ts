import { describe, expect, it } from 'vitest';
import { STAFF_ROLES, canGrantTo, canReactivate, canSuspend, isStaffRole } from './staff';

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
