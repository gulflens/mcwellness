// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  STAFF_LOCATION_NOTICE_VERSION,
  SHIFT_LEAD_MINUTES,
  SHIFT_TAIL_MINUTES,
} from '@domain/scheduling';
import { LOCATION_NOTICE } from '../../app/therapist/location/notice';
import {
  LocationSharing,
  POSITION_INTERVAL_MS,
} from '../../app/therapist/location/LocationSharing';
import { AuthProviderBoundary } from '../../app/shell/auth/AuthContext';
import type { AuthProvider } from '../../app/shell/auth/types';

/**
 * "Share my location while I work" on the practitioner's day
 * (docs/SPEC/dispatch.md section 15): the switch, the notice the first time,
 * the band the whole time it is on, and sending that stops the moment it is
 * turned off. Every id and coordinate is synthetic.
 */

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const ME = {
  userId: '00000002-0000-4000-8000-000000000009',
  displayName: 'Rowan Meadow',
  tenantId: '00000001-0000-4000-8000-000000000001',
  roles: ['practitioner'],
  capabilities: [],
};

const provider: AuthProvider = {
  kind: 'development',
  signIn: async () => undefined,
  signOut: async () => undefined,
  getAccessToken: async () => 'token',
  onChange: () => () => undefined,
};

type Status = {
  eligible: boolean;
  noticeVersion: string;
  consent: { noticeVersion: string; givenAt: string } | null;
  sharingOn: boolean;
  shiftOpen: boolean;
};

const OFF: Status = {
  eligible: true,
  noticeVersion: '1.1',
  consent: null,
  sharingOn: false,
  shiftOpen: true,
};
const AGREED = { noticeVersion: '1.1', givenAt: '2026-10-06T06:00:00.000Z' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** A geolocation that answers at once with one synthetic fix, and counts how often it was asked. */
function fakeGeolocation() {
  return {
    getCurrentPosition: vi.fn((success: PositionCallback) => {
      success({
        coords: { latitude: 25.2, longitude: 55.27, accuracy: 12 },
        timestamp: 0,
      } as unknown as GeolocationPosition);
    }),
  };
}

/**
 * Mounts the switch against a server whose state is `status`, which the
 * writes change as the real routes would. Hands back the fetch and the state.
 */
function mount(initial: Status, geolocation = fakeGeolocation()) {
  const server = { status: { ...initial } };
  const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    if (url === '/api/me') return json(ME);
    if (url === '/api/location/me') return json(server.status);
    if (url === '/api/location/consent' && init?.method === 'POST') {
      server.status = { ...server.status, consent: AGREED, sharingOn: true };
      return new Response(null, { status: 204 });
    }
    if (url === '/api/location/consent/withdraw') {
      server.status = { ...server.status, consent: null, sharingOn: false };
      return new Response(null, { status: 204 });
    }
    if (url === '/api/location/sharing') {
      const body = JSON.parse(String(init?.body)) as { on: boolean };
      server.status = { ...server.status, sharingOn: body.on };
      return new Response(null, { status: 204 });
    }
    if (url === '/api/location/positions') return new Response(null, { status: 204 });
    return json({ error: 'not_found' }, 404);
  });
  render(
    <AuthProviderBoundary provider={provider} fetchImpl={fetchImpl}>
      <LocationSharing geolocation={geolocation} />
    </AuthProviderBoundary>,
  );
  return { fetchImpl, server, geolocation };
}

const positionsSent = (fetchImpl: ReturnType<typeof vi.fn>) =>
  fetchImpl.mock.calls.filter(([url]) => String(url) === '/api/location/positions').length;

describe('the notice', () => {
  it('is shown word for word as the approved file says it', () => {
    expect(LOCATION_NOTICE).toBe(readFileSync('docs/CONSENT/staff/location.en.md', 'utf8'));
  });

  it("is the practice's approved notice at the version the server asks consent to", () => {
    const text = readFileSync('docs/CONSENT/staff/location.en.md', 'utf8');
    // One line per sentence, however the file is wrapped.
    const flat = text.replace(/\s+/g, ' ');
    expect(text).toMatch(new RegExp(`^version: ${STAFF_LOCATION_NOTICE_VERSION}$`, 'm'));
    expect(text).toMatch(/^status: approved$/m);
    // What it promises about the working day is what the rule does.
    expect(SHIFT_LEAD_MINUTES).toBe(90);
    expect(flat).toContain('an hour and a half before your first visit');
    expect(SHIFT_TAIL_MINUTES).toBe(30);
    expect(flat).toContain('half an hour after your last visit');
    expect(flat).toContain('Two days');
    for (const never of ['pay', 'hours', 'how well you are doing your job']) {
      expect(flat.toLowerCase()).toContain(never);
    }
    // Fix round 1: what the first version left out or got wrong.
    expect(flat).not.toContain('what happened yesterday');
    expect(flat).toContain('9 in the evening');
    expect(flat).toContain('wherever you set off from');
    expect(flat).toContain('at least five years');
    expect(flat).toContain(
      "the database host's daily backups, kept for 7 days on the practice's plan",
    );
    expect(flat).toContain('shown on your own sharing screen whenever your agreement stands');
    // Hard-wrapped like every other wording file: no line runs past 80.
    for (const line of text.split('\n')) expect(line.length, line).toBeLessThanOrEqual(80);
    expect(flat).toContain('weekly backup leaves positions out');
    expect(flat).toContain('Settings › Practice');
    expect(flat).not.toMatch(/@[a-z0-9-]+\.[a-z]/i);
  });
});

describe('the switch', () => {
  it('shows nothing at all to somebody with no day of their own', async () => {
    const { fetchImpl } = mount({ ...OFF, eligible: false });
    await waitFor(() =>
      expect(fetchImpl).toHaveBeenCalledWith('/api/location/me', expect.anything()),
    );
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByText(/sharing your location/i)).toBeNull();
  });

  it('is off until the person turns it on, and sends nothing while off', async () => {
    const { fetchImpl } = mount(OFF);
    const toggle = await screen.findByRole('switch', { name: 'Share my location while I work' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText('Off. The office does not see where you are.')).toBeTruthy();
    expect(positionsSent(fetchImpl)).toBe(0);
  });

  it('shows the notice the first time, and turns nothing on until "I agree"', async () => {
    const { fetchImpl } = mount(OFF);
    fireEvent.click(await screen.findByRole('switch'));
    expect(
      await screen.findByRole('heading', { name: 'Before you share your location' }),
    ).toBeTruthy();
    expect(screen.getByText(/What it is never used for/)).toBeTruthy();
    expect(
      fetchImpl.mock.calls.some(([url]) => String(url).startsWith('/api/location/sharing')),
    ).toBe(false);
    expect(positionsSent(fetchImpl)).toBe(0);

    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(await screen.findByRole('switch')).toBeTruthy();
    expect(positionsSent(fetchImpl)).toBe(0);
  });

  it('records the consent to the version shown, and the band appears', async () => {
    const { fetchImpl } = mount(OFF);
    fireEvent.click(await screen.findByRole('switch'));
    fireEvent.click(await screen.findByRole('button', { name: 'I agree, share my location' }));
    expect(
      await screen.findByText('You are sharing your location with the office while you work.'),
    ).toBeTruthy();
    const consent = fetchImpl.mock.calls.find(([url]) => String(url) === '/api/location/consent');
    expect(JSON.parse(String(consent?.[1]?.body))).toEqual({ noticeVersion: '1.1' });
  });

  it('turns straight on for somebody who has already agreed to this notice', async () => {
    mount({ ...OFF, consent: AGREED });
    fireEvent.click(await screen.findByRole('switch'));
    expect(await screen.findByRole('button', { name: 'Stop sharing' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Before you share your location' })).toBeNull();
  });

  it('shows the notice again when the notice has changed since they agreed', async () => {
    mount({ ...OFF, consent: { ...AGREED, noticeVersion: '1.0' } });
    fireEvent.click(await screen.findByRole('switch'));
    expect(await screen.findByRole('button', { name: 'I agree, share my location' })).toBeTruthy();
  });

  it('shows the date of agreement with the switch off too, whenever the agreement stands', async () => {
    mount({ ...OFF, consent: AGREED });
    expect(await screen.findByText('You agreed on 06/10/2026.')).toBeTruthy();
  });

  it('withdraws the agreement in one press', async () => {
    const { fetchImpl } = mount({ ...OFF, consent: AGREED });
    fireEvent.click(await screen.findByRole('button', { name: 'Withdraw my agreement' }));
    await waitFor(() =>
      expect(
        fetchImpl.mock.calls.some(([url]) => String(url) === '/api/location/consent/withdraw'),
      ).toBe(true),
    );
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Withdraw my agreement' })).toBeNull(),
    );
  });
});

describe('the band', () => {
  it('says when the person agreed, so an agreement they did not give would show', async () => {
    mount({ ...OFF, consent: AGREED, sharingOn: true });
    expect(await screen.findByText('You agreed on 06/10/2026.')).toBeTruthy();
  });

  it('says sharing is paused and offers the new notice when the notice has changed', async () => {
    const { fetchImpl } = mount({
      ...OFF,
      consent: { ...AGREED, noticeVersion: '1.0' },
      sharingOn: true,
    });
    expect(
      await screen.findByText('Sharing is paused: the notice has changed since you agreed.'),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Read the new notice' }));
    expect(await screen.findByRole('button', { name: 'I agree, share my location' })).toBeTruthy();
    expect(positionsSent(fetchImpl)).toBe(0);
  });

  it('is there the whole time sharing is on, and carries the way to stop', async () => {
    mount({ ...OFF, consent: AGREED, sharingOn: true });
    expect(
      await screen.findByText('You are sharing your location with the office while you work.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Stop sharing' })).toBeTruthy();
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('says nothing is sent outside the working day', async () => {
    const { fetchImpl } = mount({ ...OFF, consent: AGREED, sharingOn: true, shiftOpen: false });
    expect(await screen.findByText('Nothing is sent outside your working day.')).toBeTruthy();
    expect(positionsSent(fetchImpl)).toBe(0);
  });
});

describe('somebody who can no longer share', () => {
  it('can still withdraw an agreement they gave, and switch off', async () => {
    const { fetchImpl } = mount({
      ...OFF,
      eligible: false,
      shiftOpen: false,
      consent: AGREED,
      sharingOn: true,
    });
    expect(await screen.findByText('This account can no longer share its location.')).toBeTruthy();
    expect(screen.queryByRole('switch')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw my agreement' }));
    await waitFor(() =>
      expect(
        fetchImpl.mock.calls.some(([url]) => String(url) === '/api/location/consent/withdraw'),
      ).toBe(true),
    );
    await waitFor(() =>
      expect(screen.queryByText('This account can no longer share its location.')).toBeNull(),
    );
    expect(positionsSent(fetchImpl)).toBe(0);
  });
});

describe('sending', () => {
  it("sends the phone's position at once and every two minutes while on and on shift", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { fetchImpl } = mount({ ...OFF, consent: AGREED, sharingOn: true });
    await waitFor(() => expect(positionsSent(fetchImpl)).toBe(1));
    const sent = fetchImpl.mock.calls.find(([url]) => String(url) === '/api/location/positions');
    expect(JSON.parse(String(sent?.[1]?.body))).toEqual({
      latitude: 25.2,
      longitude: 55.27,
      accuracyMetres: 12,
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POSITION_INTERVAL_MS);
    });
    await waitFor(() => expect(positionsSent(fetchImpl)).toBe(2));
  });

  it('stops at once when the switch is turned off', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { fetchImpl, geolocation } = mount({ ...OFF, consent: AGREED, sharingOn: true });
    await waitFor(() => expect(positionsSent(fetchImpl)).toBe(1));
    fireEvent.click(screen.getByRole('button', { name: 'Stop sharing' }));
    const asked = geolocation.getCurrentPosition.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POSITION_INTERVAL_MS * 3);
    });
    expect(geolocation.getCurrentPosition.mock.calls.length).toBe(asked);
    expect(positionsSent(fetchImpl)).toBe(1);
    expect(await screen.findByRole('switch')).toBeTruthy();
  });

  it('says so, calmly, when the phone will not give its position', async () => {
    const refusing = {
      getCurrentPosition: vi.fn((_: PositionCallback, failure?: PositionErrorCallback | null) => {
        failure?.({ code: 1, message: 'denied' } as GeolocationPositionError);
      }),
    };
    const { fetchImpl } = mount({ ...OFF, consent: AGREED, sharingOn: true }, refusing as never);
    expect(await screen.findByText(/did not let the app read its location/)).toBeTruthy();
    expect(positionsSent(fetchImpl)).toBe(0);
  });
});
