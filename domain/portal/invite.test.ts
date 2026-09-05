import { describe, expect, it } from 'vitest';
import { describeAccess, INVITE_VALID_DAYS, inviteExpiry } from './invite';

/** docs/SPEC/client-portal.md sections 3.8 and 5, rule 6. */

const NOW = new Date('2026-09-05T08:00:00.000Z');
const LATER = new Date('2026-09-09T08:00:00.000Z');
const EARLIER = new Date('2026-09-01T08:00:00.000Z');

describe('inviteExpiry', () => {
  it('gives an invitation seven days', () => {
    expect(inviteExpiry(NOW).toISOString()).toBe('2026-09-12T08:00:00.000Z');
    expect(INVITE_VALID_DAYS).toBe(7);
  });
});

describe('describeAccess', () => {
  it('says no access when the contact has no account', () => {
    expect(describeAccess({ userId: null }, null, null, NOW).state).toBe('none');
  });

  it('says invited while the link is still alive', () => {
    const access = describeAccess(
      { userId: 'u' },
      { authId: null, status: 'active' },
      { expiresAt: LATER, usedAt: null, revokedAt: null },
      NOW,
    );
    expect(access.state).toBe('invited');
    expect(access.expiresAt).toBe(LATER);
  });

  it('says no access again once the link has run out of time', () => {
    expect(
      describeAccess(
        { userId: 'u' },
        { authId: null, status: 'active' },
        { expiresAt: EARLIER, usedAt: null, revokedAt: null },
        NOW,
      ).state,
    ).toBe('none');
  });

  it('says no access once the link has been revoked', () => {
    expect(
      describeAccess(
        { userId: 'u' },
        { authId: null, status: 'active' },
        { expiresAt: LATER, usedAt: null, revokedAt: EARLIER },
        NOW,
      ).state,
    ).toBe('none');
  });

  it('says active once the person has been through the door, with the date they came', () => {
    const access = describeAccess(
      { userId: 'u' },
      { authId: 'a', status: 'active' },
      { expiresAt: LATER, usedAt: EARLIER, revokedAt: null },
      NOW,
    );
    expect(access.state).toBe('active');
    expect(access.since).toBe(EARLIER);
  });

  it('says revoked when the account is switched off, whatever the link says', () => {
    expect(
      describeAccess(
        { userId: 'u' },
        { authId: 'a', status: 'suspended' },
        { expiresAt: LATER, usedAt: EARLIER, revokedAt: null },
        NOW,
      ).state,
    ).toBe('revoked');
  });
});
