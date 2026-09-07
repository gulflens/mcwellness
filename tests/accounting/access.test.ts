import { describe, expect, it } from 'vitest';
import type { Actor, Role } from '../../domain/shared';
import {
  mayChangeBooksSettings,
  mayCloseYear,
  mayReadBooks,
  mayWriteBooks,
} from '../../app/api/accounting/access';
import { canOpenBooks } from '../../app/shell/adminAccess';

/**
 * Every books permission against every role, pinned (docs/SPEC/accounting.md
 * section 3): the owner and finance read and post; only the owner closes a
 * year, locks a date or changes the settings; nobody else touches the books.
 */
const NOW = new Date('2026-09-07T09:00:00+04:00');

function actorWith(...roles: Role[]): Actor {
  return {
    userId: '00000002-0000-4000-8000-000000000001',
    tenantId: '00000001-0000-4000-8000-000000000001',
    roles,
    capabilities: [],
  };
}

const ROLES: Role[] = [
  'owner',
  'admin',
  'finance',
  'lead_practitioner',
  'practitioner',
  'client_contact',
];

const TABLE: Record<Role, { read: boolean; write: boolean; owner: boolean }> = {
  owner: { read: true, write: true, owner: true },
  finance: { read: true, write: true, owner: false },
  admin: { read: false, write: false, owner: false },
  lead_practitioner: { read: false, write: false, owner: false },
  practitioner: { read: false, write: false, owner: false },
  client_contact: { read: false, write: false, owner: false },
};

describe('who may keep the books', () => {
  for (const role of ROLES) {
    const expected = TABLE[role];
    it(`${role}: read ${expected.read}, write ${expected.write}, owner acts ${expected.owner}`, () => {
      const actor = actorWith(role);
      expect(mayReadBooks(actor, NOW)).toBe(expected.read);
      expect(mayWriteBooks(actor, NOW)).toBe(expected.write);
      expect(mayCloseYear(actor, NOW)).toBe(expected.owner);
      expect(mayChangeBooksSettings(actor, NOW)).toBe(expected.owner);
    });
  }

  it('offers the Books rail entry to exactly the roles that may read them', () => {
    // app/shell/adminAccess.ts's canOpenBooks matches `accounting.read`, which
    // is what both the rail and the route ask (docs/CHANGE-REQUESTS/accounting-01.md
    // item 4). Restated as a role list anywhere it would drift from the action.
    for (const role of ROLES) {
      expect(canOpenBooks(actorWith(role), NOW), role).toBe(TABLE[role].read);
    }
  });

  it('an admin who is also finance reads and posts through the finance role', () => {
    const actor = actorWith('admin', 'finance');
    expect(mayReadBooks(actor, NOW)).toBe(true);
    expect(mayCloseYear(actor, NOW)).toBe(false);
  });
});
