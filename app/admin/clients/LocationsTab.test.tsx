// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProviderBoundary } from '../../shell/auth/AuthContext';
import type { AuthProvider } from '../../shell/auth/types';
import type { ClientRecordResponse } from '../../api/clients/record-schema';
import { LocationsTab } from './LocationsTab';
import { ADMIN, signedInProvider } from './testActors';

afterEach(cleanup);

const provider: AuthProvider = signedInProvider;

const CLIENT_ID = '00000008-0000-4000-8000-000000000005';

const record: ClientRecordResponse = {
  id: CLIENT_ID,
  mrn: 'MW-000005',
  givenName: 'Dahlia',
  familyName: 'Bay',
  givenNameAr: 'داليا',
  familyNameAr: 'خليج',
  dateOfBirth: '1988-04-01',
  sexAtBirth: 'female',
  preferredLocale: 'en',
  referralSource: 'Instagram',
  status: 'active',
  contacts: [],
  consents: [],
  goals: [],
  locations: [
    {
      id: '00000008-0000-4000-8000-0000000000b2',
      label: 'home',
      emirate: 'DXB',
      makaniNumber: null,
      entranceLng: 55.27,
      entranceLat: 25.2,
      hasParkingPoint: false,
      hasCommunityGate: false,
      displayAddress: null,
      accessNotes: null,
      isPrimary: true,
    },
  ],
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Mounts the LocationsTab with fetch stubbed to answer verify-pin requests. */
function mount() {
  const calls: { url: string; init?: RequestInit }[] = [];
  const onChanged = vi.fn();
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === '/api/me') return json(ADMIN);
    if (url.endsWith('/verify-pin')) return json({ id: record.locations[0]!.id });
    return json({ error: 'not_found' }, 404);
  }) as unknown as typeof fetch;
  render(
    <MemoryRouter initialEntries={['/admin/clients']}>
      <AuthProviderBoundary provider={provider} fetchImpl={fetchImpl}>
        <LocationsTab clientId={CLIENT_ID} record={record} onChanged={onChanged} mayWrite />
      </AuthProviderBoundary>
    </MemoryRouter>,
  );
  return { calls, onChanged };
}

describe('LocationsTab', () => {
  it('calls the pin what it is: a pin to check, and says when it is saved', async () => {
    const { calls } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Check the pin' }));
    expect(
      screen.getByRole('heading', { name: 'Where the practitioner should arrive' }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save pin' }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/verify-pin'))).toBe(true));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Pin saved.'));
  });
});
