import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PortalReportsResponse } from '../../../app/api/portal/schema';
import type {
  DraftResponse,
  QeegDraftResponse,
  ReportListResponse,
  ReportResponse,
} from '../../../app/api/reports/schema';
import type * as Source from '../../../app/api/reports/source';
import { ageOn } from '../../../domain/shared/dates';
import { MEASURE_IDS } from '../../../domain/reports/qeeg/catalogue/ids';
import { blankFollowUp, blankInitial } from '../../../domain/reports/qeeg/blank';
import type { ComparedWith, QeegInitial } from '../../../domain/reports/qeeg/types';
import { linkFigureAsOwner } from './figures-support';
import { progressBody, sessionBody, SEEDED, startHarness, type Harness } from './support';

/**
 * Saving a brain-map (qEEG) draft, and reading it back (docs/SPEC/
 * reports-qeeg.md sections 4 and 14; brief L).
 *
 * `POST /api/reports/draft` takes a `qeeg` draft beside the two older kinds.
 * What the practitioner typed is held to the shape and refused by name; the
 * client's name, age and sex are gathered from the record on every save and
 * never taken from the request; what a follow-up is compared with is read from
 * the earlier report itself; a request that carries any part the server owns is
 * refused; a save made over a newer one is refused; and every save carries a
 * reason, which the audit trail records with the row.
 *
 * Everything here is synthetic: the seed's own invented people, and bodies
 * built from the domain's blanks.
 */

/**
 * A step run once, right after the route reads a given report: the moment a
 * race between two people happens. Null for every test but the two races.
 *
 * It runs on the request's own connection. Another person's commit cannot be
 * made from a second connection while the request waits here: the request
 * already holds the audit chain (every read it logged), and the other
 * connection's audit row would wait for it for ever. A change made inside the
 * request before its write is, to that write, exactly a change committed by
 * someone else a moment before.
 */
type Query = (text: string, params?: unknown[]) => Promise<unknown>;
const race = vi.hoisted(() => ({
  after: null as null | { id: string; run: (query: Query) => Promise<void> },
}));

vi.mock('../../../app/api/reports/source', async (importOriginal) => {
  const actual = await importOriginal<typeof Source>();
  return {
    ...actual,
    readReport: async (db: Parameters<typeof actual.readReport>[0], id: string) => {
      const found = await actual.readReport(db, id);
      const step = race.after;
      if (step !== null && step.id === id) {
        race.after = null;
        await step.run((text, params) => db.query(text, params));
      }
      return found;
    },
  };
});

const NOW = () => new Date('2026-09-30T08:00:00.000Z');
const REASON = 'Saving the brain-map draft';
const WITH_REASON = { 'x-reason': REASON };

const EARLIER_DAY = '2026-03-14';
const ISSUED_NUMBER = 901;
const SHA = 'c'.repeat(64);
/** The earlier report's one map, a document linked to it (migration 604). */
const EARLIER_MAP = '0000000d-0000-4000-8000-000000000091';

let h: Harness;
/** The client every save below is about: one with an Arabic name, a birth date and a sex on file. */
let clientIndex: number;
let clientId: string;
/** Another client of the practice, on nobody's schedule. */
let strangerId: string;
/** A signed first report of `clientId`, and a past record of theirs brought in from the old tool. */
let issuedId: string;
let importedId: string;
let household: { authId: string };

/** A body with the parts the server writes taken out, as the editor sends it. */
function withoutServerParts(content: object): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(structuredClone(content)).filter(
      ([key]) => key !== 'subject' && key !== 'provenance',
    ),
  );
}

/** A body as the editor sends it: no client, no source. */
function sentInitial(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...withoutServerParts(blankInitial()), ...over };
}

/** A follow-up as the editor sends it: what it is compared with, by id alone. */
function sentFollowUp(
  reportId: string,
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  const placeholder: ComparedWith = {
    reportId,
    recordedOn: EARLIER_DAY,
    relation: 'initial',
    origin: 'issued',
    reference: 'RPT-000000',
  };
  return {
    ...withoutServerParts(blankFollowUp(placeholder, 'follow_up')),
    comparedWith: { reportId },
    ...over,
  };
}

async function save(
  body: Record<string, unknown>,
  as: number = SEEDED.practitioner,
  headers: Record<string, string> = WITH_REASON,
): Promise<Response> {
  return h.call('POST', '/api/reports/draft', as, body, headers);
}

async function created(content: Record<string, unknown>, as?: number) {
  const res = await save({ clientId, kind: 'qeeg', locale: 'en', content }, as);
  if (res.status !== 201) throw new Error(`Refused: ${res.status} ${await res.text()}`);
  return (await res.json()) as QeegDraftResponse;
}

async function reportCount(): Promise<number> {
  const { rows } = await h.owner.query<{ n: string }>(
    "select count(*)::text as n from report where kind = 'qeeg'",
  );
  return Number(rows[0]?.n);
}

/** The subject the record says today, as the report's head should print it. */
function subjectOnRecord(day: string) {
  const person = h.data.clients[clientIndex];
  if (!person) throw new Error('The seed is not what it was.');
  const parts = [person.givenNameAr, person.familyNameAr].filter(
    (part): part is string => part !== null && part.trim().length > 0,
  );
  return {
    nameAr: parts.length === 0 ? null : parts.join(' '),
    ageYears: ageOn(person.dateOfBirth, day),
    sex: person.sexAtBirth === 'unknown' ? null : person.sexAtBirth,
  };
}

/** An earlier first report's body: a real day, a score, a map. */
function earlierContent(): QeegInitial {
  const blank = blankInitial();
  return {
    ...blank,
    recording: { recordedOn: EARLIER_DAY, eyes: 'closed_and_open', handedness: 'right' },
    dashboard: { ...blank.dashboard, mental_energy: { score: 7, evidence: null } },
    maps: {
      'map-0': {
        figureId: EARLIER_MAP,
        sha256: SHA,
        widthPx: 800,
        heightPx: 600,
        condition: 'eyes_open',
        caption: null,
        position: 0,
      },
    },
  };
}

beforeAll(async () => {
  h = await startHarness(NOW);

  const index = h.data.clients.findIndex(
    (c) => c.status === 'active' && c.givenNameAr !== null && c.sexAtBirth !== 'unknown',
  );
  if (index < 0) throw new Error('The seed has no client to write about.');
  clientIndex = index;
  clientId = h.clientId(index);
  await h.onSchedule(clientIndex, SEEDED.practitioner);

  // A client the practitioner cannot reach, asked of the database itself.
  const reachable = await h.asPerson(SEEDED.practitioner, async (db) => {
    const { rows } = await db.query<{ id: string; visible: boolean }>(
      "select id, app.client_visible_to_practitioner(id) as visible from client where status = 'active'",
    );
    return rows;
  });
  const stranger = reachable.find((row) => !row.visible && row.id !== clientId);
  if (!stranger) throw new Error('The practitioner reaches every client.');
  strangerId = stranger.id;

  // A signed first report, written as the table owner: drafted, its map
  // linked while it is a draft (migration 604 freezes the links when it
  // leaves draft), then signed with the snapshots signing leaves on a row.
  const issued = await h.owner.query<{ id: string }>(
    "insert into report (tenant_id, client_id, kind, content) values ($1, $2, 'qeeg', $3::jsonb) " +
      'returning id',
    [h.data.tenant.id, clientId, JSON.stringify(earlierContent())],
  );
  issuedId = issued.rows[0]?.id ?? '';
  const where = { tenantId: h.data.tenant.id, clientId };
  await linkFigureAsOwner(
    h.owner,
    { ...where, reportId: issuedId },
    { documentId: EARLIER_MAP, sha256: SHA, widthPx: 800, heightPx: 600, condition: 'eyes_open' },
  );
  await h.owner.query(
    "update report set status = 'issued', number = $2, issued_on = current_date, " +
      "signed_at = now(), signed_by_practitioner_id = $3, signed_by_name = 'Rowan Ridge', " +
      "signed_by_certification = 'bcia_bcn', recipient_name = 'Cedar Meadow', " +
      "recipient_record_number = 'MW-000001', practice_legal_name = 'Synthetic Studio' " +
      'where id = $1',
    [issuedId, ISSUED_NUMBER, h.practitionerIdOf(SEEDED.owner)],
  );

  // A past record: drafted with its source and its map, then kept.
  const imported = await h.owner.query<{ id: string }>(
    'insert into report (tenant_id, client_id, kind, content, imported_from, source_sha256) ' +
      "values ($1, $2, 'qeeg', $3::jsonb, 'qeeg.json/1', $4) returning id",
    [h.data.tenant.id, clientId, JSON.stringify(earlierContent()), SHA],
  );
  importedId = imported.rows[0]?.id ?? '';
  await linkFigureAsOwner(
    h.owner,
    { ...where, reportId: importedId },
    { documentId: EARLIER_MAP, sha256: SHA, widthPx: 800, heightPx: 600, condition: 'eyes_open' },
  );
  await h.owner.query("update report set status = 'imported' where id = $1", [importedId]);

  // A legal guardian of the client with a portal login of their own, made
  // the way the portal's own door makes one.
  const contact = await h.owner.query<{ id: string }>(
    'select id from contact where client_id = $1 order by id limit 1',
    [clientId],
  );
  const contactId = contact.rows[0]?.id;
  if (!contactId) throw new Error('The seed gave the client no contact.');
  const userId = '0000000d-0000-4000-8000-0000000000e1';
  const authId = '0000000d-0000-4000-8000-0000000000e2';
  await h.owner.query(
    'insert into app_user (id, tenant_id, auth_id, display_name) values ($1, $2, $3, $4)',
    [userId, h.data.tenant.id, authId, 'Household login'],
  );
  await h.owner.query(
    "insert into user_role (tenant_id, user_id, role) values ($1, $2, 'client_contact')",
    [h.data.tenant.id, userId],
  );
  await h.owner.query('update contact set user_id = $1, is_legal_guardian = true where id = $2', [
    userId,
    contactId,
  ]);
  household = { authId };
}, 180_000);

afterAll(async () => {
  await h.close();
});

describe('a practitioner saves a blank brain-map draft', () => {
  it('saves a blank first report, with the client written in from the record', async () => {
    const body = await created(sentInitial());
    expect(body.report).toMatchObject({ clientId, kind: 'qeeg', status: 'draft', locale: 'en' });
    expect(body.content).toEqual({ ...blankInitial(), subject: subjectOnRecord('2026-09-30') });
    expect(body.savedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);

    const { rows } = await h.owner.query<Record<string, unknown>>(
      'select status::text as status, reference, compared_with_id, twin_of_id, imported_from, ' +
        'source_sha256, created_by from report where id = $1',
      [body.report.id],
    );
    expect(rows[0]).toEqual({
      status: 'draft',
      reference: null,
      compared_with_id: null,
      twin_of_id: null,
      imported_from: null,
      source_sha256: null,
      created_by: h.data.users[SEEDED.practitioner]?.id,
    });
  });

  it('saves a blank follow-up, compared with a signed report as that report stands', async () => {
    const body = await created(sentFollowUp(issuedId));
    const content = body.content as ReturnType<typeof blankFollowUp>;
    expect(content.comparedWith).toEqual({
      reportId: issuedId,
      recordedOn: EARLIER_DAY,
      relation: 'initial',
      origin: 'issued',
      reference: `RPT-000${ISSUED_NUMBER}`,
    });
    // The facts of the earlier report come forward; nothing she judges does.
    expect(content.dashboard.mental_energy).toEqual({
      score: null,
      evidence: null,
      earlierScore: 7,
    });
    expect(content.change.pairs.eyes_open.earlier?.figureId).toBe(
      '0000000d-0000-4000-8000-000000000091',
    );
    expect(content.bands.delta).toEqual({ change: null, regions: [] });

    const { rows } = await h.owner.query<{ compared_with_id: string }>(
      'select compared_with_id from report where id = $1',
      [body.report.id],
    );
    expect(rows[0]?.compared_with_id).toBe(issuedId);
  });

  it('saves a blank follow-up compared with a past record, which has no reference', async () => {
    const body = await created(sentFollowUp(importedId, { stage: 'final' }));
    const content = body.content as ReturnType<typeof blankFollowUp>;
    expect(content.comparedWith).toEqual({
      reportId: importedId,
      recordedOn: EARLIER_DAY,
      relation: 'initial',
      origin: 'imported',
      reference: null,
    });
    expect(content.stage).toBe('final');
  });

  it('lets the owner and the lead practitioner save one, and never an admin', async () => {
    expect(
      (await save({ clientId, kind: 'qeeg', content: sentInitial() }, SEEDED.owner)).status,
    ).toBe(201);
    const before = await reportCount();
    const res = await save({ clientId, kind: 'qeeg', content: sentInitial() }, SEEDED.admin);
    expect(res.status).toBe(403);
    expect(await reportCount()).toBe(before);
  });

  it('answers not found for a client off the practitioner’s schedule, and writes nothing', async () => {
    const before = await reportCount();
    const res = await save({ clientId: strangerId, kind: 'qeeg', content: sentInitial() });
    expect(res.status).toBe(404);
    expect(await reportCount()).toBe(before);
  });
});

describe('what she typed is held to the shape', () => {
  it('refuses a bad field and names it', async () => {
    const before = await reportCount();
    const blank = blankInitial();
    const res = await save({
      clientId,
      kind: 'qeeg',
      content: sentInitial({
        bands: { ...blank.bands, delta: { level: 'very_high', regions: [] } },
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      code: string;
      field: string;
      refusals: { path: string }[];
    };
    expect(body.code).toBe('invalid_content');
    expect(body.field).toBe('bands.delta.level');
    expect(body.refusals.map((refusal) => refusal.path)).toEqual(['bands.delta.level']);
    expect(await reportCount()).toBe(before);
  });

  it('refuses a key the edition does not declare, by name', async () => {
    const res = await save({ clientId, kind: 'qeeg', content: sentInitial({ colour: 'blue' }) });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { field: string }).field).toBe('colour');
  });

  it('says of a day that is no day only that it is none, once (RC4 N1)', async () => {
    for (const day of ['2026-02-30', '']) {
      const res = await save({
        clientId,
        kind: 'qeeg',
        content: sentFollowUp(issuedId, {
          recording: { recordedOn: day, eyes: null, handedness: null },
        }),
      });
      expect(res.status, day).toBe(400);
      const body = (await res.json()) as { refusals: { path: string; reason: string }[] };
      expect(
        body.refusals.map((refusal) => refusal.path),
        day,
      ).toEqual(['recording.recordedOn']);
      for (const refusal of body.refusals) {
        expect(refusal.reason, day).not.toMatch(/compared with/);
      }
    }
  });

  it('refuses a follow-up recorded before the report it is compared with, once', async () => {
    const res = await save({
      clientId,
      kind: 'qeeg',
      content: sentFollowUp(issuedId, {
        recording: { recordedOn: '2026-03-13', eyes: null, handedness: null },
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { refusals: { path: string; reason: string }[] };
    expect(body.refusals).toHaveLength(1);
    expect(body.refusals[0]?.path).toBe('recording.recordedOn');
    expect(body.refusals[0]?.reason).toMatch(/compared with/);
  });

  it('refuses a mark that is nearly a mark by name, never dropping it in silence (RC4 N2)', async () => {
    const nearly = [
      { from: 0, to: 4, bold: true, underline: false },
      { from: 0, to: 4.5, bold: true },
      { from: '0', to: 4, bold: true },
    ];
    for (const mark of nearly) {
      const res = await save({
        clientId,
        kind: 'qeeg',
        content: sentInitial({
          summary: { en: { text: 'Calm and steady', marks: [mark] }, ar: null },
        }),
      });
      expect(res.status, JSON.stringify(mark)).toBe(400);
      const body = (await res.json()) as { field: string };
      expect(body.field, JSON.stringify(mark)).toMatch(/^summary\.en\.marks\.0/);
    }
  });
});

describe('the client’s details come from the record', () => {
  it('refuses a body that carries the client, whatever it says', async () => {
    const before = await reportCount();
    const res = await save({
      clientId,
      kind: 'qeeg',
      content: sentInitial({ subject: { nameAr: null, ageYears: 40, sex: 'male' } }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { code: string; field: string }).toMatchObject({
      code: 'route_owned',
      field: 'subject',
    });
    expect(await reportCount()).toBe(before);
  });

  it('counts the age on the day of the recording, and gathers again on every save', async () => {
    const first = await created(
      sentInitial({ recording: { recordedOn: '2026-04-01', eyes: null, handedness: null } }),
    );
    expect((first.content as QeegInitial).subject).toEqual(subjectOnRecord('2026-04-01'));

    // The record is corrected between two saves: the next save says so.
    const person = h.data.clients[clientIndex];
    if (!person) throw new Error('The seed is not what it was.');
    await h.owner.query("update client set date_of_birth = '2016-01-15' where id = $1", [clientId]);
    try {
      const res = await save({
        id: first.report.id,
        clientId,
        kind: 'qeeg',
        savedAt: first.savedAt,
        content: sentInitial({
          recording: { recordedOn: '2026-04-01', eyes: null, handedness: null },
        }),
      });
      expect(res.status).toBe(200);
      const again = (await res.json()) as QeegDraftResponse;
      expect((again.content as QeegInitial).subject.ageYears).toBe(10);
    } finally {
      await h.owner.query('update client set date_of_birth = $1 where id = $2', [
        person.dateOfBirth,
        clientId,
      ]);
    }
  });
});

describe('a save made over a newer one', () => {
  it('is refused, and the newer one stands', async () => {
    const first = await created(sentInitial());
    const update = (savedAt: string | undefined, text: string) =>
      save({
        id: first.report.id,
        clientId,
        kind: 'qeeg',
        ...(savedAt === undefined ? {} : { savedAt }),
        content: sentInitial({ summary: { en: { text, marks: [] }, ar: null } }),
      });

    const second = await update(first.savedAt, 'Settled mornings.');
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as QeegDraftResponse;
    expect(secondBody.savedAt).not.toBe(first.savedAt);

    // The first tab, still holding the first save, saves over the second.
    const stale = await update(first.savedAt, 'An older page.');
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as { code: string }).code).toBe('stale_draft');

    const { rows } = await h.owner.query<{ text: string }>(
      "select content #>> '{summary,en,text}' as text from report where id = $1",
      [first.report.id],
    );
    expect(rows[0]?.text).toBe('Settled mornings.');

    // An update that does not say which save it was made over is not taken.
    expect((await update(undefined, 'No stamp.')).status).toBe(400);
    // The newest stamp is taken.
    expect((await update(secondBody.savedAt, 'The newest.')).status).toBe(200);
  });

  it('refuses a change of language on a saved draft, and an update of a signed report', async () => {
    const first = await created(sentInitial());
    const res = await save({
      id: first.report.id,
      clientId,
      kind: 'qeeg',
      locale: 'ar',
      savedAt: first.savedAt,
      content: sentInitial(),
    });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { code: string }).code).toBe('locale_fixed');

    const signed = await save({
      id: issuedId,
      clientId,
      kind: 'qeeg',
      savedAt: '2026-09-30T08:00:00.000000Z',
      content: sentInitial(),
    });
    expect(signed.status).toBe(422);
    expect(((await signed.json()) as { code: string }).code).toBe('already_issued');
  });
});

describe('a body that carries what the route owns', () => {
  it('is refused, each part by name, and nothing is written', async () => {
    const calculated = {
      kind: 'no_appreciable_change',
      source: 'calculated',
      basis: {
        earlierAssessmentId: '0000000d-0000-4000-8000-000000000081',
        laterAssessmentId: '0000000d-0000-4000-8000-000000000082',
        unit: 'uV2',
        sitesPaired: 19,
      },
    };
    const followUp = sentFollowUp(issuedId);
    const change = followUp['change'] as Record<string, unknown>;
    const cases: Array<[string, Record<string, unknown>]> = [
      ['provenance', sentInitial({ provenance: { origin: 'app' } })],
      [
        'comparedWith.recordedOn',
        { ...followUp, comparedWith: { reportId: issuedId, recordedOn: EARLIER_DAY } },
      ],
      [
        'change.table.delta.eyesOpen.source',
        {
          ...followUp,
          change: {
            ...change,
            table: { delta: { position: 0, eyesOpen: calculated, eyesClosed: null } },
          },
        },
      ],
      [
        'change.sessionsCompleted.source',
        {
          ...followUp,
          change: { ...change, sessionsCompleted: { count: 20, source: 'gathered' } },
        },
      ],
    ];
    const before = await reportCount();
    for (const [field, content] of cases) {
      const res = await save({ clientId, kind: 'qeeg', content });
      expect(res.status, field).toBe(400);
      const body = (await res.json()) as { code: string; field: string; fields: string[] };
      expect(body.code, field).toBe('route_owned');
      expect(body.field, field).toBe(field);
      expect(body.fields, field).toEqual([field]);
    }
    expect(await reportCount()).toBe(before);
  });

  it('refuses a request that names where a report came from, its twin or its comparison', async () => {
    const before = await reportCount();
    for (const extra of [
      { importedFrom: 'qeeg.json/1' },
      { sourceSha256: SHA },
      { twinOfId: issuedId },
      { comparedWithId: issuedId },
      { status: 'imported' },
    ]) {
      const res = await save({ clientId, kind: 'qeeg', content: sentInitial(), ...extra });
      expect(res.status, Object.keys(extra)[0]).toBe(400);
    }
    expect(await reportCount()).toBe(before);
  });

  it('refuses a comparison with what cannot be compared with, naming why', async () => {
    const draft = await created(sentInitial());
    const theirs = await h.owner.query<{ id: string }>(
      'insert into report (tenant_id, client_id, kind, status, number, issued_on, signed_at, ' +
        'signed_by_practitioner_id, signed_by_name, signed_by_certification, recipient_name, ' +
        'recipient_record_number, practice_legal_name, content) values ' +
        "($1, $2, 'qeeg', 'issued', $3, current_date, now(), $4, 'Rowan Ridge', 'bcia_bcn', " +
        "'Cedar Meadow', 'MW-000002', 'Synthetic Studio', $5::jsonb) returning id",
      [
        h.data.tenant.id,
        strangerId,
        ISSUED_NUMBER + 1,
        h.practitionerIdOf(SEEDED.owner),
        JSON.stringify(earlierContent()),
      ],
    );
    const cases: Array<[string, string, number]> = [
      [draft.report.id, 'draft', 422],
      // Another client's report is not there at all for this practitioner.
      [theirs.rows[0]?.id ?? '', 'no_such_report', 422],
      ['0000000d-0000-4000-8000-000000000099', 'no_such_report', 422],
    ];
    for (const [reportId, reason, status] of cases) {
      const res = await save({ clientId, kind: 'qeeg', content: sentFollowUp(reportId) });
      expect(res.status, reason).toBe(status);
      expect((await res.json()) as { code: string; reason: string; field: string }).toMatchObject({
        code: 'cannot_compare',
        reason,
        field: 'comparedWith.reportId',
      });
    }
    // The owner sees the other client's report, and is told it is another client's.
    const owners = await save(
      { clientId, kind: 'qeeg', content: sentFollowUp(theirs.rows[0]?.id ?? '') },
      SEEDED.owner,
    );
    expect(((await owners.json()) as { reason: string }).reason).toBe('other_client');
  });
});

describe('reading a brain-map draft back', () => {
  it('reads back identical to what was saved, for staff', async () => {
    const saved = await created(sentFollowUp(issuedId));
    for (const who of [SEEDED.practitioner, SEEDED.owner, SEEDED.admin]) {
      const res = await h.call('GET', `/api/reports/${saved.report.id}`, who);
      expect(res.status, String(who)).toBe(200);
      const body = (await res.json()) as ReportResponse;
      expect(body.content, String(who)).toEqual(saved.content);
      expect(body.report, String(who)).toEqual(saved.report);
      expect(body.savedAt, String(who)).toBe(saved.savedAt);
      expect(body.url).toBeNull();
    }
    const list = await h.call('GET', `/api/reports?clientId=${clientId}`, SEEDED.admin);
    expect(list.status).toBe(200);
    const rows = ((await list.json()) as ReportListResponse).reports;
    expect(rows.find((row) => row.id === saved.report.id)).toMatchObject({
      kind: 'qeeg',
      status: 'draft',
    });
  });

  it('never shows a household a draft, while it shows them what was signed', async () => {
    const saved = await created(sentInitial());
    const one = await h.callAs('GET', `/api/reports/${saved.report.id}`, household.authId);
    expect(one.status).toBe(404);

    const list = await h.callAs('GET', `/api/reports?clientId=${clientId}`, household.authId);
    expect(list.status).toBe(200);
    const ids = ((await list.json()) as ReportListResponse).reports.map((row) => row.id);
    expect(ids).toContain(issuedId);
    expect(ids).not.toContain(saved.report.id);
    expect(ids).not.toContain(importedId);

    const portal = await h.callAs('GET', '/api/portal/reports', household.authId);
    expect(portal.status).toBe(200);
    const portalIds = ((await portal.json()) as PortalReportsResponse).reports.map((r) => r.id);
    expect(portalIds).not.toContain(saved.report.id);
  });
});

describe('the audit trail', () => {
  it('records each save with its reason, and the reads it made', async () => {
    const first = await created(sentInitial());
    const res = await save({
      id: first.report.id,
      clientId,
      kind: 'qeeg',
      savedAt: first.savedAt,
      content: sentInitial({ summary: { en: { text: 'Steady.', marks: [] }, ar: null } }),
    });
    expect(res.status).toBe(200);
    const { rows } = await h.owner.query<{ action: string; reason: string | null }>(
      "select action, reason from audit_log where entity_type = 'report' and entity_id = $1 " +
        "and action in ('insert', 'update') order by id",
      [first.report.id],
    );
    expect(rows).toEqual([
      { action: 'insert', reason: REASON },
      { action: 'update', reason: REASON },
    ]);
    // The record's details were read to write the head of the report.
    const reads = await h.owner.query<{ n: string }>(
      "select count(*)::text as n from audit_log where action = 'read' and entity_type = 'client' " +
        'and entity_id = $1 and reason = $2',
      [clientId, REASON],
    );
    expect(Number(reads.rows[0]?.n)).toBeGreaterThanOrEqual(2);
  });

  it('records the read of the report a follow-up is compared with', async () => {
    const saved = await created(sentFollowUp(issuedId));
    const { rows } = await h.owner.query<{ n: string }>(
      "select count(*)::text as n from audit_log where action = 'read' and entity_type = 'report' " +
        'and entity_id = $1 and client_id = $2 and reason = $3',
      [issuedId, clientId, REASON],
    );
    expect(saved.report.id).toBeTruthy();
    expect(Number(rows[0]?.n)).toBeGreaterThanOrEqual(1);
  });

  it('refuses a save with no reason, and writes nothing', async () => {
    const before = await reportCount();
    const without: Record<string, string>[] = [{}, { 'x-reason': '   ' }];
    for (const headers of without) {
      const res = await save(
        { clientId, kind: 'qeeg', content: sentInitial() },
        undefined,
        headers,
      );
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe('reason_required');
    }
    expect(await reportCount()).toBe(before);
  });
});

describe('the two older kinds beside it', () => {
  it('never lets a session or progress save land on a brain-map draft, nor the reverse', async () => {
    const brainMap = await created(sentInitial());
    const visit = await h.completedVisit(clientIndex);
    const asSession = await h.call('POST', '/api/reports/draft', SEEDED.owner, {
      id: brainMap.report.id,
      clientId,
      kind: 'session',
      sessionId: visit,
      content: sessionBody(),
    });
    expect(asSession.status).toBe(422);
    expect(((await asSession.json()) as { code: string }).code).toBe('wrong_kind');

    const progress = await h.call('POST', '/api/reports/draft', SEEDED.owner, {
      clientId,
      kind: 'progress',
      coverageFrom: '2026-06-01',
      coverageTo: '2026-09-01',
      content: progressBody(),
    });
    expect(progress.status).toBe(201);
    const progressId = ((await progress.json()) as DraftResponse).report.id;
    const asQeeg = await save(
      {
        id: progressId,
        clientId,
        kind: 'qeeg',
        savedAt: '2026-09-30T08:00:00.000000Z',
        content: sentInitial(),
      },
      SEEDED.owner,
    );
    expect(asQeeg.status).toBe(422);
    expect(((await asQeeg.json()) as { code: string }).code).toBe('wrong_kind');

    const { rows } = await h.owner.query<{ kind: string }>(
      "select content->>'kind' as kind from report where id = $1",
      [brainMap.report.id],
    );
    expect(rows[0]?.kind).toBe('qeeg');
  });
});

/** A past record of `clientId`, kept, as the table owner writes one. */
async function keptRecord(sha: string): Promise<string> {
  const { rows } = await h.owner.query<{ id: string }>(
    'insert into report (tenant_id, client_id, kind, content, imported_from, source_sha256) ' +
      "values ($1, $2, 'qeeg', $3::jsonb, 'qeeg.json/1', $4) returning id",
    [h.data.tenant.id, clientId, JSON.stringify(earlierContent()), sha],
  );
  const id = rows[0]?.id ?? '';
  await h.owner.query("update report set status = 'imported' where id = $1", [id]);
  return id;
}

/** Withdrawn as kept against the wrong client: the stamp set, the content cleared. */
async function withdraw(id: string, query: Query = (t, p) => h.owner.query(t, p)): Promise<void> {
  await query(
    "update report set withdrawn_at = now(), withdraw_reason = 'Kept against the wrong client', " +
      "content = '{}'::jsonb where id = $1",
    [id],
  );
}

/** The snapshots signing leaves on a row, written onto a draft as the table owner. */
async function signAsOwner(id: string, number: number, query: Query): Promise<void> {
  await query(
    "update report set status = 'issued', number = $2, issued_on = current_date, " +
      "signed_at = now(), signed_by_practitioner_id = $3, signed_by_name = 'Rowan Ridge', " +
      "signed_by_certification = 'bcia_bcn', recipient_name = 'Cedar Meadow', " +
      "recipient_record_number = 'MW-000001', practice_legal_name = 'Synthetic Studio' " +
      'where id = $1',
    [id, number, h.practitionerIdOf(SEEDED.owner)],
  );
}

describe('fix round 1: races between two people', () => {
  it('answers a comparison withdrawn between the read and the write with 409, and writes nothing', async () => {
    const kept = await keptRecord('d'.repeat(64));
    const before = await reportCount();
    // The owner saves, since withdrawing is the owner's or the lead's.
    race.after = { id: kept, run: (query) => withdraw(kept, query) };
    const res = await save({ clientId, kind: 'qeeg', content: sentFollowUp(kept) }, SEEDED.owner);
    expect(race.after).toBeNull();
    expect(res.status).toBe(409);
    expect((await res.json()) as { code: string; reason: string; field: string }).toMatchObject({
      code: 'cannot_compare',
      reason: 'withdrawn',
      field: 'comparedWith.reportId',
    });
    expect(await reportCount()).toBe(before);
  });

  it('answers already issued, not stale, when the draft was signed between the read and the write', async () => {
    const first = await created(sentInitial(), SEEDED.owner);
    race.after = { id: first.report.id, run: (query) => signAsOwner(first.report.id, 950, query) };
    const res = await save(
      {
        id: first.report.id,
        clientId,
        kind: 'qeeg',
        savedAt: first.savedAt,
        content: sentInitial({ summary: { en: { text: 'Late.', marks: [] }, ar: null } }),
      },
      SEEDED.owner,
    );
    expect(race.after).toBeNull();
    expect(res.status).toBe(422);
    expect(((await res.json()) as { code: string }).code).toBe('already_issued');
  });
});

describe('fix round 1: what the review found untested', () => {
  it('refuses to save over a draft read from the old tool’s file', async () => {
    const { rows } = await h.owner.query<{ id: string }>(
      'insert into report (tenant_id, client_id, kind, content, imported_from, source_sha256) ' +
        "values ($1, $2, 'qeeg', $3::jsonb, 'qeeg.json/1', $4) returning id",
      [h.data.tenant.id, clientId, JSON.stringify(earlierContent()), 'f'.repeat(64)],
    );
    const res = await save(
      {
        id: rows[0]?.id,
        clientId,
        kind: 'qeeg',
        savedAt: '2026-09-30T08:00:00.000000Z',
        content: sentInitial(),
      },
      SEEDED.owner,
    );
    expect(res.status).toBe(422);
    expect(((await res.json()) as { code: string }).code).toBe('imported_draft');
  });

  it('lets a lead practitioner who is nothing else save one', async () => {
    const userId = '0000000d-0000-4000-8000-0000000000e3';
    const authId = '0000000d-0000-4000-8000-0000000000e4';
    await h.owner.query(
      'insert into app_user (id, tenant_id, auth_id, display_name) values ($1, $2, $3, $4)',
      [userId, h.data.tenant.id, authId, 'Lead only'],
    );
    await h.owner.query(
      "insert into user_role (tenant_id, user_id, role) values ($1, $2, 'lead_practitioner')",
      [h.data.tenant.id, userId],
    );
    const res = await h.callAs(
      'POST',
      '/api/reports/draft',
      authId,
      { clientId, kind: 'qeeg', content: sentFollowUp(issuedId) },
      WITH_REASON,
    );
    expect(res.status).toBe(201);
    expect(((await res.json()) as QeegDraftResponse).report.kind).toBe('qeeg');
  });

  it('refuses a comparison with a withdrawn past record and with a superseded report', async () => {
    const withdrawn = await keptRecord('e'.repeat(64));
    await withdraw(withdrawn);
    const superseded = await h.owner.query<{ id: string }>(
      'insert into report (tenant_id, client_id, kind, status, number, issued_on, signed_at, ' +
        'signed_by_practitioner_id, signed_by_name, signed_by_certification, recipient_name, ' +
        'recipient_record_number, practice_legal_name, content) values ' +
        "($1, $2, 'qeeg', 'issued', $3, current_date, now(), $4, 'Rowan Ridge', 'bcia_bcn', " +
        "'Cedar Meadow', 'MW-000001', 'Synthetic Studio', $5::jsonb) returning id",
      [
        h.data.tenant.id,
        clientId,
        ISSUED_NUMBER + 2,
        h.practitionerIdOf(SEEDED.owner),
        JSON.stringify(earlierContent()),
      ],
    );
    const supersededId = superseded.rows[0]?.id ?? '';
    await h.owner.query("update report set status = 'superseded' where id = $1", [supersededId]);

    for (const [reportId, reason] of [
      [withdrawn, 'withdrawn'],
      [supersededId, 'superseded'],
    ] as const) {
      const res = await save({ clientId, kind: 'qeeg', content: sentFollowUp(reportId) });
      expect(res.status, reason).toBe(422);
      expect((await res.json()) as { code: string; reason: string }, reason).toMatchObject({
        code: 'cannot_compare',
        reason,
      });
    }
  });

  it('refuses any save for a client whose record was erased, whoever asks', async () => {
    const index = h.data.clients.findIndex(
      (c, i) => c.status === 'active' && i !== clientIndex && c.id !== strangerId,
    );
    const erasedId = h.clientId(index);
    await h.owner.query("update client set status = 'erased' where id = $1", [erasedId]);
    const before = await reportCount();
    const res = await save(
      { clientId: erasedId, kind: 'qeeg', content: sentInitial() },
      SEEDED.owner,
    );
    expect(res.status).toBe(422);
    expect(((await res.json()) as { code: string }).code).toBe('client_erased');
    expect(await reportCount()).toBe(before);
  });

  it('refuses a reason that cleans to nothing, or is no reason worth reading', async () => {
    const before = await reportCount();
    // A header carries bytes, not every character: a no-break space and a
    // control character, each of which the fence's cleaning removes whole.
    const cleansToNothing = [
      String.fromCharCode(0xa0).repeat(12),
      String.fromCharCode(1).repeat(12),
    ];
    for (const reason of [...cleansToNothing, 'aaaaaaaa', 'ok']) {
      const res = await save({ clientId, kind: 'qeeg', content: sentInitial() }, undefined, {
        'x-reason': reason,
      });
      expect(res.status, JSON.stringify(reason)).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe('reason_required');
    }
    expect(await reportCount()).toBe(before);
  });

  it('never hands a household the stamp a draft’s next save names', async () => {
    const theirs = await h.callAs('GET', `/api/reports/${issuedId}`, household.authId);
    expect(theirs.status).toBe(200);
    expect(Object.keys((await theirs.json()) as object)).not.toContain('savedAt');
    const staff = await h.call('GET', `/api/reports/${issuedId}`, SEEDED.owner);
    expect(((await staff.json()) as ReportResponse).savedAt).toMatch(/Z$/);
  });
});

/** Arabic letters, `length` UTF-16 units of them, with a space now and then. */
function arabic(length: number): string {
  return 'بحر سهل '.repeat(Math.ceil(length / 8)).slice(0, length);
}

/** English of `length` characters. */
function english(length: number): string {
  return 'Calm and steady. '.repeat(Math.ceil(length / 17)).slice(0, length);
}

/** Formatted text at its limit, with the most marks the shape keeps. */
function richAtLimit(text: string) {
  return {
    text,
    marks: Array.from({ length: 200 }, (_, i) => ({
      from: i * 20,
      to: i * 20 + 10,
      bold: true as const,
      underline: true as const,
    })),
  };
}

function customAtLimit() {
  return Object.fromEntries(
    Array.from({ length: 12 }, (_, i) => [
      `c${i}`,
      {
        label: { en: english(160), ar: arabic(160) },
        note: { en: english(400), ar: arabic(400) },
        chosen: true,
        position: i,
      },
    ]),
  );
}

/** The largest brain-map body the shape accepts, near enough: every typed thing at its limit. */
function maximalFollowUp(mapIds: readonly string[]): Record<string, unknown> {
  const base = sentFollowUp(issuedId);
  const change = base['change'] as Record<string, unknown>;
  const dashboard = base['dashboard'] as Record<string, Record<string, unknown>>;
  const figure = {
    kind: 'percent',
    direction: 'increase',
    low: 25,
    high: 30,
    source: 'typed',
    basis: null,
  };
  const rich = { en: richAtLimit(english(4000)), ar: richAtLimit(arabic(4000)) };
  const picked = { chosen: [], custom: customAtLimit() };
  return {
    ...base,
    findings: picked,
    focus: picked,
    recommendations: picked,
    benefits: picked,
    summary: rich,
    maps: Object.fromEntries(
      Array.from({ length: 8 }, (_, i) => [
        `map-${i}`,
        {
          figureId: mapIds[i],
          sha256: SHA,
          widthPx: 1600,
          heightPx: 1200,
          condition: 'eyes_open',
          caption: { en: english(120), ar: arabic(120) },
          position: i,
        },
      ]),
    ),
    dashboard: Object.fromEntries(
      Object.entries(dashboard).map(([key, score]) => [
        key,
        { ...score, score: 5, evidence: { en: english(400), ar: arabic(400) } },
      ]),
    ),
    change: {
      ...change,
      tiles: Object.fromEntries(
        Array.from({ length: 2 }, (_, i) => [
          `t${i}`,
          { figure, caption: { en: english(120), ar: arabic(120) }, position: i },
        ]),
      ),
      sessionsCompleted: { count: 200, source: 'typed' },
      table: Object.fromEntries(
        MEASURE_IDS.map((measure, i) => [
          measure,
          { position: i, eyesOpen: figure, eyesClosed: figure },
        ]),
      ),
      summary: rich,
    },
  };
}

describe('fix round 1: the size of a brain-map body', () => {
  it('saves the largest body the shape accepts, well over the ordinary 64 KiB', async () => {
    // Eight maps, each linked to the draft first, as the door links them.
    const draft = await created(sentFollowUp(issuedId));
    const mapIds = Array.from(
      { length: 8 },
      (_, i) => `0000000d-0000-4000-8000-0000000001${String(i).padStart(2, '0')}`,
    );
    for (const documentId of mapIds) {
      await linkFigureAsOwner(
        h.owner,
        { tenantId: h.data.tenant.id, clientId, reportId: draft.report.id },
        { documentId, sha256: SHA, widthPx: 1600, heightPx: 1200 },
      );
    }
    const content = maximalFollowUp(mapIds);
    const request = {
      id: draft.report.id,
      savedAt: draft.savedAt,
      clientId,
      kind: 'qeeg',
      content,
    };
    const bytes = Buffer.byteLength(JSON.stringify(request));
    expect(bytes).toBeGreaterThan(64 * 1024);
    expect(bytes).toBeLessThan(512 * 1024);
    const res = await save(request);
    expect(res.status, await res.clone().text()).toBe(200);
  });

  it('refuses a body over its own limit with 413', async () => {
    const res = await save({
      clientId,
      kind: 'qeeg',
      content: sentInitial({ padding: 'x'.repeat(512 * 1024) }),
    });
    expect(res.status).toBe(413);
  });
});
