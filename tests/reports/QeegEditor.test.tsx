// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProviderBoundary } from '../../app/shell/auth/AuthContext';
import { QeegEditor } from '../../app/admin/reports/qeeg/QeegEditor';
import { DRAFT_REFUSALS } from '../../app/admin/reports/qeeg/refusals';
import { IDLE_MS, SAVE_REASONS } from '../../app/admin/reports/qeeg/useQeegDraft';
import { ReportsTab } from '../../app/admin/reports/ReportsTab';
import { LEAD_PRACTITIONER, signedInProvider } from '../../app/admin/clients/testActors';
import { blankFollowUp, blankInitial } from '../../domain/reports/qeeg/blank';
import { prefillFollowUp } from '../../domain/reports/qeeg/prefill';
import type { ComparedWith, QeegContent, QeegInitial } from '../../domain/reports/qeeg/types';

/**
 * The brain-map report's form, against a fake API (docs/SPEC/reports-qeeg.md
 * section 15, and the draft route of app/api/reports/qeegDraft.ts).
 *
 * What matters most here: a report starts with nothing chosen for her, every
 * section says how much of it is left from the domain's own list, the form
 * saves at rest points and never per keystroke, and a save made over a newer
 * one is never pushed through, only explained.
 *
 * Text boxes are typed key by key with `user.type`, never with
 * `fireEvent.change` (docs/CHANGE-REQUESTS/trunk-round-63.md). Every id is in
 * the reserved synthetic shape and every person comes from `testActors`.
 */

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

const CLIENT = '00000008-0000-4000-8000-000000000005';
const EARLIER = '00000006-0000-4000-8000-000000000001';
const DRAFT = '00000006-0000-4000-8000-000000000009';
const STAMP = '2026-09-30T08:00:00.000000Z';
const LATER_STAMP = '2026-09-30T08:05:00.000000Z';

const COMPARED: ComparedWith = {
  reportId: EARLIER,
  recordedOn: '2026-06-01',
  relation: 'initial',
  origin: 'issued',
  reference: 'RPT-000001',
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

const SIGNED_BRAIN_MAP = row({
  id: EARLIER,
  status: 'issued',
  reference: 'RPT-000001',
  issuedOn: '2026-06-02',
  signedByName: 'Rowan Ridge',
  createdAt: '2026-06-02T08:00:00+04:00',
});

type Call = { url: string; method: string; reason: string | null; body: unknown };

/** What the route writes that the form never sends: the client, and the comparison. */
function asSaved(sent: Record<string, unknown>): QeegContent {
  const content = {
    ...sent,
    subject: { nameAr: null, ageYears: 9, sex: 'female' },
    provenance: { origin: 'app' },
  } as Record<string, unknown>;
  if (sent['edition'] === 'follow-up') content['comparedWith'] = { ...COMPARED };
  return content as unknown as QeegContent;
}

function mountApi({
  saveAnswer,
  stored,
}: {
  /** How the draft route answers; by default it saves. */
  saveAnswer?: (call: Call) => Response | null;
  /** What `GET /api/reports/:id` holds. */
  stored?: () => QeegContent;
} = {}) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const reason = new Headers(init?.headers).get('x-reason');
    const body: unknown = init?.body ? JSON.parse(String(init.body)) : undefined;
    const call = { url, method, reason, body };
    calls.push(call);
    if (url === '/api/me') return json(LEAD_PRACTITIONER);
    if (url.startsWith('/api/reports/qeeg/prefill?')) {
      // A follow-up begun from the signed report (brief S): nothing chosen in it.
      const begun = prefillFollowUp(
        {
          reportId: EARLIER,
          clientId: CLIENT,
          status: 'issued',
          withdrawn: false,
          erased: false,
          reference: 'RPT-000001',
          content: {
            ...blankInitial(),
            recording: { recordedOn: '2026-06-01', eyes: null, handedness: null },
          },
        },
        { clientId: CLIENT, draftId: null, stage: 'follow_up', recordedOn: null },
      );
      if (!begun.ok) throw new Error(begun.reason);
      return json({
        content: begun.content,
        offered: begun.offered,
        sessions: { count: 0, after: '2026-06-01', before: null, through: '2026-09-30' },
      });
    }
    if (url === '/api/reports/draft') {
      const answer = saveAnswer?.(call);
      if (answer) return answer;
      const sent = (body as { content: Record<string, unknown>; id?: string }).content;
      return json(
        { report: row(), content: asSaved(sent), savedAt: STAMP },
        (body as { id?: string }).id ? 200 : 201,
      );
    }
    if (url === `/api/reports/${DRAFT}`) {
      return json({
        report: row(),
        content: stored ? stored() : asSaved({ ...blankInitial() }),
        deliveries: [],
        url: null,
        expiresInSeconds: null,
        savedAt: LATER_STAMP,
      });
    }
    return json({ error: 'not_found' }, 404);
  });
  const saves = () => calls.filter((call) => call.url === '/api/reports/draft');
  return { calls, saves, fetchImpl };
}

function mountEditor(
  start: QeegContent | null,
  api = mountApi(),
  {
    reportId = null,
    reports = [SIGNED_BRAIN_MAP],
  }: { reportId?: string | null; reports?: unknown[] } = {},
) {
  const onDone = vi.fn();
  const { unmount } = render(
    <AuthProviderBoundary provider={signedInProvider} fetchImpl={api.fetchImpl}>
      <QeegEditor
        clientId={CLIENT}
        reportId={reportId}
        start={start}
        reports={reports as never}
        onDone={onDone}
      />
    </AuthProviderBoundary>,
  );
  return { ...api, onDone, unmount };
}

/** The row that opens a section, found by its title. */
async function section(title: string) {
  return screen.findByRole('button', { name: new RegExp(`^${title}`) });
}

async function openSection(user: ReturnType<typeof userEvent.setup>, title: string) {
  const toggle = await section(title);
  if (toggle.getAttribute('aria-expanded') !== 'true') await user.click(toggle);
  return toggle;
}

function sentContent(call: Call | undefined): Record<string, unknown> {
  return (call?.body as { content: Record<string, unknown> }).content;
}

describe('starting a brain-map report', () => {
  function mountTab(reports: unknown[]) {
    const api = mountApi();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).startsWith('/api/reports?clientId=')) return json({ reports });
      return api.fetchImpl(input, init);
    });
    render(
      <AuthProviderBoundary provider={signedInProvider} fetchImpl={fetchImpl}>
        <ReportsTab clientId={CLIENT} />
      </AuthProviderBoundary>,
    );
  }

  it('starts a first report from the client’s Reports tab', async () => {
    const user = userEvent.setup();
    mountTab([]);
    await user.click(await screen.findByRole('button', { name: 'New brain-map report' }));
    await user.click(screen.getByRole('button', { name: 'Start the report' }));
    expect(await screen.findByText('Brain-map report, first report')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Compared with/ })).toBeNull();
  });

  it('starts a follow-up compared with a signed brain-map report, which opens its form', async () => {
    const user = userEvent.setup();
    mountTab([SIGNED_BRAIN_MAP]);
    await user.click(await screen.findByRole('button', { name: 'New brain-map report' }));
    await user.click(
      screen.getByRole('radio', { name: 'Follow-up, compared with an earlier report' }),
    );
    expect(
      (screen.getByLabelText('Compared with') as HTMLSelectElement).selectedOptions[0]?.textContent,
    ).toBe('RPT-000001, signed on 02/06/2026');
    await user.click(screen.getByRole('button', { name: 'Start the report' }));
    expect(await screen.findByText('Brain-map report, follow-up')).toBeTruthy();
    // What it is compared with at the top, the page of what has changed at the end.
    const titles = screen
      .getAllByRole('button', { expanded: false })
      .map((button) => button.textContent ?? '')
      .filter((text) => /left to fill/.test(text));
    expect(titles[0]).toMatch(/^Compared with/);
    expect(titles.at(-1)).toMatch(/^What has changed/);
  });

  it('offers no follow-up when there is nothing to compare it with', async () => {
    const user = userEvent.setup();
    // A session report and a brain-map draft are no candidates.
    mountTab([
      row({ id: EARLIER, kind: 'progress', status: 'issued', reference: 'RPT-000002' }),
      row(),
    ]);
    await user.click(await screen.findByRole('button', { name: 'New brain-map report' }));
    await user.click(
      screen.getByRole('radio', { name: 'Follow-up, compared with an earlier report' }),
    );
    expect(screen.getByText(/nothing\s+for a follow-up to be compared with yet/)).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Start the report' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('opens a saved brain-map draft in its own form', async () => {
    const user = userEvent.setup();
    mountTab([row()]);
    await user.click(await screen.findByRole('button', { name: 'Not yet signed' }));
    expect(await screen.findByText('Brain-map report, first report')).toBeTruthy();
  });
});

describe('the sections and how much each has left', () => {
  it('shows the report’s sections in its order, one open at a time', async () => {
    const user = userEvent.setup();
    mountEditor(blankInitial());
    const findings = await openSection(user, 'Key findings');
    expect(findings.getAttribute('aria-expanded')).toBe('true');
    await openSection(user, 'Areas of focus');
    expect(findings.getAttribute('aria-expanded')).toBe('false');
    await user.click(screen.getByRole('button', { name: 'Open every section' }));
    for (const button of screen.getAllByRole('button', { name: /left to fill/ })) {
      expect(button.getAttribute('aria-expanded')).toBe('true');
    }
  });

  it('counts down as a section is filled', async () => {
    const user = userEvent.setup();
    mountEditor(blankInitial());
    const client = await openSection(user, 'Client and recording');
    // The date, the eyes, the handedness, and an age the record has not yet given.
    expect(client.textContent).toMatch(/4 left to fill$/);
    await user.selectOptions(screen.getByLabelText('Eyes'), 'closed');
    expect(client.textContent).toMatch(/3 left to fill$/);
    await user.selectOptions(screen.getByLabelText('Handedness'), 'right');
    expect(client.textContent).toMatch(/2 left to fill$/);

    // Moving on saves, and the server reads the age from the record.
    const findings = await openSection(user, 'Key findings');
    await waitFor(() => expect(client.textContent).toMatch(/1 left to fill$/));
    expect(findings.textContent).toMatch(/1 left to fill$/);
    await user.click(screen.getByLabelText('Brainwave Dysregulation'));
    expect(findings.textContent).toMatch(/Nothing left to fill$/);

    const bands = await openSection(user, 'Frequency bands');
    // Five bands; the brain maps are a section of their own.
    expect(bands.textContent).toMatch(/5 left to fill$/);
    await user.selectOptions(
      screen.getByLabelText('Level', { selector: '#qeeg-band-delta' }),
      'within_normal_limits',
    );
    expect(bands.textContent).toMatch(/4 left to fill$/);
    await user.selectOptions(
      screen.getByLabelText('Level', { selector: '#qeeg-band-theta' }),
      'increased',
    );
    // A level with no region is half a sentence.
    expect(bands.textContent).toMatch(/4 left to fill$/);
    await user.click(document.getElementById('qeeg-band-theta-regions-frontal') as HTMLElement);
    expect(bands.textContent).toMatch(/3 left to fill$/);
  });

  it('starts every score blank, never at 5', async () => {
    const user = userEvent.setup();
    mountEditor(blankInitial());
    const dashboard = await openSection(user, 'Performance dashboard');
    expect(dashboard.textContent).toMatch(/6 left to fill$/);
    const scores = screen.getAllByLabelText('Score out of 10') as HTMLSelectElement[];
    expect(scores).toHaveLength(6);
    for (const score of scores) {
      expect(score.value).toBe('');
      expect(score.selectedOptions[0]?.textContent).toBe('Not scored');
    }
    await user.selectOptions(scores[0] as HTMLSelectElement, '7');
    expect(dashboard.textContent).toMatch(/5 left to fill$/);
  });

  it('shows a follow-up’s earlier score beside the new one', async () => {
    const user = userEvent.setup();
    const blank = blankFollowUp(COMPARED, 'follow_up');
    mountEditor({
      ...blank,
      dashboard: {
        ...blank.dashboard,
        mental_energy: { score: null, evidence: null, earlierScore: 4 },
      },
    });
    await openSection(user, 'Performance dashboard');
    expect(screen.getByText('Earlier report: was 4')).toBeTruthy();
  });
});

describe('the brain-map-only choice', () => {
  it('sits beside the numbers of sessions, hides and clears the approach, and leaves nothing to fill', async () => {
    const user = userEvent.setup();
    const { saves } = mountEditor(blankInitial());
    const programme = await openSection(user, 'Programme');
    expect(programme.textContent).toMatch(/2 left to fill$/);
    await user.selectOptions(screen.getByLabelText('Initial Training Approach'), 'calming');
    expect(programme.textContent).toMatch(/1 left to fill$/);

    const group = screen.getByRole('radiogroup', { name: 'Number of sessions' });
    const choices = within(group)
      .getAllByRole('radio')
      .map((radio) => radio.closest('label')?.textContent);
    expect(choices).toEqual([
      '15 Sessions',
      '20 Sessions',
      '30 Sessions',
      '40 Sessions',
      'Another number',
      'Not applicable / QEEG only',
    ]);
    await user.click(within(group).getByRole('radio', { name: 'Not applicable / QEEG only' }));
    expect(screen.queryByLabelText('Initial Training Approach')).toBeNull();
    expect(programme.textContent).toMatch(/Nothing left to fill$/);

    await user.click(screen.getByRole('button', { name: 'Save the draft' }));
    await waitFor(() => expect(saves()).toHaveLength(1));
    expect(sentContent(saves()[0])['plan']).toEqual({ sessions: 'qeeg_only', approach: null });
  });

  it('is not offered on a follow-up', async () => {
    const user = userEvent.setup();
    mountEditor(blankFollowUp(COMPARED, 'follow_up'));
    await openSection(user, 'Programme');
    const group = screen.getByRole('radiogroup', { name: 'Number of sessions' });
    expect(within(group).queryByRole('radio', { name: 'Not applicable / QEEG only' })).toBeNull();
    expect(screen.getByLabelText('Next Stage of Training')).toBeTruthy();
  });
});

describe('saving at rest points', () => {
  it('does not save per keystroke, and saves thirty seconds after the last change', async () => {
    const api = mountApi();
    mountEditor(blankInitial(), api);
    const realUser = userEvent.setup();
    await openSection(realUser, 'Summary');

    // Only the form's own clock is faked, and it still moves with real time,
    // so the testing library's own zero-length waits go on firing.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
    const user = userEvent.setup({ delay: null });
    await user.type(screen.getByLabelText('Summary', { selector: 'textarea' }), 'Settling faster.');
    expect(api.saves()).toHaveLength(0);
    await act(async () => {
      vi.advanceTimersByTime(IDLE_MS - 1_000);
    });
    expect(api.saves()).toHaveLength(0);
    // A change starts the thirty seconds again.
    await user.type(screen.getByLabelText('Summary', { selector: 'textarea' }), ' More.');
    await act(async () => {
      vi.advanceTimersByTime(IDLE_MS - 1_000);
    });
    expect(api.saves()).toHaveLength(0);
    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    vi.useRealTimers();
    await waitFor(() => expect(api.saves()).toHaveLength(1));
    const save = api.saves()[0];
    expect(save?.reason).toBe(SAVE_REASONS.idle);
    expect((sentContent(save)['summary'] as { en: { text: string } }).en.text).toBe(
      'Settling faster. More.',
    );
  });

  it('saves on moving to another section, once, with that reason', async () => {
    const user = userEvent.setup();
    const { saves } = mountEditor(blankInitial());
    await openSection(user, 'Summary');
    await user.type(screen.getByLabelText('Summary', { selector: 'textarea' }), 'Calmer evenings.');
    expect(saves()).toHaveLength(0);
    await user.click(await section('Benefits'));
    await waitFor(() => expect(saves()).toHaveLength(1));
    expect(saves()[0]?.reason).toBe(SAVE_REASONS.section);
    // Nothing changed since: moving again writes nothing.
    await user.click(await section('Key findings'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(saves()).toHaveLength(1);
  });

  it('saves with the button, naming the save it was made over the second time', async () => {
    const user = userEvent.setup();
    const { saves } = mountEditor(blankInitial());
    await user.click(await screen.findByRole('button', { name: 'Save the draft' }));
    await waitFor(() => expect(saves()).toHaveLength(1));
    expect(saves()[0]?.reason).toBe(SAVE_REASONS.button);
    expect(saves()[0]?.body).toMatchObject({ clientId: CLIENT, kind: 'qeeg', locale: 'en' });
    expect(await screen.findByText('Saved.')).toBeTruthy();

    await openSection(user, 'Key findings');
    await user.click(screen.getByLabelText('Mental Fatigue'));
    await user.click(screen.getByRole('button', { name: 'Save the draft' }));
    await waitFor(() => expect(saves()).toHaveLength(2));
    expect(saves()[1]?.body).toMatchObject({ id: DRAFT, savedAt: STAMP });
  });

  it('never sends what the route gathers itself', async () => {
    const user = userEvent.setup();
    const { saves } = mountEditor(blankFollowUp(COMPARED, 'follow_up'));
    await user.click(await screen.findByRole('button', { name: 'Save the draft' }));
    await waitFor(() => expect(saves()).toHaveLength(1));
    const sent = sentContent(saves()[0]);
    expect(sent).not.toHaveProperty('subject');
    expect(sent).not.toHaveProperty('provenance');
    expect(sent['comparedWith']).toEqual({ reportId: EARLIER });
  });

  it('shows the client’s age and sex once the server has read them from the record', async () => {
    const user = userEvent.setup();
    mountEditor(blankInitial());
    const client = await openSection(user, 'Client and recording');
    expect(screen.getAllByText('Read from the record at the first save')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Save the draft' }));
    expect(await screen.findByText('Female')).toBeTruthy();
    expect(screen.getByText('9')).toBeTruthy();
    expect(client.textContent).toMatch(/3 left to fill$/);
  });

  it('saves on leaving, then goes back', async () => {
    const user = userEvent.setup();
    const { saves, onDone } = mountEditor(blankInitial());
    await openSection(user, 'Key findings');
    await user.click(screen.getByLabelText('Mental Fatigue'));
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(saves()).toHaveLength(1);
    expect(saves()[0]?.reason).toBe(SAVE_REASONS.leave);
  });
});

describe('a save made over a newer one', () => {
  it('says so plainly, saves nothing over it, and offers the newer version', async () => {
    const user = userEvent.setup();
    const newer: QeegInitial = {
      ...blankInitial(),
      findings: { chosen: ['mental_fatigue'], custom: {} },
    };
    const api = mountApi({
      saveAnswer: () => json({ error: 'conflict', code: 'stale_draft' }, 409),
      stored: () => ({ ...newer, subject: { nameAr: null, ageYears: 9, sex: 'female' } }),
    });
    mountEditor(null, api, { reportId: DRAFT });
    const findings = await openSection(user, 'Key findings');
    await user.click(screen.getByLabelText('Brainwave Dysregulation'));
    await user.click(screen.getByRole('button', { name: 'Save the draft' }));

    expect(await screen.findByText(DRAFT_REFUSALS['stale_draft'] as string)).toBeTruthy();
    expect(api.saves()).toHaveLength(1);
    // It stops saving on its own: moving on writes nothing more.
    await user.click(await section('Areas of focus'));
    expect(
      (screen.getByRole('button', { name: 'Save the draft' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(api.saves()).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Load the newer version' }));
    await waitFor(() =>
      expect(screen.queryByText(DRAFT_REFUSALS['stale_draft'] as string)).toBeNull(),
    );
    await openSection(user, 'Key findings');
    expect((screen.getByLabelText('Mental Fatigue') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('Brainwave Dysregulation') as HTMLInputElement).checked).toBe(
      false,
    );
    expect(findings).toBeTruthy();
  });
});

describe('a stale save is known by its code', () => {
  it('is not taken for a 409 that carries another code', async () => {
    const user = userEvent.setup();
    const api = mountApi({ saveAnswer: () => json({ error: 'conflict', code: 'other' }, 409) });
    mountEditor(null, api, { reportId: DRAFT });
    await openSection(user, 'Key findings');
    await user.click(screen.getByLabelText('Mental Fatigue'));
    await user.click(screen.getByRole('button', { name: 'Save the draft' }));
    expect(
      await screen.findByText('The draft could not be saved. Check the connection and try again.'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Load the newer version' })).toBeNull();
  });
});

describe('every refusal has its own sentence', () => {
  const answers: [string, number, Record<string, unknown>][] = [
    ['invalid_request', 400, { error: 'bad_request', code: 'invalid_request' }],
    ['reason_required', 400, { error: 'reason_required' }],
    ['route_owned', 400, { error: 'bad_request', code: 'route_owned', field: 'subject' }],
    ['wrong_kind', 422, { error: 'unprocessable', code: 'wrong_kind' }],
    ['already_issued', 422, { error: 'unprocessable', code: 'already_issued' }],
    ['imported_draft', 422, { error: 'unprocessable', code: 'imported_draft' }],
    ['locale_fixed', 422, { error: 'unprocessable', code: 'locale_fixed' }],
  ];

  it.each(answers)('says what %s means', async (code, status, body) => {
    const user = userEvent.setup();
    mountEditor(blankInitial(), mountApi({ saveAnswer: () => json(body, status) }));
    await user.click(await screen.findByRole('button', { name: 'Save the draft' }));
    expect(await screen.findByText(DRAFT_REFUSALS[code] as string)).toBeTruthy();
  });

  it('names the section and the reason of a field the shape refused', async () => {
    const user = userEvent.setup();
    mountEditor(
      blankInitial(),
      mountApi({
        saveAnswer: () =>
          json(
            {
              code: 'invalid_content',
              field: 'recording.recordedOn',
              refusals: [{ path: 'recording.recordedOn', reason: 'A date is written YYYY-MM-DD.' }],
            },
            400,
          ),
      }),
    );
    await user.click(await screen.findByRole('button', { name: 'Save the draft' }));
    expect(
      await screen.findByText(
        'Something in Client and recording is not what the report accepts: A date is written YYYY-MM-DD.',
      ),
    ).toBeTruthy();
  });

  it('says why the earlier report cannot be compared with', async () => {
    const user = userEvent.setup();
    mountEditor(
      blankFollowUp(COMPARED, 'follow_up'),
      mountApi({
        saveAnswer: () => json({ code: 'cannot_compare', reason: 'superseded' }, 422),
      }),
    );
    await user.click(await screen.findByRole('button', { name: 'Save the draft' }));
    expect(await screen.findByText(/has been replaced by a newer version/)).toBeTruthy();
  });

  it('says who may not, and what is gone', async () => {
    const user = userEvent.setup();
    mountEditor(blankInitial(), mountApi({ saveAnswer: () => json({ error: 'forbidden' }, 403) }));
    await user.click(await screen.findByRole('button', { name: 'Save the draft' }));
    expect(
      await screen.findByText('You are not allowed to write reports for this client.'),
    ).toBeTruthy();
    cleanup();
    mountEditor(blankInitial(), mountApi({ saveAnswer: () => json({ error: 'not_found' }, 404) }));
    await user.click(await screen.findByRole('button', { name: 'Save the draft' }));
    expect(await screen.findByText(/could not be found/)).toBeTruthy();
  });

  it('keeps her on the form when leaving could not save, and lets her leave anyway', async () => {
    const user = userEvent.setup();
    const { onDone } = mountEditor(
      blankInitial(),
      mountApi({ saveAnswer: () => json({ error: 'unprocessable', code: 'already_issued' }, 422) }),
    );
    await openSection(user, 'Key findings');
    await user.click(screen.getByLabelText('Mental Fatigue'));
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByText(DRAFT_REFUSALS['already_issued'] as string)).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Leave without saving' }));
    expect(onDone).toHaveBeenCalled();
  });

  it('sends nothing more once she leaves without saving and the form closes', async () => {
    const user = userEvent.setup();
    const { onDone, saves, unmount } = mountEditor(
      blankInitial(),
      mountApi({ saveAnswer: () => json({ error: 'unprocessable', code: 'already_issued' }, 422) }),
    );
    await openSection(user, 'Key findings');
    await user.click(screen.getByLabelText('Mental Fatigue'));
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await screen.findByText(DRAFT_REFUSALS['already_issued'] as string);
    expect(saves()).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Leave without saving' }));
    expect(onDone).toHaveBeenCalled();
    unmount();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(saves()).toHaveLength(1);
  });
});

describe('small things the review asked for', () => {
  it('holds back an emptied label of her own, and sends the one she had', async () => {
    const user = userEvent.setup();
    const { saves } = mountEditor(blankInitial());
    await openSection(user, 'Key findings');
    await user.type(screen.getByLabelText('Add your own item'), 'Sleep diary');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await user.clear(screen.getByLabelText('Your own item'));
    expect(screen.getByText('An item is never empty. Remove it instead.')).toBeTruthy();
    await user.click(screen.getByLabelText('Mental Fatigue'));
    await user.click(screen.getByRole('button', { name: 'Save the draft' }));
    await waitFor(() => expect(saves()).toHaveLength(1));
    const findings = sentContent(saves()[0])['findings'] as {
      custom: Record<string, { label: { en: string } }>;
    };
    expect(findings.custom['c0']?.label.en).toBe('Sleep diary');
  });

  it('words a headline from the report’s wording', async () => {
    const user = userEvent.setup();
    const blank = blankFollowUp(COMPARED, 'follow_up');
    mountEditor({
      ...blank,
      change: {
        ...blank.change,
        tiles: {
          t0: {
            position: 0,
            caption: { en: 'Calmer evenings', ar: null },
            figure: {
              kind: 'percent',
              direction: 'increase',
              low: 25,
              high: 30,
              source: 'typed',
              basis: null,
            },
          },
        },
      },
    });
    await openSection(user, 'What has changed');
    expect(screen.getByText('Calmer evenings: about 25–30% higher')).toBeTruthy();
  });

  it('asks before the browser tab closes over unsaved changes', async () => {
    const addListener = vi.spyOn(window, 'addEventListener');
    const user = userEvent.setup();
    mountEditor(blankInitial());
    await openSection(user, 'Key findings');
    await user.click(screen.getByLabelText('Mental Fatigue'));
    // A plain object stands in for the event: jsdom's own reads `returnValue`
    // as the old flag, not the string older Safari reads.
    const event = {
      returnValue: undefined as unknown,
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
    };
    const listeners = addListener.mock.calls.filter(([type]) => String(type) === 'beforeunload');
    const warn = listeners.at(-1)?.[1] as (event: unknown) => void;
    warn(event);

    expect(event.defaultPrevented).toBe(true);
    expect(event.returnValue).toBe('');
  });

  it('names the body a section controls only while it is open', async () => {
    const user = userEvent.setup();
    mountEditor(blankInitial());
    const findings = await section('Key findings');
    expect(findings.hasAttribute('aria-controls')).toBe(false);
    await user.click(findings);
    const body = document.getElementById(findings.getAttribute('aria-controls') ?? '');
    expect(body).toBeTruthy();
  });
});

describe('switching the edition', () => {
  const chosen = (): QeegInitial => {
    const blank = blankInitial();
    return {
      ...blank,
      bands: { ...blank.bands, theta: { level: 'increased', regions: ['frontal'] } },
      plan: { sessions: 20, approach: 'calming' },
    };
  };

  it('shows what is set aside before she confirms, and keeps the regions', async () => {
    const user = userEvent.setup();
    const { saves } = mountEditor(chosen());
    await user.click(await screen.findByRole('button', { name: 'Make this a follow-up' }));
    const panel = screen.getByRole('group', { name: 'Change the edition' });
    expect(within(panel).getByText('Theta: Increased')).toBeTruthy();
    expect(within(panel).getByText('Initial Training Approach: Calming')).toBeTruthy();
    expect(saves()).toHaveLength(0);

    await user.click(within(panel).getByRole('button', { name: 'Change the edition' }));
    expect(await screen.findByText('Brain-map report, follow-up')).toBeTruthy();
    await waitFor(() => expect(saves()).toHaveLength(1));
    expect(saves()[0]?.reason).toBe(SAVE_REASONS.edition);
    const sent = sentContent(saves()[0]) as {
      edition: string;
      bands: { theta: { change: unknown; regions: unknown } };
      plan: unknown;
    };
    expect(sent.edition).toBe('follow-up');
    expect(sent.bands.theta).toEqual({ change: null, regions: ['frontal'] });
    expect(sent.plan).toEqual({ sessions: 20, next: null });
  });

  it('changes nothing when she keeps it as it is', async () => {
    const user = userEvent.setup();
    const { saves } = mountEditor(chosen());
    await user.click(await screen.findByRole('button', { name: 'Make this a follow-up' }));
    await user.click(screen.getByRole('button', { name: 'Keep it as it is' }));
    expect(screen.getByText('Brain-map report, first report')).toBeTruthy();
    expect(saves()).toHaveLength(0);
  });

  it('says what a follow-up loses on becoming a first report', async () => {
    const user = userEvent.setup();
    const blank = blankFollowUp(COMPARED, 'follow_up');
    mountEditor({ ...blank, plan: { sessions: 20, next: 'continue_current' } });
    await user.click(await screen.findByRole('button', { name: 'Make this a first report' }));
    const panel = screen.getByRole('group', { name: 'Change the edition' });
    expect(
      within(panel).getByText('Next Stage of Training: Continue current approach'),
    ).toBeTruthy();
    expect(
      within(panel).getByText(/the page of what has changed and the earlier scores are not/),
    ).toBeTruthy();
  });
});
