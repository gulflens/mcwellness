import { describe, expect, it } from 'vitest';
import { canActor, canSwitchRole, type Action, type Actor, type Capability } from '@domain/shared';

/**
 * The helper role grants nothing by itself (round 76, docs/SPEC/dispatch.md
 * section 15.12): `canActor` refuses a helper every action there is, with the
 * most generous context and a valid credential besides. `EVERY` is keyed by
 * every action type, so an action added to `domain/shared/actor.ts` fails to
 * compile here until somebody decides what a helper may do with it.
 */

const CLIENT = '00000000-0000-4000-8000-000000007911';
const SERVICE = '00000000-0000-4000-8000-000000007912';
const PRACTITIONER = '00000000-0000-4000-8000-000000007913';
const HELPER_USER = '00000000-0000-4000-8000-000000007914';
const NOW = new Date('2026-10-06T08:00:00Z');

const credential: Capability = {
  serviceTypeId: SERVICE,
  canExecuteSession: true,
  canAuthorProtocol: true,
  canSignReport: true,
  validFrom: '2026-01-01',
  validTo: null,
};

const EVERY: { [K in Action['type']]: Extract<Action, { type: K }> } = {
  'client.list': { type: 'client.list' },
  'client.read': { type: 'client.read', clientId: CLIENT },
  'client.write': { type: 'client.write', clientId: CLIENT },
  'user_role.grant': { type: 'user_role.grant', role: 'helper' },
  'practice.settings.write': { type: 'practice.settings.write' },
  'practitioner.base.write': {
    type: 'practitioner.base.write',
    practitionerId: PRACTITIONER,
    ownPractitionerId: PRACTITIONER,
  },
  'session.execute': { type: 'session.execute', serviceTypeId: SERVICE, on: '2026-10-06' },
  'session.record_past': {
    type: 'session.record_past',
    practitionerId: PRACTITIONER,
    serviceTypeId: SERVICE,
    on: '2026-10-06',
  },
  'session.void': { type: 'session.void' },
  'report.sign': { type: 'report.sign' },
  'report.list': { type: 'report.list', clientId: CLIENT },
  'report.read': { type: 'report.read', clientId: CLIENT },
  'report.draft': { type: 'report.draft', clientId: CLIENT },
  'report.supersede': { type: 'report.supersede', clientId: CLIENT },
  'report.import': { type: 'report.import', clientId: CLIENT },
  'report.deliver': { type: 'report.deliver' },
  'audit.read': { type: 'audit.read', clientId: CLIENT },
  'audit.activity': { type: 'audit.activity' },
  'enquiry.list': { type: 'enquiry.list' },
  'enquiry.action': { type: 'enquiry.action' },
  'appointment.list': { type: 'appointment.list', scope: 'own' },
  'appointment.create': {
    type: 'appointment.create',
    practitionerId: PRACTITIONER,
    serviceTypeId: SERVICE,
    on: '2026-10-06',
  },
  'appointment.move': { type: 'appointment.move' },
  'appointment.reassign': { type: 'appointment.reassign' },
  'appointment.board.read': { type: 'appointment.board.read' },
  'appointment.cancel': { type: 'appointment.cancel', ownStop: true },
  'billing.price.read': { type: 'billing.price.read' },
  'billing.price.write': { type: 'billing.price.write' },
  'billing.package.read': { type: 'billing.package.read' },
  'billing.package.write': { type: 'billing.package.write' },
  'billing.sale.write': { type: 'billing.sale.write' },
  'billing.payment.write': { type: 'billing.payment.write' },
  'billing.waiver.write': { type: 'billing.waiver.write' },
  'billing.invoice.read': { type: 'billing.invoice.read' },
  'billing.refund.read': { type: 'billing.refund.read' },
  'billing.balance.read': { type: 'billing.balance.read', clientId: CLIENT },
  'accounting.read': { type: 'accounting.read' },
  'accounting.write': { type: 'accounting.write' },
  'accounting.year.close': { type: 'accounting.year.close' },
  'accounting.settings.write': { type: 'accounting.settings.write' },
  'contact.write_own': { type: 'contact.write_own', contactUserId: HELPER_USER },
  'portal.request.write': { type: 'portal.request.write', clientId: CLIENT },
  'portal.review.answer': { type: 'portal.review.answer', clientId: CLIENT },
  'portal.request.handle': { type: 'portal.request.handle' },
  'portal.access.manage': { type: 'portal.access.manage' },
  'portal.announcement.write': { type: 'portal.announcement.write' },
  'portal.push.send': { type: 'portal.push.send' },
  'kit.manage': { type: 'kit.manage' },
  'staff.manage': { type: 'staff.manage' },
  'staff.access.manage': { type: 'staff.access.manage' },
  'staff.helper.manage': { type: 'staff.helper.manage' },
  'kit.read': { type: 'kit.read', assignedToSelf: true },
  'routing.day.read': { type: 'routing.day.read', scope: 'own' },
  'routing.practiceDay.read': { type: 'routing.practiceDay.read' },
  'assessment.read': { type: 'assessment.read' },
  'assessment.record': { type: 'assessment.record' },
  'assessment.file': { type: 'assessment.file' },
};

const helper: Actor = {
  userId: HELPER_USER,
  tenantId: '00000000-0000-4000-8000-000000007915',
  roles: ['helper'],
  capabilities: [credential],
};

describe('canActor, for a helper', () => {
  for (const action of Object.values(EVERY)) {
    it(`refuses ${action.type}`, () => {
      expect(
        canActor(helper, action, { clientIds: [CLIENT], assigneeCapabilities: [credential] }, NOW),
      ).toBe(false);
    });
  }
});

describe('staff.helper.manage', () => {
  it('is the owner’s alone, as all of Team access is (21 September 2026)', () => {
    const action = EVERY['staff.helper.manage'];
    expect(canActor({ ...helper, roles: ['owner'] }, action, {}, NOW)).toBe(true);
    for (const role of [
      'admin',
      'lead_practitioner',
      'practitioner',
      'finance',
      'client_contact',
      'helper',
    ] as const) {
      expect(canActor({ ...helper, roles: [role] }, action, {}, NOW), role).toBe(false);
    }
  });
});

describe('canSwitchRole, for a helper', () => {
  const base = { actorUserId: 'owner', targetUserId: HELPER_USER, on: true };

  it('refuses switching a working role on for a helper, with its own code', () => {
    for (const role of ['admin', 'finance', 'practitioner', 'lead_practitioner']) {
      expect(canSwitchRole({ ...base, targetRoles: ['helper'], role }), role).toBe(
        'helper_holds_no_other_role',
      );
    }
  });

  it('never offers the helper role as a switch', () => {
    expect(canSwitchRole({ ...base, targetRoles: ['finance'], role: 'helper' })).toBe(
      'not_a_working_role',
    );
  });
});
