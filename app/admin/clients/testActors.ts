import type { AuthProvider } from '../../shell/auth/types';

/**
 * Test support for the client-record screens: the four people the console can
 * belong to, and a provider that hands out a token so `AuthProviderBoundary`
 * asks `/api/me` for one of them. Nothing in the application imports this.
 *
 * Every screen here now offers only the actions the actor's own routes would
 * accept (app/admin/clients/clientAccess.ts), so a test that does not say who
 * is signed in is testing the signed-out case by accident. Synthetic
 * throughout, in the reserved ranges (.claude/rules/testing.md), and named
 * from db/seed/names.ts.
 */

const TENANT_ID = '00000001-0000-4000-8000-000000000001';

export const ADMIN = {
  userId: '00000002-0000-4000-8000-0000000000d1',
  displayName: 'Hazel Harbour',
  tenantId: TENANT_ID,
  roles: ['admin'],
  capabilities: [],
};

export const LEAD_PRACTITIONER = {
  userId: '00000002-0000-4000-8000-0000000000d2',
  displayName: 'Rowan Ridge',
  tenantId: TENANT_ID,
  roles: ['lead_practitioner'],
  capabilities: [],
};

export const PRACTITIONER = {
  userId: '00000002-0000-4000-8000-0000000000d3',
  displayName: 'Cedar Valley',
  tenantId: TENANT_ID,
  roles: ['practitioner'],
  capabilities: [],
};

export const FINANCE = {
  userId: '00000002-0000-4000-8000-0000000000d4',
  displayName: 'Olive Summit',
  tenantId: TENANT_ID,
  roles: ['finance'],
  capabilities: [],
};

/** Hands out a token, so the boundary goes on to ask `/api/me` who it belongs to. */
export const signedInProvider: AuthProvider = {
  kind: 'development',
  signIn: async () => undefined,
  signOut: async () => undefined,
  getAccessToken: async () => 'token',
  onChange: () => () => undefined,
};
