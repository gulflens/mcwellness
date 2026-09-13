// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProviderBoundary } from '../../shell/auth/AuthContext';
import type { AuthProvider } from '../../shell/auth/types';
import { ExportStep } from './ExportStep';

/**
 * The attach control on the Summary step (app/therapist/session/ExportStep.tsx).
 *
 * Three things are worth proving here and nothing else is: that the screen
 * says the export is optional and marks a visit that has none, that the
 * request carries the extension and the digest and never the file's name, and
 * that a refusal is shown in the door's own words rather than a generic
 * failure.
 *
 * Everything is synthetic (.claude/rules/testing.md). The file names below are
 * deliberately not the shape the practice's own exports have — those are named
 * after the people in them, which is the whole reason a name never crosses the
 * door.
 */

afterEach(cleanup);

const SESSION_ID = '00000000-0000-4000-8000-000000009100';
const DOCUMENT_ID = '00000000-0000-4000-8000-000000009101';

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

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

type Sent = { url: string; init: RequestInit };

/**
 * `busy` and the attached name are the runner's, not the control's, so the
 * harness holds them exactly as SessionRunner does — a control tested with a
 * frozen `busy={false}` would prove nothing about the state the check-out
 * button reads.
 */
function Harness({
  attachedName,
  onBusyChange,
}: {
  attachedName: string | null;
  onBusyChange: (busy: boolean) => void;
}) {
  const [name, setName] = useState<string | null>(attachedName);
  const [busy, setBusy] = useState(false);
  return (
    <ExportStep
      sessionId={SESSION_ID}
      attachedName={name}
      busy={busy}
      onAttached={setName}
      onBusy={(next) => {
        onBusyChange(next);
        setBusy(next);
      }}
    />
  );
}

function mount(
  options: {
    attachedName?: string | null;
    answer?: () => Response;
    /** An upload that never comes back, for the window the dock has to know about. */
    hangs?: boolean;
  } = {},
): { sent: Sent[]; busy: boolean[] } {
  const sent: Sent[] = [];
  const busy: boolean[] = [];
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/me') return json(ME);
    sent.push({ url, init: init ?? {} });
    if (options.hangs) return new Promise<Response>(() => undefined);
    return options.answer ? options.answer() : json({ documentId: DOCUMENT_ID }, 201);
  }) as unknown as typeof fetch;

  render(
    <AuthProviderBoundary provider={provider} fetchImpl={fetchImpl}>
      <Harness
        attachedName={options.attachedName ?? null}
        onBusyChange={(next) => busy.push(next)}
      />
    </AuthProviderBoundary>,
  );
  return { sent, busy };
}

/** A recording of the amplifier software's own kind, as far as this screen cares. */
function chosen(name: string, bytes = new Uint8Array([0x4e, 0x52, 0x43, 0x00])): File {
  return new File([bytes], name);
}

function chooseFile(file: File): void {
  const input = screen.getByLabelText('Attach the export') as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  fireEvent.change(input);
}

describe('the attach control', () => {
  it('says the export is optional and marks a visit that has none', () => {
    mount();
    expect(screen.getByText(/Optional — checking out does not wait for it\./)).toBeTruthy();
    expect(screen.getByText('No export attached')).toBeTruthy();
    // Nothing here is a gate: the control offers no button that could refuse a
    // check-out, and the step's own Check out button is not this component's.
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('sends the extension and the digest, and never the file’s own name', async () => {
    const { sent } = mount();
    chooseFile(chosen('visit-export.eeg'));

    await waitFor(() => expect(sent).toHaveLength(1));
    const request = sent[0]!;
    expect(request.url).toBe(`/api/sessions/${SESSION_ID}/export?extension=eeg`);
    expect(request.init.method).toBe('PUT');
    // apiFetch normalises whatever it was given into a Headers (AuthContext).
    const headers = new Headers(request.init.headers);
    // Bytes with no registered type: the recordings are declared as such and
    // the door reads their own signature (domain/assessment/fileType.ts).
    expect(headers.get('content-type')).toBe('application/octet-stream');
    expect(headers.get('x-sha256')).toMatch(/^[0-9a-f]{64}$/);
    // The name is the one thing that must not travel.
    expect(JSON.stringify([request.url, [...headers]])).not.toContain('visit-export');
    await screen.findByText('visit-export.eeg');
    expect(screen.getByText('Export attached')).toBeTruthy();
  });

  it('tells the runner an upload is in flight, and that it is over', async () => {
    // The check-out button lives in the summary's dock, not here, and
    // confirming unmounts this control — so whether a request is still in the
    // air is the runner's to know (fix round 1, finding 2).
    const { busy } = mount();
    chooseFile(chosen('visit-export.eeg'));
    await screen.findByText('Export attached');
    expect(busy).toEqual([true, false]);
  });

  it('says it is over even when the upload failed', async () => {
    const { busy } = mount({ answer: () => json({ error: 'internal' }, 500) });
    chooseFile(chosen('visit-export.eeg'));
    await screen.findByText('That export could not be filed. Try again.');
    // Never left standing: a dock warning about a request that is over would
    // ask the practitioner to wait for nothing.
    expect(busy).toEqual([true, false]);
  });

  it('holds the chooser shut while an upload it cannot see the end of runs', async () => {
    const { busy } = mount({ hangs: true });
    chooseFile(chosen('visit-export.eeg'));
    await waitFor(() => expect(busy).toEqual([true]));
    expect((screen.getByLabelText('Attach the export') as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText('Attaching the export…')).toBeTruthy();
  });

  it('declares a PDF as one', async () => {
    const { sent } = mount();
    chooseFile(chosen('report.pdf', new Uint8Array([0x25, 0x50, 0x44, 0x46])));
    await waitFor(() => expect(sent).toHaveLength(1));
    const headers = new Headers(sent[0]!.init.headers);
    expect(headers.get('content-type')).toBe('application/pdf');
    expect(sent[0]!.url).toBe(`/api/sessions/${SESSION_ID}/export?extension=pdf`);
  });

  it('shows the door’s own words when the bytes are not what they say', async () => {
    mount({
      answer: () => json({ error: 'unsupported_media_type', code: 'not_a_recording' }, 415),
    });
    chooseFile(chosen('something.eeg'));
    await screen.findByText(/That is not a recording this door takes\./);
    // Still attachable: a refusal leaves the chooser where it was.
    expect(screen.getByText('No export attached')).toBeTruthy();
  });

  it('refuses a file with nothing in it before it sends anything', async () => {
    const { sent } = mount();
    chooseFile(chosen('empty.edf', new Uint8Array(0)));
    await screen.findByText('That file has nothing in it.');
    expect(sent).toHaveLength(0);
  });

  it('names what is already attached, and offers no second chooser', () => {
    mount({ attachedName: 'visit-export.eeg' });
    expect(screen.getByText('Export attached')).toBeTruthy();
    expect(screen.getByText('visit-export.eeg')).toBeTruthy();
    expect(screen.queryByLabelText('Attach the export')).toBeNull();
  });
});
