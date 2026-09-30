// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProviderBoundary } from '../../app/shell/auth/AuthContext';
import { QeegEditor } from '../../app/admin/reports/qeeg/QeegEditor';
import { ReportView } from '../../app/admin/reports/ReportView';
import { ReportsTab } from '../../app/admin/reports/ReportsTab';
import { TWIN_REFUSALS } from '../../app/admin/reports/qeeg/refusals';
import { TWIN_REASON } from '../../app/admin/reports/qeeg/useQeegSigning';
import {
  ADMIN,
  LEAD_PRACTITIONER,
  PRACTITIONER,
  signedInProvider,
} from '../../app/admin/clients/testActors';
import { blankInitial } from '../../domain/reports/qeeg/blank';
import { fullReport } from '../../domain/reports/qeeg/testing/reports';
import { LIMITS, type QeegContent, type QeegInitial } from '../../domain/reports/qeeg/types';

/**
 * The Arabic version of what she typed, previewing either language, and the
 * report's other language (docs/SPEC/reports-qeeg.md section 8; brief Q),
 * against a fake API.
 *
 * What matters here: the one Arabic box says it is Arabic (`lang`, `dir`)
 * and writes the Arabic half alone; each language previews from its own
 * button with its own notes; a signed report offers "Sign the other
 * language"; the other language's draft is read only but for its own
 * language's boxes, and says so; a report out of step says so in the list and
 * on its page.
 *
 * Every id is in the reserved synthetic shape and every person comes from
 * `testActors`.
 */

const CLIENT = '00000008-0000-4000-8000-000000000005';
const DRAFT = '00000006-0000-4000-8000-000000000009';
const FIRST = '00000006-0000-4000-8000-000000000001';
const TWIN = '00000006-0000-4000-8000-000000000002';
const STAMP = '2026-09-30T08:00:00.000000Z';

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
  dashboardScale: 0.9,
  overflowing: [],
  unprintable: [],
  unprintableMore: 0,
  maps: [],
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
    twinOfId: null,
    twinId: null,
    outOfStep: false,
    ...over,
  };
}

const SIGNED_FIRST = row({
  id: FIRST,
  status: 'issued',
  reference: 'RPT-000001',
  issuedOn: '2026-09-29',
  signedByName: 'Rowan Ridge',
});

type Call = { url: string; method: string; reason: string | null; body: unknown };

function withServerParts(sent: Record<string, unknown>): QeegContent {
  return {
    ...sent,
    subject: { nameAr: null, ageYears: 9, sex: 'female' },
    provenance: { origin: 'app' },
  } as unknown as QeegContent;
}

type Api = {
  /** What `GET /api/reports/:id` answers, by id. */
  reads?: Record<string, unknown>;
  /** The row a draft save answers with. */
  saved?: Record<string, unknown>;
  issue?: () => Response;
  twin?: () => Response;
  list?: unknown[];
};

function fakeApi(actor: object, api: Api = {}) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const reason = new Headers(init?.headers).get('x-reason');
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ url, method, reason, body });
    if (url === '/api/me') return json(actor);
    if (url.startsWith('/api/reports?clientId=')) return json({ reports: api.list ?? [] });
    if (url === '/api/reports/draft') {
      const sent = (body as { content: Record<string, unknown>; id?: string }).content;
      return json(
        { report: api.saved ?? row(), content: withServerParts(sent), savedAt: STAMP },
        (body as { id?: string }).id ? 200 : 201,
      );
    }
    if (/\/figures$/.test(url)) return json({ figures: [] });
    const preview = /^\/api\/reports\/[^/]+\/preview\?locale=(en|ar)$/.exec(url);
    if (preview) {
      return new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), {
        status: 200,
        headers: {
          'content-type': 'application/pdf',
          'x-report-layout': JSON.stringify({
            ...NOTES,
            pages: preview[1] === 'ar' ? 8 : 7,
          }),
        },
      });
    }
    if (url.endsWith('/issue')) {
      return api.issue?.() ?? json({ report: { ...SIGNED_FIRST, id: DRAFT } }, 201);
    }
    if (url.endsWith('/twin')) {
      return (
        api.twin?.() ?? json({ report: row({ id: TWIN, locale: 'ar', twinOfId: DRAFT }) }, 201)
      );
    }
    const id = /^\/api\/reports\/([^/?]+)$/.exec(url)?.[1];
    if (id && api.reads?.[id]) return json(api.reads[id]);
    return json({ error: 'not_found' }, 404);
  });
  return { calls, fetchImpl };
}

let opened: ReturnType<typeof vi.fn>;

beforeEach(() => {
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

function mountEditor(
  options: {
    actor?: object;
    api?: Api;
    reportId?: string | null;
    start?: QeegContent | null;
    reports?: unknown[];
  } = {},
) {
  const api = fakeApi(options.actor ?? SIGNER, options.api);
  const onDone = vi.fn();
  const onCorrected = vi.fn();
  render(
    <AuthProviderBoundary provider={signedInProvider} fetchImpl={api.fetchImpl}>
      <QeegEditor
        clientId={CLIENT}
        reportId={options.reportId ?? null}
        start={options.reportId ? null : (options.start ?? blankInitial())}
        reports={(options.reports ?? []) as never}
        onDone={onDone}
        onCorrected={onCorrected}
      />
    </AuthProviderBoundary>,
  );
  return { ...api, onDone, onCorrected };
}

async function openSection(user: ReturnType<typeof userEvent.setup>, title: string) {
  const toggle = await screen.findByRole('button', { name: new RegExp(`^${title}`) });
  if (toggle.getAttribute('aria-expanded') !== 'true') await user.click(toggle);
}

const saves = (calls: readonly Call[]) => calls.filter((call) => call.url === '/api/reports/draft');

function sentContent(call: Call | undefined): Record<string, unknown> {
  return (call?.body as { content: Record<string, unknown> }).content;
}

describe('the Arabic version of what she typed', () => {
  it('is collapsed until asked for, then says it is Arabic, read from the right', async () => {
    const user = userEvent.setup();
    mountEditor();
    await openSection(user, 'Summary');
    expect(screen.queryByLabelText('Arabic version of the summary')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Add an Arabic version of the summary' }));
    const box = screen.getByLabelText('Arabic version of the summary');
    expect(box.getAttribute('lang')).toBe('ar');
    expect(box.getAttribute('dir')).toBe('rtl');
    // Its label is English, as every label around it is.
    expect(screen.getByText('Arabic version of the summary').getAttribute('lang')).toBeNull();
  });

  it('writes the Arabic half of the summary and leaves the English as it was typed', async () => {
    const user = userEvent.setup();
    const { calls } = mountEditor();
    await openSection(user, 'Summary');
    await user.type(screen.getByLabelText('Summary', { selector: 'textarea' }), 'Calmer evenings.');
    await user.click(screen.getByRole('button', { name: 'Add an Arabic version of the summary' }));
    await user.type(screen.getByLabelText('Arabic version of the summary'), 'أمسيات أهدأ');
    await user.click(screen.getByRole('button', { name: 'Save the draft' }));
    await waitFor(() => expect(saves(calls)).toHaveLength(1));
    const summary = sentContent(saves(calls)[0])['summary'];
    expect(summary).toEqual({
      en: { text: 'Calmer evenings.', marks: [] },
      ar: { text: 'أمسيات أهدأ', marks: [] },
    });
  });

  it('writes the Arabic half of an item of her own, and only that half', async () => {
    const user = userEvent.setup();
    const { calls } = mountEditor();
    await openSection(user, 'Key findings');
    await user.type(screen.getByLabelText('Add your own item'), 'Restless evenings');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await user.click(
      screen.getByRole('button', {
        name: 'Add an Arabic version of your own item “Restless evenings”',
      }),
    );
    await user.type(
      screen.getByLabelText('Arabic version of your own item “Restless evenings”'),
      'أمسيات قلقة',
    );
    await user.click(screen.getByRole('button', { name: 'Save the draft' }));
    await waitFor(() => expect(saves(calls)).toHaveLength(1));
    const findings = sentContent(saves(calls)[0])['findings'] as {
      custom: Record<string, { label: unknown }>;
    };
    expect(findings.custom['c0']?.label).toEqual({ en: 'Restless evenings', ar: 'أمسيات قلقة' });
  });

  it('clears the Arabic half to none when it is emptied', async () => {
    const user = userEvent.setup();
    const start: QeegInitial = {
      ...blankInitial(),
      summary: { en: { text: 'Steady.', marks: [] }, ar: { text: 'ثابت', marks: [] } },
    };
    const { calls } = mountEditor({ start });
    await openSection(user, 'Summary');
    await user.click(
      screen.getByRole('button', { name: 'Change the Arabic version of the summary' }),
    );
    await user.clear(screen.getByLabelText('Arabic version of the summary'));
    await user.click(screen.getByRole('button', { name: 'Save the draft' }));
    await waitFor(() => expect(saves(calls)).toHaveLength(1));
    expect(sentContent(saves(calls)[0])['summary']).toEqual({
      en: { text: 'Steady.', marks: [] },
      ar: null,
    });
  });
});

describe('previewing either language', () => {
  it('saves first, then previews in English or in Arabic, each with its own notes', async () => {
    const user = userEvent.setup();
    const { calls } = mountEditor();
    await user.click(await screen.findByRole('button', { name: 'Preview in Arabic' }));
    await waitFor(() => expect(opened).toHaveBeenCalledTimes(1));
    const arabic = await screen.findByRole('list', { name: 'What the Arabic preview found' });
    expect(within(arabic).getByText('8 pages.')).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'What the English preview found' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Preview in English' }));
    const english = await screen.findByRole('list', { name: 'What the English preview found' });
    expect(within(english).getByText('7 pages.')).toBeTruthy();
    // The Arabic notes stay, under their own heading.
    expect(screen.getByRole('list', { name: 'What the Arabic preview found' })).toBeTruthy();

    const order = calls.map((call) => `${call.method} ${call.url}`);
    const saved = order.indexOf('POST /api/reports/draft');
    expect(saved).toBeGreaterThanOrEqual(0);
    expect(order.indexOf(`GET /api/reports/${DRAFT}/preview?locale=ar`)).toBeGreaterThan(saved);
    expect(order).toContain(`GET /api/reports/${DRAFT}/preview?locale=en`);
    expect(screen.getByRole('link', { name: 'Open the Arabic preview' })).toBeTruthy();
  });
});

describe('"Sign the other language"', () => {
  async function signIt(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole('button', { name: 'Sign this report' }));
    await user.click(screen.getByRole('button', { name: 'Sign and issue' }));
    await screen.findByText('Brain-map report, signed');
  }

  it('is offered on a signed report, and opens the other language’s draft', async () => {
    const user = userEvent.setup();
    const { calls, onCorrected } = mountEditor();
    await signIt(user);
    await user.click(screen.getByRole('button', { name: 'Sign the other language' }));
    await waitFor(() => expect(onCorrected).toHaveBeenCalledWith(TWIN));
    const started = calls.find((call) => call.url === `/api/reports/${DRAFT}/twin`);
    expect(started?.method).toBe('POST');
    expect(started?.reason).toBe(TWIN_REASON);
    expect(started?.body).toEqual({});
  });

  it('says why when it is refused, and stays on the signed report', async () => {
    const user = userEvent.setup();
    const { onCorrected } = mountEditor({
      api: {
        twin: () => json({ error: 'conflict', code: 'twin_exists', twinId: TWIN }, 409),
      },
    });
    await signIt(user);
    await user.click(screen.getByRole('button', { name: 'Sign the other language' }));
    expect(await screen.findByText(TWIN_REFUSALS['twin_exists'] ?? '')).toBeTruthy();
    expect(onCorrected).not.toHaveBeenCalled();
  });

  it('is offered from a signed brain map’s own page, which then opens the draft', async () => {
    const user = userEvent.setup();
    const api = fakeApi(LEAD_PRACTITIONER, {
      reads: {
        [FIRST]: {
          report: SIGNED_FIRST,
          content: fullReport(),
          deliveries: [],
          url: null,
          expiresInSeconds: null,
        },
      },
      twin: () => json({ report: row({ id: TWIN, locale: 'ar', twinOfId: FIRST }) }, 201),
    });
    const onTwinStarted = vi.fn();
    render(
      <AuthProviderBoundary provider={signedInProvider} fetchImpl={api.fetchImpl}>
        <ReportView
          reportId={FIRST}
          reports={[SIGNED_FIRST] as never}
          mayDraft
          maySupersede
          maySend={false}
          onBack={vi.fn()}
          onTwinStarted={onTwinStarted}
        />
      </AuthProviderBoundary>,
    );
    expect(await screen.findByText('English')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Sign the other language' }));
    await waitFor(() => expect(onTwinStarted).toHaveBeenCalledWith(TWIN));
    expect(api.calls.find((call) => call.url.endsWith('/twin'))?.reason).toBe(TWIN_REASON);
  });
});

describe('the other language’s draft', () => {
  const first: QeegInitial = {
    ...fullReport(),
    findings: {
      ...fullReport().findings,
      custom: {
        c0: { label: { en: 'Restless evenings', ar: null }, note: null, chosen: true, position: 0 },
      },
    },
  };
  const twinRow = row({ id: TWIN, locale: 'ar', twinOfId: FIRST });

  function mountTwin(over: Record<string, unknown> = {}) {
    const report = { ...twinRow, ...over };
    return mountEditor({
      reportId: TWIN,
      reports: [SIGNED_FIRST, report],
      api: {
        saved: report,
        reads: {
          [TWIN]: {
            report,
            content: first,
            deliveries: [],
            url: null,
            expiresInSeconds: null,
            savedAt: STAMP,
          },
        },
      },
    });
  }

  it('says plainly what it is, and that only its Arabic can be written', async () => {
    mountTwin();
    expect(
      await screen.findByRole('heading', { name: 'The Arabic version of RPT-000001' }),
    ).toBeTruthy();
    expect(screen.getByText(/cannot be changed here\. Only the Arabic version/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Make this a follow-up' })).toBeNull();
  });

  it('shows everything else read only', async () => {
    mountTwin();
    await screen.findByRole('heading', { name: 'The Arabic version of RPT-000001' });
    const carried = screen.getByRole('group', {
      name: 'Carried from the signed report, read only',
    });
    expect((carried as HTMLFieldSetElement).disabled).toBe(true);
    // Every section is shown open, and none of its boxes can be changed.
    const score = within(carried).getAllByRole('combobox')[0];
    expect(score).toBeTruthy();
    expect((score as HTMLSelectElement).matches(':disabled')).toBe(true);
    // The Arabic boxes beside the sections are not offered there.
    expect(within(carried).queryByRole('button', { name: /Arabic version/ })).toBeNull();
  });

  it('writes the Arabic of what was typed, and nothing else, when saved', async () => {
    const user = userEvent.setup();
    const { calls } = mountTwin();
    const box = await screen.findByLabelText(
      'Arabic version of your own key finding “Restless evenings”',
    );
    expect(box.getAttribute('lang')).toBe('ar');
    expect(box.getAttribute('dir')).toBe('rtl');
    await user.type(box, 'أمسيات قلقة');
    await user.click(screen.getByRole('button', { name: 'Save the draft' }));
    await waitFor(() => expect(saves(calls)).toHaveLength(1));
    const content = sentContent(saves(calls)[0]) as unknown as QeegInitial;
    expect(content.findings.custom['c0']?.label).toEqual({
      en: 'Restless evenings',
      ar: 'أمسيات قلقة',
    });
    expect(content.dashboard).toEqual(first.dashboard);
    expect(content.findings.chosen).toEqual(first.findings.chosen);
    expect(content.summary.en).toEqual(first.summary.en);
  });

  it('formats the Arabic summary with the same bold and underline (fix round 1)', async () => {
    mountTwin();
    await screen.findByRole('heading', { name: 'The Arabic version of RPT-000001' });
    const tools = screen.getByRole('toolbar', {
      name: 'Formatting for Arabic version of the summary',
    });
    expect(within(tools).getByRole('button', { name: 'Bold' })).toBeTruthy();
    expect(screen.getByLabelText('Arabic version of the summary').getAttribute('dir')).toBe('rtl');
  });

  it('says when it is out of step with the report it was made from', async () => {
    mountTwin({ outOfStep: true });
    expect(
      await screen.findByText(/has been corrected since, so this one is out of step/),
    ).toBeTruthy();
  });
});

describe('out of step, in the list and on the report’s page', () => {
  const replaced = { ...SIGNED_FIRST, status: 'superseded', twinId: TWIN };
  const late = row({
    id: TWIN,
    status: 'issued',
    locale: 'ar',
    reference: 'RPT-000002',
    issuedOn: '2026-09-30',
    signedByName: 'Rowan Ridge',
    twinOfId: FIRST,
    outOfStep: true,
  });

  it('names each report’s language and its twin in the list, and says it is out of step', async () => {
    const api = fakeApi(LEAD_PRACTITIONER, { list: [late, replaced] });
    render(
      <AuthProviderBoundary provider={signedInProvider} fetchImpl={api.fetchImpl}>
        <ReportsTab clientId={CLIENT} />
      </AuthProviderBoundary>,
    );
    expect(await screen.findByText('RPT-000002')).toBeTruthy();
    expect(screen.getByText('Brain map, Arabic')).toBeTruthy();
    expect(screen.getByText('Made from RPT-000001, in English')).toBeTruthy();
    expect(
      screen.getByText(
        'Out of step: RPT-000001 has been corrected since, so this report no longer matches it.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Arabic version: RPT-000002')).toBeTruthy();
  });

  it('says so in a sentence on the report’s page, and offers no second other language', async () => {
    const api = fakeApi(LEAD_PRACTITIONER, {
      reads: {
        [TWIN]: {
          report: late,
          content: fullReport(),
          deliveries: [],
          url: null,
          expiresInSeconds: null,
        },
      },
    });
    render(
      <AuthProviderBoundary provider={signedInProvider} fetchImpl={api.fetchImpl}>
        <ReportView
          reportId={TWIN}
          reports={[late, replaced] as never}
          mayDraft
          maySupersede
          maySend={false}
          onBack={vi.fn()}
        />
      </AuthProviderBoundary>,
    );
    expect(
      await screen.findByText(/has been corrected since, so this one is out of step with it/),
    ).toBeTruthy();
    expect(screen.getByText('Arabic')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Sign the other language' })).toBeNull();
  });
});

/** A signing certificate, given to whichever role a test signs as. */
function signing<T extends object>(actor: T) {
  return { ...actor, capabilities: SIGNER.capabilities };
}

describe('fix round 1: who is offered the other language (change request 6)', () => {
  async function signIt(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole('button', { name: 'Sign this report' }));
    await user.click(screen.getByRole('button', { name: 'Sign and issue' }));
    await screen.findByText('Brain-map report, signed');
  }

  it('offers it on the signed form to a practitioner who may draft but not correct', async () => {
    const user = userEvent.setup();
    mountEditor({ actor: signing(PRACTITIONER) });
    await signIt(user);
    expect(screen.getByRole('button', { name: 'Sign the other language' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Correct this report' })).toBeNull();
  });

  it('does not offer it on the signed form to a coordinator, who drafts nothing', async () => {
    const user = userEvent.setup();
    mountEditor({ actor: signing(ADMIN) });
    await signIt(user);
    expect(screen.queryByRole('button', { name: 'Sign the other language' })).toBeNull();
  });

  it('does not offer it on the signed form when the other language already exists', async () => {
    const user = userEvent.setup();
    mountEditor({
      api: { issue: () => json({ report: { ...SIGNED_FIRST, id: DRAFT, twinId: TWIN } }, 201) },
    });
    await signIt(user);
    expect(screen.queryByRole('button', { name: 'Sign the other language' })).toBeNull();
  });

  function openFromTheList(actor: object) {
    const api = fakeApi(actor, {
      list: [SIGNED_FIRST],
      reads: {
        [FIRST]: {
          report: SIGNED_FIRST,
          content: fullReport(),
          deliveries: [],
          url: null,
          expiresInSeconds: null,
        },
      },
    });
    render(
      <AuthProviderBoundary provider={signedInProvider} fetchImpl={api.fetchImpl}>
        <ReportsTab clientId={CLIENT} />
      </AuthProviderBoundary>,
    );
  }

  it('offers it on the report’s page to a practitioner who may draft but not correct', async () => {
    const user = userEvent.setup();
    openFromTheList(PRACTITIONER);
    await user.click(await screen.findByRole('button', { name: 'RPT-000001' }));
    expect(await screen.findByRole('button', { name: 'Sign the other language' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Correct this report' })).toBeNull();
  });

  it('does not offer it on the report’s page to a coordinator', async () => {
    const user = userEvent.setup();
    openFromTheList(ADMIN);
    await user.click(await screen.findByRole('button', { name: 'RPT-000001' }));
    await screen.findByText('English');
    expect(screen.queryByRole('button', { name: 'Sign the other language' })).toBeNull();
  });
});

describe('fix round 1: the Arabic box, for a keyboard and a screen reader', () => {
  it('moves focus into the box when it opens, and names the box it opens', async () => {
    const user = userEvent.setup();
    mountEditor();
    await openSection(user, 'Summary');
    const toggle = screen.getByRole('button', { name: 'Add an Arabic version of the summary' });
    const controlled = toggle.getAttribute('aria-controls') ?? '';
    expect(controlled).not.toBe('');
    await user.click(toggle);
    const box = screen.getByLabelText('Arabic version of the summary');
    expect(document.activeElement).toBe(box);
    expect(document.getElementById(controlled)?.contains(box)).toBe(true);
  });

  it('ties the sentence beneath it to the box', async () => {
    const user = userEvent.setup();
    mountEditor();
    await openSection(user, 'Key findings');
    await user.type(screen.getByLabelText('Add your own item'), 'Restless evenings');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await user.click(
      screen.getByRole('button', {
        name: 'Add an Arabic version of your own item “Restless evenings”',
      }),
    );
    const box = screen.getByLabelText('Arabic version of your own item “Restless evenings”');
    const described = (box.getAttribute('aria-describedby') ?? '')
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ');
    expect(described).toMatch(/prints the English as it was typed/);
  });

  it('refuses an Arabic longer than it may hold, with a sentence, and never cuts it', async () => {
    const user = userEvent.setup();
    const { calls } = mountEditor();
    await openSection(user, 'Key findings');
    await user.type(screen.getByLabelText('Add your own item'), 'Restless evenings');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await user.click(
      screen.getByRole('button', {
        name: 'Add an Arabic version of your own item “Restless evenings”',
      }),
    );
    const box = screen.getByLabelText('Arabic version of your own item “Restless evenings”');
    expect(box.getAttribute('maxlength')).toBeNull();
    box.focus();
    await user.paste('ب'.repeat(LIMITS.label + 1));
    expect(
      screen.getByText(new RegExp(`longer than the ${LIMITS.label} characters it may hold`)),
    ).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Save the draft' }));
    await waitFor(() => expect(saves(calls)).toHaveLength(1));
    const findings = sentContent(saves(calls)[0])['findings'] as {
      custom: Record<string, { label: { ar: unknown } }>;
    };
    expect(findings.custom['c0']?.label.ar).toBeNull();
  });
});

describe('fix round 1: bold and underline in the Arabic summary', () => {
  it('sets them in the Arabic box, and they reach the Arabic half', async () => {
    const user = userEvent.setup();
    const { calls } = mountEditor();
    await openSection(user, 'Summary');
    await user.type(screen.getByLabelText('Summary', { selector: 'textarea' }), 'Calmer.');
    await user.click(screen.getByRole('button', { name: 'Add an Arabic version of the summary' }));
    const box = screen.getByLabelText('Arabic version of the summary') as HTMLTextAreaElement;
    expect(box.getAttribute('lang')).toBe('ar');
    await user.type(box, 'أمسيات أهدأ');
    const tools = screen.getByRole('toolbar', {
      name: 'Formatting for Arabic version of the summary',
    });
    box.setSelectionRange(0, 6);
    fireEvent.select(box);
    await user.click(within(tools).getByRole('button', { name: 'Bold' }));
    box.setSelectionRange(7, 11);
    fireEvent.select(box);
    await user.click(within(tools).getByRole('button', { name: 'Underline' }));
    await user.click(screen.getByRole('button', { name: 'Save the draft' }));
    await waitFor(() => expect(saves(calls)).toHaveLength(1));
    const summary = sentContent(saves(calls)[0])['summary'] as {
      en: unknown;
      ar: { text: string; marks: unknown[] };
    };
    expect(summary.en).toEqual({ text: 'Calmer.', marks: [] });
    expect(summary.ar.text).toBe('أمسيات أهدأ');
    expect(summary.ar.marks).toEqual([
      { from: 0, to: 6, bold: true },
      { from: 7, to: 11, underline: true },
    ]);
  });
});
