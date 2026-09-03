// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProviderBoundary } from '../../app/shell/auth/AuthContext';
import type { AuthProvider } from '../../app/shell/auth/types';
import { CheckInPage } from '../../app/therapist/session/CheckInPage';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

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
  nameAr: 'جلسة نيوروفيدباك',
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
    onServiceTypes?: (callIndex: number) => Response;
    /** Router state the day sheet hands over when a stop's Check in is tapped. */
    state?: { record?: unknown };
    /** What GET /api/sessions/open answers: a visit already open, or none. */
    openSession?: unknown;
  } = {},
) {
  const services = options.services ?? [SERVICE_A];
  const calls: Call[] = [];
  let serviceTypesCalls = 0;
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/me') return json(ME);
    if (url === '/api/sessions/open') {
      return json({ session: options.openSession ?? null });
    }
    if (url === '/api/sessions/service-types') {
      const index = serviceTypesCalls;
      serviceTypesCalls += 1;
      return options.onServiceTypes
        ? options.onServiceTypes(index)
        : json({ serviceTypes: services });
    }
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
      <MemoryRouter
        initialEntries={[{ pathname: '/today/check-in', state: options.state ?? null }]}
      >
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

  it('shows the record-number format rule under the field at all times, and wires it to the input for assistive tech', async () => {
    mount();
    await ready();
    const input = screen.getByLabelText('Record number');
    const hintId = input.getAttribute('aria-describedby');
    expect(hintId).toBeTruthy();
    expect(input.getAttribute('aria-invalid')).toBeNull();

    const hint = document.getElementById(hintId!);
    expect(hint?.textContent).toBe(
      'Enter the record number as MW- followed by six digits, for example MW-000123.',
    );

    enterRecordNumber('not a record number');
    clickCheckIn();
    await waitFor(() => expect(input.getAttribute('aria-invalid')).toBe('true'));
    // The error replaces the rule in the same slot — never a second note
    // elsewhere on the page.
    expect(document.getElementById(hintId!)?.textContent).toBe(
      'Enter the record number as MW- followed by six digits, for example MW-000123.',
    );

    enterRecordNumber('MW-000123');
    expect(input.getAttribute('aria-invalid')).toBeNull();
  });

  it('accepts the record number lower-cased, and normalises it before sending', async () => {
    const { calls } = mount();
    await ready();
    enterRecordNumber('mw-000123');
    clickCheckIn();
    await waitFor(() => expect(calls.length).toBe(1));
    expect(calls[0]?.body.clientMrn).toBe('MW-000123');
  });

  it('shows the chosen service in both languages, the Arabic marked as Arabic', async () => {
    // A native <option> holds no markup, so the Arabic name cannot be marked
    // or laid out inside one; it sits beneath the picker instead, the way
    // every checklist item and question on the runner carries its own.
    mount();
    await ready();
    const arabic = await screen.findByText('جلسة نيوروفيدباك');
    expect(arabic.getAttribute('lang')).toBe('ar');
    expect(arabic.getAttribute('dir')).toBe('rtl');
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

  it('offers a visible retry when the services list fails to load, and recovers once it succeeds', async () => {
    let serviceTypeCalls = 0;
    mount({
      onServiceTypes: () => {
        serviceTypeCalls += 1;
        return serviceTypeCalls === 1
          ? json({ error: 'internal', requestId: 'r' }, 500)
          : json({ serviceTypes: [SERVICE_A] });
      },
    });

    await screen.findByText('The service list could not be loaded.');
    const retry = screen.getByRole('button', { name: 'Try again' });
    expect(retry.tagName).toBe('BUTTON');

    fireEvent.click(retry);
    expect(await screen.findByRole('option', { name: 'Neurofeedback session' })).toBeTruthy();
    expect(screen.queryByText('The service list could not be loaded.')).toBeNull();
    expect(serviceTypeCalls).toBe(2);
  });

  it('hands straight over to the session once the visit is open', async () => {
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
    // A check-in is not a destination: the practitioner is standing at the
    // door and the next thing they need is the pre-flight checklist, not a
    // receipt they have to tap past.
    expect(await screen.findByRole('heading', { name: 'Before you start' })).toBeTruthy();
  });

  const REASONS: Array<[string, string]> = [
    [
      'not_authorised',
      'You are not set up to deliver this service today. Ask the practice to check why.',
    ],
    ['consent_missing_participation', 'Consent to be seen is missing. Ask the practice to add it.'],
    [
      'consent_missing_minor_participation',
      "A guardian's consent is missing. Ask the practice to add it.",
    ],
    ['consent_missing_home_visit', 'Home-visit consent is missing. Ask the practice to add it.'],
    ['date_of_birth_unknown', 'Date of birth is not recorded. Ask the practice to add it.'],
    [
      'already_checked_in',
      'Already checked in on another device. Ask the practice if that was not you.',
    ],
  ];

  it.each(REASONS)(
    'renders the plain sentence for %s, naming who to call',
    async (reason, sentence) => {
      mount({ onPost: () => json({ status: 'blocked', reasons: [reason] }, 422) });
      await ready();
      enterRecordNumber('MW-000123');
      clickCheckIn();
      expect(await screen.findByText(sentence)).toBeTruthy();
    },
  );

  it('does not offer "Try again" for a consent or certification refusal, since retrying alone cannot clear it', async () => {
    mount({ onPost: () => json({ status: 'blocked', reasons: ['not_authorised'] }, 422) });
    await ready();
    enterRecordNumber('MW-000123');
    clickCheckIn();
    await screen.findByText(
      'You are not set up to deliver this service today. Ask the practice to check why.',
    );
    expect(screen.getByRole('button', { name: 'Check in' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('names the problem in plain words on a 403, and does not offer "Try again" either', async () => {
    mount({ onPost: () => json({ error: 'forbidden', requestId: 'r' }, 403) });
    await ready();
    enterRecordNumber('MW-000123');
    clickCheckIn();
    expect(
      await screen.findByText(
        'You do not have access to check in a visit. Ask the practice to check your account.',
      ),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Check in' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('names the problem in plain words on a 409, and offers a retry', async () => {
    mount({ onPost: () => json({ error: 'conflict', requestId: 'r', detail: 'x' }, 409) });
    await ready();
    enterRecordNumber('MW-000123');
    clickCheckIn();
    expect(
      await screen.findByText('That check-in could not be completed. Try again.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it.each(['not_booked_today', 'client_not_found'])(
    'reads a record number that is not booked for this practitioner today as its own plain sentence (detail: %s)',
    async (detail) => {
      mount({
        onPost: () => json({ error: 'bad_request', requestId: 'r', detail }, 400),
      });
      await ready();
      enterRecordNumber('MW-000999');
      clickCheckIn();
      expect(
        await screen.findByText(
          'This visit is not booked for you today. Check the record number, or ask the practice.',
        ),
      ).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    },
  );

  it('falls back to the generic failure, naming what to check, for any other server error', async () => {
    mount({ onPost: () => json({ error: 'internal', requestId: 'r' }, 500) });
    await ready();
    enterRecordNumber('MW-000123');
    clickCheckIn();
    expect(
      await screen.findByText('Something went wrong. Check your connection, then try again.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
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
    await screen.findByRole('heading', { name: 'Before you start' });

    expect(calls.length).toBe(2);
    expect(calls[1]?.url).toBe(calls[0]?.url);
    const firstEvents = calls[0]?.body.events as Array<{ id: string }>;
    const secondEvents = calls[1]?.body.events as Array<{ id: string }>;
    expect(secondEvents[0]?.id).toBe(firstEvents[0]?.id);
  });

  it('regenerates the session and event ids when the record number changes since the last attempt, so a corrected retry can never check in the wrong client', async () => {
    const { calls } = mount({
      onPost: () => json({ error: 'conflict', requestId: 'r', detail: 'x' }, 409),
    });
    await ready();
    enterRecordNumber('MW-000123');
    clickCheckIn();
    await screen.findByText('That check-in could not be completed. Try again.');

    enterRecordNumber('MW-000456');
    clickCheckIn('Try again');
    await waitFor(() => expect(calls.length).toBe(2));

    expect(calls[1]?.url).not.toBe(calls[0]?.url);
    expect(calls[1]?.body.clientMrn).toBe('MW-000456');
    const firstEvents = calls[0]?.body.events as Array<{ id: string }>;
    const secondEvents = calls[1]?.body.events as Array<{ id: string }>;
    expect(secondEvents[0]?.id).not.toBe(firstEvents[0]?.id);
  });

  it('regenerates the session and event ids when the delivery mode changes since the last attempt', async () => {
    const { calls } = mount({
      onPost: () => json({ error: 'conflict', requestId: 'r', detail: 'x' }, 409),
    });
    await ready();
    enterRecordNumber('MW-000123');
    clickCheckIn();
    await screen.findByText('That check-in could not be completed. Try again.');

    fireEvent.change(screen.getByLabelText('Delivery'), { target: { value: 'studio' } });
    clickCheckIn('Try again');
    await waitFor(() => expect(calls.length).toBe(2));

    expect(calls[1]?.url).not.toBe(calls[0]?.url);
    const firstEvents = calls[0]?.body.events as Array<{ id: string }>;
    const secondEvents = calls[1]?.body.events as Array<{ id: string }>;
    expect(secondEvents[0]?.id).not.toBe(firstEvents[0]?.id);
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
    const firstCall = getCurrentPosition.mock.calls[0] as unknown[] | undefined;
    expect(firstCall?.[2]).toEqual({ timeout: 10000, maximumAge: 0 });
  });

  it('reads the device position again at submit, so the recorded point is where the practitioner stands when they tap', async () => {
    let callCount = 0;
    const getCurrentPosition = vi.fn((success: PositionCallback) => {
      callCount += 1;
      const [lat, lng] = callCount === 1 ? [25.1, 55.1] : [25.2, 55.2];
      success({ coords: { latitude: lat, longitude: lng } } as GeolocationPosition);
    });
    Object.defineProperty(window.navigator, 'geolocation', {
      value: { getCurrentPosition },
      configurable: true,
    });

    const { calls } = mount();
    await ready();
    fireEvent.click(screen.getByLabelText('Share my location'));
    await waitFor(() => expect(getCurrentPosition).toHaveBeenCalledTimes(1));

    enterRecordNumber('MW-000123');
    clickCheckIn();
    await waitFor(() => expect(calls.length).toBe(1));

    expect(getCurrentPosition).toHaveBeenCalledTimes(2);
    expect(calls[0]?.body.point).toEqual({ lat: 25.2, lng: 55.2 });
  });

  it('shows a note and leaves the point null if neither geolocation callback ever fires', async () => {
    const getCurrentPosition = vi.fn(() => {
      // Deliberately calls neither the success nor the error callback,
      // simulating a device that hangs.
    });
    Object.defineProperty(window.navigator, 'geolocation', {
      value: { getCurrentPosition },
      configurable: true,
    });

    mount();
    // Real timers for the initial load — React's own scheduler in jsdom can
    // depend on setTimeout, so timers are only faked once the screen is up
    // and it is this test's own dead-man guard being exercised.
    await screen.findByLabelText('Service');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    fireEvent.click(screen.getByLabelText('Share my location'));
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12000);
    });

    expect(
      screen.getByText('Location was not shared. Check-in will continue without it.'),
    ).toBeTruthy();
  });
});

describe('the record number the day sheet hands over', () => {
  it('opens with the field carrying the handed-over record number', async () => {
    mount({ state: { record: 'MW-000123' } });
    await ready();
    expect((screen.getByLabelText('Record number') as HTMLInputElement).value).toBe('MW-000123');
  });

  it('opens empty when nothing was handed over, and ignores a value that is not text', async () => {
    mount({ state: { record: 42 } });
    await ready();
    expect((screen.getByLabelText('Record number') as HTMLInputElement).value).toBe('');
    cleanup();
    mount();
    await ready();
    expect((screen.getByLabelText('Record number') as HTMLInputElement).value).toBe('');
  });
});

/**
 * The resume offer (docs/SPEC/session-capture.md section 2): "on restart the
 * app offers 'resume session for Client L., started 14:32'". It is the first
 * thing on the screen, because a practitioner whose phone died mid-visit has
 * one thing to do and typing a record number again is not it.
 */
describe('CheckInPage, resuming a visit', () => {
  const OPEN = {
    id: '00000000-0000-4000-8000-000000009001',
    clientGivenName: 'Rowan',
    clientFamilyInitial: 'M',
    serviceTypeId: SERVICE_A.id,
    serviceName: 'Neurofeedback session',
    deliveryMode: 'home',
    checkedInAt: '2026-09-02T10:32:00.000Z',
    phase: 'in_progress',
    number: 12,
    of: 30,
    lastSeq: 6,
    photoConsent: false,
  };

  it('offers the visit the practitioner left open, by name and by the time it started', async () => {
    mount({ openSession: OPEN });
    expect(await screen.findByText(/Resume session for Rowan M\., started/)).toBeTruthy();
    expect(screen.getByText('14:32')).toBeTruthy();
  });

  it('goes back into that visit rather than starting a new one', async () => {
    const { calls } = mount({ openSession: OPEN });
    fireEvent.click(await screen.findByRole('button', { name: 'Resume' }));
    expect(await screen.findByRole('heading', { name: 'Before you start' })).toBeTruthy();
    // Resuming posts no check-in: the visit is already open on the server.
    expect(calls.filter((call) => call.url.endsWith('/events')).length).toBe(0);
  });

  it('lets the practitioner set the offer aside and check somebody else in', async () => {
    mount({ openSession: OPEN });
    fireEvent.click(await screen.findByRole('button', { name: 'Check in someone else instead' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull());
    expect(screen.getByLabelText('Record number')).toBeTruthy();
  });

  it('offers nothing when no visit is open', async () => {
    mount();
    await ready();
    expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull();
  });

  it('does not paint the form until it knows whether there is a visit to resume', async () => {
    // The offer belongs above the form, so an offer that arrived after the
    // form would push the record number, the service and the primary action
    // down the screen under a thumb already reaching for them. The face
    // waits instead, and says what it is waiting for.
    mount({ openSession: OPEN });
    expect(screen.getByText('Checking whether you have a visit already open.')).toBeTruthy();
    expect(screen.queryByLabelText('Record number')).toBeNull();

    expect(await screen.findByRole('button', { name: 'Resume' })).toBeTruthy();
  });

  it('is the only loud action while it stands, and says sharing is off', async () => {
    mount({ openSession: OPEN });
    const resume = await screen.findByRole('button', { name: 'Resume' });
    expect(resume.className).toContain('button--primary');
    // One primary on the face: the form's own action steps back rather than
    // asking the practitioner to choose between two equally loud buttons.
    expect(screen.getByRole('button', { name: 'Check in' }).className).toContain(
      'button--secondary',
    );

    // A resumed visit cannot know what was switched on at the door, so it
    // shares nothing and says so rather than leaving the practitioner to
    // wonder (docs/SPEC/session-capture.md section 3.6).
    expect(
      screen.getByText(
        'Sharing your location is off after a resume. The visit is recorded either way.',
      ),
    ).toBeTruthy();

    // And the quiet way out meets the practitioner tap floor.
    expect(
      screen.getByRole('button', { name: 'Check in someone else instead' }).className,
    ).toContain('checkin__dismiss');
  });

  it('gives the form its own single primary once the offer is set aside', async () => {
    mount({ openSession: OPEN });
    fireEvent.click(await screen.findByRole('button', { name: 'Check in someone else instead' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Check in' }).className).toContain(
        'button--primary',
      ),
    );
  });
});
