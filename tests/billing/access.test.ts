import { describe, expect, it } from 'vitest';
import type { Actor, Role } from '../../domain/shared';
import {
  mayDiscount,
  mayQuoteRefund,
  mayReadBalance,
  mayReadCatalogue,
  mayReadInvoices,
  mayRecordPayment,
  maySell,
  mayWaive,
  mayWriteCatalogue,
} from '../../app/api/billing/access';

/**
 * Every billing permission, against every role, pinned.
 *
 * These wrappers stand in front of routes that sell things and take money,
 * and each one currently resolves to `billing.price.write` or
 * `billing.price.read` until the trunk lands the named actions
 * (docs/CHANGE-REQUESTS/billing-03.md). That indirection is safe only while
 * somebody is watching it: widening `billing.price.read` upstream — to let a
 * practitioner see the price list, say — would silently widen who may read
 * the invoice book and quote a refund, and nothing would fail.
 *
 * So the audiences are asserted here rather than inferred. The table below is
 * the change request's own table, and it must read the same whether the
 * wrapper took the named action or the fallback: when pull request 43 merges
 * and `named()` starts finding `billing.package.read` and the rest, not one
 * expectation in this file may move.
 */

const NOW = new Date('2026-09-03T09:00:00+04:00');
const CLIENT_ID = '00000005-0000-4000-8000-000000000001';

function actorWith(...roles: Role[]): Actor {
  return {
    userId: '00000002-0000-4000-8000-000000000001',
    tenantId: '00000001-0000-4000-8000-000000000001',
    roles,
    capabilities: [],
  };
}

const ROLES = [
  'owner',
  'admin',
  'finance',
  'lead_practitioner',
  'practitioner',
  'client_contact',
] as const satisfies readonly Role[];

/** The office roles that record money, the four that read it, and everybody. */
const MONEY = ['owner', 'admin', 'finance'];
const OFFICE = ['owner', 'admin', 'finance', 'lead_practitioner'];

const WRAPPERS: readonly { name: string; may: (actor: Actor) => boolean; allowed: string[] }[] = [
  { name: 'mayReadCatalogue', may: (a) => mayReadCatalogue(a, NOW), allowed: OFFICE },
  { name: 'mayWriteCatalogue', may: (a) => mayWriteCatalogue(a, NOW), allowed: MONEY },
  { name: 'maySell', may: (a) => maySell(a, NOW), allowed: MONEY },
  { name: 'mayRecordPayment', may: (a) => mayRecordPayment(a, NOW), allowed: MONEY },
  { name: 'mayWaive', may: (a) => mayWaive(a, NOW), allowed: MONEY },
  { name: 'mayDiscount', may: (a) => mayDiscount(a, NOW), allowed: MONEY },
  { name: 'mayReadInvoices', may: (a) => mayReadInvoices(a, NOW), allowed: OFFICE },
  { name: 'mayQuoteRefund', may: (a) => mayQuoteRefund(a, NOW), allowed: OFFICE },
];

describe('the billing permissions, role by role', () => {
  for (const wrapper of WRAPPERS) {
    for (const role of ROLES) {
      const expected = wrapper.allowed.includes(role);
      it(`${wrapper.name}: ${role} is ${expected ? 'allowed' : 'refused'}`, () => {
        expect(wrapper.may(actorWith(role))).toBe(expected);
      });
    }
  }

  it('refuses somebody with no role at all, every time', () => {
    const nobody = actorWith();
    for (const wrapper of WRAPPERS) {
      expect(wrapper.may(nobody), wrapper.name).toBe(false);
    }
    expect(mayReadBalance(nobody, CLIENT_ID, {}, NOW)).toBe(false);
  });
});

describe('mayReadBalance, the one that reaches past the office', () => {
  it('allows the four office roles', () => {
    for (const role of OFFICE) {
      expect(mayReadBalance(actorWith(role as Role), CLIENT_ID, {}, NOW), role).toBe(true);
    }
  });

  it('allows a practitioner, whose reach is row security to decide, not this', () => {
    // The stop card at the door says "Session 3 of 15" and what is owed.
    // app.client_visible_to_practitioner scopes which client that may be.
    expect(mayReadBalance(actorWith('practitioner'), CLIENT_ID, {}, NOW)).toBe(true);
  });

  it('allows a client contact only for a client in their own context', () => {
    const contact = actorWith('client_contact');
    expect(mayReadBalance(contact, CLIENT_ID, { clientIds: [CLIENT_ID] }, NOW)).toBe(true);
    expect(mayReadBalance(contact, CLIENT_ID, { clientIds: [] }, NOW)).toBe(false);
    expect(mayReadBalance(contact, CLIENT_ID, {}, NOW)).toBe(false);
    expect(
      mayReadBalance(
        contact,
        CLIENT_ID,
        { clientIds: ['00000005-0000-4000-8000-000000000002'] },
        NOW,
      ),
    ).toBe(false);
  });
});
