import { describe, expect, it } from 'vitest';
import { STAFF_ROLES, canSuspend, isStaffRole } from './staff';

describe('the roles Settings › Team may grant', () => {
  it('are the four working roles, never ownership and never a household contact', () => {
    expect([...STAFF_ROLES]).toEqual(['admin', 'finance', 'practitioner', 'lead_practitioner']);
    expect(isStaffRole('owner')).toBe(false);
    expect(isStaffRole('client_contact')).toBe(false);
    expect(isStaffRole('lead_practitioner')).toBe(true);
  });
});

describe('suspending a sign-in', () => {
  it('is refused on your own row', () => {
    const me = '00000002-0000-4000-8000-000000000010';
    expect(canSuspend(me, me)).toBe(false);
    expect(canSuspend(me, '00000002-0000-4000-8000-000000000011')).toBe(true);
  });
});
