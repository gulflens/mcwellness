// @vitest-environment jsdom
import { createHash } from 'node:crypto';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProviderBoundary } from '../../app/shell/auth/AuthContext';
import { LEAD_PRACTITIONER, signedInProvider } from '../../app/admin/clients/testActors';
import {
  PAST_RECORD_REASONS,
  PastRecordImport,
} from '../../app/admin/reports/qeeg/PastRecordImport';
import { PastRecordView } from '../../app/admin/reports/qeeg/PastRecordView';
import { QeegStart } from '../../app/admin/reports/qeeg/QeegStart';
import { IMPORT_REFUSALS } from '../../app/admin/reports/qeeg/pastRecordWords';
import {
  buildLegacyFile,
  LEGACY_NAME,
  readLegacyFile,
  type LegacyFile,
} from '../../domain/reports/qeeg/testing/legacyFile';

/**
 * Bringing in a past record from the practice's old tool, and reading one
 * kept (docs/SPEC/reports-qeeg.md section 11; brief R, item 7), against a
 * fake API.
 *
 * What matters most here: the file is read in the browser and only the
 * reader's content crosses the wire, never the person it typed; the file's
 * person is set beside the client's record with a warning where they
 * disagree; every note of what could not be carried is shown before she
 * keeps it, the pictures' included; a kept record is read, never previewed,
 * and withdrawn with a reason; and a follow-up is offered a kept record to be
 * compared with.
 *
 * Every file is invented (`domain/reports/qeeg/testing/legacyFile.ts`). The
 * browser's decoder is stood in for, as the maps' own tests do: a picture's
 * bytes name its size, and "unreadable" is a picture the browser cannot open.
 */

vi.mock('../../app/admin/reports/qeeg/decodePicture', () => ({
  openPicture: vi.fn(async (file: Blob) => {
    const size = await file.text();
    if (size === 'unreadable') return null;
    const [width, height] = size.split('x').map(Number) as [number, number];
    return {
      width,
      height,
      pixels: () => {
        const data = new Uint8ClampedArray(width * height * 4);
        for (let i = 0; i < data.length; i += 4) {
          data[i] = 90;
          data[i + 1] = 60;
          data[i + 2] = 150;
          data[i + 3] = 255;
        }
        return { width, height, data };
      },
      close: () => undefined,
    };
  }),
}));

afterEach(() => {
  cleanup();
});

const CLIENT = '00000008-0000-4000-8000-000000000005';
const RECORD = '00000006-0000-4000-8000-000000000021';
const SIGNED = '00000006-0000-4000-8000-000000000022';
const FIGURE = '0000000d-0000-4000-8000-000000000021';
const STAMP = '2026-09-30T08:00:00.000000Z';
const FILED = '2026-09-30T08:01:00.000000Z';
const TYPED_AGE = '47 years and 3 months';

const [GIVEN = '', FAMILY = ''] = LEGACY_NAME.en.split(' ');

/** A picture held in the file: its bytes name its size, for the decoder's stand-in. */
const picture = (bytes: string) => `data:image/png;base64,${btoa(bytes)}`;

/** The invented file, its second picture one the browser cannot open. */
function oldFile(person: Record<string, unknown> = {}): LegacyFile {
  return buildLegacyFile(
    {
      maps: [
        { label: 'EO: Eyes Open', name: 'open.png', img: { url: picture('40x30'), w: 40, h: 30 } },
        {
          label: 'EC: Eyes Closed',
          name: 'closed.png',
          img: { url: picture('unreadable'), w: 40, h: 30 },
        },
      ],
    },
    { age: TYPED_AGE, ...person },
  );
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function row(over: Record<string, unknown> = {}) {
  return {
    id: RECORD,
    clientId: CLIENT,
    kind: 'qeeg',
    status: 'draft',
    locale: 'en',
    reference: null,
    issuedOn: null,
    coverageFrom: null,
    coverageTo: null,
    signedByName: null,
    version: 1,
    supersedesId: null,
    amendmentReason: null,
    documentId: null,
    deliveries: 0,
    createdAt: '2026-09-30T08:00:00+04:00',
    twinOfId: null,
    twinId: null,
    outOfStep: false,
    pastRecord: true,
    withdrawn: false,
    recordedOn: '2026-03-14',
    ...over,
  };
}

type Call = { url: string; method: string; headers: Headers; body: unknown; raw: unknown };

function mountApi({
  record = {
    givenName: GIVEN,
    familyName: FAMILY,
    dateOfBirth: '1978-10-01',
    sexAtBirth: 'female',
  },
  keep,
  withdraw,
  stored,
}: {
  record?: Record<string, unknown>;
  keep?: () => Response;
  withdraw?: () => Response;
  stored?: { report: Record<string, unknown>; content: unknown };
} = {}) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers = new Headers(init?.headers);
    const raw = init?.body;
    const body: unknown = typeof raw === 'string' ? JSON.parse(raw) : undefined;
    calls.push({ url, method, headers, body, raw });
    if (url === '/api/me') return json(LEAD_PRACTITIONER);
    if (url === `/api/clients/${CLIENT}`) {
      return json({ id: CLIENT, givenNameAr: null, familyNameAr: null, ...record });
    }
    if (url === '/api/reports/qeeg/import') {
      const sent = body as { content: unknown };
      return json({ report: row(), content: sent.content, savedAt: STAMP }, 201);
    }
    if (url === `/api/reports/${RECORD}/figures` && method === 'PUT') {
      return json(
        {
          figure: {
            figureId: FIGURE,
            sha256: headers.get('x-sha256'),
            widthPx: 40,
            heightPx: 30,
            borrowed: false,
          },
          savedAt: FILED,
        },
        201,
      );
    }
    if (url === `/api/reports/${RECORD}/keep-import`) {
      return keep?.() ?? json({ report: row({ status: 'imported' }) });
    }
    if (url === `/api/reports/${RECORD}/withdraw-import`) {
      return withdraw?.() ?? json({ report: row({ status: 'imported', withdrawn: true }) });
    }
    if (url === `/api/reports/${RECORD}` && stored) {
      return json({
        report: stored.report,
        content: stored.content,
        deliveries: [],
        url: null,
        expiresInSeconds: null,
        savedAt: STAMP,
      });
    }
    return json({ error: 'not_found' }, 404);
  });
  const sent = () => calls.filter((call) => call.method !== 'GET');
  return { calls, sent, fetchImpl };
}

function mountImport(api = mountApi()) {
  const onDone = vi.fn();
  render(
    <AuthProviderBoundary provider={signedInProvider} fetchImpl={api.fetchImpl}>
      <PastRecordImport clientId={CLIENT} onDone={onDone} onCancel={vi.fn()} />
    </AuthProviderBoundary>,
  );
  return { ...api, onDone };
}

async function chooseFile(user: ReturnType<typeof userEvent.setup>, file: LegacyFile) {
  const text = JSON.stringify(file);
  await user.upload(
    await screen.findByLabelText('The report file from the old tool'),
    new File([text], 'report.qeeg.json', { type: 'application/json' }),
  );
  return text;
}

describe('bringing in a past record', () => {
  it('reads the file in the browser and sends only its content and fingerprint, never the person', async () => {
    const user = userEvent.setup();
    const api = mountImport();
    const file = oldFile();
    const text = await chooseFile(user, file);
    await user.click(await screen.findByRole('button', { name: 'Bring it in' }));
    await screen.findByRole('button', { name: 'Keep it as a past record' });

    const posted = api.sent().find((call) => call.url === '/api/reports/qeeg/import');
    if (!posted) throw new Error('Nothing was brought in.');
    expect(posted.headers.get('x-reason')).toBe(PAST_RECORD_REASONS.import);
    const sha = createHash('sha256').update(text).digest('hex');
    expect(posted.body).toEqual({
      clientId: CLIENT,
      sourceSha256: sha,
      content: readLegacyFile(file, sha).content,
    });
    // No request carried the file, or the name, the Arabic name or the age it typed.
    for (const call of api.sent()) {
      const said = typeof call.raw === 'string' ? call.raw : '';
      expect(said).not.toContain(LEGACY_NAME.en);
      expect(said).not.toContain(LEGACY_NAME.ar);
      expect(said).not.toContain(TYPED_AGE);
      expect(said).not.toContain('"maps":[');
    }
  });

  it('shows the file’s person beside the record, and warns where they disagree', async () => {
    const user = userEvent.setup();
    mountImport(
      mountApi({
        record: {
          givenName: 'Amber',
          familyName: 'Bay',
          dateOfBirth: '1978-10-01',
          sexAtBirth: 'male',
        },
      }),
    );
    await chooseFile(user, oldFile());
    expect(await screen.findByText(LEGACY_NAME.en)).toBeTruthy();
    expect(screen.getByText('Amber Bay')).toBeTruthy();
    expect(screen.getByText(TYPED_AGE)).toBeTruthy();
    expect(
      screen.getByText(/does not match this client’s record in the name, the age and the sex/),
    ).toBeTruthy();
  });

  it('warns of nothing when the file and the record agree', async () => {
    const user = userEvent.setup();
    mountImport();
    await chooseFile(user, oldFile({ age: '47' }));
    // The same name twice: in the file, and on the record.
    expect(await screen.findAllByText(LEGACY_NAME.en)).toHaveLength(2);
    expect(screen.queryByText(/does not match this client’s record/)).toBeNull();
  });

  it('shows what could not be carried before anything is sent', async () => {
    const user = userEvent.setup();
    const api = mountImport();
    await chooseFile(user, oldFile());
    const notes = await screen.findByRole('list', { name: 'What could not be carried' });
    // The old tool printed 5 for the sixth score nobody set.
    expect(notes.textContent).toMatch(/A score nobody set/);
    expect(api.sent()).toHaveLength(0);
  });

  it('files the pictures it can, notes the one it cannot by its place, and shows it before keeping', async () => {
    const user = userEvent.setup();
    const api = mountImport();
    await chooseFile(user, oldFile());
    await user.click(await screen.findByRole('button', { name: 'Bring it in' }));
    await screen.findByRole('button', { name: 'Keep it as a past record' });
    const uploads = api.sent().filter((call) => call.method === 'PUT');
    expect(uploads).toHaveLength(1);
    expect(uploads[0]?.headers.get('content-type')).toBe('image/png');
    expect(
      screen.getByText('A picture was not brought in: the picture in place 2 of the file.'),
    ).toBeTruthy();
    expect(api.sent().some((call) => call.url.endsWith('/keep-import'))).toBe(false);
  });

  it('keeps it with the maps placed and the pictures left out named, over the last picture’s stamp', async () => {
    const user = userEvent.setup();
    const api = mountImport();
    await chooseFile(user, oldFile());
    await user.click(await screen.findByRole('button', { name: 'Bring it in' }));
    await user.click(await screen.findByRole('button', { name: 'Keep it as a past record' }));
    await waitFor(() => expect(api.onDone).toHaveBeenCalledWith(RECORD));
    const kept = api.sent().find((call) => call.url.endsWith('/keep-import'));
    expect(kept?.headers.get('x-reason')).toBe(PAST_RECORD_REASONS.keep);
    expect(kept?.body).toMatchObject({
      savedAt: FILED,
      maps: {
        'map-0': {
          figureId: FIGURE,
          widthPx: 40,
          heightPx: 30,
          condition: 'eyes_open',
          caption: null,
          position: 0,
        },
      },
      leftOut: ['map-1'],
    });
  });

  it('says in a sentence why a keep was refused', async () => {
    const user = userEvent.setup();
    mountImport(mountApi({ keep: () => json({ error: 'conflict', code: 'stale_draft' }, 409) }));
    await chooseFile(user, oldFile());
    await user.click(await screen.findByRole('button', { name: 'Bring it in' }));
    await user.click(await screen.findByRole('button', { name: 'Keep it as a past record' }));
    expect(await screen.findByText(IMPORT_REFUSALS['stale_draft'] ?? '')).toBeTruthy();
  });

  it('refuses a file the old tool did not write, before anything is sent', async () => {
    const user = userEvent.setup();
    const api = mountImport();
    await user.upload(
      await screen.findByLabelText('The report file from the old tool'),
      new File(['not a report'], 'notes.json', { type: 'application/json' }),
    );
    expect(await screen.findByText(/not a report saved by the old tool/)).toBeTruthy();
    expect(api.sent()).toHaveLength(0);
  });
});

describe('a kept past record, read', () => {
  function stored(over: Record<string, unknown> = {}) {
    const sha = 'a'.repeat(64);
    const content = readLegacyFile(buildLegacyFile(), sha).content;
    return { report: row({ status: 'imported', ...over }), content };
  }

  function mountView(api: ReturnType<typeof mountApi>, mayWithdraw = true) {
    render(
      <AuthProviderBoundary provider={signedInProvider} fetchImpl={api.fetchImpl}>
        <PastRecordView reportId={RECORD} mayWithdraw={mayWithdraw} onBack={vi.fn()} />
      </AuthProviderBoundary>,
    );
    return api;
  }

  it('shows what it records and its notes, read-only, with no preview or signature', async () => {
    mountView(mountApi({ stored: stored() }));
    expect(await screen.findByText('Past record from the old report tool')).toBeTruthy();
    expect(screen.getByText('14/03/2026')).toBeTruthy();
    expect(screen.getByRole('list', { name: 'What could not be carried' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Preview|Sign/ })).toBeNull();
    expect(screen.queryByRole('textbox', { name: /Key findings/ })).toBeNull();
  });

  it('withdraws it with the reason she typed, in the body', async () => {
    const user = userEvent.setup();
    const api = mountView(mountApi({ stored: stored() }));
    await user.click(await screen.findByRole('button', { name: 'Withdraw this record' }));
    await user.type(
      screen.getByLabelText('Why it is withdrawn'),
      'Kept against another client’s record',
    );
    await user.click(screen.getByRole('button', { name: 'Withdraw it' }));
    await waitFor(() =>
      expect(api.sent().some((call) => call.url.endsWith('/withdraw-import'))).toBe(true),
    );
    const call = api.sent().find((c) => c.url.endsWith('/withdraw-import'));
    expect(call?.body).toEqual({ reason: 'Kept against another client’s record' });
  });

  it('says why it cannot be withdrawn while a follow-up is compared with it', async () => {
    const user = userEvent.setup();
    mountView(
      mountApi({
        stored: stored(),
        withdraw: () =>
          json({ error: 'conflict', code: 'in_comparison', reportIds: [SIGNED] }, 409),
      }),
    );
    await user.click(await screen.findByRole('button', { name: 'Withdraw this record' }));
    await user.type(screen.getByLabelText('Why it is withdrawn'), 'Kept against the wrong client');
    await user.click(screen.getByRole('button', { name: 'Withdraw it' }));
    expect(await screen.findByText(IMPORT_REFUSALS['in_comparison'] ?? '')).toBeTruthy();
  });

  it('offers no withdraw to whoever may not, nor on one withdrawn already', async () => {
    mountView(mountApi({ stored: stored() }), false);
    await screen.findByText('Past record from the old report tool');
    expect(screen.queryByRole('button', { name: 'Withdraw this record' })).toBeNull();
    cleanup();
    mountView(mountApi({ stored: { ...stored({ withdrawn: true }), content: {} } }));
    expect(await screen.findByText(/This record was withdrawn/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Withdraw this record' })).toBeNull();
  });
});

describe('a follow-up’s list of earlier reports', () => {
  it('offers a kept past record beside a signed report, by the day it was recorded', async () => {
    const user = userEvent.setup();
    const past = row({ status: 'imported' });
    const signed = row({
      id: SIGNED,
      status: 'issued',
      reference: 'RPT-000001',
      issuedOn: '2026-06-02',
      pastRecord: false,
      recordedOn: '2026-06-01',
      createdAt: '2026-06-02T08:00:00+04:00',
    });
    render(<QeegStart reports={[signed, past] as never} onStart={vi.fn()} onCancel={vi.fn()} />);
    await user.click(screen.getByLabelText('Follow-up, compared with an earlier report'));
    const options = screen.getAllByRole('option').map((option) => option.textContent);
    expect(options).toEqual([
      'Past record from the old tool, recorded on 14/03/2026',
      'RPT-000001, signed on 02/06/2026',
    ]);
  });
});
