import { describe, expect, it } from 'vitest';
import { describeRoles, homeFor } from './routing';

describe('homeFor', () => {
  it('sends each role to its area, the admin desk winning when a person holds several', () => {
    expect(homeFor({ roles: ['owner', 'lead_practitioner'] })).toBe('/admin/clients');
    expect(homeFor({ roles: ['finance'] })).toBe('/admin/clients');
    expect(homeFor({ roles: ['practitioner'] })).toBe('/today');
    expect(homeFor({ roles: ['client_contact'] })).toBe('/portal');
    expect(homeFor({ roles: [] })).toBe('/no-access');
  });

  it('names roles in plain words', () => {
    expect(describeRoles(['owner', 'lead_practitioner'])).toBe('Owner, Lead practitioner');
  });
});
