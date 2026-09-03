// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProviderBoundary } from '../../app/shell/auth/AuthContext';
import type { AuthProvider } from '../../app/shell/auth/types';
import { SessionRunner, type RunnerVisit } from '../../app/therapist/session/SessionRunner';
import { createMemoryStore } from '../../app/therapist/session/outbox/store';
import type { ServiceTypeOption } from '../../app/api/sessions/schema';

/**
 * The session runner, screen by screen (docs/SPEC/session-capture.md
 * sections 3.2 to 3.6). Each test asks one question: does this screen put
 * one decision in front of the practitioner, and does the event it writes
 * say what happened?
 *
 * The outbox store is injected, because jsdom has no IndexedDB — the same
 * seam the store was built with (app/therapist/session/outbox/store.ts).
 */

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const SESSION_ID = '00000000-0000-4000-8000-000000009000';
const SERVICE_TYPE_ID = '00000000-0000-4000-8000-0000000000f1';

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

const SERVICE: ServiceTypeOption = {
  id: SERVICE_TYPE_ID,
  code: 'nf-session',
  name: 'Neurofeedback session',
  nameAr: null,
  preflightChecklist: [
    { key: 'identity_confirmed', labelEn: 'Client identity confirmed', labelAr: '' },
    { key: 'environment_suitable', labelEn: 'Environment suitable', labelAr: '' },
  ],
  ratingQuestions: [{ key: 'sleep', labelEn: 'Sleep last night', labelAr: '', min: 0, max: 10 }],
};

const VISIT: RunnerVisit = {
  sessionId: SESSION_ID,
  clientLabel: 'Rowan M.',
  checkedInAt: '2026-09-03T06:32:00.000Z',
  number: 12,
  of: 30,
  serviceTypeId: SERVICE_TYPE_ID,
  photoConsent: false,
  lastSeq: 1,
  shareLocation: false,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

type Posted = { url: string; body: Record<string, unknown> };

function mount(
  options: {
    visit?: Partial<RunnerVisit>;
    service?: ServiceTypeOption | null;
    eventsOk?: boolean;
  } = {},
) {
  const posted: Posted[] = [];
  const store = createMemoryStore();
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/me') return json(ME);
    if (init?.method === 'POST') {
      posted.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
      if (url.endsWith('/close')) {
        return json({
          status: 'closed',
          sessionId: SESSION_ID,
          closedAt: '2026-09-03T07:20:00.000Z',
          signalQualityScore: 0.4,
          durationSeconds: 1800,
          observationFlag: false,
          setupPhotoDocumentId: null,
        });
      }
      if (options.eventsOk === false) return json({ error: 'internal', requestId: null }, 500);
      const events = (init.body ? JSON.parse(String(init.body)) : { events: [] }) as {
        events: { id: string }[];
      };
      return json({
        status: 'stored',
        acknowledged: events.events.map((e) => e.id),
        refused: [],
        session: {
          id: SESSION_ID,
          phase: 'in_progress',
          checkedInAt: VISIT.checkedInAt,
          startedAt: null,
          endedAt: null,
          checkedOutAt: null,
          signalQualityScore: null,
          closed: false,
          lastSeq: 1,
        },
      });
    }
    return json({ error: 'not_found', requestId: null }, 404);
  }) as unknown as typeof fetch;

  const utils = render(
    <AuthProviderBoundary provider={provider} fetchImpl={fetchImpl}>
      <SessionRunner
        visit={{ ...VISIT, ...options.visit }}
        service={options.service === undefined ? SERVICE : options.service}
        onFinished={() => undefined}
        createStore={async () => store}
      />
    </AuthProviderBoundary>,
  );
  return { ...utils, posted, store };
}

/** Walks pre-flight and signal, leaving the run screen on screen. */
async function reachRun() {
  const mounted = mount();
  await screen.findByRole('heading', { name: 'Before you start' });
  fireEvent.click(screen.getByRole('button', { name: 'Check the signal' }));
  fireEvent.change(await screen.findByLabelText('Site'), { target: { value: 'Cz' } });
  fireEvent.click(screen.getByRole('button', { name: 'Start session' }));
  await screen.findByRole('button', { name: 'End session' });
  return mounted;
}

function kinds(posted: readonly Posted[]): string[] {
  return posted
    .filter((call) => !call.url.endsWith('/close'))
    .flatMap((call) => (call.body.events as { kind: string }[]).map((event) => event.kind));
}

describe('pre-flight', () => {
  it('asks the checklist the practice set for this service', async () => {
    mount();
    expect(await screen.findByLabelText('Client identity confirmed')).toBeTruthy();
    expect(screen.getByLabelText('Environment suitable')).toBeTruthy();
    expect(screen.getByLabelText('Sleep last night')).toBeTruthy();
  });

  it('says so plainly when the practice has set no checklist at all', async () => {
    mount({ service: null });
    expect(await screen.findByText('This service has no checklist set.')).toBeTruthy();
  });

  it('names what is still outstanding without refusing to continue', async () => {
    mount();
    await screen.findByLabelText('Client identity confirmed');
    fireEvent.click(screen.getByLabelText('Client identity confirmed'));
    expect(await screen.findByText('One item is still outstanding.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Check the signal' }).hasAttribute('disabled')).toBe(
      false,
    );
  });

  it('writes the checklist and the before answers as events when it moves on', async () => {
    const { posted } = mount();
    await screen.findByLabelText('Client identity confirmed');
    fireEvent.click(screen.getByLabelText('Client identity confirmed'));
    fireEvent.click(screen.getByRole('button', { name: 'Check the signal' }));

    await waitFor(() => expect(kinds(posted)).toContain('rating_recorded'));
    expect(kinds(posted)).toContain('observation_recorded');
    const preflight = posted
      .flatMap((call) => (call.body.events as { kind: string; payload: unknown }[]) ?? [])
      .find((event) => event.kind === 'observation_recorded');
    expect(preflight?.payload).toMatchObject({
      topic: 'preflight',
      items: [
        { key: 'identity_confirmed', done: true },
        { key: 'environment_suitable', done: false },
      ],
    });
  });
});

describe('the signal check', () => {
  it('will not start until a site has been named', async () => {
    mount();
    await screen.findByRole('heading', { name: 'Before you start' });
    fireEvent.click(screen.getByRole('button', { name: 'Check the signal' }));
    const start = await screen.findByRole('button', { name: 'Start session' });
    expect(start.hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('Name at least one site to start.')).toBeTruthy();
  });

  it('warns below the threshold and still lets the practitioner decide', async () => {
    mount();
    await screen.findByRole('heading', { name: 'Before you start' });
    fireEvent.click(screen.getByRole('button', { name: 'Check the signal' }));
    fireEvent.change(await screen.findByLabelText('Site'), { target: { value: 'Cz' } });
    fireEvent.change(screen.getByLabelText('Quality'), { target: { value: '30' } });

    expect(
      await screen.findByText(
        'The signal is below the level this practice expects. You can start anyway.',
      ),
    ).toBeTruthy();
    const start = screen.getByRole('button', { name: 'Start anyway' });
    expect(start.hasAttribute('disabled')).toBe(false);
  });
});

describe('the run', () => {
  it('shows who is in the room, which session it is, and one action', async () => {
    await reachRun();
    expect(screen.getByText('Rowan M.')).toBeTruthy();
    expect(screen.getByText('Session 12 of 30')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'End session' })).toBeTruthy();
    // No navigation chrome during a session (section 3.4).
    expect(screen.queryByRole('button', { name: 'Back to Today' })).toBeNull();
  });

  it('says only the session number when the programme length is unknown', async () => {
    mount({ visit: { of: null } });
    await screen.findByRole('heading', { name: 'Before you start' });
    fireEvent.click(screen.getByRole('button', { name: 'Check the signal' }));
    fireEvent.change(await screen.findByLabelText('Site'), { target: { value: 'Cz' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start session' }));
    expect(await screen.findByText('Session 12')).toBeTruthy();
  });
});

describe('after the session', () => {
  it('offers the setup photo only when the household has agreed to one', async () => {
    await reachRun();
    fireEvent.click(screen.getByRole('button', { name: 'End session' }));
    await screen.findByRole('heading', { name: 'After the session' });

    expect(screen.queryByRole('button', { name: 'Take a photo' })).toBeNull();
    expect(
      screen.getByText(
        'This household has not agreed to photographs, so no photo can be taken. The practice can ask them.',
      ),
    ).toBeTruthy();
  });

  it('offers the camera when consent is active', async () => {
    mount({ visit: { photoConsent: true } });
    await screen.findByRole('heading', { name: 'Before you start' });
    fireEvent.click(screen.getByRole('button', { name: 'Check the signal' }));
    fireEvent.change(await screen.findByLabelText('Site'), { target: { value: 'Cz' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start session' }));
    fireEvent.click(await screen.findByRole('button', { name: 'End session' }));

    expect(await screen.findByRole('button', { name: 'Take a photo' })).toBeTruthy();
  });

  it('asks for one reading of the whole session when none was taken during it', async () => {
    await reachRun();
    fireEvent.click(screen.getByRole('button', { name: 'End session' }));
    expect(await screen.findByLabelText('Time in reward')).toBeTruthy();
    expect(screen.getByLabelText('Artefact')).toBeTruthy();
  });

  it('treats nothing to note as an answer that clears the rest', async () => {
    await reachRun();
    fireEvent.click(screen.getByRole('button', { name: 'End session' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Fatigue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Nothing to note' }));

    expect(screen.getByRole('button', { name: 'Fatigue' }).getAttribute('aria-pressed')).toBe(
      'false',
    );
    expect(
      screen.getByRole('button', { name: 'Nothing to note' }).getAttribute('aria-pressed'),
    ).toBe('true');
  });
});

describe('the summary and the check-out', () => {
  it('shows what is about to be recorded, then closes the visit on one confirmation', async () => {
    const { posted } = await reachRun();
    fireEvent.click(screen.getByRole('button', { name: 'End session' }));
    fireEvent.click(await screen.findByRole('button', { name: 'See the summary' }));

    await screen.findByRole('heading', { name: 'Summary' });
    expect(screen.getByText('Sleep last night')).toBeTruthy();
    expect(screen.getByLabelText('Parking, in fils')).toBeTruthy();
    expect(screen.getByLabelText('Salik crossings')).toBeTruthy();
    expect(screen.getByLabelText('Anything about getting in')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Salik crossings'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check out' }));

    await waitFor(() => expect(kinds(posted)).toContain('checked_out'));
    const close = await waitFor(() => {
      const call = posted.find((c) => c.url.endsWith('/close'));
      expect(call).toBeTruthy();
      return call!;
    });
    expect(close.body.visitActuals).toMatchObject({ salikCrossings: 2, parkingCostFils: 0 });
    expect(await screen.findByRole('heading', { name: 'Checked out' })).toBeTruthy();
  });
});

describe('the sync band', () => {
  it('says how much is waiting, calmly, and never as an alert', async () => {
    const { container } = mount({ eventsOk: false });
    await screen.findByRole('heading', { name: 'Before you start' });
    fireEvent.click(screen.getByRole('button', { name: 'Check the signal' }));

    const band = await waitFor(() => {
      const found = container.querySelector('.sync');
      expect(found?.textContent).toContain('events waiting to sync');
      return found!;
    });
    expect(band.getAttribute('role')).toBe('status');
    expect(band.className).not.toContain('critical');
  });

  it('says everything is saved when nothing is waiting', async () => {
    const { container } = mount();
    await screen.findByRole('heading', { name: 'Before you start' });
    await waitFor(() =>
      expect(container.querySelector('.sync')?.textContent).toContain(
        'Everything on this visit is saved.',
      ),
    );
  });
});
