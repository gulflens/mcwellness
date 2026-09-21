import { describe, expect, it } from 'vitest';
import {
  STAFF_ROLES,
  STAFF_ROLE_OPENS,
  canEditProfile,
  canGrantTo,
  canReactivate,
  canResetPassword,
  canSuspend,
  canSwitchRole,
  isLocked,
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
  it('is an owner’s and nobody else’s, because a password is the sign-in', () => {
    expect(canResetPassword(['owner'], ['finance'])).toBe(true);
    expect(canResetPassword(['owner'], ['owner'])).toBe(true);
    expect(canResetPassword(['admin'], ['finance'])).toBe(false);
    expect(canResetPassword(['admin', 'lead_practitioner'], ['practitioner'])).toBe(false);
    expect(canResetPassword(['admin'], ['owner'])).toBe(false);
  });

  it('is refused when the target’s roles could not be read, so a blind check never permits', () => {
    expect(canResetPassword(['owner'], [])).toBe(false);
  });
});

const A = '00000002-0000-4000-8000-000000000010';
const B = '00000002-0000-4000-8000-000000000011';

describe('a locked row', () => {
  it('is any row that holds ownership, whatever else it holds', () => {
    expect(isLocked(['owner'])).toBe(true);
    expect(isLocked(['finance', 'owner'])).toBe(true);
    expect(isLocked(['admin', 'lead_practitioner'])).toBe(false);
    expect(isLocked([])).toBe(false);
  });
});

describe('switching a role', () => {
  const base = { actorUserId: A, targetUserId: B, targetRoles: ['admin', 'finance'] as const };

  it('is allowed on and off for a colleague who keeps a role', () => {
    expect(canSwitchRole({ ...base, role: 'practitioner', on: true })).toBeNull();
    expect(canSwitchRole({ ...base, role: 'finance', on: false })).toBeNull();
  });

  it('never offers ownership or a household contact, in either direction', () => {
    expect(canSwitchRole({ ...base, role: 'owner', on: true })).toBe('not_a_working_role');
    expect(canSwitchRole({ ...base, role: 'client_contact', on: false })).toBe(
      'not_a_working_role',
    );
    expect(canSwitchRole({ ...base, role: 'nonsense', on: true })).toBe('not_a_working_role');
  });

  it('is never your own to do', () => {
    expect(canSwitchRole({ ...base, targetUserId: A, role: 'finance', on: false })).toBe(
      'not_yourself',
    );
  });

  it('is refused on an owner, whatever working roles sit beside ownership', () => {
    expect(
      canSwitchRole({ ...base, targetRoles: ['finance', 'owner'], role: 'finance', on: false }),
    ).toBe('locked');
    expect(canSwitchRole({ ...base, targetRoles: ['owner'], role: 'admin', on: true })).toBe(
      'locked',
    );
  });

  it('refuses to take the last working role, because suspending is how somebody is shut out', () => {
    expect(canSwitchRole({ ...base, targetRoles: ['finance'], role: 'finance', on: false })).toBe(
      'last_role',
    );
  });

  it('lets a role the person does not hold be switched off, which changes nothing', () => {
    expect(
      canSwitchRole({ ...base, targetRoles: ['finance'], role: 'admin', on: false }),
    ).toBeNull();
  });
});

describe('editing a profile', () => {
  it('is an owner’s, for anybody who is not an owner', () => {
    expect(
      canEditProfile({
        actorUserId: A,
        actorRoles: ['owner'],
        targetUserId: B,
        targetRoles: ['admin'],
      }),
    ).toBe(true);
    expect(
      canEditProfile({
        actorUserId: A,
        actorRoles: ['admin'],
        targetUserId: B,
        targetRoles: ['finance'],
      }),
    ).toBe(false);
  });

  it('is that owner’s alone, for an owner’s row', () => {
    expect(
      canEditProfile({
        actorUserId: A,
        actorRoles: ['owner'],
        targetUserId: B,
        targetRoles: ['owner'],
      }),
    ).toBe(false);
    expect(
      canEditProfile({
        actorUserId: A,
        actorRoles: ['owner'],
        targetUserId: A,
        targetRoles: ['owner'],
      }),
    ).toBe(true);
  });
});

describe('what each role opens, in words', () => {
  it('has a sentence for each of the four working roles and no other', () => {
    expect(Object.keys(STAFF_ROLE_OPENS).sort()).toEqual([...STAFF_ROLES].sort());
    for (const line of Object.values(STAFF_ROLE_OPENS)) expect(line.length).toBeGreaterThan(10);
  });
});
