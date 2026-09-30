import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type {
  IssueResponse,
  QeegDraftResponse,
  ReportResponse,
  SupersedeResponse,
} from '../../../app/api/reports/schema';
import { blankFollowUp } from '../../../domain/reports/qeeg/blank';
import type { ComparedWith, QeegContent } from '../../../domain/reports/qeeg/types';
import type * as Wording from '../../../domain/reports/qeeg/wording';
import { clientToWriteAbout, qeegSteps, sent } from './qeeg-signing-support';
import { SEEDED, startHarness, type Harness } from './support';

/**
 * Correcting a signed brain-map report (docs/SPEC/reports-qeeg.md section 14;
 * brief P): `POST /api/reports/:id/supersede` makes a new draft that carries
 * the report's content, what it is compared with, its twin in the other
 * language, and BORROWS its maps, so the draft's first save names only
 * pictures it holds. The signed report stays exactly as it was (rule 7).
 *
 * English is approved here by a test double, as in `qeeg_issue.test.ts`: the
 * practice's approval is not a test's to give.
 */

const wording = vi.hoisted(() => ({ status: { en: 'approved', ar: 'draft' } }));
vi.mock('../../../domain/reports/qeeg/wording', async (importOriginal) => {
  const actual = await importOriginal<typeof Wording>();
  return { ...actual, WORDING_STATUS: wording.status };
});

const NOW = () => new Date('2026-09-30T08:00:00.000Z');
const CORRECTION = 'The recording date was typed a day late.';

let h: Harness;
let clientId: string;
let steps: ReturnType<typeof qeegSteps>;
let signedNumber = 800;

async function signed(seed: number): Promise<{ id: string; content: QeegContent; maps: string[] }> {
  const draft = await steps.completeDraft(SEEDED.owner, { seed });
  const res = await h.call(
    'POST',
    `/api/reports/${draft.id}/issue`,
    SEEDED.owner,
    { savedAt: draft.savedAt },
    { 'x-reason': 'Signing the brain-map report' },
  );
  if (res.status !== 201) throw new Error(`Refused: ${res.status} ${await res.text()}`);
  (await res.json()) as IssueResponse;
  const { rows } = await h.owner.query<{ content: QeegContent }>(
    'select content from report where id = $1',
    [draft.id],
  );
  return {
    id: draft.id,
    content: rows[0]?.content ?? draft.content,
    maps: draft.maps.map((map) => map.figureId),
  };
}

async function supersede(
  id: string,
  body: Record<string, unknown> = {},
  as: number = SEEDED.owner,
) {
  return h.call('POST', `/api/reports/${id}/supersede`, as, { reason: CORRECTION, ...body });
}

async function links(reportId: string) {
  const { rows } = await h.owner.query<{
    document_id: string;
    borrowed_from_report_id: string | null;
  }>(
    'select document_id, borrowed_from_report_id from report_figure where report_id = $1 ' +
      'order by document_id',
    [reportId],
  );
  return rows;
}

/** The reasons the trail gives for each refused correction of a report. */
async function refusedFor(reportId: string): Promise<string[]> {
  const { rows } = await h.owner.query<{ reason: string }>(
    "select new_values->>'reason' as reason from audit_log where action = 'report.supersede_refused' " +
      'and entity_id = $1',
    [reportId],
  );
  return rows.map((row) => row.reason);
}

/** Signs a draft as the table owner, with the snapshots signing leaves on a row. */
async function signAsOwner(reportId: string): Promise<void> {
  signedNumber += 1;
  await h.owner.query(
    "update report set status = 'issued', number = $2, issued_on = current_date, " +
      "signed_at = now(), signed_by_practitioner_id = $3, signed_by_name = 'Rowan Ridge', " +
      "signed_by_certification = 'bcia_bcn', recipient_name = 'Cedar Meadow', " +
      "recipient_record_number = 'MW-000001', practice_legal_name = 'Synthetic Studio' " +
      'where id = $1',
    [reportId, signedNumber, h.practitionerIdOf(SEEDED.owner)],
  );
}

beforeAll(async () => {
  h = await startHarness(NOW);
  clientId = clientToWriteAbout(h).id;
  steps = qeegSteps(h, clientId);
}, 180_000);

afterAll(async () => {
  await h.close();
});

describe('a signed first report, corrected', () => {
  let standing: Awaited<ReturnType<typeof signed>>;
  let answer: SupersedeResponse;
  let before: Record<string, unknown>;

  beforeAll(async () => {
    standing = await signed(1);
    const { rows } = await h.owner.query<Record<string, unknown>>(
      'select content, document_id, reference, signed_by_name from report where id = $1',
      [standing.id],
    );
    before = rows[0] ?? {};
    const res = await supersede(standing.id);
    if (res.status !== 201) throw new Error(`Refused: ${res.status} ${await res.text()}`);
    answer = (await res.json()) as SupersedeResponse;
  }, 60_000);

  it('makes a new draft, the next version, carrying the content and the reason', async () => {
    expect(answer.report).toMatchObject({
      kind: 'qeeg',
      status: 'draft',
      locale: 'en',
      version: 2,
      supersedesId: standing.id,
      amendmentReason: CORRECTION,
      reference: null,
    });
    const { rows } = await h.owner.query<{
      content: QeegContent;
      compared_with_id: string | null;
      twin_of_id: string | null;
    }>('select content, compared_with_id, twin_of_id from report where id = $1', [
      answer.report.id,
    ]);
    expect(rows[0]?.content).toEqual(standing.content);
    expect(rows[0]?.compared_with_id).toBeNull();
    expect(rows[0]?.twin_of_id).toBeNull();
  });

  it('leaves the signed report exactly as it was, but for being superseded', async () => {
    const { rows } = await h.owner.query<Record<string, unknown>>(
      'select status::text as status, content, document_id, reference, signed_by_name ' +
        'from report where id = $1',
      [standing.id],
    );
    expect(rows[0]).toEqual({ ...before, status: 'superseded' });
  });

  it('borrows the signed report’s maps, rather than copying them', async () => {
    expect(await links(answer.report.id)).toEqual(
      [...standing.maps]
        .sort()
        .map((id) => ({ document_id: id, borrowed_from_report_id: standing.id })),
    );
    const { rows } = await h.owner.query<{ n: string }>(
      "select count(*)::text as n from document where kind = 'report_figure' and id = any($1::uuid[])",
      [standing.maps],
    );
    expect(Number(rows[0]?.n)).toBe(standing.maps.length);
  });

  it('saves on its first save without being refused for a map it does not hold', async () => {
    const read = await h.call('GET', `/api/reports/${answer.report.id}`, SEEDED.owner);
    const draft = (await read.json()) as ReportResponse;
    const res = await steps.saveOver(
      { id: answer.report.id, savedAt: draft.savedAt ?? '' },
      standing.content,
      SEEDED.owner,
    );
    expect(res.status).toBe(200);
    const saved = (await res.json()) as QeegDraftResponse;
    // And it signs, as the next version, through the ordinary door.
    const issued = await h.call(
      'POST',
      `/api/reports/${answer.report.id}/issue`,
      SEEDED.owner,
      { savedAt: saved.savedAt },
      { 'x-reason': 'Signing the corrected brain-map report' },
    );
    expect(issued.status).toBe(201);
    expect(((await issued.json()) as IssueResponse).report.version).toBe(2);
  });

  it('cannot be corrected twice: the chain does not fork', async () => {
    const res = await supersede(standing.id);
    expect(res.status).toBe(422);
  });
});

describe('what a correction carries, and what it refuses', () => {
  it('carries what a follow-up is compared with, and its before-and-after maps', async () => {
    const first = await signed(2);
    const placeholder: ComparedWith = {
      reportId: first.id,
      recordedOn: '2026-09-14',
      relation: 'initial',
      origin: 'issued',
      reference: 'RPT-000000',
    };
    const res = await steps.saveAs(SEEDED.owner, {
      locale: 'en',
      content: {
        ...sent(blankFollowUp(placeholder, 'follow_up')),
        comparedWith: { reportId: first.id },
      },
    });
    expect(res.status).toBe(201);
    const followUp = (await res.json()) as QeegDraftResponse;
    await signAsOwner(followUp.report.id);

    const corrected = await supersede(followUp.report.id);
    expect(corrected.status).toBe(201);
    const next = (await corrected.json()) as SupersedeResponse;
    const { rows } = await h.owner.query<{ compared_with_id: string | null }>(
      'select compared_with_id from report where id = $1',
      [next.report.id],
    );
    expect(rows[0]?.compared_with_id).toBe(first.id);
    const earlier = (
      followUp.content as {
        change: { pairs: Record<string, { earlier: { figureId: string } | null }> };
      }
    ).change.pairs;
    const named = Object.values(earlier)
      .map((pair) => pair.earlier?.figureId)
      .filter((id): id is string => id !== undefined);
    expect(named.length).toBeGreaterThan(0);
    expect((await links(next.report.id)).map((link) => link.document_id)).toEqual(
      expect.arrayContaining(named),
    );

    // Its first save borrows nothing it does not already hold, and is not refused.
    const read = await h.call('GET', `/api/reports/${next.report.id}`, SEEDED.owner);
    const draft = (await read.json()) as ReportResponse;
    const save = await steps.saveAs(SEEDED.owner, {
      id: next.report.id,
      savedAt: draft.savedAt,
      content: { ...sent(draft.content as object), comparedWith: { reportId: first.id } },
    });
    expect(save.status).toBe(200);
  });

  it('carries its twin in the other language', async () => {
    const first = await signed(3);
    const { rows } = await h.owner.query<{ id: string }>(
      'insert into report (tenant_id, client_id, kind, locale, content, twin_of_id) values ' +
        "($1, $2, 'qeeg', 'ar', $3::jsonb, $4) returning id",
      [h.data.tenant.id, clientId, JSON.stringify(first.content), first.id],
    );
    const twin = rows[0]?.id ?? '';
    // The twin prints the first report's maps, borrowed while it is a draft
    // (docs/SPEC/reports-qeeg.md section 8, point 2).
    await h.owner.query(
      'insert into report_figure (tenant_id, client_id, report_id, document_id, ' +
        'borrowed_from_report_id, sha256, width_px, height_px) ' +
        'select tenant_id, client_id, $1, document_id, report_id, sha256, width_px, height_px ' +
        'from report_figure where report_id = $2',
      [twin, first.id],
    );
    await signAsOwner(twin);
    const res = await supersede(twin);
    expect(res.status).toBe(201);
    const next = (await res.json()) as SupersedeResponse;
    expect(next.report.locale).toBe('ar');
    const found = await h.owner.query<{ twin_of_id: string | null }>(
      'select twin_of_id from report where id = $1',
      [next.report.id],
    );
    expect(found.rows[0]?.twin_of_id).toBe(first.id);
  });

  it('refuses a body that sends the content: a correction starts from what was signed', async () => {
    const standing = await signed(4);
    const res = await supersede(standing.id, { content: standing.content });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'route_owned', field: 'content' });
    expect(await refusedFor(standing.id)).toContain('route_owned');
  });

  it('refuses another language: each language is its own report', async () => {
    const standing = await signed(5);
    const res = await supersede(standing.id, { locale: 'ar' });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: 'locale_fixed' });
    expect(await refusedFor(standing.id)).toContain('locale_fixed');
  });

  it('refuses a practitioner: a signed version is replaced by the owner or the lead', async () => {
    const standing = await signed(6);
    const res = await supersede(standing.id, {}, SEEDED.practitioner);
    expect([403, 404]).toContain(res.status);
    const { rows } = await h.owner.query<{ status: string }>(
      'select status::text as status from report where id = $1',
      [standing.id],
    );
    expect(rows[0]?.status).toBe('issued');
  });

  it('refuses, by the field, a signed report that names a map it does not hold', async () => {
    const first = await signed(7);
    // Written by hand: signing refuses a map not held, so no route makes this row.
    const { rows } = await h.owner.query<{ id: string }>(
      "insert into report (tenant_id, client_id, kind, content) values ($1, $2, 'qeeg', $3::jsonb) " +
        'returning id',
      [h.data.tenant.id, clientId, JSON.stringify(first.content)],
    );
    const bare = rows[0]?.id ?? '';
    await signAsOwner(bare);
    const res = await supersede(bare);
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({
      code: 'map_not_held',
      field: 'maps.map-0.figureId',
    });
    const left = await h.owner.query<{ status: string }>(
      'select status::text as status from report where id = $1',
      [bare],
    );
    expect(left.rows[0]?.status).toBe('issued');
  });

  it('refuses a draft, which is corrected by saving it', async () => {
    const draft = await steps.newDraft(SEEDED.owner);
    const res = await supersede(draft.id);
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: 'not_issued' });
  });
});
