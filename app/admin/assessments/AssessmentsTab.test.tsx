// @vitest-environment jsdom
import { createHash } from 'node:crypto';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProviderBoundary } from '../../shell/auth/AuthContext';
import type { AuthProvider } from '../../shell/auth/types';
import { AssessmentsTab } from './AssessmentsTab';
import { NOT_A_DIAGNOSIS } from './copy';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/**
 * The Assessments tab against a fake API (docs/SPEC/assessment.md section 3).
 * Every id and name is synthetic and inside the reserved ranges
 * (.claude/rules/testing.md), and no real instrument or software is named.
 */

const CLIENT = '00000006-0000-4000-8000-000000000001';
const BASELINE = '0000000f-0000-4000-8000-000000000001';
const CORRECTION = '0000000f-0000-4000-8000-000000000002';
const REMAP = '0000000f-0000-4000-8000-000000000003';

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

const PROVENANCE = { software: 'Synthetic Mapping Suite', softwareVersion: '3.2.1' };

function row(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    clientId: CLIENT,
    instrument: 'qeeg',
    instrumentVersion: '1',
    performedAt: '2026-03-01T08:00:00.000Z',
    performedByPractitionerId: '00000005-0000-4000-8000-000000000001',
    performedBy: 'Rowan Meadow',
    sessionId: null,
    visitOn: null,
    visitServiceName: null,
    derived: {
      kind: 'brain-map',
      provenance: PROVENANCE,
      condition: 'eyes-closed',
      figures: [{ site: 'Fz', band: 'alpha', value: 10, unit: 'uV2' }],
    },
    conditionNote: 'Eyes closed, quiet room.',
    referenceAgeYears: 9,
    referenceSex: 'female',
    version: 1,
    supersedesId: null,
    supersedeReason: null,
    files: [],
    ...overrides,
  };
}

const COMPARISON = {
  clientId: CLIENT,
  instrument: 'qeeg',
  kind: 'brain-map',
  earlier: {
    assessmentId: CORRECTION,
    performedAt: '2026-03-01T08:00:00.000Z',
    instrumentVersion: '1',
    provenance: PROVENANCE,
    referenceAgeYears: 9,
    referenceSex: 'female',
    condition: 'eyes-closed',
  },
  later: {
    assessmentId: REMAP,
    performedAt: '2026-05-30T08:00:00.000Z',
    instrumentVersion: '1',
    provenance: PROVENANCE,
    referenceAgeYears: 10,
    referenceSex: 'female',
    condition: 'eyes-closed',
  },
  figures: [
    {
      key: 'Fz.alpha',
      site: 'Fz',
      band: 'alpha',
      unit: 'uV2',
      earlier: 10,
      later: 12.5,
      difference: 2.5,
    },
  ],
  unpaired: [],
  maximum: null,
};

type Sent = { url: string; method: string; body: unknown; headers?: Headers };

const DOCUMENT = '0000000f-0000-4000-8000-000000000009';
const SIGNED = 'https://example.test/signed?token=x';
/** A one-page PDF's worth of nothing. What matters is that it starts as one. */
const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a]);
const PDF_DIGEST = createHash('sha256').update(PDF_BYTES).digest('hex');
const pdfFile = (): File =>
  new File([PDF_BYTES], 'synthetic-export.pdf', { type: 'application/pdf' });
/**
 * A recording, as far as the browser is concerned: bytes under a name the
 * browser knows no type for, which is what both of the practice's recording
 * formats are. The name is synthetic and names nobody; what the console sends
 * from it is the extension alone.
 */
const EDF_BYTES = new Uint8Array([0x30, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20]);
const recordingFile = (extension: string): File =>
  new File([EDF_BYTES], `synthetic-recording.${extension}`, { type: '' });

function mount(
  options: {
    listStatus?: number;
    chains?: unknown[];
    /** What the list answers from the second request on, after something changed. */
    chainsAfter?: unknown[];
    recordAnswer?: { status: number; body: unknown };
    attachAnswer?: { status: number; body: unknown };
  } = {},
) {
  const sent: Sent[] = [];
  let listed = 0;
  const chains = options.chains ?? [
    {
      current: row(CORRECTION, {
        version: 2,
        supersedesId: BASELINE,
        supersedeReason: 'The alpha figure at Fz was typed from the wrong column.',
        files: [
          {
            documentId: CLIENT,
            role: 'raw_recording',
            condition: 'eyes-open',
            filedAt: '2026-03-01T09:00:00.000Z',
          },
        ],
      }),
      superseded: [
        row(BASELINE, {
          supersedeReason: null,
        }),
      ],
    },
    {
      current: row(REMAP, { performedAt: '2026-05-30T08:00:00.000Z' }),
      superseded: [],
    },
  ];

  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String(input);
    const method = init?.method ?? 'GET';
    if (url.endsWith('/api/me')) return json(ME);
    if (url.includes('/assessments/compare')) {
      sent.push({ url, method, body: null });
      return json({ comparison: COMPARISON });
    }
    if (url.includes('/file') && method === 'PUT') {
      // The bytes, not a JSON envelope: kept as they arrived so a test can
      // check the digest the browser declared against them.
      sent.push({ url, method, body: init?.body ?? null, headers: new Headers(init?.headers) });
      const answer = options.attachAnswer ?? {
        status: 201,
        body: { documentId: DOCUMENT, role: 'raw_recording', condition: null },
      };
      return json(answer.body, answer.status);
    }
    if (url.includes('/assessments/file/') && url.endsWith('/link')) {
      sent.push({ url, method, body: null });
      return json({ url: SIGNED, expiresInSeconds: 300 });
    }
    if (url.endsWith('/assessments') && method === 'GET') {
      listed += 1;
      return options.listStatus === undefined
        ? json({ assessments: listed > 1 ? (options.chainsAfter ?? chains) : chains })
        : json({ error: 'forbidden' }, options.listStatus);
    }
    sent.push({
      url,
      method,
      body: init?.body === undefined ? null : (JSON.parse(String(init.body)) as unknown),
    });
    const answer = options.recordAnswer ?? { status: 201, body: { assessment: row(REMAP) } };
    return json(answer.body, answer.status);
  }) as unknown as typeof fetch;

  render(
    <AuthProviderBoundary provider={provider} fetchImpl={fetchImpl}>
      <AssessmentsTab clientId={CLIENT} />
    </AuthProviderBoundary>,
  );
  return sent;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('the measurements table', () => {
  it('shows each measurement with who recorded it and whether a file is attached', async () => {
    mount();
    expect((await screen.findAllByText('1 Mar 2026')).length).toBe(2);
    expect(screen.getAllByText('Brain map').length).toBe(3);
    expect(screen.getAllByText('Rowan Meadow').length).toBeGreaterThan(0);
    // A filed file is named by what it is, and it opens; the rest say so.
    expect(
      screen.getByRole('button', { name: 'The recording, eyes open, opens in a new tab' }),
    ).toBeTruthy();
    expect(screen.getAllByText('None attached').length).toBe(2);
  });

  it('puts a superseded version beneath the one that replaced it, with its reason', async () => {
    mount();
    await screen.findAllByText('1 Mar 2026');
    expect(screen.getAllByText('Stands').length).toBe(2);
    expect(screen.getByText(/Replaced/)).toBeTruthy();
    expect(
      screen.getByText('The alpha figure at Fz was typed from the wrong column.'),
    ).toBeTruthy();
  });

  it('renders a replaced version’s line quiet, cell by cell', async () => {
    // The shared table renders its own rows and takes no row class, so the
    // quiet is written on the cells. Every cell of the replaced line but the
    // export's, whose content is a note that is already muted or a control.
    mount();
    const rows = await screen.findAllByRole('row');
    const replaced = rows.find((each) => each.textContent?.includes('Replaced'))!;
    const cells = within(replaced).getAllByRole('cell');
    for (const cell of cells.slice(0, 3)) {
      expect(cell.querySelector('span.small.muted'), cell.textContent ?? '').toBeTruthy();
    }
    expect(within(replaced).getByText(/Replaced/).className).toBe('small muted');

    const standing = rows.find((each) => each.textContent?.includes('Stands'))!;
    expect(within(standing).getAllByRole('cell')[0]?.querySelector('span.small.muted')).toBeNull();
  });

  it('names the visit a measurement was taken at, and says so when there was none', async () => {
    // Migration 951. Empty is ordinary rather than missing: a questionnaire
    // filled in at home names no visit of the practice's own.
    mount({
      chains: [
        {
          current: row(BASELINE, {
            sessionId: '00000005-0000-4000-8000-000000000009',
            visitOn: '2026-03-01',
            visitServiceName: 'Brain map',
          }),
          superseded: [],
        },
        { current: row(REMAP, { performedAt: '2026-05-30T08:00:00.000Z' }), superseded: [] },
      ],
    });
    await screen.findAllByText('1 Mar 2026');
    expect(screen.getAllByText('Brain map').length).toBeGreaterThan(2);
    expect(screen.getByText('Not at a visit')).toBeTruthy();
  });

  it('says so plainly when nothing has been measured yet', async () => {
    mount({ chains: [] });
    expect(await screen.findByText('Nothing has been measured for this client yet.')).toBeTruthy();
  });

  it('says the record is not theirs when the server refuses', async () => {
    mount({ listStatus: 403 });
    expect(
      await screen.findByText('This record’s measurements are not yours to read.'),
    ).toBeTruthy();
  });

  it('offers Compare only once two measurements of one instrument stand', async () => {
    mount({ chains: [{ current: row(BASELINE), superseded: [] }] });
    await screen.findByText('1 Mar 2026');
    expect(screen.getByRole('button', { name: 'Record' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Compare' })).toBeNull();
  });
});

describe('the comparison', () => {
  it('shows the earlier figure, the later figure and the difference, and nothing else', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Compare' }));
    const table = await screen.findByRole('table', {
      name: 'The earlier figure, the later figure and the difference',
    });
    const heads = within(table)
      .getAllByRole('columnheader')
      .map((cell) => cell.textContent);
    expect(heads).toEqual(['Site and band', 'In', 'Earlier', 'Later', 'Difference']);
    expect(within(table).getByText('+2.5')).toBeTruthy();
  });

  it('says the age and sex each reference comparison was made against', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Compare' }));
    expect(await screen.findByText('Compared against age 9, female.')).toBeTruthy();
    expect(screen.getByText('Compared against age 10, female.')).toBeTruthy();
  });

  it('carries the band’s own hue and no other colour', async () => {
    const { container } = render(<span />);
    cleanup();
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Compare' }));
    await screen.findByText('+2.5');
    const swatches = document.querySelectorAll('.band__swatch');
    expect(swatches.length).toBeGreaterThan(0);
    for (const swatch of swatches) {
      // The class names the token; the token is the only place a colour is
      // written down (docs/DESIGN-BRIEF.md section 3.1).
      expect(swatch.className).toMatch(/band__swatch--(delta|theta|alpha|beta|gamma)/);
      expect(swatch.getAttribute('style')).toBeNull();
    }
    expect(container).toBeTruthy();
  });

  it('carries the fixed sentence in English and Arabic', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Compare' }));
    expect(await screen.findByText(NOT_A_DIAGNOSIS.en)).toBeTruthy();
    const arabic = screen.getByText(NOT_A_DIAGNOSIS.ar);
    expect(arabic.getAttribute('lang')).toBe('ar');
    expect(arabic.getAttribute('dir')).toBe('rtl');
  });

  it('attaches no word to a figure anywhere on the screen', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Compare' }));
    await screen.findByText('+2.5');
    const text = document.body.textContent?.toLowerCase() ?? '';
    for (const word of ['abnormal', 'high', 'low', 'moderate', 'severe', 'normal']) {
      expect(text.includes(word), word).toBe(false);
    }
  });
});

describe('recording one', () => {
  it('lays the figures out from the instrument’s own declared shape', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Record' }));
    // Nineteen sites of the ten-twenty system, five bands, and a unit for the
    // whole set: the shape is the layout.
    expect(screen.getByLabelText('Fz Alpha')).toBeTruthy();
    expect(screen.getByLabelText('O2 Gamma')).toBeTruthy();
    expect(screen.getByLabelText('What the figures are in')).toBeTruthy();
  });

  it('sends what was typed, with the software that produced it', async () => {
    const sent = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Record' }));
    fireEvent.change(screen.getByLabelText('Software that produced the figures'), {
      target: { value: 'Synthetic Mapping Suite' },
    });
    fireEvent.change(screen.getByLabelText('Its version'), { target: { value: '3.2.1' } });
    fireEvent.change(screen.getByLabelText('Fz Alpha'), { target: { value: '12.5' } });
    // The drawer's own Record button, which is the second: the first is the
    // one on the table that opened it.
    fireEvent.click(screen.getAllByRole('button', { name: 'Record' })[1]!);

    await waitFor(() => expect(sent.some((call) => call.method === 'POST')).toBe(true));
    const posted = sent.find((call) => call.method === 'POST')!.body as {
      instrument: string;
      derived: {
        provenance: { software: string };
        figures: { site: string; band: string; value: number; unit: string }[];
      };
    };
    expect(posted.instrument).toBe('qeeg');
    expect(posted.derived.provenance.software).toBe('Synthetic Mapping Suite');
    expect(posted.derived.figures).toEqual([
      { site: 'Fz', band: 'alpha', value: 12.5, unit: 'uV2' },
    ]);
  });

  it('refuses with the field named when the server says the shape does not know it', async () => {
    mount({
      recordAnswer: {
        status: 422,
        body: { code: 'invalid_payload', field: 'figures.0.unit', reason: 'missing_unit' },
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Record' }));
    fireEvent.change(screen.getByLabelText('Software that produced the figures'), {
      target: { value: 'Synthetic Mapping Suite' },
    });
    fireEvent.change(screen.getByLabelText('Its version'), { target: { value: '3.2.1' } });
    fireEvent.change(screen.getByLabelText('Fz Alpha'), { target: { value: '12.5' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Record' })[1]!);
    expect(await screen.findByText('figures.0.unit: Say what this figure is in.')).toBeTruthy();
  });

  it('says which gate refused a recording, in words', async () => {
    mount({
      recordAnswer: {
        status: 403,
        body: { code: 'credential_invalid', refusals: ['credential_invalid'] },
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Record' }));
    fireEvent.change(screen.getByLabelText('Software that produced the figures'), {
      target: { value: 'Synthetic Mapping Suite' },
    });
    fireEvent.change(screen.getByLabelText('Its version'), { target: { value: '3.2.1' } });
    fireEvent.change(screen.getByLabelText('Fz Alpha'), { target: { value: '12.5' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Record' })[1]!);
    expect(
      await screen.findByText('Your certification for this service is not valid today.'),
    ).toBeTruthy();
  });

  it('asks a questionnaire its own questions and shows the total it computes', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Record' }));
    fireEvent.change(screen.getByLabelText('Instrument'), {
      target: { value: 'questionnaire.sample' },
    });
    expect(screen.getByLabelText('How well did you sleep in the past week?')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('How well did you sleep in the past week?'), {
      target: { value: '2' },
    });
    fireEvent.change(
      screen.getByLabelText('How easy was it to settle to a task in the past week?'),
      { target: { value: '1' } },
    );
    fireEvent.change(screen.getByLabelText('How rested did you feel in the past week?'), {
      target: { value: '3' },
    });
    expect(await screen.findByText('Total 6 out of 12.')).toBeTruthy();
  });
});

describe('the export', () => {
  it('offers Attach the export on the version that stands, and not on a replaced one', async () => {
    mount({ chains: [{ current: row(BASELINE), superseded: [] }] });
    expect(await screen.findByLabelText('Attach the export')).toBeTruthy();

    cleanup();
    mount();
    await screen.findAllByText('1 Mar 2026');
    // Three lines, two of them standing: the replaced one carries no control.
    expect(screen.getAllByLabelText('Attach the export').length).toBe(2);
  });

  it('sends the bytes with the digest it computed in the browser', async () => {
    const sent = mount({ chains: [{ current: row(BASELINE), superseded: [] }] });
    const input = await screen.findByLabelText('Attach the export');
    expect(input.getAttribute('accept')).toBe('application/pdf,.edf,.eeg');

    fireEvent.change(input, { target: { files: [pdfFile()] } });
    await waitFor(() => expect(sent.some((call) => call.method === 'PUT')).toBe(true));

    const put = sent.find((call) => call.method === 'PUT')!;
    // The role is the extension's answer, because nobody gave another one: a
    // PDF is the software's report, and the door refuses one filed as the
    // recording.
    expect(put.url).toBe(`/api/assessments/${BASELINE}/file?role=vendor_report&extension=pdf`);
    expect(put.headers?.get('content-type')).toBe('application/pdf');
    // The fingerprint of the bytes that were sent, taken here and recomputed
    // by the route over what actually arrived.
    expect(put.headers?.get('x-sha256')).toBe(PDF_DIGEST);
    expect(new Uint8Array(put.body as ArrayBuffer)).toEqual(PDF_BYTES);
  });

  it('shows the role the extension chose, so nothing is filed behind the person', async () => {
    // The control opens on the recording and the file chosen is a report, so
    // the default moves the control as well as the request. A screen that sent
    // one word and displayed another would be filing behind somebody's back.
    mount({ chains: [{ current: row(BASELINE), superseded: [] }] });
    const what = (await screen.findByLabelText('What the file is')) as HTMLSelectElement;
    expect(what.value).toBe('raw_recording');
    fireEvent.change(screen.getByLabelText('Attach the export'), {
      target: { files: [pdfFile()] },
    });
    await waitFor(() => expect(what.value).toBe('vendor_report'));
  });

  it('says so when the file is not the thing it is being filed as', async () => {
    // The person overrode the default and called a PDF the recording. The
    // door refuses it on the bytes, and the screen says why in words.
    const sent = mount({
      chains: [{ current: row(BASELINE), superseded: [] }],
      attachAnswer: { status: 400, body: { error: 'bad_request', code: 'kind_and_role_disagree' } },
    });
    fireEvent.change(await screen.findByLabelText('What the file is'), {
      target: { value: 'raw_recording' },
    });
    fireEvent.change(screen.getByLabelText('Attach the export'), {
      target: { files: [pdfFile()] },
    });
    await waitFor(() => expect(sent.some((call) => call.method === 'PUT')).toBe(true));
    // The person's own answer is sent, not the extension's: they said it.
    expect(sent.find((call) => call.method === 'PUT')!.url).toBe(
      `/api/assessments/${BASELINE}/file?role=raw_recording&extension=pdf`,
    );
    expect(
      await screen.findByText(
        'That file is not the thing it is being filed as. A PDF is the software’s report or a ' +
          'session export; a recording is an EDF file or the amplifier software’s own.',
      ),
    ).toBeTruthy();
  });

  it('files it as the software’s report when that is what it is', async () => {
    const sent = mount({ chains: [{ current: row(BASELINE), superseded: [] }] });
    fireEvent.change(await screen.findByLabelText('What the file is'), {
      target: { value: 'vendor_report' },
    });
    fireEvent.change(screen.getByLabelText('Attach the export'), {
      target: { files: [pdfFile()] },
    });
    await waitFor(() => expect(sent.some((call) => call.method === 'PUT')).toBe(true));
    expect(sent.find((call) => call.method === 'PUT')!.url).toBe(
      `/api/assessments/${BASELINE}/file?role=vendor_report&extension=pdf`,
    );
  });

  it('declares a recording as bytes and sends the extension, never the name', async () => {
    for (const extension of ['edf', 'eeg']) {
      const sent = mount({ chains: [{ current: row(BASELINE), superseded: [] }] });
      fireEvent.change(await screen.findByLabelText('Attach the export'), {
        target: { files: [recordingFile(extension)] },
      });
      await waitFor(() => expect(sent.some((call) => call.method === 'PUT')).toBe(true));

      const put = sent.find((call) => call.method === 'PUT')!;
      expect(put.url).toBe(
        `/api/assessments/${BASELINE}/file?role=raw_recording&extension=${extension}`,
      );
      expect(put.headers?.get('content-type')).toBe('application/octet-stream');
      // The name the file was chosen under goes nowhere: the practice's own
      // files are named after the people in them.
      expect(put.url).not.toContain('synthetic-recording');
      cleanup();
    }
  });

  it('offers the condition where the file is a recording, and not otherwise', async () => {
    mount({ chains: [{ current: row(BASELINE), superseded: [] }] });
    // A recording is taken under a condition; the software's report is not.
    expect(await screen.findByLabelText('The condition it was taken under')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('What the file is'), {
      target: { value: 'vendor_report' },
    });
    expect(screen.queryByLabelText('The condition it was taken under')).toBeNull();
  });

  it('sends the condition a recording was taken under, as its own field', async () => {
    const sent = mount({ chains: [{ current: row(BASELINE), superseded: [] }] });
    fireEvent.change(await screen.findByLabelText('The condition it was taken under'), {
      target: { value: 'eyes-closed' },
    });
    fireEvent.change(screen.getByLabelText('Attach the export'), {
      target: { files: [recordingFile('edf')] },
    });
    await waitFor(() => expect(sent.some((call) => call.method === 'PUT')).toBe(true));
    expect(sent.find((call) => call.method === 'PUT')!.url).toBe(
      `/api/assessments/${BASELINE}/file?role=raw_recording&extension=edf&condition=eyes-closed`,
    );
  });

  it('sends no condition where the recording covers both, which is ordinary', async () => {
    // The practice's own native recordings carry eyes open and eyes closed in
    // one file, so the control opens on neither and that answer is sent as an
    // absence rather than as a word.
    const sent = mount({ chains: [{ current: row(BASELINE), superseded: [] }] });
    fireEvent.change(await screen.findByLabelText('Attach the export'), {
      target: { files: [recordingFile('eeg')] },
    });
    await waitFor(() => expect(sent.some((call) => call.method === 'PUT')).toBe(true));
    expect(sent.find((call) => call.method === 'PUT')!.url).not.toContain('condition');
  });

  it('reads the row again, so the file appears where it was attached', async () => {
    mount({
      chains: [{ current: row(BASELINE), superseded: [] }],
      chainsAfter: [
        {
          current: row(BASELINE, {
            files: [
              {
                documentId: DOCUMENT,
                role: 'raw_recording',
                condition: null,
                filedAt: '2026-03-01T09:00:00.000Z',
              },
            ],
          }),
          superseded: [],
        },
      ],
    });
    fireEvent.change(await screen.findByLabelText('Attach the export'), {
      target: { files: [pdfFile()] },
    });
    expect(
      await screen.findByRole('button', { name: 'The recording, opens in a new tab' }),
    ).toBeTruthy();
  });

  it('says why the door refused a file, in words', async () => {
    mount({
      chains: [{ current: row(BASELINE), superseded: [] }],
      attachAnswer: { status: 415, body: { error: 'unsupported_media_type', code: 'not_a_pdf' } },
    });
    fireEvent.change(await screen.findByLabelText('Attach the export'), {
      target: { files: [pdfFile()] },
    });
    expect(
      await screen.findByText('That is not a PDF. A report is the software’s own PDF.'),
    ).toBeTruthy();
  });

  it('opens a filed file through the link route, and not before it is pressed', async () => {
    const open = vi.fn(() => ({}) as Window);
    vi.stubGlobal('open', open);
    const sent = mount();
    const button = await screen.findByRole('button', {
      name: 'The recording, eyes open, opens in a new tab',
    });
    // The link is a read and is audited as one, so it is asked for at the
    // moment somebody presses and never rendered into the page in advance.
    expect(sent.some((call) => call.url.includes('/link'))).toBe(false);

    fireEvent.click(button);
    await waitFor(() => expect(open).toHaveBeenCalledWith(SIGNED, '_blank', 'noopener,noreferrer'));
    expect(sent.some((call) => call.url === `/api/assessments/file/${CLIENT}/link`)).toBe(true);
  });

  it('hands the link over when the browser blocks the tab', async () => {
    vi.stubGlobal(
      'open',
      vi.fn(() => null),
    );
    mount();
    fireEvent.click(
      await screen.findByRole('button', { name: 'The recording, eyes open, opens in a new tab' }),
    );
    const link = await screen.findByRole('link', { name: 'Open it in a new tab' });
    expect(link.getAttribute('href')).toBe(SIGNED);
  });
});
