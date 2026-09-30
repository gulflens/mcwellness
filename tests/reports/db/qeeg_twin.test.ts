import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type {
  IssueResponse,
  QeegDraftResponse,
  ReportListResponse,
  ReportResponse,
  TwinResponse,
} from '../../../app/api/reports/schema';
import { twinChangeIn } from '../../../domain/reports/qeeg/twin';
import { fullFollowUp, sparseFollowUp } from '../../../domain/reports/qeeg/testing/reports';
import type {
  FigureRef,
  QeegContent,
  QeegFollowUp,
  QeegInitial,
} from '../../../domain/reports/qeeg/types';
import { phrase } from '../../../domain/reports/qeeg/wording';
import type * as Wording from '../../../domain/reports/qeeg/wording';
import { extractAll } from '../../../domain/shared/document';
import {
  clientToWriteAbout,
  completeReport,
  householdOf,
  qeegSteps,
  sent,
} from './qeeg-signing-support';
import { SEEDED, startHarness, type Harness } from './support';

/**
 * The second-language report of one recording (docs/SPEC/reports-qeeg.md
 * section 8; brief Q): `POST /api/reports/:id/twin` makes the draft from a
 * signed report, its saves may change only their own language's halves of
 * typed text, it signs through the ordinary door with its own reference, and
 * it is out of step once the first is corrected.
 *
 * Both languages are approved here by a test double, as the other signing
 * tests approve English: the practice's approval is not a test's to give.
 */

const wording = vi.hoisted(() => ({ status: { en: 'approved', ar: 'approved' } }));
vi.mock('../../../domain/reports/qeeg/wording', async (importOriginal) => {
  const actual = await importOriginal<typeof Wording>();
  return { ...actual, WORDING_STATUS: wording.status };
});

const NOW = () => new Date('2026-09-30T08:00:00.000Z');
const TWIN_REASON = 'Starting the Arabic report from the signed one';
const SIGN_REASON = 'Signing the brain-map report';

let h: Harness;
let clientId: string;
let clientIndex: number;
let steps: ReturnType<typeof qeegSteps>;
let household: string;

type Signed = { id: string; content: QeegInitial; reference: string; maps: string[] };

async function sign(draft: { id: string; savedAt: string }): Promise<Response> {
  return h.call(
    'POST',
    `/api/reports/${draft.id}/issue`,
    SEEDED.owner,
    { savedAt: draft.savedAt },
    { 'x-reason': SIGN_REASON },
  );
}

async function signedReport(seed: number): Promise<Signed> {
  const draft = await steps.completeDraft(SEEDED.owner, { seed });
  const res = await sign(draft);
  if (res.status !== 201) throw new Error(`Refused: ${res.status} ${await res.text()}`);
  const answer = (await res.json()) as IssueResponse;
  const { rows } = await h.owner.query<{ content: QeegInitial }>(
    'select content from report where id = $1',
    [draft.id],
  );
  return {
    id: draft.id,
    content: rows[0]?.content ?? (draft.content as QeegInitial),
    reference: answer.report.reference ?? '',
    maps: draft.maps.map((map) => map.figureId),
  };
}

async function twin(
  id: string,
  as: number = SEEDED.owner,
  headers: Record<string, string> = { 'x-reason': TWIN_REASON },
  body: unknown = {},
): Promise<Response> {
  return h.call('POST', `/api/reports/${id}/twin`, as, body, headers);
}

async function twinOf(first: Signed): Promise<TwinResponse['report']> {
  const res = await twin(first.id);
  if (res.status !== 201) throw new Error(`Refused: ${res.status} ${await res.text()}`);
  return ((await res.json()) as TwinResponse).report;
}

async function read(id: string, as: number = SEEDED.owner): Promise<ReportResponse> {
  const res = await h.call('GET', `/api/reports/${id}`, as);
  if (res.status !== 200) throw new Error(`Refused: ${res.status} ${await res.text()}`);
  return (await res.json()) as ReportResponse;
}

async function codeOf(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

/** The trail's reasons for each refused second language of a report. */
async function refusedFor(reportId: string): Promise<string[]> {
  const { rows } = await h.owner.query<{ reason: string }>(
    "select new_values->>'reason' as reason from audit_log where action = 'report.twin_refused' " +
      'and entity_id = $1',
    [reportId],
  );
  return rows.map((row) => row.reason);
}

/** `content` with its Arabic summary and first custom finding's Arabic label given. */
function withArabic(content: QeegContent): QeegContent {
  const custom = Object.fromEntries(
    Object.entries(content.findings.custom).map(([key, item], place) => [
      key,
      place === 0 ? { ...item, label: { ...item.label, ar: 'تعب ذهني' } } : item,
    ]),
  );
  return {
    ...content,
    findings: { ...content.findings, custom },
    summary: { ...content.summary, ar: { text: 'ملخص هادئ ومستقر', marks: [] } },
  };
}

beforeAll(async () => {
  h = await startHarness(NOW);
  const client = clientToWriteAbout(h);
  clientId = client.id;
  clientIndex = client.index;
  steps = qeegSteps(h, clientId);
  household = await householdOf(h, clientId, 3);
}, 180_000);

afterAll(async () => {
  await h.close();
});

describe('the other language, started from a signed report', () => {
  let first: Signed;
  let made: TwinResponse['report'];

  beforeAll(async () => {
    first = await signedReport(1);
    made = await twinOf(first);
  }, 60_000);

  it('makes a draft in the other language that names the report it was made from', () => {
    expect(made).toMatchObject({
      kind: 'qeeg',
      status: 'draft',
      locale: 'ar',
      twinOfId: first.id,
      reference: null,
      version: 1,
      outOfStep: false,
    });
  });

  it('carries the same content, and borrows every map from the signed report', async () => {
    const { rows } = await h.owner.query<{ content: unknown }>(
      'select content from report where id = $1',
      [made.id],
    );
    expect(rows[0]?.content).toEqual(first.content);
    const links = await h.owner.query<{ document_id: string; borrowed_from_report_id: string }>(
      'select document_id, borrowed_from_report_id from report_figure where report_id = $1',
      [made.id],
    );
    expect(links.rows.map((row) => row.document_id).sort()).toEqual([...first.maps].sort());
    for (const row of links.rows) expect(row.borrowed_from_report_id).toBe(first.id);
  });

  it('shows each report its twin, in the list and on its page', async () => {
    const list = await h.call('GET', `/api/reports?clientId=${clientId}`, SEEDED.owner);
    const rows = ((await list.json()) as ReportListResponse).reports;
    expect(rows.find((row) => row.id === first.id)?.twinId).toBe(made.id);
    expect(rows.find((row) => row.id === made.id)?.twinOfId).toBe(first.id);
    expect((await read(first.id)).report.twinId).toBe(made.id);
  });

  it('writes the reason on the trail, with the new row and beside it', async () => {
    const started = await h.owner.query<{ reason: string; locale: string }>(
      "select reason, new_values->>'locale' as locale from audit_log " +
        "where action = 'report.twin_started' and entity_id = $1",
      [first.id],
    );
    expect(started.rows).toEqual([{ reason: TWIN_REASON, locale: 'ar' }]);
    const inserted = await h.owner.query<{ reason: string }>(
      "select reason from audit_log where entity_id = $1 and action like '%insert%'",
      [made.id],
    );
    expect(inserted.rows.length).toBeGreaterThan(0);
    for (const row of inserted.rows) expect(row.reason).toBe(TWIN_REASON);
  });

  it('refuses a second one, and says where the first is', async () => {
    const res = await twin(first.id);
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toMatchObject({ code: 'twin_exists', twinId: made.id });
    expect(await refusedFor(first.id)).toContain('twin_exists');
  });
});

describe('what "Sign the other language" refuses, each by its own code', () => {
  it('refuses a report that is not signed', async () => {
    const draft = await steps.completeDraft(SEEDED.owner, { seed: 2 });
    const res = await twin(draft.id);
    expect(res.status).toBe(422);
    expect(await codeOf(res)).toMatchObject({ code: 'not_signed' });
    expect(await refusedFor(draft.id)).toEqual(['not_signed']);
  });

  it('refuses a version already replaced', async () => {
    const first = await signedReport(3);
    const corrected = await h.call('POST', `/api/reports/${first.id}/supersede`, SEEDED.owner, {
      reason: 'The recording date was typed a day late.',
    });
    expect(corrected.status).toBe(201);
    const res = await twin(first.id);
    expect(res.status).toBe(422);
    expect(await codeOf(res)).toMatchObject({ code: 'already_superseded' });
  });

  it('refuses a past record brought in from the old tool', async () => {
    const first = await signedReport(4);
    const { rows } = await h.owner.query<{ id: string }>(
      'insert into report (tenant_id, client_id, kind, content, imported_from, source_sha256) ' +
        "values ($1, $2, 'qeeg', $3::jsonb, 'qeeg.json/1', $4) returning id",
      [h.data.tenant.id, clientId, JSON.stringify(first.content), 'f'.repeat(64)],
    );
    const pastId = rows[0]?.id ?? '';
    await h.owner.query("update report set status = 'imported' where id = $1", [pastId]);
    const res = await twin(pastId);
    expect(res.status).toBe(422);
    expect(await codeOf(res)).toMatchObject({ code: 'imported_record' });
  });

  it('refuses a client whose record has been erased', async () => {
    const index = h.data.clients.findIndex(
      (c, at) => c.status === 'active' && at !== clientIndex && c.givenNameAr !== null,
    );
    const other = qeegSteps(h, h.clientId(index));
    const draft = await other.completeDraft(SEEDED.owner, { seed: 5 });
    expect((await sign(draft)).status).toBe(201);
    await h.owner.query("update client set status = 'erased' where id = $1", [h.clientId(index)]);
    const res = await twin(draft.id);
    expect(res.status).toBe(422);
    expect(await codeOf(res)).toMatchObject({ code: 'client_erased' });
    const { rows } = await h.owner.query<{ n: string }>(
      'select count(*)::text as n from report where twin_of_id = $1',
      [draft.id],
    );
    expect(rows[0]?.n).toBe('0');
  });

  it('answers a practitioner off her schedule as not there', async () => {
    const first = await signedReport(6);
    const res = await twin(first.id, SEEDED.otherPractitioner);
    expect(res.status).toBe(404);
  });

  it('refuses a coordinator, who drafts no reports, and writes it on the trail', async () => {
    const first = await signedReport(61);
    const res = await twin(first.id, SEEDED.admin);
    expect(res.status).toBe(403);
    expect(await codeOf(res)).toMatchObject({ code: 'not_permitted' });
    expect(await refusedFor(first.id)).toContain('not_permitted');
  });

  it('refuses a request that gives no reason, or sends a body of its own', async () => {
    const first = await signedReport(7);
    const bare = await twin(first.id, SEEDED.owner, {});
    expect(bare.status).toBe(400);
    expect(((await bare.json()) as { error: string }).error).toBe('reason_required');
    const withBody = await twin(
      first.id,
      SEEDED.owner,
      { 'x-reason': TWIN_REASON },
      {
        locale: 'en',
      },
    );
    expect(withBody.status).toBe(400);
    expect(await codeOf(withBody)).toMatchObject({ code: 'invalid_request' });
  });

  it('answers a report nobody can see as not there, and a household nothing', async () => {
    const res = await twin('0000000a-0000-4000-8000-000000009999');
    expect(res.status).toBe(404);
    const first = await signedReport(8);
    const asHousehold = await h.callAs(
      'POST',
      `/api/reports/${first.id}/twin`,
      household,
      {},
      {
        'x-reason': TWIN_REASON,
      },
    );
    expect([403, 404]).toContain(asHousehold.status);
  });
});

describe('who may start it (change request 6: report.draft)', () => {
  it('lets a practitioner on her schedule start it, with the maps borrowed and the reason kept', async () => {
    const first = await signedReport(62);
    // On her schedule, so the client is hers to draft for.
    await h.onSchedule(clientIndex, SEEDED.practitioner);
    const reason = 'The household asked for the report in Arabic';
    const res = await twin(first.id, SEEDED.practitioner, { 'x-reason': reason });
    expect(res.status).toBe(201);
    const made = ((await res.json()) as TwinResponse).report;
    expect(made).toMatchObject({ status: 'draft', locale: 'ar', twinOfId: first.id });
    const links = await h.owner.query<{ document_id: string; borrowed_from_report_id: string }>(
      'select document_id, borrowed_from_report_id from report_figure where report_id = $1',
      [made.id],
    );
    expect(links.rows.map((row) => row.document_id).sort()).toEqual([...first.maps].sort());
    const started = await h.owner.query<{ reason: string }>(
      "select reason from audit_log where action = 'report.twin_started' and entity_id = $1",
      [first.id],
    );
    expect(started.rows).toEqual([{ reason }]);
  });
});

describe('two requests at once', () => {
  it('make one second-language draft, and the other is told where it is', async () => {
    const first = await signedReport(9);
    const answers = await Promise.all([twin(first.id), twin(first.id)]);
    expect(answers.map((res) => res.status).sort()).toEqual([201, 409]);
    const { rows } = await h.owner.query<{ n: string }>(
      'select count(*)::text as n from report where twin_of_id = $1',
      [first.id],
    );
    expect(rows[0]?.n).toBe('1');
  });
});

describe('the second-language draft, saved', () => {
  let first: Signed;
  let draft: { id: string; savedAt: string };

  beforeAll(async () => {
    first = await signedReport(10);
    const made = await twinOf(first);
    draft = { id: made.id, savedAt: (await read(made.id)).savedAt ?? '' };
  }, 60_000);

  async function save(content: object) {
    return steps.saveOver(draft, content, SEEDED.owner);
  }

  it('takes a save that changes only its own language’s halves', async () => {
    const res = await save(withArabic(first.content));
    expect(res.status).toBe(200);
    const body = (await res.json()) as QeegDraftResponse;
    draft = { id: draft.id, savedAt: body.savedAt };
    const content = body.content as QeegInitial;
    expect(content.summary.ar?.text).toBe('ملخص هادئ ومستقر');
  });

  it('reads back identical to the first report outside its Arabic halves', async () => {
    const back = (await read(draft.id)).content as QeegContent;
    expect(twinChangeIn(first.content, back, 'ar')).toBeNull();
    expect(back.summary.en).toEqual(first.content.summary.en);
    expect(back.dashboard).toEqual(first.content.dashboard);
    expect(back.maps).toEqual(first.content.maps);
  });

  it('refuses by the field a save that changes a score', async () => {
    const changed: QeegInitial = {
      ...first.content,
      dashboard: {
        ...first.content.dashboard,
        mental_energy: {
          ...first.content.dashboard.mental_energy,
          score: first.content.dashboard.mental_energy.score === 1 ? 2 : 1,
        },
      },
    };
    const res = await save(changed);
    expect(res.status).toBe(422);
    expect(await codeOf(res)).toMatchObject({
      code: 'twin_fixed',
      field: 'dashboard.mental_energy.score',
    });
  });

  it('refuses a finding unticked, a map moved and the edition changed', async () => {
    const unticked = await save({
      ...first.content,
      findings: { ...first.content.findings, chosen: [] },
    });
    expect(unticked.status).toBe(422);
    expect(String((await codeOf(unticked))['field'])).toMatch(/^findings\.chosen/);

    const maps = Object.fromEntries(
      Object.entries(first.content.maps).map(([key, map]) => [
        key,
        {
          ...map,
          caption: null,
          condition: map.condition === 'eyes_open' ? 'eyes_closed' : 'eyes_open',
        },
      ]),
    );
    const moved = await save({ ...first.content, maps });
    expect(moved.status).toBe(422);
    expect(String((await codeOf(moved))['field'])).toMatch(/^maps\./);

    const other = await save({ ...first.content, edition: 'follow-up' });
    expect(other.status).toBe(422);
    expect(await codeOf(other)).toMatchObject({ code: 'twin_fixed', field: 'edition' });
  });

  it('refuses an English half changed on the Arabic report', async () => {
    const res = await save({
      ...first.content,
      summary: { ...first.content.summary, en: { text: 'Another summary.', marks: [] } },
    });
    expect(res.status).toBe(422);
    expect(String((await codeOf(res))['field'])).toMatch(/^summary\.en/);
  });

  it('refuses a map added to it or taken from it through the maps’ door', async () => {
    const removed = await h.raw(
      'DELETE',
      `/api/reports/${draft.id}/figures/${first.maps[0] ?? ''}`,
      SEEDED.owner,
      undefined,
      { 'x-reason': 'Removing a brain map from the draft' },
    );
    expect(removed.status).toBe(422);
    expect(await codeOf(removed)).toMatchObject({ code: 'twin_fixed' });
  });

  it('writes nothing for a refused save', async () => {
    const back = (await read(draft.id)).content as QeegContent;
    expect(back.findings.chosen).toEqual(first.content.findings.chosen);
    expect(back.summary.en).toEqual(first.content.summary.en);
  });
});

describe('the second-language report, signed', () => {
  let first: Signed;
  let answer: IssueResponse;
  let pdf: Uint8Array;

  beforeAll(async () => {
    first = await signedReport(20);
    const made = await twinOf(first);
    const stamp = (await read(made.id)).savedAt ?? '';
    const saved = await steps.saved(
      { id: made.id, savedAt: stamp },
      withArabic(first.content),
      SEEDED.owner,
    );
    const res = await sign(saved);
    if (res.status !== 201) throw new Error(`Refused: ${res.status} ${await res.text()}`);
    answer = (await res.json()) as IssueResponse;
    const { rows } = await h.owner.query<{ storage_key: string }>(
      'select d.storage_key from report r join document d on d.id = r.document_id where r.id = $1',
      [made.id],
    );
    const bytes = await h.storage.get(rows[0]?.storage_key ?? '');
    if (!bytes) throw new Error('The store holds nothing at that key.');
    pdf = bytes;
  }, 90_000);

  it('signs through the ordinary door, with a reference of its own', () => {
    expect(answer.report).toMatchObject({ status: 'issued', locale: 'ar', twinOfId: first.id });
    expect(answer.report.reference).toMatch(/^RPT-\d{6}$/);
    expect(answer.report.reference).not.toBe(first.reference);
  });

  it('is itself the other language of the first, and says so when asked for a third', async () => {
    const res = await twin(answer.report.id);
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toMatchObject({ code: 'twin_exists', twinId: first.id });
  });

  it('files an Arabic PDF', () => {
    const text = extractAll(pdf);
    expect(text).toMatch(/[\u0600-\u06ff\ufb50-\ufdff\ufe70-\ufefe]/);
    expect(text).not.toContain(phrase('heading.programme', 'initial', 'en'));
  });

  it('is shown out of step once the first report is corrected', async () => {
    const before = await read(answer.report.id);
    expect(before.report.outOfStep).toBe(false);
    const corrected = await h.call('POST', `/api/reports/${first.id}/supersede`, SEEDED.owner, {
      reason: 'A finding was ticked in error.',
    });
    expect(corrected.status).toBe(201);
    expect((await read(answer.report.id)).report.outOfStep).toBe(true);
    const list = await h.call('GET', `/api/reports?clientId=${clientId}`, SEEDED.owner);
    const rows = ((await list.json()) as ReportListResponse).reports;
    expect(rows.find((row) => row.id === answer.report.id)?.outOfStep).toBe(true);
    // The first report, replaced, is history and is not itself out of step.
    expect(rows.find((row) => row.id === first.id)?.outOfStep).toBe(false);
  });
});

describe('a second-language draft whose first report was corrected meanwhile', () => {
  it('is refused at signing, by its own code, and nothing is numbered', async () => {
    const first = await signedReport(30);
    const made = await twinOf(first);
    const saved = await steps.saved(
      { id: made.id, savedAt: (await read(made.id)).savedAt ?? '' },
      withArabic(first.content),
      SEEDED.owner,
    );
    const corrected = await h.call('POST', `/api/reports/${first.id}/supersede`, SEEDED.owner, {
      reason: 'The recording date was typed a day late.',
    });
    expect(corrected.status).toBe(201);
    const res = await sign(saved);
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toMatchObject({ code: 'twin_out_of_step', twinOfId: first.id });
    const { rows } = await h.owner.query<{ status: string; number: number | null }>(
      'select status::text as status, number from report where id = $1',
      [made.id],
    );
    expect(rows[0]).toEqual({ status: 'draft', number: null });
  });

  it('is refused at signing when it says something the first report does not', async () => {
    const first = await signedReport(31);
    const made = await twinOf(first);
    // Written some other way than its own door.
    await h.owner.query(
      "update report set content = jsonb_set(content, '{findings,chosen}', '[]'::jsonb) where id = $1",
      [made.id],
    );
    const res = await sign({ id: made.id, savedAt: (await read(made.id)).savedAt ?? '' });
    expect(res.status).toBe(422);
    expect(await codeOf(res)).toMatchObject({ code: 'twin_differs' });
  });
});

describe('a signature racing a correction of the first report', () => {
  it('waits for the correction, then refuses the other language as out of step', async () => {
    const first = await signedReport(32);
    const made = await twinOf(first);
    const saved = await steps.saved(
      { id: made.id, savedAt: (await read(made.id)).savedAt ?? '' },
      withArabic(first.content),
      SEEDED.owner,
    );
    // The correction below is written without its audit row, for this test
    // only. The trail links every row under one lock, which the signature
    // takes early (it reads the client) and holds while it waits; a
    // correction that wrote its audit row after the signature was blocked
    // would wait on that lock in turn, and the database would end one of the
    // two. In the app a correction takes the trail's lock before it touches
    // the row, so the two never cross; the test holds the row alone to prove
    // the row's lock by itself.
    await h.owner.query('alter table report disable trigger audit_row');
    let answeredWhileHeld: boolean;
    let blocked = false;
    let signing: Promise<Response>;
    try {
      // A second connection holds the first report's row, as a correction's
      // own update does before it commits (`for no key update`: it keeps the
      // signature's `for share` waiting, and not the check of the twin's key
      // at its commit, so only the lock in issue.ts can be what waits).
      await h.owner.query('begin');
      await h.owner.query('select id from report where id = $1 for no key update', [first.id]);
      let settled = false;
      signing = sign(saved).finally(() => {
        settled = true;
      });
      // Wait until the signature is seen blocked on this connection, so the
      // test cannot pass without exercising the lock. Without the `for share`
      // in issue.ts nothing of the signature waits on this row: it is
      // answered while the row is held, or the deadline passes, and the test
      // fails.
      const deadline = Date.now() + 10_000;
      while (!blocked && Date.now() < deadline && !settled) {
        const waiting = await h.owner.query<{ n: string }>(
          'select count(*)::text as n from pg_stat_activity ' +
            'where pid <> pg_backend_pid() and pg_backend_pid() = any(pg_blocking_pids(pid)) ' +
            "and wait_event_type = 'Lock'",
        );
        blocked = Number(waiting.rows[0]?.n ?? 0) > 0;
        if (!blocked) await new Promise((resolve) => setTimeout(resolve, 25));
      }
      // Held here, the signature had not been answered.
      answeredWhileHeld = settled;
      // Only now, the correction.
      await h.owner.query("update report set status = 'superseded' where id = $1", [first.id]);
      await h.owner.query('commit');
    } finally {
      await h.owner.query('alter table report enable always trigger audit_row');
    }
    expect(blocked).toBe(true);
    expect(answeredWhileHeld).toBe(false);
    const res = await signing;
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toMatchObject({ code: 'twin_out_of_step' });
    const { rows } = await h.owner.query<{ status: string }>(
      'select status::text as status from report where id = $1',
      [made.id],
    );
    expect(rows[0]?.status).toBe('draft');
  });
});

describe('a twin whose row names another service or comparison than its first', () => {
  it('is refused at signing, by the column', async () => {
    const first = await signedReport(33);
    const made = await twinOf(first);
    const other = h.data.serviceTypes.find((service) => service.id !== null)?.id ?? '';
    await h.owner.query('update report set service_type_id = $2 where id = $1', [made.id, other]);
    const res = await sign({ id: made.id, savedAt: (await read(made.id)).savedAt ?? '' });
    expect(res.status).toBe(422);
    expect(await codeOf(res)).toMatchObject({ code: 'twin_differs', field: 'serviceTypeId' });
  });
});

describe('the other language of a signed follow-up', () => {
  it('borrows the earlier pictures from the first, then saves and signs', async () => {
    const earlier = await steps.completeDraft(SEEDED.owner, { seed: 70 });
    expect((await sign(earlier)).status).toBe(201);

    const draft = await steps.saveAs(SEEDED.owner, {
      locale: 'en',
      content: { ...sent(sparseFollowUp()), comparedWith: { reportId: earlier.id } },
    });
    expect(draft.status).toBe(201);
    const blank = (await draft.json()) as QeegDraftResponse;
    let savedAt = blank.savedAt;
    const own: FigureRef[] = [];
    for (const seed of [71, 72, 73, 74]) {
      const filed = await steps.upload(blank.report.id, SEEDED.owner, seed);
      own.push(filed.ref);
      savedAt = filed.savedAt;
    }
    const [mapA, mapB, laterClosed, laterOpen] = own;
    if (!mapA || !mapB || !laterClosed || !laterOpen) throw new Error('Uploads went missing.');
    const full = fullFollowUp();
    const saved = await steps.saveAs(SEEDED.owner, {
      id: blank.report.id,
      savedAt,
      content: {
        ...sent(full),
        comparedWith: { reportId: earlier.id },
        recording: { ...full.recording, recordedOn: '2026-09-28' },
        maps: completeReport([mapA, mapB]).maps,
        change: {
          ...full.change,
          sessionsCompleted: { count: 20, source: 'typed' },
          pairs: {
            eyes_closed: { earlier: null, later: laterClosed },
            eyes_open: { earlier: null, later: laterOpen },
          },
        },
      },
    });
    if (saved.status !== 200) throw new Error(`Refused: ${saved.status} ${await saved.text()}`);
    const followUp = (await saved.json()) as QeegDraftResponse;
    expect((await sign({ id: followUp.report.id, savedAt: followUp.savedAt })).status).toBe(201);

    const res = await twin(followUp.report.id);
    expect(res.status).toBe(201);
    const made = ((await res.json()) as TwinResponse).report;
    const content = (await read(made.id)).content as QeegFollowUp;
    const earlierSides = [
      content.change.pairs.eyes_closed.earlier,
      content.change.pairs.eyes_open.earlier,
    ]
      .filter((figure): figure is FigureRef => figure !== null)
      .map((figure) => figure.figureId);
    expect(earlierSides.length).toBe(2);
    const links = await h.owner.query<{ document_id: string; borrowed_from_report_id: string }>(
      'select document_id, borrowed_from_report_id from report_figure where report_id = $1',
      [made.id],
    );
    for (const id of earlierSides) {
      expect(links.rows.find((row) => row.document_id === id)?.borrowed_from_report_id).toBe(
        followUp.report.id,
      );
    }

    const given: QeegFollowUp = {
      ...content,
      change: {
        ...content.change,
        summary: { ...content.change.summary, ar: { text: 'نوم أعمق', marks: [] } },
      },
    };
    const twinSaved = await steps.saved(
      { id: made.id, savedAt: (await read(made.id)).savedAt ?? '' },
      { ...given, comparedWith: { reportId: earlier.id } },
      SEEDED.owner,
    );
    const signed = await sign(twinSaved);
    expect(signed.status).toBe(201);
    const answer = (await signed.json()) as IssueResponse;
    expect(answer.report).toMatchObject({
      status: 'issued',
      locale: 'ar',
      twinOfId: followUp.report.id,
    });
  });
});

describe('what a household sees', () => {
  it('sees neither the second-language draft nor its preview', async () => {
    const first = await signedReport(40);
    const made = await twinOf(first);
    expect((await h.callAs('GET', `/api/reports/${made.id}`, household)).status).toBe(404);
    expect(
      (await h.callAs('GET', `/api/reports/${made.id}/preview?locale=ar`, household)).status,
    ).toBe(404);
    const list = await h.callAs('GET', `/api/reports?clientId=${clientId}`, household);
    if (list.status === 200) {
      const rows = ((await list.json()) as ReportListResponse).reports;
      expect(rows.some((row) => row.status === 'draft')).toBe(false);
      expect(rows.some((row) => row.id === made.id)).toBe(false);
    }
  });
});

describe('the second-language draft previewed', () => {
  it('draws in either language, the Arabic halves where given and the English where not', async () => {
    const first = await signedReport(50);
    const made = await twinOf(first);
    await steps.saved(
      { id: made.id, savedAt: (await read(made.id)).savedAt ?? '' },
      withArabic(first.content),
      SEEDED.owner,
    );
    for (const locale of ['ar', 'en']) {
      const res = await h.call(
        'GET',
        `/api/reports/${made.id}/preview?locale=${locale}`,
        SEEDED.owner,
      );
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('application/pdf');
    }
  });
});
