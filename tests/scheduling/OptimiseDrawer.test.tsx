// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { plainText } from './support';
import { OptimiseDrawer } from '../../app/admin/schedule/map/OptimiseDrawer';
import { AuthProviderBoundary } from '../../app/shell/auth/AuthContext';
import type { AuthProvider } from '../../app/shell/auth/types';
import type { AppointmentRow } from '../../app/api/appointments/schema';
import type { OptimiseDayResponse } from '../../app/api/routing/schema';

afterEach(cleanup);

const provider: AuthProvider = {
  kind: 'development',
  signIn: async () => undefined,
  signOut: async () => undefined,
  getAccessToken: async () => null,
  onChange: () => () => undefined,
};

const DAY = '2026-09-10';
const PRACTITIONER = '00000008-0000-4000-8000-000000000002';
const A1 = '00000008-0000-4000-8000-000000000101';
const A2 = '00000008-0000-4000-8000-000000000102';
const A3 = '00000008-0000-4000-8000-000000000103';

function row(id: string, givenName: string, familyName: string, hour: string): AppointmentRow {
  return {
    id,
    windowStart: `2026-09-10T${hour}:00:00.000Z`,
    windowEnd: `2026-09-10T${hour}:45:00.000Z`,
    status: 'proposed',
    deliveryMode: 'home',
    client: {
      id: '00000008-0000-4000-8000-000000000201',
      givenName,
      familyName,
      givenNameAr: null,
      familyNameAr: null,
    },
    practitioner: { id: PRACTITIONER, displayName: 'Cedar Ridge' },
    serviceType: { id: '00000008-0000-4000-8000-000000000003', name: 'Standard session' },
    location: { id: '00000008-0000-4000-8000-000000000202', label: 'home', emirate: 'DXB' },
  };
}

const stops = [
  row(A1, 'Iris', 'Cliff', '05'),
  { ...row(A2, 'Juniper', 'Valley', '06'), status: 'confirmed' as const },
  row(A3, 'Cedar', 'Marsh', '08'),
];

/** 1 h 55 min of driving becomes 1 h 45 min: ten minutes saved. */
function plan(): OptimiseDayResponse {
  return {
    kind: 'plan',
    stops: [
      {
        appointmentId: A1,
        windowStart: '2026-09-10T05:00:00.000Z',
        windowEnd: '2026-09-10T05:45:00.000Z',
        wasWindowStart: '2026-09-10T05:00:00.000Z',
        travelBufferMinutes: 20,
        moved: true,
        anchor: false,
      },
      {
        appointmentId: A2,
        windowStart: '2026-09-10T06:00:00.000Z',
        windowEnd: '2026-09-10T06:45:00.000Z',
        wasWindowStart: '2026-09-10T06:00:00.000Z',
        travelBufferMinutes: 15,
        moved: false,
        anchor: true,
      },
      {
        appointmentId: A3,
        windowStart: '2026-09-10T08:00:00.000Z',
        windowEnd: '2026-09-10T08:45:00.000Z',
        wasWindowStart: '2026-09-10T08:00:00.000Z',
        travelBufferMinutes: 25,
        moved: true,
        anchor: false,
      },
    ],
    before: { driveSeconds: 6900, driveMetres: 63000, dayEnd: '2026-09-10T09:00:00.000Z' },
    after: { driveSeconds: 6300, driveMetres: 60000, dayEnd: '2026-09-10T09:00:00.000Z' },
    savedSeconds: 600,
    source: 'traffic',
  };
}

let sent: {
  headers: Record<string, string>;
  body: { moves: { appointmentId: string; wasWindowStart: string }[] };
} | null = null;

function spyFetch(answer: OptimiseDayResponse): typeof globalThis.fetch {
  sent = null;
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/routing/practice-day/optimise') {
      return new Response(JSON.stringify(answer), { status: 200 });
    }
    if (url === '/api/appointments/reorder') {
      sent = {
        // The auth boundary may hand the fetch a Headers object or a plain
        // one; both are read the same way here.
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
        body: JSON.parse(String(init?.body)) as {
          moves: { appointmentId: string; wasWindowStart: string }[];
        },
      };
      return new Response(JSON.stringify({ appointments: [], movedFrom: [] }), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  }) as unknown as typeof globalThis.fetch;
}

function renderDrawer(answer: OptimiseDayResponse, fetchStub?: typeof globalThis.fetch) {
  return render(
    <AuthProviderBoundary provider={provider} fetchImpl={fetchStub ?? spyFetch(answer)}>
      <OptimiseDrawer
        date={DAY}
        practitionerId={PRACTITIONER}
        stops={stops}
        onClose={() => undefined}
        onApplied={() => undefined}
      />
    </AuthProviderBoundary>,
  );
}

describe('OptimiseDrawer', () => {
  it('shows the driving now and after, the saving, and where the figures came from', async () => {
    renderDrawer(plan());
    expect(await screen.findByText('Saves about 10 min of driving.')).toBeTruthy();
    expect(screen.getByText('Estimates from traffic.')).toBeTruthy();
    expect(screen.getByText('1 h 55 min')).toBeTruthy(); // Now
    expect(screen.getByText('1 h 45 min')).toBeTruthy(); // After
  });

  it('names every visit with the window it had and the window it would take, and marks the kept ones', async () => {
    renderDrawer(plan());
    const rows = await screen.findAllByRole('row');
    expect(rows.some((r) => r.textContent?.includes('kept (confirmed)'))).toBe(true);
    expect(screen.getAllByText('12:00–12:45', plainText).length).toBeGreaterThan(0);
  });

  it('applies the moved visits only, with the reason, and says the households have not been told', async () => {
    const fetchStub = spyFetch(plan());
    renderDrawer(plan(), fetchStub);
    fireEvent.click(await screen.findByRole('button', { name: 'Apply the new order' }));
    await waitFor(() => expect(sent).not.toBeNull());
    expect(sent?.headers['x-reason']).toBe('Day optimised on the map');
    expect(sent?.body.moves.map((m) => m.appointmentId)).toEqual([A1, A3]);
    expect(sent?.body.moves[0]?.wasWindowStart).toBe('2026-09-10T05:00:00.000Z');
    expect(
      await screen.findByText('2 visits moved. The households have not been told.'),
    ).toBeTruthy();
  });

  it('refuses to apply without a reason', async () => {
    renderDrawer(plan());
    fireEvent.change(await screen.findByLabelText('Why is the day changing?'), {
      target: { value: '  ' },
    });
    expect(
      screen.getByRole('button', { name: 'Apply the new order' }).hasAttribute('disabled'),
    ).toBe(true);
  });

  it('says the day changed underneath it, and offers no second attempt', async () => {
    const answer = plan();
    const fetchStub = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/routing/practice-day/optimise') {
        return new Response(JSON.stringify(answer), { status: 200 });
      }
      return new Response(JSON.stringify({ error: 'conflict', code: 'stale_plan' }), {
        status: 409,
      });
    }) as unknown as typeof globalThis.fetch;
    renderDrawer(answer, fetchStub);
    fireEvent.click(await screen.findByRole('button', { name: 'Apply the new order' }));
    expect(
      await screen.findByText('The day changed while you were looking. Reload the day.'),
    ).toBeTruthy();
  });

  it.each([
    [
      'nothing_to_move',
      'Every visit today has been agreed with its household, or is already under way.',
    ],
    ['no_improvement', 'This order already drives least.'],
    ['infeasible', 'The day cannot be improved around the confirmed visits.'],
    ['too_many_stops', 'More than ten stops in a day is not optimised.'],
  ])('says why nothing should move: %s', async (reason, sentence) => {
    renderDrawer({ kind: 'refusal', reason } as OptimiseDayResponse);
    expect(await screen.findByText(sentence)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Apply the new order' })).toBeNull();
  });
});
