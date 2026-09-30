// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PREFILL_SENTENCES } from '../../app/api/reports/qeeg/prefill';
import { prefillRefusalSentence } from '../../app/admin/reports/qeeg/prefill';
import { CANNOT_COMPARE } from '../../app/admin/reports/qeeg/refusals';
import { ReportsTab } from '../../app/admin/reports/ReportsTab';
import { LEAD_PRACTITIONER, signedInProvider } from '../../app/admin/clients/testActors';
import { AuthProviderBoundary } from '../../app/shell/auth/AuthContext';
import { blankInitial } from '../../domain/reports/qeeg/blank';
import { prefillFollowUp } from '../../domain/reports/qeeg/prefill';
import { countedFigure } from '../../domain/reports/qeeg/sessionsCompleted';
import type { QeegContent, QeegInitial } from '../../domain/reports/qeeg/types';

/**
 * A follow-up begun from an earlier report, on the screen (brief S): starting
 * one asks the prefill, which fills the draft; what she chose last time is
 * suggested beside each list and never ticked; she takes it one by one; the
 * earlier score and the earlier maps stand beside the new; the sessions are
 * counted from the visits and may be typed instead; choosing another report
 * before the first save asks the prefill again, asking her first when she has
 * changed something; and every refusal has its own sentence.
 *
 * Against a fake API whose prefill is the domain's own `prefillFollowUp`, so
 * the screen is shown what the route would answer. Text boxes are typed key
 * by key with `user.type`. Every id is in the reserved synthetic shape.
 */

afterEach(() => {
  cleanup();
});

const CLIENT = '00000008-0000-4000-8000-000000000005';
const FIRST = '00000006-0000-4000-8000-000000000001';
const SECOND = '00000006-0000-4000-8000-000000000002';
const DRAFT = '00000006-0000-4000-8000-000000000009';
const MAP_OPEN = '00000007-0000-4000-8000-000000000001';
const MAP_CLOSED = '00000007-0000-4000-8000-000000000002';
const STAMP = '2026-09-30T08:00:00.000000Z';
const SHA = 'a'.repeat(64);

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

const FIRST_ROW = row({
  id: FIRST,
  status: 'issued',
  reference: 'RPT-000001',
  issuedOn: '2026-06-02',
  recordedOn: '2026-06-01',
  createdAt: '2026-06-02T08:00:00+04:00',
});
const SECOND_ROW = row({
  id: SECOND,
  status: 'issued',
  reference: 'RPT-000002',
  issuedOn: '2026-07-02',
  recordedOn: '2026-07-01',
  createdAt: '2026-07-02T08:00:00+04:00',
});

/** The signed first report: ticks, one item of her own, regions, scores and two maps. */
function firstContent(): QeegInitial {
  const blank = blankInitial();
  return {
    ...blank,
    subject: { nameAr: null, ageYears: 9, sex: 'female' },
    recording: { recordedOn: '2026-06-01', eyes: 'closed_and_open', handedness: 'left' },
    findings: {
      chosen: ['mental_fatigue', 'sleep_dysregulation'],
      custom: {
        c0: { label: { en: 'Slow mornings', ar: null }, note: null, chosen: true, position: 0 },
      },
    },
    maps: {
      'map-0': {
        figureId: MAP_OPEN,
        sha256: SHA,
        widthPx: 800,
        heightPx: 600,
        condition: 'eyes_open',
        caption: null,
        position: 0,
      },
      'map-1': {
        figureId: MAP_CLOSED,
        sha256: SHA,
        widthPx: 800,
        heightPx: 600,
        condition: 'eyes_closed',
        caption: null,
        position: 1,
      },
    },
    bands: { ...blank.bands, delta: { level: 'increased', regions: ['frontal', 'central'] } },
    dashboard: { ...blank.dashboard, mental_energy: { score: 4, evidence: null } },
  };
}

/** The second signed report: nothing chosen, another handedness, no maps. */
function secondContent(): QeegInitial {
  const blank = blankInitial();
  return {
    ...blank,
    recording: { recordedOn: '2026-07-01', eyes: 'closed_and_open', handedness: 'right' },
  };
}

const EARLIER: Record<string, { row: ReturnType<typeof row>; content: () => QeegInitial }> = {
  [FIRST]: { row: FIRST_ROW, content: firstContent },
  [SECOND]: { row: SECOND_ROW, content: secondContent },
};

type Call = { url: string; method: string; body: unknown };

function mountTab({
  refuse,
  sessions = 3,
  reports = [FIRST_ROW],
  stored,
}: {
  /** A refusal code the prefill answers instead. */
  refuse?: { status: number; code: string };
  sessions?: number;
  reports?: unknown[];
  /** A saved draft, as `GET /api/reports/:id` holds it. */
  stored?: QeegContent;
} = {}) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const body: unknown = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method, body });
    if (url === '/api/me') return json(LEAD_PRACTITIONER);
    if (url.startsWith('/api/reports?clientId=')) return json({ reports });
    if (url.startsWith('/api/reports/qeeg/prefill?')) {
      if (refuse) return json({ error: 'unprocessable', code: refuse.code }, refuse.status);
      const query = new URL(url, 'http://localhost').searchParams;
      const earlier = EARLIER[query.get('from') ?? ''];
      if (!earlier) return json({ error: 'not_found', code: 'no_such_report' }, 404);
      const begun = prefillFollowUp(
        {
          reportId: earlier.row.id,
          clientId: CLIENT,
          status: 'issued',
          withdrawn: false,
          erased: false,
          reference: String(earlier.row.reference),
          content: earlier.content(),
        },
        {
          clientId: CLIENT,
          draftId: null,
          stage: 'follow_up',
          recordedOn: query.get('recordedOn'),
        },
      );
      if (!begun.ok) return json({ error: 'unprocessable', code: begun.reason }, 422);
      const count = earlier.row.id === FIRST ? sessions : 0;
      return json({
        content: {
          ...begun.content,
          change: {
            ...begun.content.change,
            sessionsCompleted: countedFigure(count),
          },
        },
        offered: begun.offered,
        sessions: {
          count,
          after: begun.content.comparedWith.recordedOn,
          before: null,
          through: '2026-09-30',
        },
      });
    }
    if (url === '/api/reports/draft') {
      const sent = (body as { content: Record<string, unknown> }).content;
      const content = {
        ...sent,
        subject: { nameAr: null, ageYears: 9, sex: 'female' },
        provenance: { origin: 'app' },
      } as Record<string, unknown>;
      return json(
        { report: row(), content: content as unknown as QeegContent, savedAt: STAMP },
        201,
      );
    }
    if (stored && url === `/api/reports/${DRAFT}`) {
      return json({
        report: row(),
        content: stored,
        deliveries: [],
        url: null,
        expiresInSeconds: null,
        savedAt: STAMP,
      });
    }
    const earlier = Object.values(EARLIER).find((each) => url === `/api/reports/${each.row.id}`);
    if (earlier) {
      return json({
        report: earlier.row,
        content: earlier.content(),
        deliveries: [],
        url: null,
        expiresInSeconds: null,
        savedAt: STAMP,
      });
    }
    return json({ error: 'not_found' }, 404);
  });
  render(
    <AuthProviderBoundary provider={signedInProvider} fetchImpl={fetchImpl}>
      <ReportsTab clientId={CLIENT} />
    </AuthProviderBoundary>,
  );
  const prefills = () => calls.filter((call) => call.url.startsWith('/api/reports/qeeg/prefill?'));
  const saves = () => calls.filter((call) => call.url === '/api/reports/draft');
  return { calls, prefills, saves };
}

async function startFollowUp(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'New brain-map report' }));
  await user.click(
    screen.getByRole('radio', { name: 'Follow-up, compared with an earlier report' }),
  );
  await user.click(screen.getByRole('button', { name: 'Start the report' }));
}

async function openSection(user: ReturnType<typeof userEvent.setup>, title: string) {
  const toggle = await screen.findByRole('button', { name: new RegExp(`^${title}`) });
  if (toggle.getAttribute('aria-expanded') !== 'true') await user.click(toggle);
  return toggle;
}

function sentContent(call: Call | undefined): Record<string, unknown> {
  return (call?.body as { content: Record<string, unknown> }).content;
}

describe('starting a follow-up from the report it is compared with', () => {
  it('asks the prefill once she starts, and the draft is filled from it', async () => {
    const user = userEvent.setup();
    const api = mountTab();
    await startFollowUp(user);
    expect(await screen.findByText('Brain-map report, follow-up')).toBeTruthy();
    expect(api.prefills()).toHaveLength(1);
    const asked = new URL(api.prefills()[0]?.url ?? '', 'http://localhost').searchParams;
    expect(Object.fromEntries(asked)).toEqual({ clientId: CLIENT, from: FIRST });

    await openSection(user, 'Client and recording');
    // The handedness is a fact about the client, brought forward.
    expect((screen.getByLabelText('Handedness') as HTMLSelectElement).value).toBe('left');

    await user.click(screen.getByRole('button', { name: 'Save the draft' }));
    await waitFor(() => expect(api.saves()).toHaveLength(1));
    const sent = sentContent(api.saves()[0]) as {
      comparedWith: unknown;
      change: {
        sessionsCompleted: unknown;
        pairs: { eyes_open: { earlier: { figureId: string } } };
      };
      findings: { chosen: string[] };
    };
    expect(sent.comparedWith).toEqual({ reportId: FIRST });
    expect(sent.change.sessionsCompleted).toEqual({ count: 3, source: 'gathered' });
    expect(sent.change.pairs.eyes_open.earlier.figureId).toBe(MAP_OPEN);
    // What she chose last time is not in the report until she takes it.
    expect(sent.findings.chosen).toEqual([]);
  });

  it('shows the earlier score beside the new one', async () => {
    const user = userEvent.setup();
    mountTab();
    await startFollowUp(user);
    await openSection(user, 'Performance dashboard');
    expect(screen.getByText('Earlier report: was 4')).toBeTruthy();
  });

  it('shows the earlier maps as the before side of the pairs, read-only', async () => {
    const user = userEvent.setup();
    mountTab();
    await startFollowUp(user);
    await openSection(user, 'What has changed');
    const open = screen.getByLabelText('Eyes open, before, the earlier report’s map');
    const closed = screen.getByLabelText('Eyes closed, before, the earlier report’s map');
    await waitFor(() => expect(open.textContent).toBe('Map 1, eyes open, 800 × 600 pixels'));
    expect(closed.textContent).toBe('Map 2, eyes closed, 800 × 600 pixels');
    expect(screen.queryByRole('combobox', { name: /before/ })).toBeNull();
  });
});

describe('what she chose last time', () => {
  it('is suggested beside the list, and nothing of it is ticked', async () => {
    const user = userEvent.setup();
    mountTab();
    await startFollowUp(user);
    await openSection(user, 'Key findings');
    const offered = screen.getByRole('group', { name: 'Chosen in the earlier report' });
    expect(within(offered).getByText('Mental Fatigue')).toBeTruthy();
    expect(within(offered).getByText('Sleep Dysregulation')).toBeTruthy();
    expect(within(offered).getByText('Slow mornings')).toBeTruthy();
    expect(
      (screen.getByRole('checkbox', { name: 'Mental Fatigue' }) as HTMLInputElement).checked,
    ).toBe(false);
  });

  it('is taken one at a time, and what is taken is no longer suggested', async () => {
    const user = userEvent.setup();
    const api = mountTab();
    await startFollowUp(user);
    await openSection(user, 'Key findings');
    await user.click(screen.getByRole('button', { name: 'Take Mental Fatigue' }));
    expect(
      (screen.getByRole('checkbox', { name: 'Mental Fatigue' }) as HTMLInputElement).checked,
    ).toBe(true);
    expect(
      (screen.getByRole('checkbox', { name: 'Sleep Dysregulation' }) as HTMLInputElement).checked,
    ).toBe(false);
    const offered = screen.getByRole('group', { name: 'Chosen in the earlier report' });
    expect(within(offered).queryByText('Mental Fatigue')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Take Slow mornings' }));
    await user.click(screen.getByRole('button', { name: 'Save the draft' }));
    await waitFor(() => expect(api.saves()).toHaveLength(1));
    const sent = sentContent(api.saves()[0]) as {
      findings: { chosen: string[]; custom: Record<string, { label: { en: string } }> };
    };
    expect(sent.findings.chosen).toEqual(['mental_fatigue']);
    expect(Object.values(sent.findings.custom).map((item) => item.label.en)).toEqual([
      'Slow mornings',
    ]);
  });

  it('suggests the regions named last time, band by band', async () => {
    const user = userEvent.setup();
    mountTab();
    await startFollowUp(user);
    await openSection(user, 'Frequency bands');
    const offered = screen.getByRole('group', { name: 'Regions named in the earlier report' });
    expect(within(offered).getByText(/Frontal Regions, Central Regions/)).toBeTruthy();
    await user.click(
      within(offered).getByRole('button', { name: /^Take the earlier regions of Delta/ }),
    );
    expect(screen.queryByRole('group', { name: 'Regions named in the earlier report' })).toBeNull();
  });
});

describe('the sessions completed', () => {
  it('shows the number counted from the visits, and takes a typed one instead', async () => {
    const user = userEvent.setup();
    const api = mountTab();
    await startFollowUp(user);
    await openSection(user, 'What has changed');
    const group = screen.getByRole('radiogroup', { name: 'Neurofeedback sessions completed' });
    expect(
      (
        within(group).getByRole('radio', {
          name: 'Counted from the client’s visits',
        }) as HTMLInputElement
      ).checked,
    ).toBe(true);
    expect(
      screen.getByText(/^3 completed sessions, counted from the client’s visits/),
    ).toBeTruthy();

    await user.click(
      within(group).getByRole('radio', { name: 'Typed, because some were elsewhere' }),
    );
    await user.type(screen.getByLabelText('Number of sessions completed'), '5');
    await user.click(screen.getByRole('button', { name: 'Save the draft' }));
    await waitFor(() => expect(api.saves()).toHaveLength(1));
    const sent = sentContent(api.saves()[0]) as { change: { sessionsCompleted: unknown } };
    expect(sent.change.sessionsCompleted).toEqual({ count: 5, source: 'typed' });

    // And back to the count.
    await user.click(
      within(group).getByRole('radio', { name: 'Counted from the client’s visits' }),
    );
    expect(screen.getByText(/^3 completed sessions/)).toBeTruthy();
  });

  it('says when no visit was counted, and offers only typing', async () => {
    const user = userEvent.setup();
    mountTab({ sessions: 0 });
    await startFollowUp(user);
    await openSection(user, 'What has changed');
    const group = screen.getByRole('radiogroup', { name: 'Neurofeedback sessions completed' });
    expect(
      (
        within(group).getByRole('radio', {
          name: 'Counted from the client’s visits',
        }) as HTMLInputElement
      ).disabled,
    ).toBe(true);
    expect(screen.getByText(/^No completed visit is recorded/)).toBeTruthy();
  });
});

describe('choosing another report before the first save', () => {
  it('asks the prefill again at once when she has changed nothing', async () => {
    const user = userEvent.setup();
    const api = mountTab({ reports: [FIRST_ROW, SECOND_ROW] });
    await startFollowUp(user);
    await openSection(user, 'Compared with');
    await user.selectOptions(screen.getByLabelText('Compare with'), SECOND);
    await waitFor(() => expect(api.prefills()).toHaveLength(2));
    expect(screen.queryByRole('group', { name: 'Start again from another report' })).toBeNull();
    await openSection(user, 'Client and recording');
    await waitFor(() =>
      expect((screen.getByLabelText('Handedness') as HTMLSelectElement).value).toBe('right'),
    );
  });

  it('asks her first when she has changed something, inside the form', async () => {
    const user = userEvent.setup();
    const api = mountTab({ reports: [FIRST_ROW, SECOND_ROW] });
    await startFollowUp(user);
    // A change in the same section: moving to another would save the draft first.
    await openSection(user, 'Compared with');
    await user.selectOptions(screen.getByLabelText('This report is'), 'final');
    await user.selectOptions(screen.getByLabelText('Compare with'), SECOND);
    const asking = screen.getByRole('group', { name: 'Start again from another report' });
    expect(api.prefills()).toHaveLength(1);

    await user.click(within(asking).getByRole('button', { name: 'Keep what I have' }));
    expect(api.prefills()).toHaveLength(1);
    expect((screen.getByLabelText('Compare with') as HTMLSelectElement).value).toBe(FIRST);

    await user.selectOptions(screen.getByLabelText('Compare with'), SECOND);
    await user.click(screen.getByRole('button', { name: 'Start again from that report' }));
    await waitFor(() => expect(api.prefills()).toHaveLength(2));
    await waitFor(() =>
      expect((screen.getByLabelText('Compare with') as HTMLSelectElement).value).toBe(SECOND),
    );
    // Asked for with the stage she chose, and nothing else of hers.
    const asked = new URL(api.prefills()[1]?.url ?? '', 'http://localhost').searchParams;
    expect(Object.fromEntries(asked)).toEqual({ clientId: CLIENT, from: SECOND, stage: 'final' });
    expect(api.saves()).toHaveLength(0);
  });

  it('keeps what she filled in once the draft is saved, and asks only for the suggestions again', async () => {
    const user = userEvent.setup();
    const api = mountTab({ reports: [FIRST_ROW, SECOND_ROW] });
    await startFollowUp(user);
    await openSection(user, 'Key findings');
    await user.click(screen.getByRole('button', { name: 'Take Mental Fatigue' }));
    await user.click(screen.getByRole('button', { name: 'Save the draft' }));
    await waitFor(() => expect(api.saves()).toHaveLength(1));
    await openSection(user, 'Compared with');
    await user.selectOptions(screen.getByLabelText('Compare with'), SECOND);
    await waitFor(() => expect(api.prefills()).toHaveLength(2));
    const asked = new URL(api.prefills()[1]?.url ?? '', 'http://localhost').searchParams;
    expect(asked.get('draftId')).toBe(DRAFT);
    expect(screen.queryByRole('group', { name: 'Start again from another report' })).toBeNull();
    await openSection(user, 'Key findings');
    expect(
      (screen.getByRole('checkbox', { name: 'Mental Fatigue' }) as HTMLInputElement).checked,
    ).toBe(true);
    // The second report chose nothing, so nothing is suggested.
    expect(screen.queryByRole('group', { name: 'Chosen in the earlier report' })).toBeNull();
  });
});

describe('each refusal of the prefill', () => {
  it('has a sentence of its own on the form for every code the route answers', () => {
    for (const code of Object.keys(PREFILL_SENTENCES)) {
      const sentence = prefillRefusalSentence(422, { code });
      expect(sentence, code).toBe(CANNOT_COMPARE[code]);
    }
    expect(prefillRefusalSentence(403, { error: 'forbidden' })).toMatch(/not allowed/);
  });

  for (const [status, code] of [
    [422, 'other_client'],
    [422, 'superseded'],
    [422, 'withdrawn'],
    [422, 'undated'],
    [404, 'no_such_report'],
  ] as const) {
    it(`says ${code} in its sentence, and the form does not open`, async () => {
      const user = userEvent.setup();
      mountTab({ refuse: { status, code } });
      await startFollowUp(user);
      expect(await screen.findByText(CANNOT_COMPARE[code] ?? 'missing')).toBeTruthy();
      expect(screen.queryByText('Brain-map report, follow-up')).toBeNull();
    });
  }
});

/** A saved follow-up of the first report, with nothing counted in it. */
function savedFollowUp(): QeegContent {
  const begun = prefillFollowUp(
    {
      reportId: FIRST,
      clientId: CLIENT,
      status: 'issued',
      withdrawn: false,
      erased: false,
      reference: 'RPT-000001',
      content: firstContent(),
    },
    { clientId: CLIENT, draftId: DRAFT, stage: 'follow_up', recordedOn: null },
  );
  if (!begun.ok) throw new Error(begun.reason);
  return {
    ...begun.content,
    subject: { nameAr: null, ageYears: 9, sex: 'female' },
  } as QeegContent;
}

describe('a saved follow-up, opened again (fix round 1)', () => {
  it('asks the prefill once, with the draft named, so the count and the suggestions come back', async () => {
    const user = userEvent.setup();
    const api = mountTab({ reports: [FIRST_ROW, row()], stored: savedFollowUp() });
    await user.click(await screen.findByRole('button', { name: 'Not yet signed' }));
    expect(await screen.findByText('Brain-map report, follow-up')).toBeTruthy();
    await waitFor(() => expect(api.prefills()).toHaveLength(1));
    const asked = new URL(api.prefills()[0]?.url ?? '', 'http://localhost').searchParams;
    expect(asked.get('from')).toBe(FIRST);
    expect(asked.get('draftId')).toBe(DRAFT);

    await openSection(user, 'Key findings');
    expect(await screen.findByRole('group', { name: 'Chosen in the earlier report' })).toBeTruthy();
    await openSection(user, 'What has changed');
    const group = screen.getByRole('radiogroup', { name: 'Neurofeedback sessions completed' });
    const counted = within(group).getByRole('radio', {
      name: 'Counted from the client’s visits',
    }) as HTMLInputElement;
    expect(counted.disabled).toBe(false);
    await user.click(counted);
    expect(screen.getByText(/^3 completed sessions/)).toBeTruthy();
    expect(api.prefills()).toHaveLength(1);
  });

  it('never says no visit is recorded when nothing was counted', async () => {
    const user = userEvent.setup();
    mountTab({
      reports: [FIRST_ROW, row()],
      stored: savedFollowUp(),
      refuse: { status: 422, code: 'recorded_later' },
    });
    await user.click(await screen.findByRole('button', { name: 'Not yet signed' }));
    await openSection(user, 'What has changed');
    expect(screen.queryByText(/No completed visit is recorded/)).toBeNull();
    const group = screen.getByRole('radiogroup', { name: 'Neurofeedback sessions completed' });
    expect(
      (
        within(group).getByRole('radio', {
          name: 'Counted from the client’s visits',
        }) as HTMLInputElement
      ).disabled,
    ).toBe(true);
  });
});

describe('a count over what a figure may hold (fix round 1)', () => {
  it('is never set as the counted figure, and she is told to type it', async () => {
    const user = userEvent.setup();
    const api = mountTab({ sessions: 250 });
    await startFollowUp(user);
    await openSection(user, 'What has changed');
    const group = screen.getByRole('radiogroup', { name: 'Neurofeedback sessions completed' });
    const counted = within(group).getByRole('radio', {
      name: 'Counted from the client’s visits',
    }) as HTMLInputElement;
    expect(counted.disabled).toBe(true);
    expect(screen.getByText(/^250 completed visits were counted/)).toBeTruthy();
    expect(screen.queryByText(/No completed visit is recorded/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Save the draft' }));
    await waitFor(() => expect(api.saves()).toHaveLength(1));
    const sent = sentContent(api.saves()[0]) as { change: { sessionsCompleted: unknown } };
    expect(sent.change.sessionsCompleted).toBeNull();
  });
});

describe('focus and what is announced (fix round 1)', () => {
  it('keeps “Compare with” usable while she is asked, moves focus into the question, and back', async () => {
    const user = userEvent.setup();
    mountTab({ reports: [FIRST_ROW, SECOND_ROW] });
    await startFollowUp(user);
    await openSection(user, 'Compared with');
    await user.selectOptions(screen.getByLabelText('This report is'), 'final');
    const select = screen.getByLabelText('Compare with') as HTMLSelectElement;
    await user.selectOptions(select, SECOND);
    const asking = screen.getByRole('group', { name: 'Start again from another report' });
    expect(select.disabled).toBe(false);
    expect(select.getAttribute('aria-busy')).toBe('true');
    expect(document.activeElement).toBe(asking);
    expect(asking.textContent).toMatch(/“Keep what I have” keeps everything you have filled in/);
    await user.click(within(asking).getByRole('button', { name: 'Keep what I have' }));
    expect(document.activeElement).toBe(screen.getByLabelText('Compare with'));
  });

  it('says it is reading the earlier report in a live region that is always there', async () => {
    const user = userEvent.setup();
    mountTab({ reports: [FIRST_ROW, SECOND_ROW] });
    await user.click(await screen.findByRole('button', { name: 'New brain-map report' }));
    const starting = document.getElementById('qeeg-start-status');
    expect(starting?.getAttribute('aria-live')).toBe('polite');
    expect(starting?.textContent).toBe('');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await startFollowUp(user);
    await openSection(user, 'Compared with');
    const live = document.getElementById('qeeg-compared-status');
    expect(live?.getAttribute('aria-live')).toBe('polite');
    expect(live?.textContent).toBe('');
  });

  it('moves focus to the next suggestion after one is taken, and to the ticked item after the last', async () => {
    const user = userEvent.setup();
    mountTab();
    await startFollowUp(user);
    await openSection(user, 'Key findings');
    await user.click(screen.getByRole('button', { name: 'Take Mental Fatigue' }));
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Take Sleep Dysregulation' }),
    );
    await user.click(screen.getByRole('button', { name: 'Take Sleep Dysregulation' }));
    await user.click(screen.getByRole('button', { name: 'Take Slow mornings' }));
    expect(screen.queryByRole('group', { name: 'Chosen in the earlier report' })).toBeNull();
    expect(document.activeElement?.tagName).toBe('INPUT');
    expect(document.activeElement?.closest('.qeeg-section')).toBeTruthy();
  });
});
