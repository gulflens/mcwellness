import { describe, expect, it } from 'vitest';
import { contactDisplayName } from './contactName';

const client = { givenName: 'Alpha', familyName: 'Synthetic' };

describe('contactDisplayName', () => {
  it("uses the contact's own name when it has one", () => {
    expect(
      contactDisplayName(
        { givenName: 'Beta', familyName: 'Synthetic', relationship: 'mother' },
        client,
      ),
    ).toBe('Beta Synthetic');
  });

  it("is the client's own name for a self contact with no name of its own", () => {
    expect(
      contactDisplayName({ givenName: null, familyName: null, relationship: 'self' }, client),
    ).toBe('Alpha Synthetic');
  });

  it('falls back to the relationship for any other unnamed contact', () => {
    expect(
      contactDisplayName({ givenName: null, familyName: null, relationship: 'guardian' }, client),
    ).toBe('Guardian');
  });

  it('deduplicates the erased-client placeholder for a self contact on an erased record', () => {
    const erasedClient = { givenName: 'Erased client', familyName: 'Erased client' };
    expect(
      contactDisplayName({ givenName: null, familyName: null, relationship: 'self' }, erasedClient),
    ).toBe('Erased client');
  });
});
