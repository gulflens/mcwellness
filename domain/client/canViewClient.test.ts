import { describe, expect, it } from 'vitest';
import type { Role } from '../shared/actor';
import { canViewClient } from './canViewClient';
import type { ClientStatus, ClientSummary, ViewClientContext, ViewingActor } from './types';

const NOW = new Date('2026-09-02T08:00:00Z');
const TENANT = 'tenant-1';
const OTHER_TENANT = 'tenant-2';
const CLIENT: ClientSummary = { id: 'client-1', tenantId: TENANT, status: 'active' };
const ERASED_CLIENT: ClientSummary = { id: 'client-1', tenantId: TENANT, status: 'erased' };
const EMPTY_CTX: ViewClientContext = { scheduledClientIds: [], contactClientIds: [] };

function actor(roles: Role[], tenantId: string = TENANT): ViewingActor {
  return { userId: 'u', tenantId, roles };
}

describe('canViewClient', () => {
  it('refuses a user with no roles', () => {
    expect(canViewClient(actor([]), CLIENT, EMPTY_CTX, NOW)).toEqual({
      ok: false,
      needsReason: false,
    });
  });

  it('lets the owner, an admin, a lead practitioner and finance see any live record', () => {
    for (const role of ['owner', 'admin', 'lead_practitioner', 'finance'] as const) {
      expect(canViewClient(actor([role]), CLIENT, EMPTY_CTX, NOW)).toEqual({
        ok: true,
        needsReason: false,
      });
    }
  });

  it('lets a practitioner see only a client on their own schedule', () => {
    const ctx: ViewClientContext = { scheduledClientIds: ['client-1'], contactClientIds: [] };
    expect(canViewClient(actor(['practitioner']), CLIENT, ctx, NOW)).toEqual({
      ok: true,
      needsReason: false,
    });
    expect(canViewClient(actor(['practitioner']), CLIENT, EMPTY_CTX, NOW)).toEqual({
      ok: false,
      needsReason: false,
    });
  });

  it("lets a client contact see only their own household's client", () => {
    const ctx: ViewClientContext = { scheduledClientIds: [], contactClientIds: ['client-1'] };
    expect(canViewClient(actor(['client_contact']), CLIENT, ctx, NOW)).toEqual({
      ok: true,
      needsReason: false,
    });
    expect(canViewClient(actor(['client_contact']), CLIENT, EMPTY_CTX, NOW)).toEqual({
      ok: false,
      needsReason: false,
    });
  });

  it('opens an erased record only for the owner and the lead practitioner, and needs a reason', () => {
    for (const role of ['owner', 'lead_practitioner'] as const) {
      expect(canViewClient(actor([role]), ERASED_CLIENT, EMPTY_CTX, NOW)).toEqual({
        ok: true,
        needsReason: true,
      });
    }
  });

  it('refuses an erased record to everyone else, including admin and finance', () => {
    for (const role of ['admin', 'finance'] as const) {
      expect(canViewClient(actor([role]), ERASED_CLIENT, EMPTY_CTX, NOW)).toEqual({
        ok: false,
        needsReason: false,
      });
    }
  });

  it('refuses an erased record to a practitioner even when it is on their schedule', () => {
    const ctx: ViewClientContext = { scheduledClientIds: ['client-1'], contactClientIds: [] };
    expect(canViewClient(actor(['practitioner']), ERASED_CLIENT, ctx, NOW)).toEqual({
      ok: false,
      needsReason: false,
    });
  });

  it('refuses an erased record to a client contact even for their own client', () => {
    const ctx: ViewClientContext = { scheduledClientIds: [], contactClientIds: ['client-1'] };
    expect(canViewClient(actor(['client_contact']), ERASED_CLIENT, ctx, NOW)).toEqual({
      ok: false,
      needsReason: false,
    });
  });

  it('refuses everyone, owner included, when the actor and the client belong to different tenants', () => {
    for (const role of ['owner', 'admin', 'lead_practitioner', 'finance'] as const) {
      expect(canViewClient(actor([role], OTHER_TENANT), CLIENT, EMPTY_CTX, NOW)).toEqual({
        ok: false,
        needsReason: false,
      });
    }
    // Even the owner cannot use the erased-record door into another tenant's client.
    expect(canViewClient(actor(['owner'], OTHER_TENANT), ERASED_CLIENT, EMPTY_CTX, NOW)).toEqual({
      ok: false,
      needsReason: false,
    });
  });

  it('refuses a client with a status this rule does not recognise, rather than falling open', () => {
    const unknownStatusClient: ClientSummary = {
      id: 'client-1',
      tenantId: TENANT,
      status: 'not_a_real_status' as unknown as ClientStatus,
    };
    for (const role of ['owner', 'admin', 'lead_practitioner', 'finance'] as const) {
      expect(canViewClient(actor([role]), unknownStatusClient, EMPTY_CTX, NOW)).toEqual({
        ok: false,
        needsReason: false,
      });
    }
  });
});
