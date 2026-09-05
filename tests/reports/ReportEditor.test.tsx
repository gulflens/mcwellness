// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProviderBoundary } from '../../app/shell/auth/AuthContext';
import { ReportEditor } from '../../app/admin/reports/ReportEditor';
import { ReportView } from '../../app/admin/reports/ReportView';
import { LEAD_PRACTITIONER, signedInProvider } from '../../app/admin/clients/testActors';

/**
 * The draft editor and the view-and-deliver screen, against a fake API
 * (docs/SPEC/reports-v1.md sections 4.2 and 4.3).
 *
 * Two things matter here above the rest: **the gathered figures are not
 * editable**, because a figure a practitioner could retype is a figure that
 * can disagree with the record; and **signing says in plain words what it
 * means** before it happens.
 */

afterEach(cleanup);

const CLIENT = '00000008-0000-4000-8000-000000000005';
const REPORT = '00000006-0000-4000-8000-000000000001';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const SIGNER = {
  ...LEAD_PRACTITIONER,
  capabilities: [
    {
      serviceTypeId: '00000000-0000-4000-8000-0000000000f1',
      canExecuteSession: true,
      canAuthorProtocol: false,
      canSignReport: true,
      validFrom: '2024-01-01',
      validTo: null,
    },
  ],
};

const LAPSED = {
  ...LEAD_PRACTITIONER,
  capabilities: [
    {
      serviceTypeId: '00000000-0000-4000-8000-0000000000f1',
      canExecuteSession: true,
      canAuthorProtocol: false,
      canSignReport: true,
      validFrom: '2020-01-01',
      validTo: '2021-12-31',
    },
  ],
};

const GATHERED = {
  kind: 'progress',
  coverageFrom: '2026-06-01',
  coverageTo: '2026-09-01',
  sessionsDelivered: 12,
  sessionsEntitled: 15,
  goals: [{ description: 'Sleep through the night', status: 'active', movement: '' }],
  ribbon: {
    slices: [
      { index: 1, quality: 0.6, band: 'theta', mapMark: true },
      { index: 2, quality: 0.9, band: 'alpha', mapMark: false },
    ],
    remaining: 3,
  },
  comparison: null,
  summary: '',
  suggestion: '',
};

const ROW = {
  id: REPORT,
  clientId: CLIENT,
  kind: 'progress',
  status: 'issued',
  locale: 'en',
  reference: 'RPT-000001',
  issuedOn: '2026-09-01',
  coverageFrom: '2026-06-01',
  coverageTo: '2026-09-01',
  signedByName: 'Hazel Harbour',
  version: 1,
  supersedesId: null,
  amendmentReason: null,
  documentId: '00000006-0000-4000-8000-0000000000d1',
  deliveries: 0,
  createdAt: '2026-09-01T08:00:00+04:00',
};

function mountEditor(me: unknown = SIGNER, brainMapsRead = false) {
  const calls: { url: string; body?: unknown }[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url === '/api/me') return json(me);
    if (url.startsWith('/api/reports/gather')) {
      return json({ content: GATHERED, brainMapsRead });
    }
    if (url === '/api/reports/draft') {
      return json({ report: { ...ROW, status: 'draft', reference: null }, content: GATHERED }, 201);
    }
    if (url.endsWith('/issue')) return json({ report: ROW }, 201);
    return json({ error: 'not_found' }, 404);
  });
  const onDone = vi.fn();
  render(
    <AuthProviderBoundary provider={signedInProvider} fetchImpl={fetchImpl}>
      <ReportEditor clientId={CLIENT} onDone={onDone} onCancel={() => undefined} />
    </AuthProviderBoundary>,
  );
  return { calls, onDone };
}

describe('the draft editor', () => {
  it('shows the gathered figures as text, never as a field somebody could retype', async () => {
    mountEditor();
    expect(await screen.findByText('Sessions delivered')).toBeTruthy();
    expect(screen.getByText('12')).toBeTruthy();
    expect(screen.getByText('15')).toBeTruthy();
    // No input anywhere carries a gathered figure.
    for (const input of Array.from(document.querySelectorAll('input'))) {
      expect(input.value).not.toBe('12');
      expect(input.value).not.toBe('15');
    }
  });

  it('draws the ribbon, with one mark per session and the sessions still to come', async () => {
    mountEditor();
    await screen.findByText('Sessions delivered');
    const ribbon = document.querySelector('.ribbon');
    expect(ribbon).toBeTruthy();
    // Two slices, one brain-map hairline and three empty marks.
    expect(ribbon?.querySelectorAll('.ribbon__slice')).toHaveLength(2);
    expect(ribbon?.querySelectorAll('.ribbon__map')).toHaveLength(1);
    expect(ribbon?.querySelectorAll('.ribbon__empty')).toHaveLength(3);
    // The hue comes from the band's own token class and never from a literal.
    expect(ribbon?.querySelector('.ribbon__slice--theta')).toBeTruthy();
    expect(ribbon?.innerHTML).not.toMatch(/#[0-9a-f]{3,6}/i);
  });

  it('says the report will say nothing about brain maps when there are none', async () => {
    mountEditor(SIGNER, true);
    expect(
      await screen.findByText(
        'This client has fewer than two brain maps of one kind, so the report says nothing about them.',
      ),
    ).toBeTruthy();
  });

  it('says so differently when the system holds no brain maps at all', async () => {
    mountEditor(SIGNER, false);
    expect(
      await screen.findByText(
        'Brain maps are not recorded on this system yet, so the report says nothing about them.',
      ),
    ).toBeTruthy();
  });

  it('takes the practitioner’s own words and sends them with the draft', async () => {
    const { calls } = mountEditor();
    const summary = await screen.findByLabelText('Summary');
    fireEvent.change(summary, { target: { value: 'Settling faster.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save the draft' }));
    await waitFor(() => {
      const save = calls.find((call) => call.url === '/api/reports/draft');
      expect((save?.body as { content: { summary: string } })?.content.summary).toBe(
        'Settling faster.',
      );
    });
  });

  it('says in plain words what signing means before it happens', async () => {
    mountEditor();
    fireEvent.click(await screen.findByRole('button', { name: 'Sign this report' }));
    expect(
      screen.getByText(/it cannot be edited afterwards — a mistake is corrected by issuing/),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign and issue' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'See the page first' })).toBeTruthy();
  });

  it('never names who is signing: the server takes the person doing it', async () => {
    const { calls, onDone } = mountEditor();
    fireEvent.click(await screen.findByRole('button', { name: 'Sign this report' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sign and issue' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const issue = calls.find((call) => call.url.endsWith('/issue'));
    expect(issue?.body).toEqual({});
  });

  it('offers no signing door to somebody whose certificate has lapsed', async () => {
    mountEditor(LAPSED);
    await screen.findByText('Sessions delivered');
    expect(screen.queryByRole('button', { name: 'Sign this report' })).toBeNull();
    expect(
      screen.getByText(/A report is signed by a practitioner whose certificate says so/),
    ).toBeTruthy();
  });
});

describe('view and deliver', () => {
  function mountView(over: Record<string, unknown> = {}, contacts: unknown[] = []) {
    const calls: { url: string; body?: unknown }[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url === '/api/me') return json(SIGNER);
      if (url === `/api/reports/${REPORT}`) {
        return json({
          report: { ...ROW, ...over },
          content: GATHERED,
          deliveries: [],
          url: 'https://storage.example.com/signed',
          expiresInSeconds: 300,
          ...(over.responseOver as object | undefined),
        });
      }
      if (url === `/api/clients/${CLIENT}`) return json({ contacts });
      if (url.endsWith('/deliver')) {
        return json(
          {
            channel: 'whatsapp',
            delivered: false,
            handoffUrl: 'https://wa.me/971500000012?text=x',
            message: 'Your progress report RPT-000001 is ready.',
          },
          201,
        );
      }
      if (url.endsWith('/supersede')) return json({ report: { ...ROW, version: 2 } }, 201);
      return json({ error: 'not_found' }, 404);
    });
    render(
      <AuthProviderBoundary provider={signedInProvider} fetchImpl={fetchImpl}>
        <ReportView reportId={REPORT} maySupersede maySend onBack={() => undefined} />
      </AuthProviderBoundary>,
    );
    return calls;
  }

  it('shows the report’s own facts and offers to open it', async () => {
    mountView();
    expect(await screen.findByText('RPT-000001')).toBeTruthy();
    expect(screen.getByText('Progress report')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open the report' })).toBeTruthy();
  });

  it('says a superseded version is kept because a household may hold it', async () => {
    mountView({ status: 'superseded' });
    expect(
      await screen.findByText(
        /A newer version of this report has been issued. This one is kept because a household may already hold it\./,
      ),
    ).toBeTruthy();
  });

  it('hands off to WhatsApp rather than claiming to have sent anything', async () => {
    mountView({}, [
      {
        id: '00000008-0000-4000-8000-0000000000c1',
        relationship: 'mother',
        canReceiveReports: true,
      },
    ]);
    fireEvent.click(await screen.findByRole('button', { name: 'Send' }));
    expect(
      await screen.findByRole('link', { name: 'Open WhatsApp with the message written' }),
    ).toBeTruthy();
  });

  it('says nobody on the record receives reports rather than offering an empty list', async () => {
    mountView({}, []);
    expect(
      await screen.findByText('Nobody on this record is marked as receiving reports.'),
    ).toBeTruthy();
  });

  it('asks for a reason before it starts a correction, and says both are kept', async () => {
    const calls = mountView();
    fireEvent.click(await screen.findByRole('button', { name: 'Correct this report' }));
    expect(screen.getByText(/This report stays as it is and is marked as replaced/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Why a new version is needed'), {
      target: { value: 'The coverage ended a week later.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Start a new version' }));
    await waitFor(() => {
      const call = calls.find((each) => each.url.endsWith('/supersede'));
      expect((call?.body as { reason: string })?.reason).toBe('The coverage ended a week later.');
    });
    // And it does not sign the new one by itself.
    expect(
      await screen.findByText(
        'A new version has been started as a draft. Read it over, then sign it.',
      ),
    ).toBeTruthy();
  });
});
