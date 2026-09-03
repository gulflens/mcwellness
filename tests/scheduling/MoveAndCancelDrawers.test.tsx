// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppointmentRow } from '../../app/api/appointments/schema';
import { CancelAppointmentDrawer } from '../../app/admin/schedule/CancelAppointmentDrawer';
import { MoveAppointmentDrawer } from '../../app/admin/schedule/MoveAppointmentDrawer';
import { AuthProviderBoundary } from '../../app/shell/auth/AuthContext';
import type { AuthProvider } from '../../app/shell/auth/types';

afterEach(cleanup);

/**
 * The two drawers that change a visit already promised to a household
 * (docs/SPEC/scheduling-manual.md sections 2 and 3).
 *
 * What is proved here: the move sends the window a coordinator typed and the
 * reason they gave, and names a clash in this screen's own words rather than
 * the server's; and the cancel names the consequence — a session used —
 * before the person confirms, and reports what actually happened afterwards.
 */

const provider: AuthProvider = {
  kind: 'development',
  signIn: async () => undefined,
  signOut: async () => undefined,
  getAccessToken: async () => null,
  onChange: () => () => undefined,
};

// Synthetic throughout, in the reserved ranges (.claude/rules/testing.md);
// names come from db/seed/names.ts, the one list every invented person here
// is named from.
const APPOINTMENT: AppointmentRow = {
  id: '0000000a-0000-4000-8000-000000000101',
  // 09:00–09:45 in the practice's own zone, on a fixed day.
  windowStart: '2026-09-10T05:00:00.000Z',
  windowEnd: '2026-09-10T05:45:00.000Z',
  status: 'confirmed',
  deliveryMode: 'home',
  client: {
    id: '0000000a-0000-4000-8000-000000000001',
    givenName: 'Iris',
    familyName: 'Cliff',
    givenNameAr: null,
    familyNameAr: null,
  },
  practitioner: { id: '0000000a-0000-4000-8000-000000000002', displayName: 'Cedar Ridge' },
  serviceType: { id: '0000000a-0000-4000-8000-000000000003', name: 'Standard session' },
  location: { id: '0000000a-0000-4000-8000-000000000004', label: 'home', emirate: 'DXB' },
};

/** A visit far enough out that the practice's notice period is not in play. */
const WELL_AHEAD: AppointmentRow = {
  ...APPOINTMENT,
  id: '0000000a-0000-4000-8000-000000000102',
  windowStart: new Date(Date.now() + 96 * 3_600_000).toISOString(),
  windowEnd: new Date(Date.now() + 96 * 3_600_000 + 45 * 60_000).toISOString(),
};

/** And one inside it. */
const IMMINENT: AppointmentRow = {
  ...APPOINTMENT,
  id: '0000000a-0000-4000-8000-000000000103',
  windowStart: new Date(Date.now() + 3 * 3_600_000).toISOString(),
  windowEnd: new Date(Date.now() + 3 * 3_600_000 + 45 * 60_000).toISOString(),
};

/** `apiFetch` normalises whatever a caller passes into a `Headers`
 * (app/shell/auth/AuthContext.tsx), so this is how a test reads one back. */
function headerOf(init: RequestInit | undefined, name: string): string | null {
  return new Headers(init?.headers).get(name);
}

function mount(node: React.ReactNode, fetchImpl: typeof fetch) {
  return render(
    <AuthProviderBoundary provider={provider} fetchImpl={fetchImpl}>
      <MemoryRouter>{node}</MemoryRouter>
    </AuthProviderBoundary>,
  );
}

function settingsAnd(handler: (url: string, init?: RequestInit) => Response): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('/api/appointments/settings')) {
      return new Response(JSON.stringify({ noticeHours: 24, unfitFeeFils: 15000 }), {
        status: 200,
      });
    }
    return handler(url, init);
  }) as unknown as typeof fetch;
}

describe('MoveAppointmentDrawer', () => {
  it('opens on the window the household was already promised', async () => {
    mount(
      <MoveAppointmentDrawer
        appointment={APPOINTMENT}
        onClose={() => undefined}
        onMoved={() => undefined}
      />,
      settingsAnd(() => new Response('not found', { status: 404 })),
    );
    // Twice: once on the context line above the fields, naming the day and
    // the window the household was promised, and once as the start-time
    // field's own hint. The day itself is asserted through the date field
    // below rather than through a formatted month name, which is the one
    // thing here that a change of locale data could move.
    expect(screen.getAllByText(/09:00–09:45/)).toHaveLength(2);
    expect(screen.getByText(/Iris Cliff/)).toBeTruthy();
    expect((screen.getByLabelText('New date') as HTMLInputElement).value).toBe('2026-09-10');
    expect((screen.getByLabelText('New start time') as HTMLInputElement).value).toBe('09:00');
    // Moving a visit tells nobody: the screen says so rather than leaving it
    // to be discovered.
    expect(screen.getByText('The household still has to be told the new window.')).toBeTruthy();
  });

  it('will not move a visit to the time it already has, or without a reason', () => {
    mount(
      <MoveAppointmentDrawer
        appointment={APPOINTMENT}
        onClose={() => undefined}
        onMoved={() => undefined}
      />,
      settingsAnd(() => new Response('not found', { status: 404 })),
    );
    const submit = screen.getByRole('button', { name: 'Move appointment' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(screen.getByText('Choose a different time first.')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('New start time'), { target: { value: '14:00' } });
    // A new time, and still no reason.
    expect(
      (screen.getByRole('button', { name: 'Move appointment' }) as HTMLButtonElement).disabled,
    ).toBe(true);

    fireEvent.change(screen.getByLabelText('Why is it moving?'), {
      target: { value: 'The family asked for the afternoon.' },
    });
    expect(
      (screen.getByRole('button', { name: 'Move appointment' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('sends the new window and carries the reason on the request, not in the body', async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    const fetchImpl = settingsAnd((url, init) => {
      seen.push({ url, init });
      return new Response(
        JSON.stringify({
          appointment: { ...APPOINTMENT, id: '0000000a-0000-4000-8000-000000000201' },
          movedFrom: {
            id: APPOINTMENT.id,
            windowStart: APPOINTMENT.windowStart,
            windowEnd: APPOINTMENT.windowEnd,
          },
        }),
        { status: 201 },
      );
    });
    const onMoved = vi.fn();
    mount(
      <MoveAppointmentDrawer
        appointment={APPOINTMENT}
        onClose={() => undefined}
        onMoved={onMoved}
      />,
      fetchImpl,
    );
    fireEvent.change(screen.getByLabelText('New start time'), { target: { value: '14:00' } });
    fireEvent.change(screen.getByLabelText('Why is it moving?'), {
      target: { value: 'The family asked for the afternoon.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Move appointment' }));

    await waitFor(() => expect(onMoved).toHaveBeenCalled());
    const request = seen.find((entry) => entry.url.endsWith('/move'));
    expect(request?.url).toBe(`/api/appointments/${APPOINTMENT.id}/move`);
    expect(headerOf(request?.init, 'x-reason')).toBe('The family asked for the afternoon.');
    // 14:00 in the practice's own zone, sent as the instant it is.
    expect(JSON.parse(String(request?.init?.body))).toEqual({
      windowStart: '2026-09-10T10:00:00.000Z',
    });
  });

  it('names a clash in this screen’s own words, with the way out', async () => {
    const fetchImpl = settingsAnd(
      () =>
        new Response(
          JSON.stringify({
            error: 'conflict',
            issues: [
              {
                code: 'practitioner_overlap',
                message: 'This practitioner is already booked close to this time.',
                conflictsWithAppointmentId: null,
              },
            ],
            requestId: null,
          }),
          { status: 409 },
        ),
    );
    mount(
      <MoveAppointmentDrawer
        appointment={APPOINTMENT}
        onClose={() => undefined}
        onMoved={() => undefined}
      />,
      fetchImpl,
    );
    fireEvent.change(screen.getByLabelText('New start time'), { target: { value: '14:00' } });
    fireEvent.change(screen.getByLabelText('Why is it moving?'), { target: { value: 'A clash.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Move appointment' }));

    expect(
      await screen.findByText(
        'This practitioner is already booked close to this time. Choose a different time or practitioner.',
      ),
    ).toBeTruthy();
  });
});

describe('CancelAppointmentDrawer', () => {
  it('says the client keeps the session when the notice period is not in play', async () => {
    mount(
      <CancelAppointmentDrawer
        appointment={WELL_AHEAD}
        onClose={() => undefined}
        onCancelled={() => undefined}
      />,
      settingsAnd(() => new Response('not found', { status: 404 })),
    );
    expect(
      await screen.findByText(/outside the practice’s 24 hours’ notice, so the client keeps/),
    ).toBeTruthy();
  });

  it('names the consequence before the coordinator confirms', async () => {
    mount(
      <CancelAppointmentDrawer
        appointment={IMMINENT}
        onClose={() => undefined}
        onCancelled={() => undefined}
      />,
      settingsAnd(() => new Response('not found', { status: 404 })),
    );
    expect(
      await screen.findByText(
        "This is inside the practice's 24 hours' notice, so it uses one of the client's sessions. It can be waived afterwards.",
      ),
    ).toBeTruthy();
  });

  it('warns about a visit that could not go ahead at the door however much notice there was, and names the fee', async () => {
    mount(
      <CancelAppointmentDrawer
        appointment={WELL_AHEAD}
        onClose={() => undefined}
        onCancelled={() => undefined}
      />,
      settingsAnd(() => new Response('not found', { status: 404 })),
    );
    await screen.findByText(/outside the practice’s 24 hours’ notice/);
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'unfit_to_attend' } });
    expect(
      await screen.findByText(
        "A visit that cannot go ahead once the practitioner has arrived counts as late whatever notice was given: it uses one of the client's sessions.",
      ),
    ).toBeTruthy();
    // The practice's own figure, formatted by the one money formatter, and
    // honest about the fact that nothing charges it on its own.
    expect(screen.getByText(/The practice’s fee for this is AED 150\.00\./)).toBeTruthy();
  });

  it('sends the chosen reason and reports that a session was used', async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    const fetchImpl = settingsAnd((url, init) => {
      seen.push({ url, init });
      return new Response(
        JSON.stringify({
          id: IMMINENT.id,
          status: 'cancelled_late',
          reason: 'client_request',
          noticeHours: 24,
          creditConsumed: true,
          waiverEntitlementId: '0000000a-0000-4000-8000-000000000301',
        }),
        { status: 200 },
      );
    });
    const onCancelled = vi.fn();
    mount(
      <CancelAppointmentDrawer
        appointment={IMMINENT}
        onClose={() => undefined}
        onCancelled={onCancelled}
      />,
      fetchImpl,
    );
    fireEvent.change(screen.getByLabelText('What happened?'), {
      target: { value: 'The child is unwell.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Call off this visit' }));

    expect(await screen.findByText(/It used one of the client’s sessions\./)).toBeTruthy();
    expect(onCancelled).toHaveBeenCalled();
    const request = seen.find((entry) => entry.url.endsWith('/cancel'));
    expect(request?.url).toBe(`/api/appointments/${IMMINENT.id}/cancel`);
    expect(headerOf(request?.init, 'x-reason')).toBe('The child is unwell.');
    expect(JSON.parse(String(request?.init?.body))).toEqual({ reason: 'client_request' });
    // The way back is offered, and never a route path on the face of a screen.
    expect(screen.getByRole('link', { name: 'Open Billing' })).toBeTruthy();
  });

  it('does not claim a charge when the client had no session to use', async () => {
    const fetchImpl = settingsAnd(
      () =>
        new Response(
          JSON.stringify({
            id: IMMINENT.id,
            status: 'cancelled_late',
            reason: 'client_request',
            noticeHours: 24,
            creditConsumed: false,
            waiverEntitlementId: null,
          }),
          { status: 200 },
        ),
    );
    mount(
      <CancelAppointmentDrawer
        appointment={IMMINENT}
        onClose={() => undefined}
        onCancelled={() => undefined}
      />,
      fetchImpl,
    );
    fireEvent.change(screen.getByLabelText('What happened?'), { target: { value: 'No answer.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Call off this visit' }));

    expect(
      await screen.findByText(/The client had no session left to use for it, so nothing was taken/),
    ).toBeTruthy();
    expect(screen.queryByText(/It used one of the client’s sessions/)).toBeNull();
  });

  it('will not call a visit off without saying what happened', async () => {
    mount(
      <CancelAppointmentDrawer
        appointment={IMMINENT}
        onClose={() => undefined}
        onCancelled={() => undefined}
      />,
      settingsAnd(() => new Response('not found', { status: 404 })),
    );
    expect(
      (screen.getByRole('button', { name: 'Call off this visit' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
