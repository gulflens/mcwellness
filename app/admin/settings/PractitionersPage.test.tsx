// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FAMILY_NAMES, GIVEN_NAMES } from '../../../db/seed/names';
import { AuthProviderBoundary } from '../../shell/auth/AuthContext';
import type { AuthProvider } from '../../shell/auth/types';
import { PractitionersPage } from './PractitionersPage';

/**
 * Settings › Practitioners: the ledger of who treats and where each one's day
 * starts, and the drawer that sets it
 * (docs/SPEC/route-planning.md section 5.4).
 *
 * **No name and no coordinate is invented here.** The names come from
 * `db/seed/names.ts`, the one list every synthetic person in this repository
 * is named from, and the point is the seed's own synthetic lattice — the
 * Dubai centre `db/seed/generate.ts` places its grid on, and the same one
 * `tests/scheduling/DayMap.test.tsx` draws with. `generateSeed()` itself
 * cannot run here: it reads the consent wording off the disk, and this test
 * is in jsdom. A home base is a real person's home, so a plausible one has no
 * business in a test either.
 */

afterEach(cleanup);

/** The seed's own lattice origin for Dubai (db/seed/generate.ts). */
const POINT = { entrance: { lat: 25.2, lng: 55.27 }, emirate: 'DXB' } as const;

function name(given: number, family: number): string {
  const first = GIVEN_NAMES[given]?.en;
  const last = FAMILY_NAMES[family]?.en;
  if (!first || !last) throw new Error('The name lists are shorter than this file expects.');
  return `${first} ${last}`;
}
const FIRST_NAME = name(7, 4);
const SECOND_NAME = name(9, 9);

const PRACTITIONERS = {
  withBase: {
    id: '00000005-0000-4000-8000-000000000001',
    displayName: FIRST_NAME,
    isYou: false,
    base: {
      locationId: '00000007-0000-4000-8000-000000000009',
      point: { lat: POINT.entrance.lat, lng: POINT.entrance.lng },
      emirate: POINT.emirate,
    },
  },
  withNone: {
    id: '00000005-0000-4000-8000-000000000002',
    displayName: SECOND_NAME,
    isYou: true,
    base: null,
  },
} as const;

const provider: AuthProvider = {
  kind: 'development',
  signIn: async () => undefined,
  signOut: async () => undefined,
  getAccessToken: async () => 'token',
  onChange: () => () => undefined,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

type Call = { url: string; init?: RequestInit };

function mount(
  options: {
    roles?: string[];
    list?: Response | (() => Response);
    save?: (call: Call) => Response;
  } = {},
) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), init };
    calls.push(call);
    if (call.url === '/api/me') {
      return json({
        userId: '00000002-0000-4000-8000-000000000002',
        displayName: SECOND_NAME,
        tenantId: '00000001-0000-4000-8000-000000000001',
        roles: options.roles ?? ['admin'],
        capabilities: [],
      });
    }
    if (call.url === '/api/practitioners') {
      const answer = options.list ?? json({ practitioners: [], scope: null });
      return typeof answer === 'function' ? answer() : answer.clone();
    }
    return (options.save ?? (() => json({ error: 'internal' }, 500)))(call);
  }) as unknown as typeof fetch;

  render(
    <MemoryRouter>
      <AuthProviderBoundary provider={provider} fetchImpl={fetchImpl}>
        <PractitionersPage />
      </AuthProviderBoundary>
    </MemoryRouter>,
  );
  return { calls };
}

const saves = (calls: Call[]) => calls.filter((call) => call.init?.method === 'PUT');

async function openTheDrawer(name: string): Promise<void> {
  fireEvent.click(await screen.findByRole('button', { name }));
  await screen.findByRole('dialog', { name: 'Set the home base' });
}

describe('Settings › Practitioners — the table', () => {
  it('shows the office every practitioner, whether a base is recorded and its emirate', async () => {
    mount({
      list: json({
        practitioners: [PRACTITIONERS.withBase, PRACTITIONERS.withNone],
        scope: null,
      }),
    });
    expect(await screen.findByText(FIRST_NAME)).toBeTruthy();
    expect(screen.getByText(SECOND_NAME)).toBeTruthy();
    expect(screen.getByText('Recorded')).toBeTruthy();
    expect(screen.getByText('Not set')).toBeTruthy();
    // The scope note belongs to a practitioner's own view and not to this one.
    expect(screen.queryByText(/You are shown your own home base/)).toBeNull();
  });

  it('never puts the coordinate itself in the table', async () => {
    mount({ list: json({ practitioners: [PRACTITIONERS.withBase], scope: null }) });
    await screen.findByText(FIRST_NAME);
    const table = screen.getByRole('table');
    expect(table.textContent).not.toContain(String(POINT.entrance.lat));
    expect(table.textContent).not.toContain(String(POINT.entrance.lng));
  });

  it('shows a practitioner one row, their own, and says why there is one', async () => {
    mount({
      roles: ['practitioner'],
      list: json({ practitioners: [PRACTITIONERS.withNone], scope: 'own' }),
    });
    expect(await screen.findByText(/You are shown your own home base/)).toBeTruthy();
    expect(screen.getAllByRole('row')).toHaveLength(2); // the header and one person
    expect(screen.getByText('(you)')).toBeTruthy();
  });

  it('says a day with no base has no first drive', async () => {
    mount({ list: json({ practitioners: [PRACTITIONERS.withNone], scope: null }) });
    expect(await screen.findByText(/no first drive/)).toBeTruthy();
  });

  it('says whose the base is when the answer is a refusal', async () => {
    mount({ list: json({ error: 'forbidden' }, 403) });
    expect(await screen.findByText(/is the practitioner/)).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });
});

describe('Settings › Practitioners — the drawer', () => {
  it('says what the practice keeps, and offers no box for anything else', async () => {
    mount({ list: json({ practitioners: [PRACTITIONERS.withNone], scope: 'own' }) });
    await openTheDrawer('Set the home base');

    expect(
      screen.getByText(
        "This is where this practitioner's driving day starts and ends. The practice keeps the " +
          'coordinate and nothing else — no address, no notes.',
      ),
    ).toBeTruthy();
    // The three controls a person standing at their own front door needs.
    expect(screen.getByLabelText('Latitude')).toBeTruthy();
    expect(screen.getByLabelText('Longitude')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Use my current position' })).toBeTruthy();
    expect(screen.getByLabelText('Why is this being set?')).toBeTruthy();
    // And no box for the things a base is deliberately never given.
    expect(screen.queryByLabelText(/address/i)).toBeNull();
    expect(screen.queryByLabelText(/notes/i)).toBeNull();
    expect(screen.queryByLabelText(/makani/i)).toBeNull();
  });

  it('opens on the base already recorded', async () => {
    mount({ list: json({ practitioners: [PRACTITIONERS.withBase], scope: null }) });
    await openTheDrawer('Change the home base');
    expect((screen.getByLabelText('Latitude') as HTMLInputElement).value).toBe(
      String(POINT.entrance.lat),
    );
    expect((screen.getByLabelText('Emirate') as HTMLSelectElement).value).toBe(POINT.emirate);
  });

  it('sends the point, the emirate and the reason, and reads the row back', async () => {
    const saved = {
      ...PRACTITIONERS.withNone,
      base: {
        locationId: '00000007-0000-4000-8000-000000000009',
        point: { lat: POINT.entrance.lat, lng: POINT.entrance.lng },
        emirate: POINT.emirate,
      },
    };
    const { calls } = mount({
      list: json({ practitioners: [PRACTITIONERS.withNone], scope: 'own' }),
      save: () => json({ practitioner: saved }),
    });
    await openTheDrawer('Set the home base');
    fireEvent.change(screen.getByLabelText('Latitude'), {
      target: { value: String(POINT.entrance.lat) },
    });
    fireEvent.change(screen.getByLabelText('Longitude'), {
      target: { value: String(POINT.entrance.lng) },
    });
    fireEvent.change(screen.getByLabelText('Emirate'), { target: { value: POINT.emirate } });
    fireEvent.change(screen.getByLabelText('Why is this being set?'), {
      target: { value: 'Recording my own base.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save the home base' }));

    await waitFor(() => expect(saves(calls)).toHaveLength(1));
    const sent = saves(calls)[0];
    expect(sent?.url).toBe(`/api/practitioners/${PRACTITIONERS.withNone.id}/base`);
    expect(new Headers(sent?.init?.headers).get('x-reason')).toBe('Recording my own base.');
    expect(JSON.parse(String(sent?.init?.body))).toEqual({
      lat: POINT.entrance.lat,
      lng: POINT.entrance.lng,
      emirate: POINT.emirate,
    });

    expect(await screen.findByText('The home base is saved.')).toBeTruthy();
    expect(screen.getByText('Recorded')).toBeTruthy();
  });

  it('sends nothing without a reason', async () => {
    const { calls } = mount({
      list: json({ practitioners: [PRACTITIONERS.withNone], scope: 'own' }),
      save: () => json({ practitioner: PRACTITIONERS.withNone }),
    });
    await openTheDrawer('Set the home base');
    fireEvent.change(screen.getByLabelText('Latitude'), {
      target: { value: String(POINT.entrance.lat) },
    });
    fireEvent.change(screen.getByLabelText('Longitude'), {
      target: { value: String(POINT.entrance.lng) },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save the home base' }));

    expect(await screen.findByText('Say why this is being set before saving.')).toBeTruthy();
    expect(saves(calls)).toHaveLength(0);
  });

  it('sends nothing without a point', async () => {
    const { calls } = mount({
      list: json({ practitioners: [PRACTITIONERS.withNone], scope: 'own' }),
      save: () => json({ practitioner: PRACTITIONERS.withNone }),
    });
    await openTheDrawer('Set the home base');
    fireEvent.change(screen.getByLabelText('Why is this being set?'), {
      target: { value: 'Trying to save nothing.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save the home base' }));

    expect(await screen.findByText('A base needs both a latitude and a longitude.')).toBeTruthy();
    expect(saves(calls)).toHaveLength(0);
  });

  it('says whose the base is when the server refuses the save', async () => {
    mount({
      roles: ['practitioner'],
      list: json({ practitioners: [PRACTITIONERS.withNone], scope: 'own' }),
      save: () => json({ error: 'forbidden' }, 403),
    });
    await openTheDrawer('Set the home base');
    fireEvent.change(screen.getByLabelText('Latitude'), {
      target: { value: String(POINT.entrance.lat) },
    });
    fireEvent.change(screen.getByLabelText('Longitude'), {
      target: { value: String(POINT.entrance.lng) },
    });
    fireEvent.change(screen.getByLabelText('Why is this being set?'), {
      target: { value: 'Trying it on.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save the home base' }));

    expect(await screen.findByText('A home base is the practitioner’s own to set.')).toBeTruthy();
  });
});
