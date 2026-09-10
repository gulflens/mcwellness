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
              client: {
                id: client.id,
                givenName: client.givenName,
                familyName: client.familyName,
                givenNameAr: client.givenNameAr,
                familyNameAr: client.familyNameAr,
              },
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

  it('books on the day chosen in the panel, defaulting to the day shown', async () => {
    const fetchImpl = buildFetch(
      () =>
        new Response(
          JSON.stringify({
            id: '00000008-0000-4000-8000-000000000098',
            windowStart: '2026-09-11T06:00:00.000Z',
            windowEnd: '2026-09-11T06:45:00.000Z',
            status: 'proposed',
            deliveryMode: 'home',
            client: {
              id: client.id,
              givenName: client.givenName,
              familyName: client.familyName,
              givenNameAr: client.givenNameAr,
              familyNameAr: client.familyNameAr,
            },
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
    const onCreated = vi.fn();

    render(
      <AuthProviderBoundary provider={provider} fetchImpl={fetchImpl}>
        <NewAppointmentDrawer date="2026-09-10" onClose={vi.fn()} onCreated={onCreated} />
      </AuthProviderBoundary>,
    );

    // Defaults to the day the schedule was showing when the panel opened.
    const dateField = screen.getByLabelText('Date') as HTMLInputElement;
    expect(dateField.value).toBe('2026-09-10');
    fireEvent.change(dateField, { target: { value: '2026-09-11' } });

    // Same walk as "books on submit" above: client, service, location, practitioner, time.
    fireEvent.change(screen.getByLabelText('Search clients'), { target: { value: 'Iris' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Iris Cliff' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Iris Cliff' }));

    await waitFor(() =>
      expect((screen.getByLabelText('Service') as HTMLSelectElement).options).toHaveLength(2),
    );
    fireEvent.change(screen.getByLabelText('Service'), { target: { value: serviceType.id } });

    await waitFor(() =>
      expect((screen.getByLabelText('Location') as HTMLSelectElement).options).toHaveLength(3),
    );
    await waitFor(() =>
      expect((screen.getByLabelText('Practitioner') as HTMLSelectElement).options).toHaveLength(2),
    );
    fireEvent.change(screen.getByLabelText('Location'), { target: { value: homeLocation.id } });
    fireEvent.change(screen.getByLabelText('Practitioner'), { target: { value: practitioner.id } });
    fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '10:00' } });

    fireEvent.click(screen.getByRole('button', { name: 'Book appointment' }));

    await waitFor(() =>
      expect(fetchImpl.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true),
    );
    const postCall = fetchImpl.mock.calls.find(
      ([input, init]) => String(input).startsWith('/api/appointments') && init?.method === 'POST',
    );
    if (!postCall) throw new Error('POST /api/appointments was never called');
    const [, init] = postCall;
    const body = JSON.parse(String(init?.body));
    expect(body.windowStart).toBe(new Date('2026-09-11T10:00:00+04:00').toISOString());

    // The options — and so the practitioner list — were fetched for the new day.
    expect(fetchImpl.mock.calls.some(([input]) => String(input).includes('date=2026-09-11'))).toBe(
      true,
    );
  });

  it('disables submit and asks for a date when the date is cleared after everything else is chosen', async () => {
    const fetchImpl = buildFetch(
      () => new Response(JSON.stringify({ error: 'forbidden', requestId: 'r1' }), { status: 403 }),
    );
    await walkToStartTime(fetchImpl);

    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '' } });

    // Clearing the date also clears the practitioner choice (as any date
    // change does); re-picking one here reproduces the actual bug — every
    // other step is still filled in, only the date itself is missing.
    await waitFor(() =>
      expect((screen.getByLabelText('Practitioner') as HTMLSelectElement).options).toHaveLength(2),
    );
    fireEvent.change(screen.getByLabelText('Practitioner'), { target: { value: practitioner.id } });

    const submitButton = screen.getByRole('button', {
      name: 'Book appointment',
    }) as HTMLButtonElement;
    expect(submitButton.disabled).toBe(true);
    expect(screen.getByText('Choose a date.')).toBeTruthy();
  });

  it('clears the chosen practitioner when the date changes, and refetches options for the new day', async () => {
    const fetchImpl = buildFetch(
      () => new Response(JSON.stringify({ error: 'forbidden', requestId: 'r1' }), { status: 403 }),
    );
    await walkToStartTime(fetchImpl);

    const practitionerSelect = screen.getByLabelText('Practitioner') as HTMLSelectElement;
    expect(practitionerSelect.value).toBe(practitioner.id);

    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-09-11' } });

    // A practitioner certified on one day may be away on another: the choice
    // is cleared the moment the date changes, not left showing a stale pick.
    expect(practitionerSelect.value).toBe('');

    await waitFor(() =>
      expect(
        fetchImpl.mock.calls.some(([input]) => String(input).includes('date=2026-09-11')),
      ).toBe(true),
    );
  });

  it("renders every 409 issue as its own local sentence, never the server's own wording", async () => {
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

    // Every code gets this screen's own fixed sentence, naming the problem
    // and the way out (docs/CHANGE-REQUESTS/scheduling-02.md section 4).
    await waitFor(() =>
      expect(
        screen.getByText(
          'This practitioner is already booked close to this time. Choose a different time or practitioner.',
        ),
      ).toBeTruthy(),
    );
    expect(
      screen.getByText(
        "This client's record is not active. Reactivate the client's record before booking.",
      ),
    ).toBeTruthy();
    // consent_missing is the one exception that still reads the purpose out of
    // the server's message, because the coordinator needs to know which
    // consent to go and obtain — but the sentence itself is still local.
    expect(
      screen.getByText(
        "The client's participation consent is missing. Ask the family for it before booking.",
      ),
    ).toBeTruthy();

    // None of the server's own wording is rendered directly.
    for (const issue of issues) {
      expect(screen.queryByText(issue.message)).toBeNull();
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

  it('names what each locked step is waiting for, and clears the hint once it unlocks', async () => {
    const fetchImpl = buildFetch(
      () => new Response(JSON.stringify({ error: 'forbidden', requestId: 'r1' }), { status: 403 }),
    );
    render(
      <AuthProviderBoundary provider={provider} fetchImpl={fetchImpl}>
        <NewAppointmentDrawer date="2026-09-10" onClose={vi.fn()} onCreated={vi.fn()} />
      </AuthProviderBoundary>,
    );

    // Every locked step says what it is waiting for, not just that it is disabled.
    expect(screen.getByText('Choose a client first')).toBeTruthy();
    expect(screen.getAllByText('Choose a service first')).toHaveLength(2); // location and practitioner
    expect(screen.getByText('Choose a location and a practitioner first')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Search clients'), { target: { value: 'Iris' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Iris Cliff' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Iris Cliff' }));

    // Choosing a client clears that hint; the two steps still waiting on a
    // service keep theirs.
    expect(screen.queryByText('Choose a client first')).toBeNull();
    expect(screen.getAllByText('Choose a service first')).toHaveLength(2);

    await waitFor(() =>
      expect((screen.getByLabelText('Service') as HTMLSelectElement).options).toHaveLength(2),
    );
    fireEvent.change(screen.getByLabelText('Service'), { target: { value: serviceType.id } });

    expect(screen.queryByText('Choose a service first')).toBeNull();
    expect(screen.getByText('Choose a location and a practitioner first')).toBeTruthy();
  });

  it('clears the practitioner list the moment the service changes, before the new list arrives', async () => {
    const secondServiceType = {
      id: '00000008-0000-4000-8000-000000000020',
      name: 'Second session',
      deliveryModes: ['home'],
    };
    const secondPractitioner = {
      id: '00000008-0000-4000-8000-000000000021',
      displayName: 'Juniper Vale',
    };
    let resolveSecondOptions: (value: Response) => void = () => undefined;

    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost');
      const method = init?.method ?? 'GET';
      if (url.pathname === '/api/clients' && method === 'GET') {
        return new Response(JSON.stringify({ clients: [client], note: null }), { status: 200 });
      }
      if (url.pathname === '/api/appointments/options' && method === 'GET') {
        if (url.searchParams.get('serviceTypeId') === secondServiceType.id) {
          // Left pending for the rest of the test: proves the practitioner
          // list is cleared the moment the service changes, not only once
          // the new fetch eventually settles.
          return new Promise<Response>((resolve) => {
            resolveSecondOptions = resolve;
          });
        }
        return new Response(
          JSON.stringify({
            serviceTypes: [serviceType, secondServiceType],
            locations: [homeLocation, studioLocation],
            practitioners: url.searchParams.has('serviceTypeId') ? [practitioner] : [],
          }),
          { status: 200 },
        );
      }
      return new Response('not found', { status: 404 });
    });

    render(
      <AuthProviderBoundary provider={provider} fetchImpl={fetchImpl}>
        <NewAppointmentDrawer date="2026-09-10" onClose={vi.fn()} onCreated={vi.fn()} />
      </AuthProviderBoundary>,
    );

    fireEvent.change(screen.getByLabelText('Search clients'), { target: { value: 'Iris' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Iris Cliff' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Iris Cliff' }));

    // The Service select must actually hold both options before a value is
    // set on it — jsdom (like a real browser) silently drops an assigned
    // value that matches no <option>, which would otherwise make this fire
    // selectService('') instead of selecting the first service at all.
    await waitFor(() =>
      expect((screen.getByLabelText('Service') as HTMLSelectElement).options).toHaveLength(3),
    );
    fireEvent.change(screen.getByLabelText('Service'), { target: { value: serviceType.id } });
    await waitFor(() =>
      expect((screen.getByLabelText('Practitioner') as HTMLSelectElement).options).toHaveLength(2),
    );

    fireEvent.change(screen.getByLabelText('Service'), { target: { value: secondServiceType.id } });

    // The second service's own options fetch is still pending, yet the
    // first service's practitioner is already gone from the list — cleared
    // synchronously by selectService, not only once the new fetch settles.
    const practitionerSelect = screen.getByLabelText('Practitioner') as HTMLSelectElement;
    expect(practitionerSelect.options).toHaveLength(1);
    expect(
      Array.from(practitionerSelect.options).some((option) => option.value === practitioner.id),
    ).toBe(false);

    // apiFetch awaits provider.getAccessToken() before calling fetchImpl, so
    // the mock call that captures resolveSecondOptions lands a microtask
    // after the assertions above, not within the same synchronous flush.
    await waitFor(() =>
      expect(
        fetchImpl.mock.calls.some(([input]) =>
          String(input).includes(`serviceTypeId=${secondServiceType.id}`),
        ),
      ).toBe(true),
    );

    resolveSecondOptions(
      new Response(
        JSON.stringify({
          serviceTypes: [serviceType, secondServiceType],
          locations: [homeLocation, studioLocation],
          practitioners: [secondPractitioner],
        }),
        { status: 200 },
      ),
    );
    await waitFor(() => expect(practitionerSelect.options).toHaveLength(2));
  });

  it('searches only from two characters, and says so below that', async () => {
    const fetchImpl = buildFetch(
      () => new Response(JSON.stringify({ error: 'forbidden', requestId: 'r1' }), { status: 403 }),
    );
    render(
      <AuthProviderBoundary provider={provider} fetchImpl={fetchImpl}>
        <NewAppointmentDrawer date="2026-09-10" onClose={vi.fn()} onCreated={vi.fn()} />
      </AuthProviderBoundary>,
    );

    fireEvent.change(screen.getByLabelText('Search clients'), { target: { value: 'I' } });
    expect(screen.getByText('Keep typing: search starts at two characters.')).toBeTruthy();
    // No search fetch for a single character.
    expect(
      fetchImpl.mock.calls.some(([input]) => String(input).startsWith('/api/clients?q=')),
    ).toBe(false);

    fireEvent.change(screen.getByLabelText('Search clients'), { target: { value: 'Ir' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Iris Cliff' })).toBeTruthy());
    expect(screen.queryByText('Keep typing: search starts at two characters.')).toBeNull();
  });
});
