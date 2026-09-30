// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProviderBoundary } from '../../app/shell/auth/AuthContext';
import { QeegEditor } from '../../app/admin/reports/qeeg/QeegEditor';
import {
  ISSUE_REFUSALS,
  PREVIEW_REFUSALS,
  SUPERSEDE_REFUSALS,
} from '../../app/admin/reports/qeeg/refusals';
import { SAVE_REASONS } from '../../app/admin/reports/qeeg/useQeegDraft';
import { SIGN_REASON } from '../../app/admin/reports/qeeg/useQeegSigning';
import { LEAD_PRACTITIONER, signedInProvider } from '../../app/admin/clients/testActors';
import { blankInitial } from '../../domain/reports/qeeg/blank';
import type { QeegContent } from '../../domain/reports/qeeg/types';

/**
 * Previewing and signing a brain-map report from its form, and correcting it
 * once signed, against a fake API (docs/SPEC/reports-qeeg.md sections 12, 14
 * and 15; brief P).
 *
 * What matters here: Preview and Sign each save first; the preview opens the
 * server's own file in a new tab and says what the pages found beside the
 * button, and a `window.open` that answers null is not called blocked;
 * signing is a panel inside the form, never the browser's dialog; a refusal
 * lists what is left; a signed report is shown read only with its reference,
 * its file and a way to correct it.
 *
 * Every id is in the reserved synthetic shape and every person comes from
 * `testActors`.
 */

const CLIENT = '00000008-0000-4000-8000-000000000005';
const DRAFT = '00000006-0000-4000-8000-000000000009';
const CORRECTED = '00000006-0000-4000-8000-00000000000a';
const MAP = '0000000d-0000-4000-8000-000000000001';
const STAMP = '2026-09-30T08:00:00.000000Z';
const FILE_URL = 'https://store.example.com/signed-link';

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

const NOTES = {
  pages: 7,
  dashboardScale: 0.908,
  overflowing: [],
  unprintable: ['U+0141'],
  unprintableMore: 0,
  maps: [{ figureId: MAP, dpi: 180, quality: 'fair' }],
  pairs: [],
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function row(over: Record<string, unknown> = {}) {
  return {
    id: DRAFT,
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
    ...over,
  };
}

const SIGNED_ROW = row({
  status: 'issued',
  reference: 'RPT-000042',
  issuedOn: '2026-09-30',
  signedByName: 'Rowan Ridge',
  documentId: '0000000e-0000-4000-8000-000000000001',
});

type Call = { url: string; method: string; reason: string | null; body: unknown };

function withServerParts(sent: Record<string, unknown>): QeegContent {
  return {
    ...sent,
    subject: { nameAr: null, ageYears: 9, sex: 'female' },
    provenance: { origin: 'app' },
  } as unknown as QeegContent;
}

type Answers = {
  preview?: () => Response;
  issue?: () => Response;
  supersede?: () => Response;
};

function mountApi(actor: object, answers: Answers = {}) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const reason = new Headers(init?.headers).get('x-reason');
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ url, method, reason, body });
    if (url === '/api/me') return json(actor);
    if (url === '/api/reports/draft') {
      const sent = (body as { content: Record<string, unknown>; id?: string }).content;
      return json(
        { report: row(), content: withServerParts(sent), savedAt: STAMP },
        (body as { id?: string }).id ? 200 : 201,
      );
    }
    if (url === `/api/reports/${DRAFT}/figures`) return json({ figures: [] });
    if (url === `/api/reports/${DRAFT}/preview?locale=en`) {
      return (
        answers.preview?.() ??
        new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), {
          status: 200,
          headers: { 'content-type': 'application/pdf', 'x-report-layout': JSON.stringify(NOTES) },
        })
      );
    }
    if (url === `/api/reports/${DRAFT}/issue`) {
      return answers.issue?.() ?? json({ report: SIGNED_ROW }, 201);
    }
    if (url === `/api/reports/${DRAFT}/supersede`) {
      return (
        answers.supersede?.() ??
        json({ report: row({ id: CORRECTED, version: 2, supersedesId: DRAFT }) }, 201)
      );
    }
    if (url === `/api/reports/${DRAFT}`) {
      return json({
        report: SIGNED_ROW,
        content: withServerParts({ ...blankInitial() }),
        deliveries: [],
        url: FILE_URL,
        expiresInSeconds: 300,
        savedAt: STAMP,
      });
    }
    return json({ error: 'not_found' }, 404);
  });
  return { calls, fetchImpl };
}

let opened: ReturnType<typeof vi.fn>;

beforeEach(() => {
  // A tab opened with `noopener` answers null, whether or not it opened.
  opened = vi.fn(() => null);
  vi.spyOn(window, 'open').mockImplementation(opened as unknown as typeof window.open);
  Object.assign(URL, {
    createObjectURL: vi.fn(() => 'blob:preview-file'),
    revokeObjectURL: vi.fn(),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

function mountEditor(actor: object = SIGNER, answers: Answers = {}) {
  const api = mountApi(actor, answers);
  const onDone = vi.fn();
  const onCorrected = vi.fn();
  render(
    <AuthProviderBoundary provider={signedInProvider} fetchImpl={api.fetchImpl}>
      <QeegEditor
        clientId={CLIENT}
        reportId={null}
        start={blankInitial()}
        reports={[]}
        onDone={onDone}
        onCorrected={onCorrected}
      />
    </AuthProviderBoundary>,
  );
  return { ...api, onDone, onCorrected };
}

const urls = (calls: readonly Call[]) => calls.map((call) => `${call.method} ${call.url}`);

describe('Preview', () => {
  it('saves the draft first, then opens the server’s own file in a new tab', async () => {
    const user = userEvent.setup();
    const { calls } = mountEditor();
    await user.click(await screen.findByRole('button', { name: 'Preview' }));
    await waitFor(() => expect(opened).toHaveBeenCalled());
    const order = urls(calls).filter((call) => call.includes('/api/reports/'));
    const saved = order.indexOf('POST /api/reports/draft');
    const previewed = order.indexOf(`GET /api/reports/${DRAFT}/preview?locale=en`);
    expect(saved).toBeGreaterThanOrEqual(0);
    expect(previewed).toBeGreaterThan(saved);
    expect(calls.find((call) => call.url === '/api/reports/draft')?.reason).toBe(
      SAVE_REASONS.preview,
    );
    expect(opened).toHaveBeenCalledWith('blob:preview-file', '_blank', 'noopener,noreferrer');
  });

  it('never says the tab was blocked because the browser answered null', async () => {
    const user = userEvent.setup();
    mountEditor();
    await user.click(await screen.findByRole('button', { name: 'Preview' }));
    await screen.findByText(/The preview opened in a new tab\./);
    expect(screen.queryByText(/blocked/i)).toBeNull();
    const again = screen.getByRole('link', { name: 'Open the preview again' });
    expect(again.getAttribute('href')).toBe('blob:preview-file');
    expect(again.getAttribute('target')).toBe('_blank');
  });

  it('shows what the pages found beside the button', async () => {
    const user = userEvent.setup();
    mountEditor();
    await user.click(await screen.findByRole('button', { name: 'Preview' }));
    const found = await screen.findByRole('list', { name: 'What the preview found' });
    const lines = within(found)
      .getAllByRole('listitem')
      .map((item) => item.textContent);
    expect(lines).toContain('7 pages.');
    expect(lines).toContain('The dashboard is drawn at 91% of its size to fit its page.');
    expect(lines).toContain(
      'The typeface cannot draw Ł (U+0141). Those characters would be left out of the page.',
    );
  });

  it('says what ran over when the preview is refused, and opens nothing', async () => {
    const user = userEvent.setup();
    mountEditor(SIGNER, {
      preview: () =>
        json(
          {
            error: 'unprocessable',
            code: 'overrun',
            parts: ['summary.1'],
            layout: { ...NOTES, overflowing: ['summary.1'] },
          },
          422,
        ),
    });
    await user.click(await screen.findByRole('button', { name: 'Preview' }));
    expect(
      await screen.findByText(`${PREVIEW_REFUSALS['overrun']} It ran over under: Summary.`),
    ).toBeTruthy();
    expect(screen.getByText('Runs past the foot of its page: Summary.')).toBeTruthy();
    expect(screen.queryByText(/summary\.1/)).toBeNull();
    expect(opened).not.toHaveBeenCalled();
    expect(screen.queryByRole('link', { name: 'Open the preview again' })).toBeNull();
  });
});

describe('Sign', () => {
  it('asks inside the form, never with the browser’s own dialog', async () => {
    const user = userEvent.setup();
    const asked = vi.spyOn(window, 'confirm');
    const { calls } = mountEditor();
    await user.click(await screen.findByRole('button', { name: 'Sign this report' }));
    expect(screen.getByLabelText('Sign this report')).toBeTruthy();
    expect(screen.getByText(/Signing this puts your name on it\./)).toBeTruthy();
    expect(asked).not.toHaveBeenCalled();
    // Nothing is signed until she says so.
    expect(calls.some((call) => call.url.endsWith('/issue'))).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Not yet' }));
    expect(screen.queryByLabelText('Sign this report')).toBeNull();
  });

  it('saves first, then signs naming the save and saying why', async () => {
    const user = userEvent.setup();
    const { calls } = mountEditor();
    await user.click(await screen.findByRole('button', { name: 'Sign this report' }));
    await user.click(screen.getByRole('button', { name: 'Sign and issue' }));
    await screen.findByText('Brain-map report, signed');
    const order = urls(calls).filter((call) => call.startsWith('POST'));
    expect(order).toEqual(['POST /api/reports/draft', `POST /api/reports/${DRAFT}/issue`]);
    const issued = calls.find((call) => call.url.endsWith('/issue'));
    expect(issued?.body).toEqual({ savedAt: STAMP });
    expect(issued?.reason).toBe(SIGN_REASON);
    expect(calls.find((call) => call.url === '/api/reports/draft')?.reason).toBe(SAVE_REASONS.sign);
  });

  it('lists what is left to fill when the signature is refused for it', async () => {
    const user = userEvent.setup();
    mountEditor(SIGNER, {
      issue: () =>
        json(
          {
            error: 'unprocessable',
            code: 'incomplete',
            missing: [
              { section: 'label.findings', what: 'connectivity.phase_lag.title' },
              { section: 'heading.summary', what: 'heading.summary' },
            ],
          },
          422,
        ),
    });
    await user.click(await screen.findByRole('button', { name: 'Sign this report' }));
    await user.click(screen.getByRole('button', { name: 'Sign and issue' }));
    expect(await screen.findByText(ISSUE_REFUSALS['incomplete'] ?? '')).toBeTruthy();
    const left = screen.getByRole('list', { name: 'Still to fill' });
    expect(within(left).getAllByRole('listitem')).toHaveLength(2);
    // Still the form: nothing was signed.
    expect(screen.queryByText('Brain-map report, signed')).toBeNull();
  });

  it('names the pictures left unplaced when that is why', async () => {
    const user = userEvent.setup();
    mountEditor(SIGNER, {
      issue: () => json({ error: 'unprocessable', code: 'unplaced_figures', figures: [MAP] }, 422),
    });
    await user.click(await screen.findByRole('button', { name: 'Sign this report' }));
    await user.click(screen.getByRole('button', { name: 'Sign and issue' }));
    expect(
      await screen.findByText(/^1 picture uploaded to this draft is not on the report\./),
    ).toBeTruthy();
  });

  it('is not offered to someone whose certificate does not let them sign', async () => {
    mountEditor(LEAD_PRACTITIONER);
    await screen.findByRole('button', { name: 'Preview' });
    expect(screen.queryByRole('button', { name: 'Sign this report' })).toBeNull();
    expect(screen.getByText(/stays a draft for somebody who can sign it/)).toBeTruthy();
  });
});

describe('the signed report', () => {
  async function signIt(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole('button', { name: 'Sign this report' }));
    await user.click(screen.getByRole('button', { name: 'Sign and issue' }));
    await screen.findByText('Brain-map report, signed');
  }

  it('is shown read only, with its reference, and saves nothing more', async () => {
    const user = userEvent.setup();
    const { calls } = mountEditor();
    await signIt(user);
    expect(screen.getByText('RPT-000042')).toBeTruthy();
    expect(screen.getByText('30/09/2026')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save the draft' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Key findings/ })).toBeNull();
    const saves = calls.filter((call) => call.url === '/api/reports/draft').length;
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(calls.filter((call) => call.url === '/api/reports/draft').length).toBe(saves);
  });

  it('opens the signed file through its own short-lived link', async () => {
    const user = userEvent.setup();
    mountEditor();
    await signIt(user);
    await user.click(screen.getByRole('button', { name: 'Open the signed report' }));
    await waitFor(() =>
      expect(opened).toHaveBeenCalledWith(FILE_URL, '_blank', 'noopener,noreferrer'),
    );
  });

  it('corrects it: a reason, then a new version as a draft, which the form opens', async () => {
    const user = userEvent.setup();
    const { calls, onCorrected } = mountEditor();
    await signIt(user);
    await user.click(screen.getByRole('button', { name: 'Correct this report' }));
    await user.type(
      screen.getByLabelText('Why it is being corrected'),
      'The recording date was typed a day late.',
    );
    await user.click(screen.getByRole('button', { name: 'Start a corrected version' }));
    await waitFor(() => expect(onCorrected).toHaveBeenCalledWith(CORRECTED));
    expect(calls.find((call) => call.url.endsWith('/supersede'))?.body).toEqual({
      reason: 'The recording date was typed a day late.',
    });
  });

  it('says why a correction was refused, and stays on the signed report', async () => {
    const user = userEvent.setup();
    const { onCorrected } = mountEditor(SIGNER, {
      supersede: () => json({ error: 'unprocessable', code: 'no_reason' }, 422),
    });
    await signIt(user);
    await user.click(screen.getByRole('button', { name: 'Correct this report' }));
    await user.click(screen.getByRole('button', { name: 'Start a corrected version' }));
    expect(await screen.findByText(SUPERSEDE_REFUSALS['no_reason'] ?? '')).toBeTruthy();
    expect(onCorrected).not.toHaveBeenCalled();
  });
});
