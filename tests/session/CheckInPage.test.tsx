// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProviderBoundary } from '../../app/shell/auth/AuthContext';
import type { AuthProvider } from '../../app/shell/auth/types';
import { CheckInPage } from '../../app/therapist/session/CheckInPage';

afterEach(cleanup);

// Synthetic throughout, in the reserved ranges (.claude/rules/testing.md).
const ME = {
  userId: '00000002-0000-4000-8000-000000000009',
  displayName: 'Rowan Meadow',
  tenantId: '00000001-0000-4000-8000-000000000001',
  roles: ['practitioner'],
  capabilities: [],
};

const SERVICE_A = {
  id: '00000004-0000-4000-8000-000000000001',
  code: 'nf-session',
  name: 'Neurofeedback session',
  nameAr: null,
};

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

type Call = { url: string; body: Record<string, unknown> };
type PostHandler = (call: Call, callIndex: number) => Response;

function mount(
  options: {
    services?: unknown[];
    onPost?: PostHandler;
  } = {},
) {
  const services = options.services ?? [SERVICE_A];
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/me') return json(ME);
    if (url === '/api/sessions/service-types') return json({ serviceTypes: services });
    if (init?.method === 'POST' && url.startsWith('/api/sessions/')) {
      const call: Call = { url, body: JSON.parse(String(init.body)) as Record<string, unknown> };
      calls.push(call);
      return options.onPost
        ? options.onPost(call, calls.length - 1)
        : json(
            {
              status: 'checked_in',
              sessionId: '00000000-0000-4000-8000-000000009000',
              checkedInAt: '2026-09-02T06:32:00.000Z',
            },
            201,
          );
    }
    return json({ error: 'not_found', requestId: null }, 404);
  }) as unknown as typeof fetch;

  const utils = render(
    <AuthProviderBoundary provider={provider} fetchImpl={fetchImpl}>
      <MemoryRouter initialEntries={['/today/check-in']}>
        <CheckInPage />
      </MemoryRouter>
    </AuthProviderBoundary>,
  );
  return { ...utils, fetchImpl, calls };
}

async function ready() {
  await screen.findByLabelText('Service');
}

function enterRecordNumber(value: string) {
  fireEvent.change(screen.getByLabelText('Record number'), { target: { value } });
}

function clickCheckIn(name: 'Check in' | 'Try again' = 'Check in') {
  fireEvent.click(screen.getByRole('button', { name }));
}

describe('CheckInPage', () => {
  it('validates the record number locally before it ever calls the server', async () => {
    const { calls } = mount();
    await ready();
    enterRecordNumber('not a record number');
    clickCheckIn();
    expect(
      await screen.findByText(
        'Enter the record number as MW- followed by six digits, for example MW-000123.',
      ),
    ).toBeTruthy();
    expect(calls.length).toBe(0);
  });

  it('accepts the record number lower-cased, and normalises it before sending', async () => {
    const { calls } = mount();
    await ready();
    enterRecordNumber('mw-000123');
    clickCheckIn();
    await waitFor(() => expect(calls.length).toBe(1));
    expect(calls[0]?.body.clientId).toBe('MW-000123');
  });

  it('lists the caller’s certified services, and explains an empty list', async () => {
    mount({ services: [SERVICE_A] });
    expect(await screen.findByRole('option', { name: 'Neurofeedback session' })).toBeTruthy();
    cleanup();

    mount({ services: [] });
    expect(
      await screen.findByText(
        'No certified service is on file for you. Ask the practice to add one before you check in a visit.',
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Check in' })).toHaveProperty('disabled', true);
  });

  it('shows a confirmation with the time on a successful check-in', async () => {
    mount({
      onPost: () =>
        json(
          {
            status: 'checked_in',
            sessionId: '00000000-0000-4000-8000-000000009000',
            checkedInAt: '2026-09-02T06:32:00.000Z',
          },
          201,
        ),
    });
    await ready();
    enterRecordNumber('MW-000123');
    clickCheckIn();
    expect(await screen.findByRole('heading', { name: 'Checked in' })).toBeTruthy();
    expect(screen.getByText('10:32')).toBeTruthy();
  });

  const REASONS: Array<[string, string]> = [
    ['not_authorised', 'Certification for this service is not valid today.'],
    ['consent_missing_participation', 'Consent to be seen is missing.'],
    ['consent_missing_minor_participation', "A guardian's consent is missing."],
    ['consent_missing_home_visit', 'Home-visit consent is missing.'],
    ['date_of_birth_unknown', 'Date of birth is not recorded.'],
    ['already_checked_in', 'Already checked in on another device.'],
  ];

  it.each(REASONS)('renders the plain sentence for %s', async (reason, sentence) => {
    mount({ onPost: () => json({ status: 'blocked', reasons: [reason] }, 422) });
    await ready();
    enterRecordNumber('MW-000123');
    clickCheckIn();
    expect(await screen.findByText(sentence)).toBeTruthy();
  });

  it('names the problem in plain words on a 403 and on a 409', async () => {
    mount({ onPost: () => json({ error: 'forbidden', requestId: 'r' }, 403) });
    await ready();
    enterRecordNumber('MW-000123');
    clickCheckIn();
    expect(
      await screen.findByText(
        'You do not have access to check in a visit. Ask the practice to check your account.',
      ),
    ).toBeTruthy();
    cleanup();

    mount({ onPost: () => json({ error: 'conflict', requestId: 'r', detail: 'x' }, 409) });
    await ready();
    enterRecordNumber('MW-000123');
    clickCheckIn();
    expect(
      await screen.findByText('That check-in could not be completed. Try again.'),
    ).toBeTruthy();
  });

  it('reuses the same session and event ids on a retry, so a repeated tap never opens two visits', async () => {
    const { calls } = mount({
      onPost: (_call, index) =>
        index === 0
          ? json({ error: 'conflict', requestId: 'r', detail: 'x' }, 409)
          : json(
              {
                status: 'checked_in',
                sessionId: '00000000-0000-4000-8000-000000009000',
                checkedInAt: '2026-09-02T06:32:00.000Z',
              },
              201,
            ),
    });
    await ready();
    enterRecordNumber('MW-000123');
    clickCheckIn();
    await screen.findByText('That check-in could not be completed. Try again.');
    clickCheckIn('Try again');
    await screen.findByRole('heading', { name: 'Checked in' });

    expect(calls.length).toBe(2);
    expect(calls[1]?.url).toBe(calls[0]?.url);
    const firstEvents = calls[0]?.body.events as Array<{ id: string }>;
    const secondEvents = calls[1]?.body.events as Array<{ id: string }>;
    expect(secondEvents[0]?.id).toBe(firstEvents[0]?.id);
  });

  it('does not ask for the device’s location until the switch is turned on, and degrades gracefully when refused', async () => {
    const getCurrentPosition = vi.fn(
      (_success: PositionCallback, error?: PositionErrorCallback) => {
        error?.({
          code: 1,
          message: 'User denied',
          PERMISSION_DENIED: 1,
        } as GeolocationPositionError);
      },
    );
    Object.defineProperty(window.navigator, 'geolocation', {
      value: { getCurrentPosition },
      configurable: true,
    });

    mount();
    await ready();
    expect(getCurrentPosition).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText('Share my location'));
    await waitFor(() => expect(getCurrentPosition).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByText('Location was not shared. Check-in will continue without it.'),
    ).toBeTruthy();
  });
});
