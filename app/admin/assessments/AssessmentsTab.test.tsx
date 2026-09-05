// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProviderBoundary } from '../../shell/auth/AuthContext';
import type { AuthProvider } from '../../shell/auth/types';
import { AssessmentsTab } from './AssessmentsTab';
import { NOT_A_DIAGNOSIS } from './copy';

afterEach(cleanup);

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

type Sent = { url: string; method: string; body: unknown };

function mount(
  options: {
    listStatus?: number;
    chains?: unknown[];
    recordAnswer?: { status: number; body: unknown };
  } = {},
) {
  const sent: Sent[] = [];
  const chains = options.chains ?? [
    {
      current: row(CORRECTION, {
        version: 2,
        supersedesId: BASELINE,
        supersedeReason: 'The alpha figure at Fz was typed from the wrong column.',
        files: [{ documentId: CLIENT, role: 'raw', filedAt: '2026-03-01T09:00:00.000Z' }],
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
    if (url.endsWith('/assessments') && method === 'GET') {
      return options.listStatus === undefined
        ? json({ assessments: chains })
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
    expect(screen.getByText('1 file')).toBeTruthy();
    expect(screen.getAllByText('None attached').length).toBe(2);
  });

  it('puts a superseded version beneath the one that replaced it, with its reason', async () => {
    mount();
    await screen.findAllByText('1 Mar 2026');
    expect(screen.getAllByText('Stands').length).toBe(2);
    expect(screen.getByText('Replaced')).toBeTruthy();
    expect(
      screen.getByText('The alpha figure at Fz was typed from the wrong column.'),
    ).toBeTruthy();
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
