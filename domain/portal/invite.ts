/**
 * Invitations to the portal, and what the practice's own Portal screen says
 * about each contact (docs/SPEC/client-portal.md sections 3.8 and 5, rule 6).
 *
 * An invitation is a link that lives seven days, is shown once, is stored only
 * as a hash and can be revoked. None of that arithmetic belongs in a route or
 * in a screen: `inviteExpiry` is the one place the seven days is written, and
 * `describeAccess` is the one place the four words the table shows are decided.
 *
 * Pure: no clock is read inside; `now` is always an argument.
 */

/** Seven days. The spec's figure, in one place. */
export const INVITE_VALID_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/** When an invitation issued at `issuedAt` stops working. */
export function inviteExpiry(issuedAt: Date): Date {
  return new Date(issuedAt.getTime() + INVITE_VALID_DAYS * DAY_MS);
}

/** The two kinds of invitation: a first way in, or a new password for a way in that exists. */
export const INVITE_KINDS = ['first_sign_in', 'password_reset'] as const;
export type InviteKind = (typeof INVITE_KINDS)[number];

/** The four states section 3.8 shows, and nothing else. */
export type AccessState = 'none' | 'invited' | 'active' | 'revoked';

export type AccessContact = { userId: string | null };

/** The `app_user` row behind the contact, when there is one. */
export type AccessUser = {
  /** Linked to a sign-in: the person has been through the door at least once. */
  authId: string | null;
  status: 'active' | 'suspended' | 'archived';
};

/** The most recent invitation issued to that contact, when there is one. */
export type AccessInvite = {
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
};

export type Access = {
  state: AccessState;
  /** When an outstanding invitation runs out. Only ever set while the state is `invited`. */
  expiresAt: Date | null;
  /** When the person first came through the door. Only ever set while the state is `active`. */
  since: Date | null;
};

/**
 * What the practice sees beside a contact.
 *
 * The order of the questions is the order of the facts. A person whose account
 * has been switched off is revoked whatever any invitation says, because
 * revocation is the account and not the link (section 7). A person whose
 * account is linked to a sign-in is active. Otherwise an invitation that is
 * still alive — not used, not revoked, not out of time — is an outstanding
 * invitation, and anything else is no access, which is also what an
 * invitation that quietly expired leaves behind: the practice sends another.
 */
export function describeAccess(
  contact: AccessContact,
  user: AccessUser | null,
  invite: AccessInvite | null,
  now: Date,
): Access {
  if (contact.userId === null || user === null) {
    return { state: 'none', expiresAt: null, since: null };
  }
  if (user.status !== 'active') {
    return { state: 'revoked', expiresAt: null, since: null };
  }
  if (user.authId !== null) {
    return { state: 'active', expiresAt: null, since: invite?.usedAt ?? null };
  }
  if (
    invite !== null &&
    invite.usedAt === null &&
    invite.revokedAt === null &&
    invite.expiresAt > now
  ) {
    return { state: 'invited', expiresAt: invite.expiresAt, since: null };
  }
  return { state: 'none', expiresAt: null, since: null };
}
