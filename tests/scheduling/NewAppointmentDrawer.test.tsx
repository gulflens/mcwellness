// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NewAppointmentDrawer } from '../../app/admin/schedule/NewAppointmentDrawer';
import { AuthProviderBoundary } from '../../app/shell/auth/AuthContext';
import type { AuthProvider } from '../../app/shell/auth/types';

afterEach(cleanup);

const provider: AuthProvider = {
  kind: 'development',
  signIn: async () => undefined,
  signOut: async () => undefined,
  getAccessToken: async () => null,
  onChange: () => () => undefined,
};

const client = {
  id: '00000008-0000-4000-8000-000000000001',
  mrn: 'MW-000001',
  givenName: 'Iris',
  familyName: 'Cliff',
  givenNameAr: null,
  familyNameAr: null,
  age: 12,
  status: 'active' as const,
  contact: null,
  emirate: 'DXB',
};

const serviceType = {
  id: '00000008-0000-4000-8000-000000000010',
  name: 'Standard session',
  deliveryModes: ['home', 'studio'],
};

const homeLocation = { id: '00000008-0000-4000-8000-000000000011', label: 'home', emirate: 'DXB' };
const studioLocation = {
  id: '00000008-0000-4000-8000-000000000012',
  label: 'studio',
  emirate: 'DXB',
};
const practitioner = { id: '00000008-0000-4000-8000-000000000013', displayName: 'Cedar Ridge' };

function optionsResponse(url: URL) {
  return {
    serviceTypes: [serviceType],
    locations: url.searchParams.has('clientId') ? [homeLocation, studioLocation] : [],
    practitioners: url.searchParams.has('serviceTypeId') ? [practitioner] : [],
  };
}

/** Every scenario shares the same client search and options doors; only the
 * POST /api/appointments answer differs between tests. */
function buildFetch(postResponse: () => Response) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const method = init?.method ?? 'GET';
    if (url.pathname === '/api/clients' && method === 'GET') {
      return new Response(JSON.stringify({ clients: [client], note: null }), { status: 200 });
    }
    if (url.pathname === '/api/appointments/options' && method === 'GET') {
      return new Response(JSON.stringify(optionsResponse(url)), { status: 200 });
    }
    if (url.pathname === '/api/appointments' && method === 'POST') {
      return postResponse();
    }
    return new Response('not found', { status: 404 });
  });
}

/** Walks every step up to (and including) typing a start time, checking the
 * ordering and gating along the way, and leaves the form ready to submit. */
async function walkToStartTime(fetchImpl: ReturnType<typeof buildFetch>) {
  const onCreated = vi.fn();
  const onClose = vi.fn();
  render(
    <AuthProviderBoundary provider={provider} fetchImpl={fetchImpl}>
      <NewAppointmentDrawer date="2026-09-10" onClose={onClose} onCreated={onCreated} />
    </AuthProviderBoundary>,
  );

  // No client, no service: the practitioner step is locked from the start.
  expect((screen.getByLabelText('Practitioner') as HTMLSelectElement).disabled).toBe(true);

  fireEvent.change(screen.getByLabelText('Search clients'), { target: { value: 'Iris' } });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Iris Cliff' })).toBeTruthy(), {
    timeout: 1000,
  });
  fireEvent.click(screen.getByRole('button', { name: 'Iris Cliff' }));

  // A client alone still doesn't unlock the practitioner step — that needs a service.
  await waitFor(() =>
    expect((screen.getByLabelText('Service') as HTMLSelectElement).options).toHaveLength(2),
  );
  expect((screen.getByLabelText('Practitioner') as HTMLSelectElement).disabled).toBe(true);

  fireEvent.change(screen.getByLabelText('Service'), { target: { value: serviceType.id } });

  // Choosing the service unlocks both location and practitioner together.
  expect((screen.getByLabelText('Practitioner') as HTMLSelectElement).disabled).toBe(false);
  await waitFor(() =>
    expect((screen.getByLabelText('Location') as HTMLSelectElement).options).toHaveLength(3),
  );
  await waitFor(() =>
    expect((screen.getByLabelText('Practitioner') as HTMLSelectElement).options).toHaveLength(2),
  );

  expect((screen.getByLabelText('Start time') as HTMLInputElement).disabled).toBe(true);

  fireEvent.change(screen.getByLabelText('Location'), { target: { value: homeLocation.id } });
  fireEvent.change(screen.getByLabelText('Practitioner'), { target: { value: practitioner.id } });

  // Only once both are chosen does the final step open.
  expect((screen.getByLabelText('Start time') as HTMLInputElement).disabled).toBe(false);
  fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '09:00' } });
  expect(screen.getByText('Arrival window 09:00–09:45')).toBeTruthy();

  return { onCreated, onClose };
}

describe('NewAppointmentDrawer', () => {
  it(
    'walks client, service, location, practitioner and start time in order, ' +
      'keeping the practitioner step locked until a service is chosen, and books on submit',
    async () => {
      const fetchImpl = buildFetch(
        () =>
          new Response(
            JSON.stringify({
              id: '00000008-0000-4000-8000-000000000099',
              windowStart: '2026-09-10T05:00:00.000Z',
              windowEnd: '2026-09-10T05:45:00.000Z',
              status: 'proposed',
              deliveryMode: 'home',
              client: { id: client.id, givenName: client.givenName, familyName: client.familyName },
              practitioner: { id: practitioner.id, displayName: practitioner.displayName },
              serviceType: { id: serviceType.id, name: serviceType.name },
              location: {
                id: homeLocation.id,
                label: homeLocation.label,
                emirate: homeLocation.emirate,
              },
            }),
            { status: 201 },
          ),
      );
      const { onCreated } = await walkToStartTime(fetchImpl);

      fireEvent.click(screen.getByRole('button', { name: 'Book appointment' }));

      await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
      expect(onCreated.mock.calls[0]?.[0]).toMatchObject({ status: 'proposed' });

      const postCall = fetchImpl.mock.calls.find(
        ([input, init]) => String(input).startsWith('/api/appointments') && init?.method === 'POST',
      );
      if (!postCall) throw new Error('POST /api/appointments was never called');
      const [, init] = postCall;
      expect(JSON.parse(String(init?.body))).toEqual({
        clientId: client.id,
        practitionerId: practitioner.id,
        serviceTypeId: serviceType.id,
        locationId: homeLocation.id,
        deliveryMode: 'home',
        windowStart: '2026-09-10T05:00:00.000Z',
      });
    },
  );

  it('renders every 409 issue in plain words', async () => {
    const issues = [
      {
        code: 'practitioner_overlap',
        message: 'This practitioner is already booked close to this time.',
        conflictsWithAppointmentId: null,
      },
      {
        code: 'client_inactive',
        message: "This client's record is not active.",
        conflictsWithAppointmentId: null,
      },
      {
        code: 'consent_missing',
        message: 'The required consent (participation) is not active for this client.',
        conflictsWithAppointmentId: null,
      },
    ];
    const fetchImpl = buildFetch(
      () =>
        new Response(JSON.stringify({ error: 'conflict', issues, requestId: 'r1' }), {
          status: 409,
        }),
    );
    await walkToStartTime(fetchImpl);

    fireEvent.click(screen.getByRole('button', { name: 'Book appointment' }));

    for (const issue of issues) {
      await waitFor(() => expect(screen.getByText(issue.message)).toBeTruthy());
    }
  });

  it('explains who may book on a 403, in plain words', async () => {
    const fetchImpl = buildFetch(
      () => new Response(JSON.stringify({ error: 'forbidden', requestId: 'r1' }), { status: 403 }),
    );
    await walkToStartTime(fetchImpl);

    fireEvent.click(screen.getByRole('button', { name: 'Book appointment' }));

    await waitFor(() =>
      expect(
        screen.getByText(
          'Only the owner, an admin or a lead practitioner can book an appointment.',
        ),
      ).toBeTruthy(),
    );
  });
});
