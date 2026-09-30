import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type {
  QeegDraftResponse,
  QeegPrefillResponse,
  ReportResponse,
  TwinResponse,
} from '../../../app/api/reports/schema';
import { PREFILL_SENTENCES } from '../../../app/api/reports/qeeg/prefill';
import { blankFollowUp, blankInitial } from '../../../domain/reports/qeeg/blank';
import { DIMENSION_IDS } from '../../../domain/reports/qeeg/catalogue/ids';
import { missingForIssue } from '../../../domain/reports/qeeg/complete';
import { isOffered } from '../../../domain/reports/qeeg/offered';
import { validateQeegContent } from '../../../domain/reports/qeeg/shape';
import { fullFollowUp } from '../../../domain/reports/qeeg/testing/reports';
import type {
  FigureRef,
  QeegContent,
  QeegFollowUp,
  QeegInitial,
} from '../../../domain/reports/qeeg/types';
import type * as Wording from '../../../domain/reports/qeeg/wording';
import {
  clientToWriteAbout,
  completeReport,
  householdOf,
  pageCount,
  qeegSteps,
  sent,
  visitAt,
  voidVisit,
} from './qeeg-signing-support';
import { progressBody, refusalsOnTrail, SEEDED, startHarness, type Harness } from './support';

/**
 * A follow-up begun from an earlier report (docs/SPEC/reports-qeeg.md
 * sections 10, 14 and 16 point 7; brief S): `GET /api/reports/qeeg/prefill`
 * brings the facts of a signed report or a kept past record forward, offers
 * her last choices beside them, counts the sessions completed from the
 * client's visits, refuses in the prefill's own order with `other_client`
 * first, writes nothing, and is on the trail as a read. The draft route then
 * counts a counted figure again on every save and keeps a typed one, and a
 * follow-up started this way saves, previews, signs, is corrected and is made
 * in the other language.
 *
 * Both languages are approved here by a test double, as the other signing
 * tests approve them: the practice's approval is not a test's to give.
 * Everything is invented: the seed's own people, bodies built from the
 * domain's fixtures, pictures made from arithmetic, visits on made-up days.
 */

const wording = vi.hoisted(() => ({ status: { en: 'approved', ar: 'approved' } }));
vi.mock('../../../domain/reports/qeeg/wording', async (importOriginal) => {
  const actual = await importOriginal<typeof Wording>();
  return { ...actual, WORDING_STATUS: wording.status };
});

const NOW = () => new Date('2026-09-30T08:00:00.000Z');
const SIGN_REASON = 'Signing the brain-map report';
const SAVE_REASON = 'Saving the brain-map draft';
/** The first report's day of recording (`fullReport`), and the follow-up's. */
const EARLIER_DAY = '2026-09-14';
const LATER_DAY = '2026-09-28';
const PAST_DAY = '2026-03-14';
const SHA = 'c'.repeat(64);

let h: Harness;
let clientId: string;
let clientIndex: number;
let steps: ReturnType<typeof qeegSteps>;
let household: string;
/** A signed first report of the client, with two maps, and its content as signed. */
let signed: { id: string; content: QeegInitial; maps: FigureRef[] };
/** A past record of the client, kept. */
let keptId: string;
/** Another client, and a signed-looking report of theirs. */
let otherClientId: string;
let otherReportId: string;
let signedNumber = 950;

function prefillPath(query: Record<string, string>): string {
  return `/api/reports/qeeg/prefill?${new URLSearchParams(query).toString()}`;
}

async function prefill(
  query: Record<string, string>,
  as: number = SEEDED.owner,
): Promise<Response> {
  return h.call('GET', prefillPath(query), as);
}

async function prefilled(query: Record<string, string>): Promise<QeegPrefillResponse> {
  const res = await prefill(query);
  if (res.status !== 200) throw new Error(`Refused: ${res.status} ${await res.text()}`);
  return (await res.json()) as QeegPrefillResponse;
}

async function countOf(sql: string, params: unknown[] = []): Promise<number> {
  const { rows } = await h.owner.query<{ n: string }>(sql, params);
  return Number(rows[0]?.n);
}

async function sign(draft: { id: string; savedAt: string }): Promise<Response> {
  return h.call(
    'POST',
    `/api/reports/${draft.id}/issue`,
    SEEDED.owner,
    { savedAt: draft.savedAt },
    { 'x-reason': SIGN_REASON },
  );
}

async function readBack(id: string): Promise<ReportResponse> {
  const res = await h.call('GET', `/api/reports/${id}`, SEEDED.owner);
  if (res.status !== 200) throw new Error(`Not read: ${res.status}`);
  return (await res.json()) as ReportResponse;
}

/** A report row written as the table owner, signed with the snapshots signing leaves. */
async function signedRow(client: string, content: object): Promise<string> {
  signedNumber += 1;
  const { rows } = await h.owner.query<{ id: string }>(
    'insert into report (tenant_id, client_id, kind, status, number, issued_on, signed_at, ' +
      'signed_by_practitioner_id, signed_by_name, signed_by_certification, recipient_name, ' +
      'recipient_record_number, practice_legal_name, content) values ' +
      "($1, $2, 'qeeg', 'issued', $3, current_date, now(), $4, 'Rowan Ridge', 'bcia_bcn', " +
      "'Cedar Meadow', 'MW-000001', 'Synthetic Studio', $5::jsonb) returning id",
    [
      h.data.tenant.id,
      client,
      signedNumber,
      h.practitionerIdOf(SEEDED.owner),
      JSON.stringify(content),
    ],
  );
  return rows[0]?.id ?? '';
}

/** A past record of `client`, kept, read from an old file with this digest. */
async function keptRecord(client: string, sha: string, content: object): Promise<string> {
  const { rows } = await h.owner.query<{ id: string }>(
    'insert into report (tenant_id, client_id, kind, content, imported_from, source_sha256) ' +
      "values ($1, $2, 'qeeg', $3::jsonb, 'qeeg.json/1', $4) returning id",
    [h.data.tenant.id, client, JSON.stringify(content), sha],
  );
  const id = rows[0]?.id ?? '';
  await h.owner.query("update report set status = 'imported' where id = $1", [id]);
  return id;
}

function pastContent(recordedOn: string | null): QeegInitial {
  const blank = blankInitial();
  return {
    ...blank,
    recording: { recordedOn, eyes: 'closed_and_open', handedness: 'left' },
    dashboard: { ...blank.dashboard, mental_energy: { score: 4, evidence: null } },
  };
}

/** A visit of the client's on `day`, checked in at nine in the practice's morning. */
async function visitOn(
  client: string,
  day: string,
  status: 'completed' | 'no_show' | 'voided' = 'completed',
  by: number = SEEDED.owner,
): Promise<void> {
  await visitAt(h, client, `${day}T09:00:00+04:00`, { status, by });
}

beforeAll(async () => {
  h = await startHarness(NOW);
  const client = clientToWriteAbout(h);
  clientId = client.id;
  clientIndex = client.index;
  steps = qeegSteps(h, clientId);
  household = await householdOf(h, clientId, 7);
  await h.onSchedule(clientIndex, SEEDED.practitioner);

  const draft = await steps.completeDraft(SEEDED.owner, { seed: 61 });
  const res = await sign(draft);
  if (res.status !== 201) throw new Error(`Not signed: ${res.status} ${await res.text()}`);
  signed = { id: draft.id, content: draft.content as QeegInitial, maps: draft.maps };

  keptId = await keptRecord(clientId, SHA, pastContent(PAST_DAY));

  const otherIndex = h.data.clients.findIndex(
    (c, at) => c.status === 'active' && at !== clientIndex,
  );
  otherClientId = h.clientId(otherIndex);
  otherReportId = await signedRow(otherClientId, pastContent(PAST_DAY));

  // The client's visits, and the ones that must not count.
  await visitOn(clientId, EARLIER_DAY); // the earlier recording's own day
  await visitOn(clientId, '2026-09-15');
  // A colleague's visit: row security would hide it from the practitioner who asks.
  await visitOn(clientId, '2026-09-16', 'completed', SEEDED.otherPractitioner);
  await visitOn(clientId, '2026-09-20');
  await visitOn(clientId, '2026-09-21', 'voided');
  await visitOn(clientId, '2026-09-23', 'no_show');
  await visitOn(clientId, '2026-09-27');
  await visitOn(clientId, LATER_DAY); // the new recording's own day
  await visitOn(clientId, '2026-09-29'); // after it
  await visitOn(otherClientId, '2026-09-22'); // another client's
}, 240_000);

afterAll(async () => {
  await h.close();
});

describe('a follow-up begun from an earlier report', () => {
  it('brings a signed report forward: its scores, its maps as the before side, what it is compared with and the handedness', async () => {
    const body = await prefilled({ clientId, from: signed.id, recordedOn: LATER_DAY });
    const checked = validateQeegContent(body.content);
    if (!checked.ok) throw new Error(JSON.stringify(checked.refusals));
    const content = checked.content as QeegFollowUp;
    expect(content.edition).toBe('follow-up');
    expect(content.comparedWith).toMatchObject({
      reportId: signed.id,
      recordedOn: EARLIER_DAY,
      relation: 'initial',
      origin: 'issued',
    });
    expect(content.comparedWith.reference).toMatch(/^RPT-/);
    expect(content.recording).toEqual({ recordedOn: LATER_DAY, eyes: null, handedness: 'right' });
    for (const d of DIMENSION_IDS) {
      expect(content.dashboard[d], d).toEqual({
        score: null,
        evidence: null,
        earlierScore: signed.content.dashboard[d].score,
      });
    }
    // `completeReport` places the first map eyes closed and the second eyes open.
    expect(content.change.pairs.eyes_closed).toEqual({ earlier: signed.maps[0], later: null });
    expect(content.change.pairs.eyes_open).toEqual({ earlier: signed.maps[1], later: null });
  });

  it('leaves every judgement empty, and offers what she chose last time beside it', async () => {
    const body = await prefilled({ clientId, from: signed.id });
    const content = body.content as QeegFollowUp;
    const blank = blankFollowUp(content.comparedWith, 'follow_up');
    expect(content.findings).toEqual(blank.findings);
    expect(content.focus).toEqual(blank.focus);
    expect(content.recommendations).toEqual(blank.recommendations);
    expect(content.benefits).toEqual(blank.benefits);
    expect(content.bands).toEqual(blank.bands);
    expect(content.connectivity).toEqual(blank.connectivity);
    expect(content.summary).toEqual(blank.summary);
    expect(content.plan).toEqual(blank.plan);
    // What a blank follow-up is missing, less the handedness, which is a fact brought forward.
    expect(missingForIssue(content)).toEqual(
      missingForIssue({
        ...blank,
        recording: { ...blank.recording, handedness: content.recording.handedness },
      }),
    );

    expect(isOffered(body.offered)).toBe(true);
    const offered = body.offered as { findings: { chosen: string[]; custom: object } };
    expect(offered.findings.chosen).toEqual(signed.content.findings.chosen);
    expect(Object.values(offered.findings.custom)).toHaveLength(1);
  });

  it('brings a kept past record forward, which has no reference', async () => {
    const body = await prefilled({ clientId, from: keptId, stage: 'final' });
    const content = body.content as QeegFollowUp;
    expect(content.stage).toBe('final');
    expect(content.comparedWith).toEqual({
      reportId: keptId,
      recordedOn: PAST_DAY,
      relation: 'initial',
      origin: 'imported',
      reference: null,
    });
    expect(content.recording.handedness).toBe('left');
    expect(content.dashboard.mental_energy.earlierScore).toBe(4);
    expect(content.change.pairs.eyes_open.earlier).toBeNull();
  });

  it('writes nothing', async () => {
    const reports = 'select count(*)::text as n from report where client_id = $1';
    const links = 'select count(*)::text as n from report_figure';
    const stamp = await h.owner.query<{ updated_at: string }>(
      'select updated_at::text as updated_at from report where id = $1',
      [signed.id],
    );
    const before = [await countOf(reports, [clientId]), await countOf(links)];
    await prefilled({ clientId, from: signed.id, recordedOn: LATER_DAY });
    await prefilled({ clientId, from: keptId });
    expect([await countOf(reports, [clientId]), await countOf(links)]).toEqual(before);
    const after = await h.owner.query<{ updated_at: string }>(
      'select updated_at::text as updated_at from report where id = $1',
      [signed.id],
    );
    expect(after.rows[0]?.updated_at).toBe(stamp.rows[0]?.updated_at);
  });

  it('is on the trail as a read of the earlier report and of the client', async () => {
    const reads = (type: string, id: string) =>
      countOf(
        "select count(*)::text as n from audit_log where action = 'read' and entity_type = $1 " +
          'and entity_id = $2 and client_id = $3 and actor_id = $4',
        [type, id, clientId, h.data.users[SEEDED.owner]?.id],
      );
    const before = [await reads('report', signed.id), await reads('client', clientId)];
    await prefilled({ clientId, from: signed.id });
    expect([await reads('report', signed.id), await reads('client', clientId)]).toEqual([
      (before[0] ?? 0) + 1,
      (before[1] ?? 0) + 1,
    ]);
  });
});

describe('who may ask', () => {
  it('refuses a household, and anyone who may not draft', async () => {
    const asHousehold = await h.callAs(
      'GET',
      prefillPath({ clientId, from: signed.id }),
      household,
    );
    expect(asHousehold.status).toBe(403);
    expect((await prefill({ clientId, from: signed.id }, SEEDED.admin)).status).toBe(403);
    // Each written to the trail before the answer, against the client.
    expect(await refusalsOnTrail(h.owner, 'report.prefill_refused', { clientId })).toEqual([
      'not_permitted',
      'not_permitted',
    ]);
  });

  it('answers a practitioner on the client’s schedule, and no one who cannot reach the client', async () => {
    expect((await prefill({ clientId, from: signed.id }, SEEDED.practitioner)).status).toBe(200);
    // A client off her schedule, asked of the database itself.
    const reachable = await h.asPerson(SEEDED.practitioner, async (db) => {
      const { rows } = await db.query<{ id: string; visible: boolean }>(
        "select id, app.client_visible_to_practitioner(id) as visible from client where status = 'active'",
      );
      return rows;
    });
    const stranger = reachable.find((row) => !row.visible && row.id !== clientId);
    if (!stranger) throw new Error('The practitioner reaches every client.');
    const theirs = await signedRow(stranger.id, pastContent(PAST_DAY));
    const res = await prefill({ clientId: stranger.id, from: theirs }, SEEDED.practitioner);
    expect(res.status).toBe(404);
  });

  it('refuses a query it does not know', async () => {
    const res = await prefill({ clientId, from: signed.id, content: 'x' });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('invalid_request');
    expect((await prefill({ clientId, from: 'not-an-id' })).status).toBe(400);
  });
});

describe('each refusal, by its own code and sentence', () => {
  async function refusal(query: Record<string, string>, as: number = SEEDED.owner) {
    const res = await prefill(query, as);
    const body = (await res.json()) as { code: string; sentence: string };
    return { status: res.status, code: body.code, sentence: body.sentence };
  }

  it('says another client’s report is another client’s before anything else about it', async () => {
    // A draft of another client's, whose record is also erased: the only thing
    // said is whose it is.
    const theirs = await h.owner.query<{ id: string }>(
      "insert into report (tenant_id, client_id, kind, content) values ($1, $2, 'qeeg', $3::jsonb) " +
        'returning id',
      [h.data.tenant.id, otherClientId, JSON.stringify(blankInitial())],
    );
    const theirDraft = theirs.rows[0]?.id ?? '';
    const reads = () =>
      countOf(
        "select count(*)::text as n from audit_log where action = 'read' and entity_id = any($1)",
        [[otherReportId, theirDraft]],
      );
    const readsBefore = await reads();
    for (const from of [otherReportId, theirDraft]) {
      expect(await refusal({ clientId, from }), from).toEqual({
        status: 422,
        code: 'other_client',
        sentence: PREFILL_SENTENCES.other_client,
      });
    }
    // Nothing of the other client's report was read into this answer.
    expect(await reads()).toBe(readsBefore);
  });

  it('answers a report that cannot be seen as none', async () => {
    const res = await prefill({ clientId, from: '0000000e-0000-4000-8000-000000000001' });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('no_such_report');
  });

  it('refuses a report that is not a brain map', async () => {
    const res = await h.call(
      'POST',
      '/api/reports/draft',
      SEEDED.owner,
      {
        clientId,
        kind: 'progress',
        locale: 'en',
        coverageFrom: '2026-06-01',
        coverageTo: '2026-09-01',
        content: progressBody(),
      },
      { 'x-reason': SAVE_REASON },
    );
    const progressId = ((await res.json()) as { report: { id: string } }).report.id;
    expect((await refusal({ clientId, from: progressId })).code).toBe('not_a_brain_map');
  });

  it('refuses the draft being filled, before saying it is a draft', async () => {
    const draft = await steps.newDraft(SEEDED.owner);
    expect((await refusal({ clientId, from: draft.id, draftId: draft.id })).code).toBe(
      'same_report',
    );
    expect((await refusal({ clientId, from: draft.id })).code).toBe('draft');
  });

  it('refuses a report replaced by a newer version, a withdrawn past record and an undated one', async () => {
    const superseded = await signedRow(clientId, pastContent(PAST_DAY));
    await h.owner.query("update report set status = 'superseded' where id = $1", [superseded]);
    const withdrawn = await keptRecord(clientId, 'd'.repeat(64), pastContent(PAST_DAY));
    await h.owner.query(
      "update report set withdrawn_at = now(), withdraw_reason = 'Kept against the wrong client', " +
        "content = '{}'::jsonb where id = $1",
      [withdrawn],
    );
    const undated = await keptRecord(clientId, 'e'.repeat(64), pastContent(null));
    for (const [from, code] of [
      [superseded, 'superseded'],
      [withdrawn, 'withdrawn'],
      [undated, 'undated'],
    ] as const) {
      expect(await refusal({ clientId, from }), code).toEqual({
        status: 422,
        code,
        sentence: PREFILL_SENTENCES[code],
      });
    }
  });

  it('refuses a day that is no day, and an earlier report recorded after the new recording', async () => {
    expect((await refusal({ clientId, from: signed.id, recordedOn: '2026-02-30' })).code).toBe(
      'no_such_day',
    );
    expect((await refusal({ clientId, from: signed.id, recordedOn: '2026-09-01' })).code).toBe(
      'recorded_later',
    );
    // The same day is allowed.
    expect((await prefill({ clientId, from: signed.id, recordedOn: EARLIER_DAY })).status).toBe(
      200,
    );
  });

  it('refuses a client whose record has been erased, after saying whose a report is', async () => {
    const index = h.data.clients.findIndex(
      (c, at) => c.status === 'active' && at !== clientIndex && h.clientId(at) !== otherClientId,
    );
    const erasedId = h.clientId(index);
    const theirs = await keptRecord(erasedId, 'f'.repeat(64), pastContent(PAST_DAY));
    await h.owner.query("update client set status = 'erased' where id = $1", [erasedId]);
    expect((await refusal({ clientId: erasedId, from: theirs })).code).toBe('erased');
    expect((await refusal({ clientId: erasedId, from: signed.id })).code).toBe('other_client');
  });
});

describe('the sessions completed, counted from the visits', () => {
  it('counts the completed visits between the two recording days, leaving out voided ones and another client’s', async () => {
    const body = await prefilled({ clientId, from: signed.id, recordedOn: LATER_DAY });
    // The 15th, the colleague's 16th, the 20th and the 27th: not the two recording days, the voided
    // visit, the no-show, the day after, or another client's.
    expect(body.sessions).toEqual({
      count: 4,
      after: EARLIER_DAY,
      before: LATER_DAY,
      through: null,
    });
    expect((body.content as QeegFollowUp).change.sessionsCompleted).toEqual({
      count: 4,
      source: 'gathered',
    });
  });

  it('gives a practitioner on the client’s schedule the owner’s count, a colleague’s visit included', async () => {
    const asked = prefillPath({ clientId, from: signed.id, recordedOn: LATER_DAY });
    const asOwner = (await (
      await h.call('GET', asked, SEEDED.owner)
    ).json()) as QeegPrefillResponse;
    const res = await h.call('GET', asked, SEEDED.practitioner);
    expect(res.status).toBe(200);
    const asPractitioner = (await res.json()) as QeegPrefillResponse;
    expect(asPractitioner.sessions.count).toBe(4);
    expect(asPractitioner.sessions).toEqual(asOwner.sessions);

    // And her save prints the owner's count.
    const saved = await h.call(
      'POST',
      '/api/reports/draft',
      SEEDED.practitioner,
      {
        clientId,
        kind: 'qeeg',
        locale: 'en',
        content: {
          ...sent(asPractitioner.content as QeegFollowUp),
          comparedWith: { reportId: signed.id },
        },
      },
      { 'x-reason': SAVE_REASON },
    );
    expect(saved.status).toBe(201);
    const body = (await saved.json()) as QeegDraftResponse;
    expect((body.content as QeegFollowUp).change.sessionsCompleted).toEqual({
      count: 4,
      source: 'gathered',
    });
  });

  it('counts through today while the new recording has no day', async () => {
    const body = await prefilled({ clientId, from: signed.id });
    expect(body.sessions).toEqual({
      count: 6,
      after: EARLIER_DAY,
      before: null,
      through: '2026-09-30',
    });
  });

  it('gives no figure when no visit falls between the two', async () => {
    const body = await prefilled({ clientId, from: signed.id, recordedOn: '2026-09-15' });
    expect(body.sessions.count).toBe(0);
    expect((body.content as QeegFollowUp).change.sessionsCompleted).toBeNull();
  });
});

describe('the draft route counts a counted figure again, and keeps a typed one', () => {
  async function saveFollowUp(sessionsCompleted: unknown): Promise<QeegFollowUp> {
    const start = await prefilled({ clientId, from: signed.id, recordedOn: LATER_DAY });
    const content = start.content as QeegFollowUp;
    const res = await steps.saveAs(SEEDED.owner, {
      locale: 'en',
      content: {
        ...sent(content),
        comparedWith: { reportId: signed.id },
        change: { ...content.change, sessionsCompleted },
      },
    });
    if (res.status !== 201) throw new Error(`Refused: ${res.status} ${await res.text()}`);
    return ((await res.json()) as QeegDraftResponse).content as QeegFollowUp;
  }

  it('works out a counted figure afresh, whatever count the request carried', async () => {
    const saved = await saveFollowUp({ count: 99, source: 'gathered' });
    expect(saved.change.sessionsCompleted).toEqual({ count: 4, source: 'gathered' });
  });

  it('keeps a typed figure as typed', async () => {
    const saved = await saveFollowUp({ count: 30, source: 'typed' });
    expect(saved.change.sessionsCompleted).toEqual({ count: 30, source: 'typed' });
  });

  it('counts again when the day of the new recording changes', async () => {
    const start = await prefilled({ clientId, from: signed.id });
    const content = start.content as QeegFollowUp;
    const created = await steps.saveAs(SEEDED.owner, {
      locale: 'en',
      content: { ...sent(content), comparedWith: { reportId: signed.id } },
    });
    const first = (await created.json()) as QeegDraftResponse;
    expect((first.content as QeegFollowUp).change.sessionsCompleted?.count).toBe(6);
    const later = await steps.saveOver(
      { id: first.report.id, savedAt: first.savedAt },
      {
        ...(first.content as QeegFollowUp),
        comparedWith: { reportId: signed.id },
        recording: { ...content.recording, recordedOn: LATER_DAY },
      },
      SEEDED.owner,
    );
    expect(later.status).toBe(200);
    const body = (await later.json()) as QeegDraftResponse;
    expect((body.content as QeegFollowUp).change.sessionsCompleted?.count).toBe(4);
  });
});

/** A follow-up begun from the prefill, her judgements typed in, its own maps uploaded, saved. */
async function completedFollowUp(seeds: number[]) {
  const start = await prefilled({ clientId, from: signed.id, recordedOn: LATER_DAY });
  const begun = start.content as QeegFollowUp;
  const created = await steps.saveAs(SEEDED.owner, {
    locale: 'en',
    content: { ...sent(begun), comparedWith: { reportId: signed.id } },
  });
  if (created.status !== 201) throw new Error(`Refused: ${created.status}`);
  const draft = (await created.json()) as QeegDraftResponse;
  let savedAt = draft.savedAt;
  const own: FigureRef[] = [];
  for (const seed of seeds) {
    const filed = await steps.upload(draft.report.id, SEEDED.owner, seed);
    own.push(filed.ref);
    savedAt = filed.savedAt;
  }
  const [mapA, mapB, laterClosed, laterOpen] = own;
  if (!mapA || !mapB || !laterClosed || !laterOpen) throw new Error('Uploads went missing.');
  // Her judgements, typed now: the full follow-up's, over what the prefill began.
  const full = fullFollowUp();
  const content = {
    ...sent(begun),
    comparedWith: { reportId: signed.id },
    recording: { ...begun.recording, eyes: 'closed_and_open' },
    findings: full.findings,
    focus: full.focus,
    recommendations: full.recommendations,
    benefits: full.benefits,
    summary: full.summary,
    bands: full.bands,
    connectivity: full.connectivity,
    plan: full.plan,
    maps: completeReport([mapA, mapB]).maps,
    dashboard: Object.fromEntries(
      DIMENSION_IDS.map((d) => [d, { ...begun.dashboard[d], score: 6 }]),
    ),
    change: {
      ...begun.change,
      tiles: full.change.tiles,
      table: full.change.table,
      summary: full.change.summary,
      pairs: {
        eyes_closed: { ...begun.change.pairs.eyes_closed, later: laterClosed },
        eyes_open: { ...begun.change.pairs.eyes_open, later: laterOpen },
      },
    },
  };
  const saved = await steps.saveAs(SEEDED.owner, { id: draft.report.id, savedAt, content });
  if (saved.status !== 200) throw new Error(`Refused: ${saved.status} ${await saved.text()}`);
  const body = (await saved.json()) as QeegDraftResponse;
  const savedContent = body.content as QeegFollowUp;
  return { id: draft.report.id, body, savedContent };
}

describe('a follow-up started from the prefill, to its signature and beyond', () => {
  let followUpId: string;
  let followUpContent: QeegFollowUp;

  it('saves, previews and signs', async () => {
    const { id, body, savedContent } = await completedFollowUp([71, 72, 73, 74]);
    const draft = { report: { id } };
    expect(missingForIssue(savedContent)).toEqual([]);
    expect(savedContent.change.sessionsCompleted).toEqual({ count: 4, source: 'gathered' });

    const preview = await h.call(
      'GET',
      `/api/reports/${draft.report.id}/preview?locale=en`,
      SEEDED.owner,
      undefined,
      { 'x-reason': 'Previewing the brain-map report' },
    );
    expect(preview.status).toBe(200);
    expect(pageCount(new Uint8Array(await preview.arrayBuffer()))).toBeGreaterThan(1);

    const issued = await sign({ id: draft.report.id, savedAt: body.savedAt });
    expect(issued.status).toBe(201);
    followUpId = draft.report.id;
    followUpContent = savedContent;
  });

  it('is corrected with its comparison and its counted sessions kept as they were', async () => {
    expect(followUpId).toBeDefined();
    const res = await h.call(
      'POST',
      `/api/reports/${followUpId}/supersede`,
      SEEDED.owner,
      { reason: 'Correcting a finding' },
      { 'x-reason': 'Correcting a finding' },
    );
    expect(res.status).toBe(201);
    const correction = (await res.json()) as { report: { id: string } };
    const read = await readBack(correction.report.id);
    const content = read.content as QeegFollowUp;
    expect(content.comparedWith).toEqual(followUpContent.comparedWith);
    expect(content.change.sessionsCompleted).toEqual({ count: 4, source: 'gathered' });
  });

  it('keeps a typed count through a correction', async () => {
    const start = await prefilled({ clientId, from: keptId, recordedOn: LATER_DAY });
    const begun = start.content as QeegFollowUp;
    const created = await steps.saveAs(SEEDED.owner, {
      locale: 'en',
      content: {
        ...sent(begun),
        comparedWith: { reportId: keptId },
        change: { ...begun.change, sessionsCompleted: { count: 24, source: 'typed' } },
      },
    });
    expect(created.status).toBe(201);
    const draft = (await created.json()) as QeegDraftResponse;
    // Signed as the table owner: a correction reads only what was signed.
    signedNumber += 1;
    await h.owner.query(
      "update report set status = 'issued', number = $2, issued_on = current_date, " +
        "signed_at = now(), signed_by_practitioner_id = $3, signed_by_name = 'Rowan Ridge', " +
        "signed_by_certification = 'bcia_bcn', recipient_name = 'Cedar Meadow', " +
        "recipient_record_number = 'MW-000001', practice_legal_name = 'Synthetic Studio' " +
        'where id = $1',
      [draft.report.id, signedNumber, h.practitionerIdOf(SEEDED.owner)],
    );
    const res = await h.call(
      'POST',
      `/api/reports/${draft.report.id}/supersede`,
      SEEDED.owner,
      { reason: 'Correcting a finding' },
      { 'x-reason': 'Correcting a finding' },
    );
    expect(res.status).toBe(201);
    const correction = (await res.json()) as { report: { id: string } };
    const content = (await readBack(correction.report.id)).content as QeegFollowUp;
    expect(content.comparedWith.reportId).toBe(keptId);
    expect(content.change.sessionsCompleted).toEqual({ count: 24, source: 'typed' });
  });

  it('is made in the other language, which saves with its counted figure as the first has it', async () => {
    const res = await h.call(
      'POST',
      `/api/reports/${followUpId}/twin`,
      SEEDED.owner,
      {},
      { 'x-reason': 'Starting the Arabic report from the signed one' },
    );
    // The signed follow-up was corrected above, so its twin is refused as superseded;
    // the correction, once signed, is what a twin is made from.
    expect(res.status).toBe(422);

    const list = await h.owner.query<{ id: string }>(
      'select id from report where supersedes_id = $1',
      [followUpId],
    );
    const correctionId = list.rows[0]?.id ?? '';
    const read = await readBack(correctionId);
    const signedCorrection = await sign({ id: correctionId, savedAt: read.savedAt ?? '' });
    expect(signedCorrection.status).toBe(201);

    const twin = await h.call(
      'POST',
      `/api/reports/${correctionId}/twin`,
      SEEDED.owner,
      {},
      { 'x-reason': 'Starting the Arabic report from the signed one' },
    );
    expect(twin.status).toBe(201);
    const twinId = ((await twin.json()) as TwinResponse).report.id;
    const twinRead = await readBack(twinId);
    const twinContent = twinRead.content as QeegContent;
    const saved = await steps.saveOver(
      { id: twinId, savedAt: twinRead.savedAt ?? '' },
      {
        ...(twinContent as QeegFollowUp),
        comparedWith: { reportId: (twinContent as QeegFollowUp).comparedWith.reportId },
      },
      SEEDED.owner,
    );
    expect(saved.status).toBe(200);
    const body = (await saved.json()) as QeegDraftResponse;
    expect((body.content as QeegFollowUp).change.sessionsCompleted).toEqual({
      count: 4,
      source: 'gathered',
    });
  });
});

describe('signing counts a counted figure again', () => {
  it('signs the count as it stands, not as the last save left it', async () => {
    // A visit logged from the records, inside the window, counted at the save…
    const logged = await visitAt(h, clientId, '2026-09-25T09:00:00+04:00', { fromRecords: true });
    const { id, body, savedContent } = await completedFollowUp([81, 82, 83, 84]);
    expect(savedContent.change.sessionsCompleted).toEqual({ count: 5, source: 'gathered' });
    // …and voided before the signature.
    await voidVisit(h, logged);
    const issued = await sign({ id, savedAt: body.savedAt });
    expect(issued.status).toBe(201);
    const content = (await readBack(id)).content as QeegFollowUp;
    expect(content.change.sessionsCompleted).toEqual({ count: 4, source: 'gathered' });
  });

  it('signs a typed count as she typed it', async () => {
    const { id } = await completedFollowUp([85, 86, 87, 88]);
    const read = await readBack(id);
    const typed = await steps.saveOver(
      { id, savedAt: read.savedAt ?? '' },
      {
        ...(read.content as QeegFollowUp),
        comparedWith: { reportId: signed.id },
        change: {
          ...(read.content as QeegFollowUp).change,
          sessionsCompleted: { count: 12, source: 'typed' },
        },
      },
      SEEDED.owner,
    );
    const saved = (await typed.json()) as QeegDraftResponse;
    expect((await sign({ id, savedAt: saved.savedAt })).status).toBe(201);
    const content = (await readBack(id)).content as QeegFollowUp;
    expect(content.change.sessionsCompleted).toEqual({ count: 12, source: 'typed' });
  });
});
