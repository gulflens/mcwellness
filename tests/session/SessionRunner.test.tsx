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

/** A shell with nobody signed in: no token, so AuthContext settles signed-out. */
const signedOutProvider: AuthProvider = { ...provider, getAccessToken: async () => null };
const failingFetch = (async () => new Response('{}', { status: 401 })) as unknown as typeof fetch;

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
  photoConsent: 'refused',
  previousSetupPhotoDocumentId: null,
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
    /** What POST /close answers: 200, or a status the runner must triage. */
    closeStatus?: number;
    store?: ReturnType<typeof createMemoryStore>;
  } = {},
) {
  const posted: Posted[] = [];
  const put: { url: string; type: string | null }[] = [];
  const store = options.store ?? createMemoryStore();
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/me') return json(ME);
    if (init?.method === 'PUT' && url.endsWith('/photo')) {
      put.push({ url, type: init.headers ? new Headers(init.headers).get('content-type') : null });
      return json({ status: 'filed', documentId: '00000000-0000-4000-8000-0000000000f9' }, 201);
    }
    if (url.includes('/api/sessions/photo/')) {
      return json({ url: 'https://example.com/link', expiresInSeconds: 300 });
    }
    if (init?.method === 'POST') {
      posted.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
      if (url.endsWith('/close')) {
        if (options.closeStatus && options.closeStatus !== 200) {
          return json({ error: 'forbidden', requestId: null }, options.closeStatus);
        }
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
  return { ...utils, posted, put, store };
}

/** Ending takes two taps now: the first arms the control, the second ends it. */
function endSession() {
  fireEvent.click(screen.getByRole('button', { name: 'End session' }));
  fireEvent.click(screen.getByRole('button', { name: 'Tap again to end' }));
}

/** Walks pre-flight and signal, leaving the run screen on screen. */
async function reachRun(options: Parameters<typeof mount>[0] = {}) {
  const mounted = mount(options);
  await screen.findByRole('heading', { name: 'Before you start' });
  fireEvent.click(screen.getByRole('button', { name: 'Check the signal' }));
  fireEvent.change(await screen.findByLabelText('Site'), { target: { value: 'Cz' } });
  fireEvent.click(screen.getByRole('button', { name: 'Start session' }));
  await screen.findByRole('button', { name: 'End session' });
  return mounted;
}

/** Walks the whole visit as far as the summary. */
async function reachSummary(options: Parameters<typeof mount>[0] = {}) {
  const mounted = await reachRun(options);
  endSession();
  fireEvent.click(await screen.findByRole('button', { name: 'See the summary' }));
  await screen.findByRole('heading', { name: 'Summary' });
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

describe('ending the session', () => {
  it('takes two taps, with the clock still showing between them', async () => {
    await reachRun();
    fireEvent.click(screen.getByRole('button', { name: 'End session' }));
    // Armed, not ended: the run screen is still here and so is the timer.
    expect(screen.getByText('Tap again to end the session. It cannot be restarted.')).toBeTruthy();
    expect(screen.getByText('elapsed')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Tap again to end' }));
    expect(await screen.findByRole('heading', { name: 'After the session' })).toBeTruthy();
  });
});

describe('after the session', () => {
  it('never offers the camera, and says the household has not agreed when that is why', async () => {
    await reachRun();
    endSession();
    await screen.findByRole('heading', { name: 'After the session' });

    expect(screen.queryByRole('button', { name: 'Take a photo' })).toBeNull();
    expect(
      screen.getByText(
        'This household has not agreed to photographs, so no photo can be taken. The practice can ask them.',
      ),
    ).toBeTruthy();
  });

  it('says it cannot check, rather than that they refused, on a resume with no signal', async () => {
    await reachRun({ visit: { photoConsent: 'unknown' } });
    endSession();
    await screen.findByRole('heading', { name: 'After the session' });

    expect(
      screen.getByText(
        'This device cannot check whether the household has agreed to photographs until it is back online.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/has not agreed to photographs/)).toBeNull();
  });

  it('holds the practitioner to what the photo is for', async () => {
    await reachRun({ visit: { photoConsent: 'given' } });
    endSession();
    expect(
      await screen.findByText('The sensor placement only: not the face, and not the room.'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Take a photo' })).toBeNull();
  });

  it('asks for one reading of the whole session when none was taken during it', async () => {
    await reachRun();
    endSession();
    expect(await screen.findByLabelText('Time in reward')).toBeTruthy();
    expect(screen.getByLabelText('Artefact')).toBeTruthy();
  });

  it('files no reading at all when nobody moved the sliders', async () => {
    const { posted } = await reachSummary();
    // An untouched slider is not a measurement: no telemetry event, and the
    // summary says so rather than reporting a quality of zero.
    expect(kinds(posted)).not.toContain('telemetry_chunk');
    expect(screen.getByText('Session quality').nextElementSibling?.textContent).toBe(
      'Not recorded',
    );
  });

  it('files the reading once the practitioner has actually moved one', async () => {
    const { posted } = await reachRun();
    endSession();
    fireEvent.change(await screen.findByLabelText('Time in reward'), { target: { value: '60' } });
    fireEvent.click(screen.getByRole('button', { name: 'See the summary' }));

    await waitFor(() => expect(kinds(posted)).toContain('telemetry_chunk'));
  });

  it('treats nothing to note as an answer that clears the rest', async () => {
    await reachRun();
    endSession();
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
    const { posted } = await reachSummary();
    expect(screen.getByText('Sleep last night')).toBeTruthy();
    expect(screen.getByLabelText('Parking, in dirhams')).toBeTruthy();
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

  it('says the same numbers the record was given', async () => {
    // The sliders nobody moved still file their midpoint, so the summary
    // must say that midpoint and not "not asked" (design review, item 4).
    const { posted } = await reachSummary();
    const filed = posted
      .flatMap((call) => (call.body.events as { kind: string; payload: unknown }[]) ?? [])
      .filter((event) => event.kind === 'rating_recorded')
      .map(
        (event) => event.payload as { phase: string; answers: { key: string; value: number }[] },
      );

    expect(filed.find((p) => p.phase === 'pre')?.answers).toEqual([{ key: 'sleep', value: 5 }]);
    expect(filed.find((p) => p.phase === 'post')?.answers).toEqual([{ key: 'sleep', value: 5 }]);
    expect(screen.getByText('Sleep last night').nextElementSibling?.textContent).toBe('5 to 5');
  });

  it('names the setup and the session as the two different measurements they are', async () => {
    await reachSummary();
    expect(screen.getByText('Signal at setup')).toBeTruthy();
    expect(screen.getByText('Session quality')).toBeTruthy();
    expect(screen.queryByText('Signal')).toBeNull();
  });

  it('takes parking in dirhams and files it in fils', async () => {
    const { posted } = await reachSummary();
    fireEvent.change(screen.getByLabelText('Parking, in dirhams'), { target: { value: '7.50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check out' }));

    const close = await waitFor(() => {
      const call = posted.find((c) => c.url.endsWith('/close'));
      expect(call).toBeTruthy();
      return call!;
    });
    expect(close.body.visitActuals).toMatchObject({ parkingCostFils: 750 });
  });

  it('drains the queue before it posts the close, so the first attempt is the one that lands', async () => {
    const { posted } = await reachSummary();
    fireEvent.click(screen.getByRole('button', { name: 'Check out' }));
    await screen.findByRole('heading', { name: 'Checked out' });

    // Exactly one close, and every event went before it: no waiting thirty
    // seconds under copy that says the phone can be put away.
    const closes = posted.filter((call) => call.url.endsWith('/close'));
    expect(closes).toHaveLength(1);
    const lastEventCall = posted.findLastIndex((call) => !call.url.endsWith('/close'));
    expect(lastEventCall).toBeLessThan(posted.indexOf(closes[0]!));
  });

  it('stops and says so when the server will never accept the close', async () => {
    await reachSummary({ closeStatus: 403 });
    fireEvent.click(screen.getByRole('button', { name: 'Check out' }));

    expect(await screen.findByRole('heading', { name: 'Not checked out' })).toBeTruthy();
    expect(
      screen.getByText(
        'This visit could not be checked out. Nothing is lost — ask the practice to close it.',
      ),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Back to Today' })).toBeTruthy();
  });

  it('keeps waiting, and keeps the calm copy, when the close is worth retrying', async () => {
    await reachSummary({ closeStatus: 503 });
    fireEvent.click(screen.getByRole('button', { name: 'Check out' }));

    expect(await screen.findByRole('heading', { name: 'Checking out' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Not checked out' })).toBeNull();
  });
});

describe('what the device keeps', () => {
  it('empties itself when the practitioner signs out', async () => {
    const store = createMemoryStore();
    const { rerender } = mount({ store });
    await screen.findByRole('heading', { name: 'Before you start' });
    fireEvent.click(screen.getByRole('button', { name: 'Check the signal' }));
    await waitFor(async () => expect(await store.readOpenVisit()).not.toBeNull());

    // The shell drops the session; nothing of the household stays behind.
    rerender(
      <AuthProviderBoundary provider={signedOutProvider} fetchImpl={failingFetch}>
        <SessionRunner
          visit={VISIT}
          service={SERVICE}
          onFinished={() => undefined}
          createStore={async () => store}
        />
      </AuthProviderBoundary>,
    );
    await waitFor(async () => expect(await store.readOpenVisit()).toBeNull());
    expect(await store.pending()).toEqual([]);
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

describe('what the outbox is given', () => {
  it('numbers a resumed visit on from where the device left off', async () => {
    const { posted } = mount({ visit: { lastSeq: 6 } });
    await screen.findByRole('heading', { name: 'Before you start' });
    fireEvent.click(screen.getByRole('button', { name: 'Check the signal' }));

    await waitFor(() => expect(posted.length).toBeGreaterThan(0));
    const seqs = posted.flatMap((call) =>
      (call.body.events as { seq: number }[]).map((event) => event.seq),
    );
    // Never 1: seq 1 is the check-in the server already holds.
    expect(Math.min(...seqs)).toBe(7);
  });

  it('loses nothing tapped before the device store has finished opening', async () => {
    // A store that takes a moment, as IndexedDB does on a cold start. The
    // practitioner is faster than it, which must not cost them an event.
    const store = createMemoryStore();
    let open: () => void = () => undefined;
    const ready = new Promise<void>((resolve) => {
      open = resolve;
    });
    const posted: Posted[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/me') return json(ME);
      if (init?.method === 'POST') {
        posted.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
        const events = (JSON.parse(String(init.body)) as { events: { id: string }[] }).events;
        return json({
          status: 'stored',
          acknowledged: events.map((e) => e.id),
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

    render(
      <AuthProviderBoundary provider={provider} fetchImpl={fetchImpl}>
        <SessionRunner
          visit={VISIT}
          service={SERVICE}
          onFinished={() => undefined}
          createStore={async () => {
            await ready;
            return store;
          }}
        />
      </AuthProviderBoundary>,
    );

    await screen.findByRole('heading', { name: 'Before you start' });
    fireEvent.click(screen.getByRole('button', { name: 'Check the signal' }));
    expect(posted).toHaveLength(0);

    open();
    await waitFor(() => expect(kinds(posted)).toContain('observation_recorded'));
    expect(kinds(posted)).toContain('rating_recorded');
  });
});

/**
 * The setup photograph (docs/SPEC/practitioner-phone.md section 4). The camera
 * appears only under an active consent, the bytes wait behind their own event,
 * and the pre-flight offers the last placement only when there is one.
 */
describe('the setup photograph', () => {
  /** A one-pixel file: `preparePhoto` needs a real decode, so this is stubbed. */
  function stubPreparedPhoto(): void {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 100, height: 80, close: () => undefined })),
    );
    // jsdom's canvas has no 2d context and no toBlob; both are stood in for.
    const canvas = HTMLCanvasElement.prototype as unknown as {
      getContext: unknown;
      toBlob: unknown;
    };
    canvas.getContext = () => ({ drawImage: () => undefined });
    canvas.toBlob = (callback: (blob: Blob | null) => void) => {
      callback(new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/jpeg' }));
    };
  }

  it('offers the camera when the household has agreed, and keeps what it takes', async () => {
    stubPreparedPhoto();
    const { posted, put, store } = await reachRun({ visit: { photoConsent: 'given' } });
    endSession();
    await screen.findByRole('heading', { name: 'After the session' });

    const camera = screen.getByLabelText('Take the setup photo');
    fireEvent.change(camera, {
      target: { files: [new File([new Uint8Array([1, 2, 3, 4])], 'placement.jpg')] },
    });

    // The event names the digest; the bytes follow it.
    await waitFor(() => expect(kinds(posted)).toContain('photo_captured'));
    await waitFor(() => expect(put).toHaveLength(1));
    expect(put[0]?.type).toBe('image/jpeg');
    // Filed, so the device is done with it.
    await waitFor(async () => expect(await store.blobs()).toEqual([]));
    expect(screen.getByRole('button', { name: 'Take it again' })).toBeTruthy();
  });

  it('never offers the camera when the household has not agreed', async () => {
    await reachRun({ visit: { photoConsent: 'refused' } });
    endSession();
    await screen.findByRole('heading', { name: 'After the session' });
    expect(screen.queryByLabelText('Take the setup photo')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Take the photo' })).toBeNull();
  });

  it('offers the last placement only when there is one', async () => {
    mount();
    await screen.findByRole('heading', { name: 'Before you start' });
    expect(screen.queryByRole('button', { name: 'Show last placement' })).toBeNull();

    cleanup();
    mount({ visit: { previousSetupPhotoDocumentId: '00000000-0000-4000-8000-0000000000f8' } });
    await screen.findByRole('heading', { name: 'Before you start' });
    expect(screen.getByRole('button', { name: 'Show last placement' })).toBeTruthy();
  });

  it('says the last placement needs a connection rather than failing at a door', async () => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    mount({ visit: { previousSetupPhotoDocumentId: '00000000-0000-4000-8000-0000000000f8' } });
    await screen.findByRole('heading', { name: 'Before you start' });
    fireEvent.click(screen.getByRole('button', { name: 'Show last placement' }));
    expect(
      await screen.findByText('The last placement is not available without a connection.'),
    ).toBeTruthy();
    online.mockRestore();
  });
});
