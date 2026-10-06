// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { plainText } from './support';
import type { AppointmentRow } from '../../app/api/appointments/schema';
import { WeekPage } from '../../app/admin/schedule/WeekPage';
import { AuthProviderBoundary } from '../../app/shell/auth/AuthContext';
import type { AuthProvider } from '../../app/shell/auth/types';

afterEach(cleanup);

/**
 * The week (docs/SPEC/scheduling-manual.md sections 4.1 and 5.2): seven days
 * across, the same facts the day's own rows carry, and the day's own actions
 * on each visit through the day's own drawers.
 */

const provider: AuthProvider = {
  kind: 'development',
  signIn: async () => undefined,
  signOut: async () => undefined,
  getAccessToken: async () => null,
  onChange: () => () => undefined,
};

// Thursday 10 September 2026; the week it falls in runs Monday the 7th to
// Sunday the 13th.
const ANCHOR = '2026-09-10';
const MONDAY = '2026-09-07';
const SUNDAY = '2026-09-13';

function appointmentOn(date: string, id: string): AppointmentRow {
  return {
    id,
    windowStart: `${date}T05:00:00.000Z`,
    windowEnd: `${date}T05:45:00.000Z`,
    status: 'confirmed',
    deliveryMode: 'home',
    client: {
      id: '0000000b-0000-4000-8000-000000000001',
      givenName: 'Iris',
      familyName: 'Cliff',
      givenNameAr: 'إيريس',
      familyNameAr: 'كليف',
    },
    practitioner: { id: '0000000b-0000-4000-8000-000000000002', displayName: 'Cedar Ridge' },
    serviceType: { id: '0000000b-0000-4000-8000-000000000003', name: 'Standard session' },
    location: { id: '0000000b-0000-4000-8000-000000000004', label: 'home', emirate: 'DXB' },
    movedTo: null,
    sessionId: null,
    recordedFrom: null,
    settledOutsideApp: null,
    sessionMinutes: null,
  };
}

/** One appointment on the anchor day and nothing on the other six. */
function week(): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost');
    const date = url.searchParams.get('date');
    const appointments =
      date === ANCHOR ? [appointmentOn(ANCHOR, '0000000b-0000-4000-8000-000000000101')] : [];
    return new Response(JSON.stringify({ appointments }), { status: 200 });
  }) as unknown as typeof fetch;
}

function renderWeek(fetchImpl: typeof fetch, date = ANCHOR) {
  return render(
    <AuthProviderBoundary provider={provider} fetchImpl={fetchImpl}>
      <MemoryRouter initialEntries={[`/admin/schedule/week?date=${date}`]}>
        <WeekPage />
      </MemoryRouter>
    </AuthProviderBoundary>,
  );
}

function datesAsked(fetchImpl: typeof fetch): string[] {
  const calls = (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls;
  return calls
    .map((call) => new URL(String(call[0]), 'http://localhost').searchParams.get('date'))
    .filter((date): date is string => date !== null)
    .sort();
}

describe('the week keeps seven columns', () => {
  // jsdom lays nothing out, so the assertion is on the rule rather than on the
  // rendered width: the grid is seven columns, and nothing between a phone and
  // a wide screen folds them into fewer. A laptop at 1024px used to get
  // 3 + 3 + 1, which is not a week — the reader loses the one thing they came
  // for, Monday to Sunday side by side (design review of this pull request).
  // What gives at that width is how much each stop says, not where it sits.
  // Read from the repository root, which is where vitest runs: this file is a
  // jsdom test, so `import.meta.url` here is an http URL and not a path.
  const css = readFileSync('app/admin/schedule/schedule.css', 'utf8');

  it('declares seven columns and folds them only in the compact tier', () => {
    expect(css).toContain('grid-template-columns: repeat(7, minmax(0, 1fr))');
    // Every media query that changes the week's column count, with its width.
    // The fold belongs to the shell's compact tier and nowhere else
    // (docs/SPEC/responsive-console.md section 4): a week narrower than that
    // is four characters a column and is not a week at all.
    const folds = [...css.matchAll(/@media \(max-width: (\d+)px\)\s*\{\s*\.week\s*\{/g)];
    expect(folds).toHaveLength(1);
    for (const [, width] of folds) {
      expect(Number(width), `a fold at ${width}px`).toBe(767);
    }
  });

  it('renders all seven days whatever the width', async () => {
    const { container } = render(
      <AuthProviderBoundary provider={provider} fetchImpl={week()}>
        <MemoryRouter initialEntries={[`/admin/schedule/week?date=${ANCHOR}`]}>
          <WeekPage />
        </MemoryRouter>
      </AuthProviderBoundary>,
    );
    await screen.findByText('Iris Cliff');
    expect(container.querySelectorAll('.week__day')).toHaveLength(7);
  });
});

describe('WeekPage', () => {
  it('asks for the seven days of the week the chosen day falls in, Monday first', async () => {
    const fetchImpl = week();
    renderWeek(fetchImpl);
    await screen.findByText('1 appointment');
    const asked = datesAsked(fetchImpl);
    expect(asked).toHaveLength(7);
    expect(asked[0]).toBe(MONDAY);
    expect(asked[6]).toBe(SUNDAY);
  });

  it("carries the same facts a day's own row carries", async () => {
    renderWeek(week());
    expect(await screen.findByText('Iris Cliff')).toBeTruthy();
    expect(screen.getByText('09:00–09:45', plainText)).toBeTruthy();
    expect(screen.getByText('Cedar Ridge')).toBeTruthy();
    expect(screen.getByText('Standard session, Home')).toBeTruthy();
    expect(screen.getByText('Confirmed')).toBeTruthy();
    // And no Arabic name: the console is English only (operator's decision of
    // 7 September 2026, docs/DESIGN-BRIEF.md section 10 item 4). The fixture
    // still carries one, which is the point — Arabic on the wire breaks
    // nothing, it is simply not drawn.
    expect(screen.queryByText('إيريس كليف')).toBeNull();
  });

  it('keeps the arrival window in one order in a right-to-left layout', async () => {
    // jsdom does not run the bidirectional algorithm, so what is asserted is
    // the thing that makes the browser get it right: the range is isolated, so
    // an Arabic name beside it cannot reorder it into 09:45–09:00 — the
    // practice telling a household the wrong hour.
    const { container } = render(
      <AuthProviderBoundary provider={provider} fetchImpl={week()}>
        <MemoryRouter initialEntries={[`/admin/schedule/week?date=${ANCHOR}`]}>
          <div dir="rtl" lang="ar">
            <WeekPage />
          </div>
        </MemoryRouter>
      </AuthProviderBoundary>,
    );
    await screen.findByText('Iris Cliff');
    const window = container.querySelector('.week__window');
    const text = window?.textContent ?? '';
    expect(text.startsWith('\u2066')).toBe(true);
    expect(text.endsWith('\u2069')).toBe(true);
    expect(text.indexOf('09:00')).toBeLessThan(text.indexOf('09:45'));
  });

  it('marks today, drawn and announced', async () => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(new Date());
    const { container } = render(
      <AuthProviderBoundary provider={provider} fetchImpl={week()}>
        <MemoryRouter initialEntries={[`/admin/schedule/week?date=${today}`]}>
          <WeekPage />
        </MemoryRouter>
      </AuthProviderBoundary>,
    );
    await waitFor(() => expect(container.querySelectorAll('.week__day')).toHaveLength(7));
    // Exactly one column, and it is the one whose heading names today.
    const marked = container.querySelectorAll('.week__day--today');
    expect(marked).toHaveLength(1);
    // A week is read to find where one is in it, so the mark is not visual only.
    expect(marked[0]?.getAttribute('aria-current')).toBe('date');
    expect(container.querySelectorAll('[aria-current="date"]')).toHaveLength(1);
  });

  it('says plainly which days hold nothing', async () => {
    renderWeek(week());
    await screen.findByText('Iris Cliff');
    // Six of the seven, in this fixture.
    expect(screen.getAllByText('Nothing booked.')).toHaveLength(6);
  });

  it("offers the day's own actions on a visit still open, and books nothing", async () => {
    renderWeek(week());
    await screen.findByText('Iris Cliff');
    expect(screen.getByRole('button', { name: "Move Iris Cliff's appointment" })).toBeTruthy();
    expect(screen.getByRole('button', { name: "Call off Iris Cliff's appointment" })).toBeTruthy();
    // Confirmed already: there is nobody left to tell.
    expect(screen.queryByRole('button', { name: "Confirm Iris Cliff's appointment" })).toBeNull();
    // Booking stays on the day, where the coordinator sees what else it holds.
    expect(screen.queryByRole('button', { name: 'Add appointment' })).toBeNull();
  });

  it("opens the day's own drawers from a card, one at a time", async () => {
    renderWeek(week());
    fireEvent.click(
      await screen.findByRole('button', { name: "Call off Iris Cliff's appointment" }),
    );
    expect(screen.getByRole('dialog', { name: 'Call off appointment' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: "Move Iris Cliff's appointment" }));
    expect(screen.queryByRole('dialog', { name: 'Call off appointment' })).toBeNull();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it('confirms a proposed visit from its card and reads the week again', async () => {
    const proposedId = '0000000b-0000-4000-8000-000000000102';
    let confirmed = false;
    const posts: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost');
      if (init?.method === 'POST') {
        posts.push(url.pathname);
        confirmed = true;
        return new Response('{}', { status: 200 });
      }
      const date = url.searchParams.get('date');
      const appointments =
        date === ANCHOR
          ? [{ ...appointmentOn(ANCHOR, proposedId), status: confirmed ? 'confirmed' : 'proposed' }]
          : [];
      return new Response(JSON.stringify({ appointments }), { status: 200 });
    }) as unknown as typeof fetch;
    renderWeek(fetchImpl);
    fireEvent.click(
      await screen.findByRole('button', { name: "Confirm Iris Cliff's appointment" }),
    );
    await waitFor(() => expect(screen.getByText('Confirmed')).toBeTruthy());
    expect(posts).toEqual([`/api/appointments/${proposedId}/confirm`]);
  });

  it('folds called-off visits away until the switch asks for them', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost');
      const date = url.searchParams.get('date');
      const appointments =
        date === ANCHOR
          ? [
              appointmentOn(ANCHOR, '0000000b-0000-4000-8000-000000000101'),
              {
                ...appointmentOn(ANCHOR, '0000000b-0000-4000-8000-000000000103'),
                status: 'cancelled_late',
                client: { ...appointmentOn(ANCHOR, 'x').client, givenName: 'Juniper' },
              },
            ]
          : [];
      return new Response(JSON.stringify({ appointments }), { status: 200 });
    }) as unknown as typeof fetch;
    renderWeek(fetchImpl);
    await screen.findByText('Iris Cliff');
    expect(screen.queryByText('Juniper Cliff')).toBeNull();
    expect(screen.getByText('1 appointment')).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: /Show called-off visits/ }));
    expect(screen.getByText('Juniper Cliff')).toBeTruthy();
    expect(screen.getByText('Cancelled late')).toBeTruthy();
    // Called off is called off: no Move, no Call off on it.
    expect(screen.queryByRole('button', { name: "Move Juniper Cliff's appointment" })).toBeNull();
  });

  it('moves a week at a time, and hands a day back to the day view', async () => {
    const fetchImpl = week();
    renderWeek(fetchImpl);
    await screen.findByText('1 appointment');

    expect(screen.getByRole('link', { name: 'Back to the day' }).getAttribute('href')).toBe(
      `/admin/schedule?date=${ANCHOR}`,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Next week' }));
    await waitFor(() => {
      expect(datesAsked(fetchImpl)).toContain('2026-09-20');
    });
  });
});
