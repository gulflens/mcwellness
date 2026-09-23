// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { plainText } from './support';
import { SchedulePage } from '../../app/admin/schedule/SchedulePage';
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

const appointment = {
  id: '00000008-0000-4000-8000-000000000101',
  windowStart: '2026-09-10T05:00:00.000Z',
  windowEnd: '2026-09-10T05:45:00.000Z',
  status: 'confirmed' as const,
  deliveryMode: 'home' as const,
  client: {
    id: '00000008-0000-4000-8000-000000000001',
    givenName: 'Iris',
    familyName: 'Cliff',
    givenNameAr: 'إيريس',
    familyNameAr: 'كليف',
  },
  practitioner: { id: '00000008-0000-4000-8000-000000000002', displayName: 'Cedar Ridge' },
  serviceType: { id: '00000008-0000-4000-8000-000000000003', name: 'Standard session' },
  location: { id: '00000008-0000-4000-8000-000000000004', label: 'home', emirate: 'DXB' },
  movedTo: null,
  sessionId: null,
  recordedFrom: null,
  settledOutsideApp: null,
  sessionMinutes: null,
};

/**
 * A visit still waiting for somebody to tell the household about it
 * (docs/SPEC/scheduling-manual.md section 3). Names from db/seed/names.ts.
 */
const proposed = {
  ...appointment,
  id: '00000008-0000-4000-8000-000000000102',
  status: 'proposed' as const,
  client: {
    id: '00000008-0000-4000-8000-000000000005',
    givenName: 'Juniper',
    familyName: 'Valley',
    givenNameAr: null,
    familyNameAr: null,
  },
};

/**
 * A visit moved on: the old row stays on its own day, marked rescheduled,
 * and the schedule should say where it went (the walk of 10 September).
 * Fri 11 Sept 10:00 Dubai time is 06:00 UTC.
 */
const rescheduled = {
  ...appointment,
  id: '00000008-0000-4000-8000-000000000106',
  status: 'rescheduled' as const,
  movedTo: {
    id: '00000008-0000-4000-8000-000000000107',
    windowStart: '2026-09-11T06:00:00.000Z',
  },
};

/**
 * A visit logged from the practice's records (trunk round 51) on a day gone
 * by: the one kind of row Void and Correct are offered on (trunk round 60).
 * Wed 4 March 15:30 Dubai time is 11:30 UTC; the window is always 45 minutes,
 * the visit itself ran 50.
 */
const fromRecords = {
  ...appointment,
  id: '00000008-0000-4000-8000-000000000108',
  windowStart: '2026-03-04T11:30:00.000Z',
  windowEnd: '2026-03-04T12:15:00.000Z',
  status: 'completed' as const,
  sessionId: '00000008-0000-4000-8000-000000000501',
  recordedFrom: 'records' as const,
  settledOutsideApp: false,
  sessionMinutes: 50,
};

/** The same visit closed on the phone: what the household really had. */
const fromDevice = {
  ...fromRecords,
  id: '00000008-0000-4000-8000-000000000109',
  sessionId: '00000008-0000-4000-8000-000000000502',
  recordedFrom: 'device' as const,
  client: proposed.client,
};

/** A visit logged in error and withdrawn: greyed, and nothing left to change. */
const voided = {
  ...fromRecords,
  id: '00000008-0000-4000-8000-000000000110',
  status: 'voided' as const,
  sessionId: '00000008-0000-4000-8000-000000000503',
  client: proposed.client,
};

const signedIn = { getAccessToken: async () => 'token' };

/** Signed in as someone holding these roles. Synthetic, in the reserved ranges. */
function me(roles: string[]) {
  return {
    userId: '00000008-0000-4000-8000-000000000901',
    displayName: 'Rowan Meadow',
    tenantId: '00000008-0000-4000-8000-000000000902',
    roles,
    capabilities: [],
  };
}

/** The day the screen opens on lives in the address, so the week view can
 * hand a day back; a router is what supplies that, and the two links out of
 * the toolbar need one anyway. */
function renderPage(fetchImpl: typeof fetch, date = '2026-09-10', auth: AuthProvider = provider) {
  return render(
    <AuthProviderBoundary provider={auth} fetchImpl={fetchImpl}>
      <MemoryRouter initialEntries={[`/admin/schedule?date=${date}`]}>
        <SchedulePage />
      </MemoryRouter>
    </AuthProviderBoundary>,
  );
}

describe('SchedulePage', () => {
  it("renders the day's appointments as rows with their window, client, practitioner, service, delivery and status", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/appointments?')) {
        return new Response(JSON.stringify({ appointments: [appointment] }), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    }) as unknown as typeof fetch;

    renderPage(fetchImpl);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Iris Cliff' })).toBeTruthy());
    // No Arabic name beneath the Latin one: the console is English only
    // (operator's decision of 7 September 2026, docs/DESIGN-BRIEF.md section
    // 10 item 4). The appointment still carries one on the wire.
    expect(screen.queryByText('إيريس كليف')).toBeNull();
    expect(screen.getByRole('cell', { name: 'Cedar Ridge' })).toBeTruthy();
    expect(screen.getByRole('cell', { name: 'Standard session' })).toBeTruthy();
    expect(screen.getByRole('cell', { name: 'Home' })).toBeTruthy();
    expect(screen.getByText('Confirmed')).toBeTruthy();
    expect(screen.getByText('09:00–09:45', plainText)).toBeTruthy();
    expect(screen.getByText('1 appointment')).toBeTruthy();
  });

  it('says where a rescheduled visit went, as a link to that day', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/appointments?')) {
        return new Response(JSON.stringify({ appointments: [rescheduled] }), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    }) as unknown as typeof fetch;

    renderPage(fetchImpl);

    await waitFor(() => expect(screen.getByText('Rescheduled')).toBeTruthy());
    const link = screen.getByRole('link', { name: 'Moved to Fri 11 Sept 10:00' });
    // The next day, in the same address the date field itself writes to.
    expect(link.getAttribute('href')).toBe('/admin/schedule?date=2026-09-11');
  });

  it("opens the client's own drawer from the client link, beside the ledger", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/appointments?')) {
        return new Response(JSON.stringify({ appointments: [appointment] }), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    }) as unknown as typeof fetch;

    renderPage(fetchImpl);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Iris Cliff' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Iris Cliff' }));

    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByRole('heading', { name: 'Iris Cliff' })).toBeTruthy();
    expect(within(drawer).queryByText('إيريس كليف')).toBeNull();
  });

  it('Add appointment is a secondary action beside the heading, not a second primary button', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ appointments: [] }), { status: 200 }),
    ) as unknown as typeof fetch;

    renderPage(fetchImpl);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add appointment' })).toBeTruthy(),
    );
    expect(screen.getByRole('button', { name: 'Add appointment' }).className).not.toContain(
      'button--primary',
    );
  });

  it('offers to log a past session on a day that has passed, and not on today', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/appointments?')) {
        return new Response(JSON.stringify({ appointments: [] }), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    }) as unknown as typeof fetch;

    renderPage(fetchImpl, '2026-03-04');
    await waitFor(() => expect(screen.getByText(/No appointments are booked/)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Log a past session' }));
    expect(screen.getByRole('dialog', { name: 'Log a past session' })).toBeTruthy();
    cleanup();

    // Today, in the practice's own zone: nothing is logged from records.
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(new Date());
    renderPage(fetchImpl, today);
    await waitFor(() => expect(screen.getByText(/No appointments are booked/)).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Log a past session' })).toBeNull();
  });

  it('shows the empty line in plain words when no appointments are booked', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ appointments: [] }), { status: 200 }),
    ) as unknown as typeof fetch;

    renderPage(fetchImpl);

    await waitFor(() =>
      expect(screen.getByText('No appointments are booked for this day.')).toBeTruthy(),
    );
  });

  it('offers Confirm on a visit the household has not been told about, and not on one it has', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/appointments?')) {
        return new Response(JSON.stringify({ appointments: [proposed, appointment] }), {
          status: 200,
        });
      }
      return new Response('not found', { status: 404 });
    }) as unknown as typeof fetch;

    renderPage(fetchImpl);

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: "Confirm Juniper Valley's appointment" }),
      ).toBeTruthy(),
    );
    // The confirmed visit keeps Move and Call off and gains nothing: there is
    // nothing left to tell anybody.
    expect(screen.queryByRole('button', { name: "Confirm Iris Cliff's appointment" })).toBe(null);
    expect(screen.getByRole('button', { name: "Move Iris Cliff's appointment" })).toBeTruthy();
  });

  it('records the household as told and reloads the day', async () => {
    const calls: string[] = [];
    let confirmed = false;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.startsWith('/api/appointments?')) {
        return new Response(
          JSON.stringify({
            appointments: [confirmed ? { ...proposed, status: 'confirmed' } : proposed],
          }),
          { status: 200 },
        );
      }
      if (url === `/api/appointments/${proposed.id}/confirm`) {
        confirmed = true;
        return new Response(JSON.stringify({ id: proposed.id, status: 'confirmed' }), {
          status: 200,
        });
      }
      return new Response('not found', { status: 404 });
    }) as unknown as typeof fetch;

    renderPage(fetchImpl);

    const button = await screen.findByRole('button', {
      name: "Confirm Juniper Valley's appointment",
    });
    fireEvent.click(button);

    await waitFor(() => expect(screen.getByText('Confirmed')).toBeTruthy());
    expect(calls).toContain(`POST /api/appointments/${proposed.id}/confirm`);
    // Confirming asks nothing and takes nothing, so no reason travels with it.
    expect(screen.queryByRole('button', { name: "Confirm Juniper Valley's appointment" })).toBe(
      null,
    );
  });

  it('says plainly when a visit somebody else has already moved on cannot be confirmed', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/appointments?')) {
        return new Response(JSON.stringify({ appointments: [proposed] }), { status: 200 });
      }
      if (url === `/api/appointments/${proposed.id}/confirm`) {
        return new Response(
          JSON.stringify({ error: 'bad_request', code: 'appointment_not_proposed' }),
          {
            status: 400,
          },
        );
      }
      return new Response('not found', { status: 404 });
    }) as unknown as typeof fetch;

    renderPage(fetchImpl);

    fireEvent.click(
      await screen.findByRole('button', { name: "Confirm Juniper Valley's appointment" }),
    );

    await waitFor(() =>
      expect(
        screen.getByText(
          'This visit is no longer waiting to be confirmed — it has been confirmed, moved or ' +
            'called off already. Reload the day to see where it stands.',
        ),
      ).toBeTruthy(),
    );
  });

  it('answers a failed load with a plain-words error, not a blank table', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('nope', { status: 500 }),
    ) as unknown as typeof fetch;

    renderPage(fetchImpl);

    await waitFor(() =>
      expect(
        screen.getByText("The day's appointments could not be loaded. Try again."),
      ).toBeTruthy(),
    );
  });
});

describe('SchedulePage: a visit logged from the records', () => {
  /** The day of 4 March, as the given roles see it; every POST is recorded. */
  function dayOf(roles: string[], rows: unknown[]) {
    const posts: { url: string; init: RequestInit | undefined }[] = [];
    // Settles once the page has read the signed-in answer: the screen's own
    // marker that it knows who is looking, and the thing a role test waits
    // on rather than on the clock.
    let meRead!: () => void;
    const signedInAnswered = new Promise<void>((resolve) => {
      meRead = resolve;
    });
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('/api/me')) {
        const res = new Response(JSON.stringify(me(roles)), { status: 200 });
        const read = res.json.bind(res);
        res.json = async () => {
          const body: unknown = await read();
          meRead();
          return body;
        };
        return res;
      }
      if (url.startsWith('/api/appointments?')) {
        return new Response(JSON.stringify({ appointments: rows }), { status: 200 });
      }
      if (init?.method === 'POST') posts.push({ url, init });
      return new Response('not found', { status: 404 });
    }) as unknown as typeof fetch;
    renderPage(fetchImpl, '2026-03-04', { ...provider, ...signedIn });
    /** The day on screen and the signed-in answer applied, in that order. */
    async function ready() {
      await waitFor(() => expect(screen.getByRole('button', { name: 'Iris Cliff' })).toBeTruthy());
      await signedInAnswered;
      await act(async () => {});
    }
    return Object.assign(posts, { ready });
  }

  it('offers Correct and Void on a visit logged from the records, to the owner', async () => {
    dayOf(['owner'], [fromRecords]);
    expect(await screen.findByRole('button', { name: "Void Iris Cliff's visit" })).toBeTruthy();
    expect(screen.getByRole('button', { name: "Correct Iris Cliff's visit" })).toBeTruthy();
    expect(screen.getByRole('button', { name: "Void Iris Cliff's visit" }).textContent).toBe(
      'Void',
    );
  });

  it('offers neither on a visit closed on the phone', async () => {
    dayOf(['owner'], [fromDevice, fromRecords]);
    await screen.findByRole('button', { name: "Void Iris Cliff's visit" });
    expect(screen.queryByRole('button', { name: "Void Juniper Valley's visit" })).toBeNull();
    expect(screen.queryByRole('button', { name: "Correct Juniper Valley's visit" })).toBeNull();
  });

  it('offers neither to finance, whose role cannot void a visit', async () => {
    // The control: the same wait, as the owner, already shows both actions,
    // so the wait reaches the signed-in page and the absence below is the
    // role gate's answer, not an actor not yet known.
    await dayOf(['owner'], [fromRecords]).ready();
    expect(screen.getByRole('button', { name: "Void Iris Cliff's visit" })).toBeTruthy();
    cleanup();

    await dayOf(['finance'], [fromRecords]).ready();
    expect(screen.queryByRole('button', { name: "Void Iris Cliff's visit" })).toBeNull();
    expect(screen.queryByRole('button', { name: "Correct Iris Cliff's visit" })).toBeNull();
  });

  it('shows a voided visit as Voided, with nothing left to change', async () => {
    dayOf(['owner'], [voided]);
    await waitFor(() => expect(screen.getByText('Voided')).toBeTruthy());
    const row = screen.getByRole('button', { name: 'Juniper Valley' }).closest('tr')!;
    expect(
      within(row)
        .queryAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Juniper Valley']);
  });

  it('opens the void drawer beside the day, and the correct drawer pre-filled from the row', async () => {
    dayOf(['owner'], [fromRecords]);
    fireEvent.click(await screen.findByRole('button', { name: "Void Iris Cliff's visit" }));
    expect(screen.getByRole('dialog', { name: 'Void this visit' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: "Correct Iris Cliff's visit" }));
    expect(screen.queryByRole('dialog', { name: 'Void this visit' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Correct a past session' })).toBeTruthy();
    expect((screen.getByLabelText('Start time') as HTMLInputElement).value).toBe('15:30');
  });
});
