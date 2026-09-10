// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { plainText } from '../scheduling/support';
import type { BoardResponse } from '../../app/api/appointments/schema';
import { BoardPage } from '../../app/admin/schedule/board/BoardPage';
import { blockOf, daySpan, gridColumns, hourLabels } from '../../app/admin/schedule/board/columns';
import { AuthProviderBoundary } from '../../app/shell/auth/AuthContext';
import type { AuthProvider } from '../../app/shell/auth/types';

/**
 * The board in jsdom (docs/SPEC/dispatch.md section 13): the states read from
 * the facts, an idle practitioner's row present, a drag opening the drawer
 * rather than committing, and every refusal the reassign route can give
 * answered in place with a sentence that names the way out.
 *
 * Names from db/seed/names.ts; ids in the reserved shape.
 */
afterEach(cleanup);

const provider: AuthProvider = {
  kind: 'development',
  signIn: async () => undefined,
  signOut: async () => undefined,
  getAccessToken: async () => 'token',
  onChange: () => () => undefined,
};

const DATE = '2026-09-04';

/**
 * A wall-clock time in the practice's own zone, on the wire as the route
 * sends it: `z.iso.datetime()` accepts UTC and nothing else, so a fixture
 * written with a `+04:00` offset would fail `BoardResponse.parse` rather than
 * reach the screen.
 */
const at = (time: string) => new Date(`${DATE}T${time}:00+04:00`).toISOString();

const CEDAR = '00000008-0000-4000-8000-000000000002';
const SAGE = '00000008-0000-4000-8000-000000000004';
const FINISHED_VISIT = '00000008-0000-4000-8000-000000000101';
const LATE_VISIT = '00000008-0000-4000-8000-000000000102';
/** A second visit that can still change hands, so a drag can re-target the drawer. */
const LIVE_VISIT = '00000008-0000-4000-8000-000000000104';
const SERVICE = {
  id: '00000008-0000-4000-8000-000000000003',
  name: 'Neurofeedback session',
  durationMinutes: 45,
};
const REASON = 'Cedar is unwell this afternoon.';
const OTHER_REASON = 'This one is nearer to Sage.';

const BOARD: BoardResponse = {
  date: DATE,
  latenessAvailable: true,
  practitioners: [
    {
      practitionerId: CEDAR,
      displayName: 'Cedar Ridge',
      visits: [
        {
          appointmentId: FINISHED_VISIT,
          windowStart: at('09:00'),
          windowEnd: at('09:45'),
          status: 'completed',
          state: 'finished',
          client: {
            id: '00000008-0000-4000-8000-000000000011',
            givenName: 'Iris',
            familyName: 'Cliff',
          },
          serviceType: SERVICE,
          emirate: 'DXB',
          checkedInAt: at('09:02'),
          closedAt: at('09:40'),
          lateness: { late: false, byMinutes: 0 },
        },
        {
          appointmentId: LATE_VISIT,
          windowStart: at('11:00'),
          windowEnd: at('11:45'),
          status: 'confirmed',
          state: 'running_late',
          client: {
            id: '00000008-0000-4000-8000-000000000012',
            givenName: 'Juniper',
            familyName: 'Valley',
          },
          serviceType: SERVICE,
          emirate: 'SHJ',
          checkedInAt: null,
          closedAt: null,
          lateness: { late: true, byMinutes: 20 },
        },
        {
          appointmentId: LIVE_VISIT,
          windowStart: at('14:00'),
          windowEnd: at('14:45'),
          status: 'proposed',
          state: 'waiting',
          client: {
            id: '00000008-0000-4000-8000-000000000013',
            givenName: 'Laurel',
            familyName: 'Creek',
          },
          serviceType: SERVICE,
          emirate: 'DXB',
          checkedInAt: null,
          closedAt: null,
          lateness: { late: false, byMinutes: 0 },
        },
      ],
    },
    { practitionerId: SAGE, displayName: 'Sage Harbour', visits: [] },
  ],
};

/** The same day on a deployment with no routing seam to price the drives with. */
const NO_SEAM: BoardResponse = {
  ...BOARD,
  latenessAvailable: false,
  practitioners: BOARD.practitioners.map((practitioner) => ({
    ...practitioner,
    visits: practitioner.visits.map((visit) => ({
      ...visit,
      lateness: null,
      state: visit.state === 'running_late' ? ('agreed' as const) : visit.state,
    })),
  })),
};

/** What the route answers a reassignment with: the row that stands, and the one it replaced. */
const REASSIGNED = {
  appointment: {
    id: '00000008-0000-4000-8000-000000000103',
    windowStart: at('11:00'),
    windowEnd: at('11:45'),
    status: 'confirmed',
    deliveryMode: 'home',
    client: {
      id: '00000008-0000-4000-8000-000000000012',
      givenName: 'Juniper',
      familyName: 'Valley',
      givenNameAr: null,
      familyNameAr: null,
    },
    practitioner: { id: SAGE, displayName: 'Sage Harbour' },
    serviceType: { id: SERVICE.id, name: SERVICE.name },
    location: { id: '00000008-0000-4000-8000-000000000021', label: 'home', emirate: 'SHJ' },
  },
  movedFrom: { id: LATE_VISIT, windowStart: at('11:00'), windowEnd: at('11:45') },
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

type Reassign = (body: unknown, reason: string | null) => Response;

function mount(options: { onReassign?: Reassign; board?: BoardResponse } = {}) {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/me') {
      return json({
        userId: '00000002-0000-4000-8000-000000000010',
        displayName: 'Hazel Harbour',
        tenantId: '00000001-0000-4000-8000-000000000001',
        roles: ['admin'],
        capabilities: [],
      });
    }
    if (url.startsWith('/api/appointments/board')) return json(options.board ?? BOARD);
    if (url.endsWith('/reassign')) {
      const headers = new Headers(init?.headers);
      const answer = options.onReassign ?? (() => json({ error: 'internal' }, 500));
      return answer(init?.body ? JSON.parse(String(init.body)) : null, headers.get('x-reason'));
    }
    return json({ error: 'not_found' }, 404);
  });
  render(
    <MemoryRouter initialEntries={[`/admin/schedule/board?date=${DATE}`]}>
      <AuthProviderBoundary provider={provider} fetchImpl={fetchImpl as unknown as typeof fetch}>
        <Routes>
          <Route path="/admin/schedule/board" element={<BoardPage />} />
        </Routes>
      </AuthProviderBoundary>
    </MemoryRouter>,
  );
  return { fetchImpl };
}

/** Open the drawer from the late visit's block, fill it in and send it. */
async function reassignTheLateVisit() {
  fireEvent.click(await screen.findByRole('button', { name: /Juniper Valley/ }));
  fireEvent.change(screen.getByLabelText('To'), { target: { value: SAGE } });
  fireEvent.change(screen.getByLabelText('Why'), { target: { value: REASON } });
  fireEvent.click(screen.getByRole('button', { name: 'Reassign' }));
}

describe('the board grid', () => {
  it('never draws a day narrower than the practice keeps', () => {
    const span = daySpan(DATE, []);
    expect(span.start.toISOString()).toBe(at('08:00'));
    expect(span.end.toISOString()).toBe(at('18:00'));
    expect(span.columns).toBe(40);
  });

  it('opens an hour before the first block and closes an hour after the last', () => {
    const span = daySpan(DATE, [
      { start: new Date(at('06:30')), end: new Date(at('07:15')) },
      { start: new Date(at('19:00')), end: new Date(at('19:45')) },
    ]);
    expect(span.start.toISOString()).toBe(at('05:00'));
    expect(span.end.toISOString()).toBe(at('21:00'));
    expect(span.columns).toBe(64);
  });

  it('spans a block over its arrival window and the service that follows it', () => {
    const block = blockOf(BOARD.practitioners[0]!.visits[0]!);
    expect(block.start.toISOString()).toBe(at('09:00'));
    // 09:45, the window's end, plus the service's own 45 minutes.
    expect(block.end.toISOString()).toBe(at('10:30'));
  });

  it('places a block on the quarter hours it covers, one-based', () => {
    const span = daySpan(DATE, []);
    expect(gridColumns(span, { start: new Date(at('08:00')), end: new Date(at('09:00')) })).toEqual(
      {
        start: 1,
        end: 5,
      },
    );
    expect(gridColumns(span, { start: new Date(at('09:00')), end: new Date(at('10:30')) })).toEqual(
      {
        start: 5,
        end: 11,
      },
    );
  });

  it('clips a block that runs past either end of the span', () => {
    const span = daySpan(DATE, []);
    expect(gridColumns(span, { start: new Date(at('06:00')), end: new Date(at('08:30')) })).toEqual(
      {
        start: 1,
        end: 3,
      },
    );
    expect(gridColumns(span, { start: new Date(at('17:30')), end: new Date(at('20:00')) })).toEqual(
      {
        start: 39,
        end: 41,
      },
    );
  });

  it('heads one clock hour every four columns', () => {
    const labels = hourLabels(daySpan(DATE, []));
    expect(labels).toHaveLength(10);
    expect(labels[0]).toEqual({ label: '08:00', column: 1 });
    expect(labels[9]).toEqual({ label: '17:00', column: 37 });
  });
});

describe('BoardPage', () => {
  it('shows every practitioner as a row, the idle one included, and each visit in its state', async () => {
    mount();
    expect(await screen.findByRole('heading', { name: 'Board' })).toBeTruthy();
    const rows = screen.getAllByRole('region');
    expect(rows.map((row) => row.getAttribute('aria-label'))).toEqual([
      'Cedar Ridge',
      'Sage Harbour',
    ]);
    expect(within(rows[1]!).getByText('Nothing on')).toBeTruthy();
    expect(screen.getByText('Finished')).toBeTruthy();
    expect(screen.getByText('Running late, 20 min')).toBeTruthy();
    expect(screen.getByText('Iris Cliff')).toBeTruthy();
    expect(screen.getByText('09:00–09:45', plainText)).toBeTruthy();
  });

  it('leaves a settled visit as a fact on the board rather than a control', async () => {
    mount();
    await screen.findByRole('heading', { name: 'Board' });
    // Delivered: it cannot change hands, so it is not something to press.
    expect(screen.queryByRole('button', { name: /Iris Cliff/ })).toBeNull();
    expect(screen.getByText('Iris Cliff')).toBeTruthy();
  });

  it('leaves a visit at the door alone, whatever its status still says', async () => {
    // `boardState` calls a `confirmed` appointment with an open session "at
    // the door". The route would refuse to hand it on (`session_open`), so
    // the board must not offer the control: the state on the block is the
    // decision, not a second reading of the status beside it.
    mount({
      board: {
        ...BOARD,
        practitioners: BOARD.practitioners.map((practitioner) => ({
          ...practitioner,
          visits: practitioner.visits.map((visit) =>
            visit.appointmentId === LATE_VISIT
              ? { ...visit, state: 'at_the_door' as const, checkedInAt: at('11:05') }
              : visit,
          ),
        })),
      },
    });
    expect(await screen.findByText('At the door')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Juniper Valley/ })).toBeNull();
  });

  it('reads the day the address names', async () => {
    const { fetchImpl } = mount();
    await screen.findByRole('heading', { name: 'Board' });
    await waitFor(() =>
      expect(
        fetchImpl.mock.calls.map((call) => String(call[0])).filter((url) => url.includes('/board')),
      ).toEqual([`/api/appointments/board?date=${DATE}`]),
    );
  });

  it('opens the drawer prefilled from a drag rather than committing on drop', async () => {
    const onReassign = vi.fn(() => json({ error: 'internal' }, 500));
    mount({ onReassign });
    const block = await screen.findByRole('button', { name: /Juniper Valley/ });
    const target = screen.getByRole('region', { name: 'Sage Harbour' });
    fireEvent.dragStart(block, { dataTransfer: { setData: vi.fn(), getData: () => '' } });
    fireEvent.drop(target, { dataTransfer: { getData: () => LATE_VISIT } });
    expect(await screen.findByRole('dialog', { name: 'Reassign the visit' })).toBeTruthy();
    expect((screen.getByLabelText('To') as HTMLSelectElement).value).toBe(SAGE);
    expect(onReassign).not.toHaveBeenCalled();
  });

  it('puts the board out of reach while the drawer is open, and closes on Escape', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /Juniper Valley/ }));
    const drawer = await screen.findByRole('dialog', { name: 'Reassign the visit' });
    // The console's shared drawer behaviour: everything beside the drawer is
    // inert, so the board behind cannot be tabbed into, read out or dragged
    // while a reassignment is being written.
    const behind = [...(drawer.parentElement?.children ?? [])].filter((each) => each !== drawer);
    expect(behind.length).toBeGreaterThan(0);
    expect(behind.map((each) => (each as HTMLElement).inert)).toEqual(behind.map(() => true));
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('starts a fresh drawer when it is re-targeted at another visit', async () => {
    const onReassign = vi.fn(() => json(REASSIGNED, 201));
    const { fetchImpl } = mount({ onReassign });
    // Open on the late visit and say why that one is changing hands.
    fireEvent.click(await screen.findByRole('button', { name: /Juniper Valley/ }));
    fireEvent.change(screen.getByLabelText('Why'), { target: { value: REASON } });
    // A drop of the other live visit re-targets the drawer. Nothing typed for
    // the first visit may survive into the second: the reason is the audited
    // record of why one particular promise changed hands.
    fireEvent.drop(screen.getByRole('region', { name: 'Sage Harbour' }), {
      dataTransfer: { getData: () => LIVE_VISIT },
    });
    const drawer = await screen.findByRole('dialog', { name: 'Reassign the visit' });
    expect(within(drawer).getByText('Laurel Creek')).toBeTruthy();
    expect((screen.getByLabelText('Why') as HTMLInputElement).value).toBe('');
    fireEvent.change(screen.getByLabelText('Why'), { target: { value: OTHER_REASON } });
    fireEvent.click(screen.getByRole('button', { name: 'Reassign' }));
    await waitFor(() => expect(onReassign).toHaveBeenCalledTimes(1));
    const sent = fetchImpl.mock.calls.find((call) => String(call[0]).endsWith('/reassign'));
    expect(String(sent?.[0])).toBe(`/api/appointments/${LIVE_VISIT}/reassign`);
    expect(new Headers(sent?.[1]?.headers).get('x-reason')).toBe(OTHER_REASON);
  });

  it('leaves a visit where it is when it is dropped back on its own row', async () => {
    mount();
    const block = await screen.findByRole('button', { name: /Juniper Valley/ });
    fireEvent.dragStart(block, { dataTransfer: { setData: vi.fn(), getData: () => '' } });
    fireEvent.drop(screen.getByRole('region', { name: 'Cedar Ridge' }), {
      dataTransfer: { getData: () => LATE_VISIT },
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('sends the reason and the new practitioner, and redraws on success', async () => {
    const onReassign = vi.fn(() => json(REASSIGNED, 201));
    const { fetchImpl } = mount({ onReassign });
    await reassignTheLateVisit();
    await waitFor(() => expect(onReassign).toHaveBeenCalledWith({ practitionerId: SAGE }, REASON));
    await waitFor(() =>
      expect(fetchImpl.mock.calls.filter((call) => String(call[0]).includes('/board')).length).toBe(
        2,
      ),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it("refuses in place, in the console's own words, when the slot is taken", async () => {
    mount({
      onReassign: () =>
        json(
          {
            error: 'conflict',
            issues: [
              {
                code: 'practitioner_overlap',
                message: 'Practitioner already has an appointment in this window.',
                conflictsWithAppointmentId: null,
              },
            ],
            requestId: null,
          },
          409,
        ),
    });
    await reassignTheLateVisit();
    expect(
      await screen.findByText(
        'This practitioner is already booked close to this time. Choose a different time or practitioner.',
      ),
    ).toBeTruthy();
  });

  it.each([
    [400, 'same_practitioner', 'That is the practitioner it is already with.'],
    [
      400,
      'appointment_settled',
      'This visit has already been checked in, delivered, called off or moved. Reload the board to see where it stands.',
    ],
    [
      400,
      'session_open',
      'A session has already been started for this visit, so it cannot change hands now.',
    ],
    [400, 'reason_required', 'Say why this visit is changing hands before it does.'],
    [
      400,
      'practitioner_not_found',
      'That practitioner is no longer on the practice. Reload the board and choose somebody else.',
    ],
    [400, 'invalid_request', 'Check the practitioner and try again.'],
    [
      404,
      'appointment_not_found',
      'This appointment is no longer there. Close this and reload the board.',
    ],
  ])('answers a %i %s in place', async (status, code, sentence) => {
    mount({ onReassign: () => json({ error: 'bad_request', code, requestId: null }, status) });
    await reassignTheLateVisit();
    expect(await screen.findByText(sentence)).toBeTruthy();
  });

  it('says so when the practitioner may not take this visit', async () => {
    mount({ onReassign: () => json({ error: 'forbidden', requestId: null }, 403) });
    await reassignTheLateVisit();
    expect(
      await screen.findByText(
        'That practitioner is not certified for this service on that day. Choose another practitioner, or reload the board if your own access has changed.',
      ),
    ).toBeTruthy();
  });

  it('says when running late cannot be worked out', async () => {
    mount({ board: NO_SEAM });
    expect(
      await screen.findByText(
        'Running late cannot be worked out on this deployment: no drive estimates are configured.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText('Running late, 20 min')).toBeNull();
    expect(screen.getByText('Agreed')).toBeTruthy();
  });

  it('says so when the board cannot be read at all', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/me') {
        return json({
          userId: '00000002-0000-4000-8000-000000000010',
          displayName: 'Hazel Harbour',
          tenantId: '00000001-0000-4000-8000-000000000001',
          roles: ['admin'],
          capabilities: [],
        });
      }
      return json({ error: 'bad_request', requestId: null }, 400);
    });
    render(
      <MemoryRouter initialEntries={[`/admin/schedule/board?date=${DATE}`]}>
        <AuthProviderBoundary provider={provider} fetchImpl={fetchImpl as unknown as typeof fetch}>
          <Routes>
            <Route path="/admin/schedule/board" element={<BoardPage />} />
          </Routes>
        </AuthProviderBoundary>
      </MemoryRouter>,
    );
    expect(await screen.findByText('The board could not be loaded. Try again.')).toBeTruthy();
  });
});
