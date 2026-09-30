import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type {
  ImportResponse,
  PastRecordResponse,
  QeegDraftResponse,
  ReportListResponse,
} from '../../../app/api/reports/schema';
import { fullFollowUp, sparseFollowUp } from '../../../domain/reports/qeeg/testing/reports';
import {
  buildLegacyFile,
  LEGACY_NAME,
  readLegacyFile,
  type LegacyFile,
} from '../../../domain/reports/qeeg/testing/legacyFile';
import type { FigureRef, QeegContent } from '../../../domain/reports/qeeg/types';
import type * as Wording from '../../../domain/reports/qeeg/wording';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { goodPng, linkFigureAsOwner, sha256Hex } from './figures-support';
import {
  clientToWriteAbout,
  completeReport,
  householdOf,
  qeegSteps,
  sent,
} from './qeeg-signing-support';
import { refusalsOnTrail, SEEDED, startHarness, type Harness } from './support';

/**
 * Bringing in a past record from the practice's old tool (docs/SPEC/
 * reports-qeeg.md section 11; brief R): `POST /api/reports/qeeg/import`,
 * the pictures through the ordinary maps door, `POST /:id/keep-import` and
 * `POST /:id/withdraw-import`, and every other door refusing a past record by
 * its code.
 *
 * **Every file here is invented** (`domain/reports/qeeg/testing/legacyFile.ts`),
 * read by the reader as the browser reads it, and only its content is sent.
 * The old tool's own folders are never opened. Pictures are made from
 * arithmetic, as the browser would have made them ready.
 *
 * **The words are approved here by a test double**, as the issue tests do, so
 * that a follow-up compared with a past record can be signed.
 */

const wording = vi.hoisted(() => ({
  status: { en: 'approved', ar: 'draft' } as Record<string, string>,
}));
vi.mock('../../../domain/reports/qeeg/wording', async (importOriginal) => {
  const actual = await importOriginal<typeof Wording>();
  return { ...actual, WORDING_STATUS: wording.status };
});

const NOW = () => new Date('2026-09-30T08:00:00.000Z');
const IMPORT_REASON = 'Bringing in a past record from the old tool';
const KEEP_REASON = 'Keeping the past record as read over';
/** Typed by a person, with a letter no header may carry. */
const WITHDRAW_REASON = 'Kept against another client’s record by mistake';
/** An age no seeded record could hold as a word, so a probe for it finds only the file's. */
const TYPED_AGE = '47 years and 3 months';

let h: Harness;
let clientId: string;
let otherClientId: string;
let erasedClientId: string;
let household: string;
/** A practitioner made lead practitioner, and nothing more. */
const LEAD = SEEDED.otherPractitioner;

/** Each test's own file: the same file twice is refused for one client. */
let fileCount = 0;
function newFile(person: Record<string, unknown> = {}): LegacyFile {
  fileCount += 1;
  return buildLegacyFile({ summary: `A settled recording, number ${fileCount}.` }, person);
}

/** What the browser sends: the reader's content and the fingerprint of the file's bytes. */
function bodyFor(file: LegacyFile, forClient: string = clientId) {
  const sha = sha256Hex(new TextEncoder().encode(JSON.stringify(file)));
  const read = readLegacyFile(file, sha);
  return { clientId: forClient, sourceSha256: sha, content: read.content };
}

async function bringIn(
  body: unknown,
  as: number = SEEDED.owner,
  headers: Record<string, string> = { 'x-reason': IMPORT_REASON },
): Promise<Response> {
  return h.call('POST', '/api/reports/qeeg/import', as, body, headers);
}

async function brought(file: LegacyFile = newFile(), forClient: string = clientId) {
  const res = await bringIn(bodyFor(file, forClient));
  if (res.status !== 201) throw new Error(`Refused: ${res.status} ${await res.text()}`);
  return (await res.json()) as ImportResponse;
}

async function upload(
  reportId: string,
  seed: number,
  as: number = SEEDED.owner,
): Promise<{ status: number; ref: FigureRef; savedAt: string }> {
  const bytes = await goodPng(40, 30, seed);
  const res = await h.raw('PUT', `/api/reports/${reportId}/figures`, as, bytes, {
    'content-type': 'image/png',
    'x-sha256': sha256Hex(bytes),
    'x-reason': 'Bringing in the maps of a past record',
  });
  const body = (await res.json()) as {
    figure: { figureId: string; sha256: string; widthPx: number; heightPx: number };
    savedAt: string;
  };
  const { figureId, sha256, widthPx, heightPx } = body.figure ?? {
    figureId: '',
    sha256: '',
    widthPx: 0,
    heightPx: 0,
  };
  return {
    status: res.status,
    ref: { figureId, sha256, widthPx, heightPx },
    savedAt: body.savedAt,
  };
}

function placed(refs: readonly (FigureRef | null)[]) {
  return Object.fromEntries(
    refs.flatMap((ref, place) =>
      ref === null
        ? []
        : [
            [
              `map-${place}`,
              {
                ...ref,
                condition: place === 0 ? 'eyes_open' : 'eyes_closed',
                caption: null,
                position: place,
              },
            ],
          ],
    ),
  );
}

async function keep(
  reportId: string,
  body: Record<string, unknown>,
  as: number = SEEDED.owner,
  headers: Record<string, string> = { 'x-reason': KEEP_REASON },
): Promise<Response> {
  return h.call('POST', `/api/reports/${reportId}/keep-import`, as, body, headers);
}

/** A past record brought in, its first picture filed and its second left out, and kept. */
async function kept(forClient: string = clientId, file: LegacyFile = newFile()) {
  const draft = await brought(file, forClient);
  const map = await upload(draft.report.id, fileCount);
  const res = await keep(draft.report.id, {
    savedAt: map.savedAt,
    maps: placed([map.ref]),
    leftOut: ['map-1'],
  });
  if (res.status !== 200) throw new Error(`Keep refused: ${res.status} ${await res.text()}`);
  return { id: draft.report.id, map: map.ref, file };
}

/**
 * The reason is typed by a person, so it travels in the body, where any
 * letter may go, and is the one the stamp and the trail keep.
 */
async function withdraw(
  reportId: string,
  as: number = SEEDED.owner,
  reason: string = WITHDRAW_REASON,
): Promise<Response> {
  return h.call('POST', `/api/reports/${reportId}/withdraw-import`, as, { reason });
}

async function codeOf(res: Response): Promise<string> {
  return ((await res.json()) as { code?: string }).code ?? '';
}

async function rowOf(id: string) {
  const { rows } = await h.owner.query<{
    status: string;
    content: Record<string, unknown>;
    imported_from: string | null;
    source_sha256: string | null;
    withdrawn_at: Date | null;
    withdraw_reason: string | null;
    subject: unknown;
  }>(
    'select status::text as status, content, imported_from, source_sha256, withdrawn_at, ' +
      "withdraw_reason, content -> 'subject' as subject from report where id = $1",
    [id],
  );
  const row = rows[0];
  if (!row) throw new Error('No such report.');
  return row;
}

async function trailOf(id: string, action: string) {
  const { rows } = await h.owner.query<{ reason: string | null; new_values: unknown }>(
    'select reason, new_values from audit_log where entity_id = $1 and action = $2',
    [id, action],
  );
  return rows;
}

/** A kept past record with two of its pictures brought in, and none left out. */
async function keptWithTwo(forClient: string = clientId) {
  const draft = await brought(newFile(), forClient);
  const first = await upload(draft.report.id, 600 + fileCount);
  const second = await upload(draft.report.id, 700 + fileCount);
  const res = await keep(draft.report.id, {
    savedAt: second.savedAt,
    maps: placed([first.ref, second.ref]),
    leftOut: [],
  });
  if (res.status !== 200) throw new Error(`Keep refused: ${res.status} ${await res.text()}`);
  return { id: draft.report.id, maps: [first.ref, second.ref] };
}

async function documentsOf(ids: readonly string[]) {
  const { rows } = await h.owner.query<{ id: string; storage_key: string }>(
    'select id, storage_key from document where id = any($1::uuid[]) order by id',
    [ids],
  );
  return rows;
}

/** The client's Documents tab as a person reads it: the ids and kinds it lists. */
async function listedAs(as: { seeded: number } | { authId: string }, forClient: string) {
  const path = `/api/clients/${forClient}/documents`;
  const headers = { 'x-reason': 'Reading the client’s documents'.replace('’', "'") };
  const res =
    'seeded' in as
      ? await h.call('GET', path, as.seeded, undefined, headers)
      : await h.callAs('GET', path, as.authId, undefined, headers);
  if (res.status !== 200) throw new Error(`List refused: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { documents: { id: string; kind: string }[] }).documents;
}

/** A second connection as the table owner, to hold a row or a write while a request runs. */
async function secondConnection(): Promise<pg.Client> {
  // The fresh database's own address, as the owner's connection was opened on it.
  const at = (h.owner as unknown as { connectionParameters: pg.ClientConfig }).connectionParameters;
  const other = new pg.Client({
    host: at.host,
    port: at.port,
    user: at.user,
    password: at.password,
    database: at.database,
  });
  await other.connect();
  return other;
}

/** Waits until some backend is blocked by `pid`, as the race tests of the twin do. */
async function blockedBy(pid: number): Promise<boolean> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const { rows } = await h.owner.query<{ n: string }>(
      'select count(*)::text as n from pg_stat_activity where $1 = any(pg_blocking_pids(pid)) ' +
        "and wait_event_type = 'Lock'",
      [pid],
    );
    if (Number(rows[0]?.n) > 0) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

/** The household login `householdOf(h, clientId, 7)` made. */
const HOUSEHOLD_USER = '0000000d-0000-4000-8000-000000000107';

/** Which of `ids` a person reads under row security, as the API reads them. */
async function read(actorId: string, roles: string, ids: readonly string[]): Promise<string[]> {
  await h.owner.query('begin');
  try {
    await h.owner.query(
      "select set_config('app.tenant_id', $1, true), set_config('app.actor_id', $2, true), " +
        "set_config('app.actor_roles', $3, true)",
      [h.data.tenant.id, actorId, roles],
    );
    await h.owner.query('set local role app_role');
    const { rows } = await h.owner.query<{ id: string }>(
      'select id from document where id = any($1::uuid[])',
      [ids],
    );
    return rows.map((row) => row.id);
  } finally {
    await h.owner.query('rollback');
  }
}

/** A referral letter filed for the client by the owner: a document that is not a picture. */
async function fileReferral(): Promise<string> {
  const filed = await h.call(
    'POST',
    `/api/clients/${clientId}/documents`,
    SEEDED.owner,
    {
      kind: 'referral',
      file: {
        mimeType: 'application/pdf',
        bytesBase64: Buffer.from('%PDF-1.7\n% synthetic\n').toString('base64'),
      },
    },
    { 'x-reason': 'Filing a referral letter' },
  );
  if (filed.status !== 201) throw new Error(`Refused: ${filed.status} ${await filed.text()}`);
  return ((await filed.json()) as { id: string }).id;
}

/** The database's own answer to a statement, as a code, or null when it runs. */
async function sqlState(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (error) {
    return String((error as { code?: unknown }).code ?? 'thrown');
  }
}

beforeAll(async () => {
  h = await startHarness(NOW);
  clientId = clientToWriteAbout(h).id;
  const others = h.data.clients
    .map((c, index) => ({ c, index }))
    .filter(({ c }) => c.status === 'active' && c.id !== clientId);
  otherClientId = others[0]?.c.id ?? '';
  erasedClientId = others[1]?.c.id ?? '';
  if (!otherClientId || !erasedClientId) throw new Error('The seed has too few clients.');
  const lead = h.data.users[LEAD];
  if (!lead) throw new Error('No seeded practitioner to make lead.');
  await h.owner.query(
    "insert into user_role (tenant_id, user_id, role) values ($1, $2, 'lead_practitioner')",
    [h.data.tenant.id, lead.id],
  );
  household = await householdOf(h, clientId, 7);
  await h.onSchedule(
    h.data.clients.findIndex((c) => c.id === clientId),
    SEEDED.practitioner,
  );
}, 180_000);

afterAll(async () => {
  await h.close();
});

describe('bringing a past record in', () => {
  it('lets the owner bring one in as a draft with its source, audited with the reason', async () => {
    const file = newFile();
    const body = bodyFor(file);
    const res = await bringIn(body);
    expect(res.status).toBe(201);
    const answer = (await res.json()) as ImportResponse;
    expect(answer.report).toMatchObject({ status: 'draft', kind: 'qeeg', pastRecord: true });
    expect(answer.report.recordedOn).toBe('2026-03-14');
    const row = await rowOf(answer.report.id);
    expect(row.imported_from).toBe('qeeg.json/1');
    expect(row.source_sha256).toBe(body.sourceSha256);
    expect(row.content).toEqual(body.content);
    const trail = await trailOf(answer.report.id, 'report.imported');
    expect(trail).toHaveLength(1);
    expect(trail[0]?.reason).toBe(IMPORT_REASON);
  });

  it('lets the lead practitioner bring one in', async () => {
    const res = await bringIn(bodyFor(newFile()), LEAD);
    expect(res.status).toBe(201);
  });

  it('refuses a practitioner and a coordinator, each on the trail before the answer', async () => {
    const before = await refusalsOnTrail(h.owner, 'report.import_refused', { clientId });
    for (const as of [SEEDED.practitioner, SEEDED.admin]) {
      const res = await bringIn(bodyFor(newFile()), as);
      expect(res.status, String(as)).toBe(403);
      expect(await codeOf(res)).toBe('not_permitted');
    }
    expect(await refusalsOnTrail(h.owner, 'report.import_refused', { clientId })).toEqual([
      ...before,
      'not_permitted',
      'not_permitted',
    ]);
  });

  it('refuses one brought in with no reason', async () => {
    const res = await bringIn(bodyFor(newFile()), SEEDED.owner, {});
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('reason_required');
  });

  it('refuses a body carrying the person the file typed, beside the content or inside it', async () => {
    const body = bodyFor(newFile());
    const beside = await bringIn({ ...body, asTyped: { name: LEGACY_NAME.en } });
    expect(beside.status).toBe(400);
    expect(await codeOf(beside)).toBe('invalid_request');

    const inside = await bringIn({
      ...body,
      content: { ...body.content, subject: { nameAr: LEGACY_NAME.ar, ageYears: 34, sex: null } },
    });
    expect(inside.status).toBe(400);
    expect(await inside.json()).toMatchObject({ code: 'route_owned', field: 'subject.nameAr' });
  });

  it('refuses a content whose fingerprint is not the file’s', async () => {
    const body = bodyFor(newFile());
    const res = await bringIn({ ...body, sourceSha256: 'f'.repeat(64) });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      code: 'digest_mismatch',
      field: 'provenance.sourceSha256',
    });
  });

  it('refuses a report this app wrote, and a content that already names maps', async () => {
    const body = bodyFor(newFile());
    const ours = await bringIn({
      ...body,
      content: { ...body.content, provenance: { origin: 'app' } },
    });
    expect(ours.status).toBe(400);
    expect(await ours.json()).toMatchObject({ code: 'not_a_past_record', field: 'provenance' });

    const maps = completeReport([
      {
        figureId: '0000000f-0000-4000-8000-000000000001',
        sha256: 'a'.repeat(64),
        widthPx: 40,
        heightPx: 30,
      },
    ]).maps;
    const named = await bringIn({ ...body, content: { ...body.content, maps } });
    expect(named.status).toBe(400);
    expect(await named.json()).toMatchObject({ code: 'maps_come_after', field: 'maps' });
  });

  it('refuses a content the shape refuses, naming the field', async () => {
    const body = bodyFor(newFile());
    const res = await bringIn({ ...body, content: { ...body.content, stage: 'sometime' } });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'invalid_content', field: 'stage' });
  });

  it('refuses the same file twice for one client, by its fingerprint, and says where it is', async () => {
    const file = newFile();
    const first = await brought(file);
    const again = await bringIn(bodyFor(file));
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({
      code: 'already_imported',
      reportId: first.report.id,
      status: 'draft',
    });
    // Another client is another question: the same file may be theirs.
    const elsewhere = await bringIn(bodyFor(file, otherClientId));
    expect(elsewhere.status).toBe(201);
  });

  it('answers two imports of the same file at once with one draft and one refusal', async () => {
    const body = bodyFor(newFile());
    const answers = await Promise.all([bringIn(body), bringIn(body)]);
    expect(answers.map((res) => res.status).sort()).toEqual([201, 409]);
    const { rows } = await h.owner.query(
      'select id from report where client_id = $1 and source_sha256 = $2',
      [clientId, body.sourceSha256],
    );
    expect(rows).toHaveLength(1);
  });

  it('answers the import that loses the race at the write, by the unique index, with where the other is', async () => {
    const body = bodyFor(newFile());
    // Another connection writes the same file for the same client and holds
    // it uncommitted, so the route's own question finds nothing and its
    // insert waits on the index, then fails when the other commits.
    const other = await secondConnection();
    try {
      await other.query('begin');
      const held = await other.query<{ id: string }>(
        'insert into report (tenant_id, client_id, kind, content, imported_from, source_sha256) ' +
          "values ($1, $2, 'qeeg', $3::jsonb, 'qeeg.json/1', $4) returning id",
        [h.data.tenant.id, clientId, JSON.stringify(body.content), body.sourceSha256],
      );
      const pid = (await other.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0]
        ?.pid;
      const pending = bringIn(body);
      expect(await blockedBy(pid ?? -1)).toBe(true);
      await other.query('commit');
      const res = await pending;
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({
        code: 'already_imported',
        reportId: held.rows[0]?.id,
        status: 'draft',
      });
    } finally {
      await other.end();
    }
  });

  it('never stores the name, age or sex the file typed, in any column of any table', async () => {
    const count = async (needle: string): Promise<number> => {
      const tables = await h.owner.query<{ name: string }>(
        'select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace ' +
          "where n.nspname = 'public' and c.relkind = 'r' order by 1",
      );
      let found = 0;
      for (const { name } of tables.rows) {
        const { rows } = await h.owner.query<{ n: string }>(
          `select count(*)::text as n from public.${name} as x where x::text like $1`,
          [`%${needle}%`],
        );
        found += Number(rows[0]?.n ?? 0);
      }
      return found;
    };
    // The English name is made from the seed's lists, so a seeded client may
    // share it: that one is measured as a change. The Arabic name as the file
    // joins it, and the age as it typed it, are held by nothing at all, after
    // every request this file has sent, the refused ones included.
    const before = await count(LEGACY_NAME.en);
    const record = await kept(clientId, newFile({ age: TYPED_AGE }));
    expect(await count(LEGACY_NAME.en)).toBe(before);
    expect(await count(LEGACY_NAME.ar)).toBe(0);
    expect(await count(TYPED_AGE)).toBe(0);
    expect((await rowOf(record.id)).subject).toEqual({ nameAr: null, ageYears: null, sex: null });
  });
});

describe('the maps of a past record, and keeping it', () => {
  it('files a past record’s picture through the maps door for the owner, and not for a practitioner', async () => {
    const draft = await brought();
    expect((await upload(draft.report.id, 400)).status).toBe(201);
    expect((await upload(draft.report.id, 401, SEEDED.practitioner)).status).toBe(403);
  });

  it('keeps it frozen, with its maps placed and a note for each picture left out', async () => {
    const record = await kept();
    const row = await rowOf(record.id);
    expect(row.status).toBe('imported');
    const content = row.content as unknown as QeegContent;
    expect(Object.keys(content.maps)).toEqual(['map-0']);
    expect(content.provenance).toMatchObject({ origin: 'legacy_tool' });
    if (content.provenance.origin !== 'legacy_tool') throw new Error('not a past record');
    expect(content.provenance.notes).toContainEqual({
      code: 'map_not_brought_in',
      at: 'images.map-1',
    });
    const frozen = await h.owner.query<{ is_immutable: boolean }>(
      'select is_immutable from document where id = $1',
      [record.map.figureId],
    );
    expect(frozen.rows[0]?.is_immutable).toBe(true);
    const trail = await trailOf(record.id, 'report.import_kept');
    expect(trail[0]?.reason).toBe(KEEP_REASON);
    // Kept is kept: a second keep, a picture, and a save are all refused.
    expect(
      await codeOf(
        await keep(record.id, { savedAt: '2026-09-30T08:00:00.000000Z', maps: {}, leftOut: [] }),
      ),
    ).toBe('already_kept');
    expect((await upload(record.id, 402)).status).toBe(422);
  });

  it('lets the lead practitioner keep one, and refuses a practitioner', async () => {
    const draft = await brought();
    const refused = await keep(
      draft.report.id,
      { savedAt: draft.savedAt, maps: {}, leftOut: ['map-0', 'map-1'] },
      SEEDED.practitioner,
    );
    expect(refused.status).toBe(403);
    const res = await keep(
      draft.report.id,
      { savedAt: draft.savedAt, maps: {}, leftOut: ['map-0', 'map-1'] },
      LEAD,
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as PastRecordResponse).report.status).toBe('imported');
  });

  it('refuses a map the record does not hold, and a picture filed and never placed', async () => {
    const draft = await brought();
    const map = await upload(draft.report.id, 410);
    const stranger = { ...map.ref, figureId: '0000000f-0000-4000-8000-0000000000ff' };
    const unlinked = await keep(draft.report.id, {
      savedAt: map.savedAt,
      maps: placed([stranger]),
      leftOut: [],
    });
    expect(unlinked.status).toBe(400);
    expect(await unlinked.json()).toMatchObject({
      code: 'unlinked_figure',
      field: 'maps.map-0.figureId',
    });
    expect(
      await refusalsOnTrail(h.owner, 'report.import_refused', { entityId: draft.report.id }),
    ).toEqual(['unlinked_figure']);
    const unplaced = await keep(draft.report.id, { savedAt: map.savedAt, maps: {}, leftOut: [] });
    expect(unplaced.status).toBe(422);
    expect(await codeOf(unplaced)).toBe('unplaced_figures');
    expect((await rowOf(draft.report.id)).status).toBe('draft');
  });

  it('refuses a map named at a size its link does not hold, on the trail before the answer', async () => {
    const draft = await brought();
    const map = await upload(draft.report.id, 415);
    const wider = { ...map.ref, widthPx: map.ref.widthPx + 1 };
    const res = await keep(draft.report.id, {
      savedAt: map.savedAt,
      maps: placed([wider]),
      leftOut: [],
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      code: 'figure_mismatch',
      field: 'maps.map-0.widthPx',
    });
    expect(
      await refusalsOnTrail(h.owner, 'report.import_refused', { entityId: draft.report.id }),
    ).toEqual(['figure_mismatch']);
    expect((await rowOf(draft.report.id)).status).toBe('draft');
  });

  it('refuses a place the file never had, and a keep made over an older stamp', async () => {
    const draft = await brought();
    const map = await upload(draft.report.id, 420);
    const bad = await keep(draft.report.id, {
      savedAt: map.savedAt,
      maps: {},
      leftOut: ['signature'],
    });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ code: 'invalid_placement', field: 'leftOut.0' });
    expect(
      await refusalsOnTrail(h.owner, 'report.import_refused', { entityId: draft.report.id }),
    ).toEqual(['invalid_placement']);
    const stale = await keep(draft.report.id, {
      savedAt: draft.savedAt,
      maps: placed([map.ref]),
      leftOut: [],
    });
    expect(stale.status).toBe(409);
    expect(await codeOf(stale)).toBe('stale_draft');
  });

  it('refuses to keep a record with nothing in it', async () => {
    const draft = await brought();
    await h.owner.query("update report set content = '{}'::jsonb where id = $1", [draft.report.id]);
    const stamp = await h.call('GET', `/api/reports/${draft.report.id}`, SEEDED.owner);
    const savedAt = ((await stamp.json()) as { savedAt: string }).savedAt;
    const res = await keep(draft.report.id, { savedAt, maps: {}, leftOut: [] });
    expect(res.status).toBe(422);
    expect(await codeOf(res)).toBe('nothing_to_keep');
    expect((await rowOf(draft.report.id)).status).toBe('draft');
  });
});

describe('withdrawing a past record kept against the wrong client', () => {
  it('clears its content, removes its maps and keeps the stamp, with the reason', async () => {
    const record = await kept();
    const before = await rowOf(record.id);
    const res = await withdraw(record.id);
    expect(res.status).toBe(200);
    expect(((await res.json()) as PastRecordResponse).report.withdrawn).toBe(true);
    const row = await rowOf(record.id);
    expect(row.status).toBe('imported');
    expect(row.content).toEqual({});
    expect(row.withdrawn_at).not.toBeNull();
    expect(row.withdraw_reason).toBe(WITHDRAW_REASON);
    // The stamp of what was brought in stays.
    expect(row.imported_from).toBe(before.imported_from);
    expect(row.source_sha256).toBe(before.source_sha256);
    const links = await h.owner.query('select 1 from report_figure where report_id = $1', [
      record.id,
    ]);
    expect(links.rowCount).toBe(0);
    const trail = await trailOf(record.id, 'report.import_withdrawn');
    expect(trail[0]?.reason).toBe(WITHDRAW_REASON);
  });

  it('removes the pictures themselves, rows and bytes, one delete from the store for each', async () => {
    const record = await keptWithTwo();
    const ids = record.maps.map((map) => map.figureId);
    const before = await documentsOf(ids);
    expect(before).toHaveLength(2);
    const deleted = vi.spyOn(h.storage, 'delete');
    try {
      const res = await withdraw(record.id);
      expect(res.status).toBe(200);
      await vi.waitFor(() => expect(deleted).toHaveBeenCalledTimes(2));
      expect(deleted.mock.calls.map(([key]) => key).sort()).toEqual(
        before.map((row) => row.storage_key).sort(),
      );
    } finally {
      deleted.mockRestore();
    }
    expect(await documentsOf(ids)).toHaveLength(0);
    for (const row of before) expect(await h.storage.exists(row.storage_key)).toBe(false);
  });

  it('leaves the wrong client’s Documents tab without them, for staff and for the household', async () => {
    const record = await keptWithTwo();
    const ids = record.maps.map((map) => map.figureId);
    expect((await withdraw(record.id)).status).toBe(200);
    const staff = await listedAs({ seeded: SEEDED.owner }, clientId);
    const home = await listedAs({ authId: household }, clientId);
    for (const listed of [staff, home]) {
      expect(listed.filter((doc) => ids.includes(doc.id))).toEqual([]);
    }
  });

  it('still refuses to remove the pictures of a kept record not withdrawn, and of a signed report', async () => {
    const record = await keptWithTwo();
    const map = record.maps[0];
    if (!map) throw new Error('No map.');
    expect(
      await sqlState(() =>
        h.asPerson(SEEDED.owner, (db) =>
          db.query('select app.remove_report_figure($1, $2)', [record.id, map.figureId]),
        ),
      ),
    ).toBe('23001');
    // Frozen: not even the table owner deletes the picture outside an erasure (903).
    expect(
      await sqlState(() => h.owner.query('delete from document where id = $1', [map.figureId])),
    ).not.toBeNull();

    const steps = qeegSteps(h, clientId);
    const draft = await steps.completeDraft(SEEDED.owner, { seed: 90 });
    const signed = await h.call(
      'POST',
      `/api/reports/${draft.id}/issue`,
      SEEDED.owner,
      { savedAt: draft.savedAt },
      { 'x-reason': 'Signing the brain-map report' },
    );
    expect(signed.status).toBe(201);
    const own = draft.maps[0];
    if (!own) throw new Error('No map.');
    expect(
      await sqlState(() =>
        h.asPerson(SEEDED.owner, (db) =>
          db.query('select app.remove_report_figure($1, $2)', [draft.id, own.figureId]),
        ),
      ),
    ).toBe('23001');
    expect(await documentsOf([own.figureId, map.figureId])).toHaveLength(2);
  });

  it('keeps a picture another report still links, and removes only the record’s own link', async () => {
    const record = await keptWithTwo();
    const [shared, alone] = record.maps;
    if (!shared || !alone) throw new Error('No maps.');
    // A draft of the same client that borrows the first picture, linked as
    // the borrow function links one.
    const other = await qeegSteps(h, clientId).newDraft(SEEDED.owner);
    await h.owner.query(
      'insert into report_figure (tenant_id, client_id, report_id, document_id, ' +
        'borrowed_from_report_id, sha256, width_px, height_px) ' +
        "values ($1, $2, $3, $4, $5, decode($6, 'hex'), $7, $8)",
      [
        h.data.tenant.id,
        clientId,
        other.id,
        shared.figureId,
        record.id,
        shared.sha256,
        shared.widthPx,
        shared.heightPx,
      ],
    );
    expect((await withdraw(record.id)).status).toBe(200);
    expect((await documentsOf([shared.figureId])).map((row) => row.id)).toEqual([shared.figureId]);
    expect(await documentsOf([alone.figureId])).toHaveLength(0);
    const links = await h.owner.query<{ report_id: string }>(
      'select report_id from report_figure where document_id = $1',
      [shared.figureId],
    );
    expect(links.rows.map((row) => row.report_id)).toEqual([other.id]);
  });

  it('withdraws an unfinished import draft too, removing its pictures, with the reason', async () => {
    const draft = await brought();
    const map = await upload(draft.report.id, 800);
    const [row] = await documentsOf([map.ref.figureId]);
    if (!row) throw new Error('The picture was not filed.');
    for (const as of [SEEDED.practitioner, SEEDED.admin]) {
      expect((await withdraw(draft.report.id, as)).status, String(as)).toBe(403);
    }
    const res = await withdraw(draft.report.id, LEAD);
    expect(res.status).toBe(200);
    expect(((await res.json()) as PastRecordResponse).report).toMatchObject({
      status: 'imported',
      withdrawn: true,
    });
    const after = await rowOf(draft.report.id);
    expect(after.content).toEqual({});
    expect(after.withdraw_reason).toBe(WITHDRAW_REASON);
    expect(after.source_sha256).not.toBeNull();
    expect(await documentsOf([map.ref.figureId])).toHaveLength(0);
    await vi.waitFor(async () => expect(await h.storage.exists(row.storage_key)).toBe(false));
    const trail = await trailOf(draft.report.id, 'report.import_withdrawn');
    expect(trail[0]?.reason).toBe(WITHDRAW_REASON);
  });

  it('leaves nothing of the erasure marker behind, and writes each picture’s deletion to the trail with the reason', async () => {
    const record = await keptWithTwo();
    const ids = record.maps.map((map) => map.figureId);
    expect((await withdraw(record.id)).status).toBe(200);
    const marker = await h.owner.query<{ n: string }>(
      'select count(*)::text as n from app.erasure_active',
    );
    expect(marker.rows[0]?.n).toBe('0');
    for (const id of ids) {
      const { rows } = await h.owner.query<{ reason: string | null; client_id: string | null }>(
        "select reason, client_id from audit_log where entity_type = 'document' " +
          "and entity_id = $1 and action = 'delete'",
        [id],
      );
      expect(rows, id).toHaveLength(1);
      expect(rows[0]).toEqual({ reason: WITHDRAW_REASON, client_id: clientId });
    }
  });

  it('removes a picture filed to an unfinished import while the withdraw waited for it', async () => {
    const draft = await brought();
    const first = await upload(draft.report.id, 850);
    // Another connection files a second picture and holds the report's row,
    // as the upload function does, uncommitted.
    const other = await secondConnection();
    const late = '0000000d-0000-4000-8000-0000000008a1';
    try {
      await other.query('begin');
      await other.query('select id from report where id = $1 for update', [draft.report.id]);
      const bytes = await goodPng(40, 30, 851);
      await linkFigureAsOwner(
        other,
        { tenantId: h.data.tenant.id, clientId, reportId: draft.report.id },
        { documentId: late, sha256: sha256Hex(bytes) },
      );
      const pid = (await other.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0]
        ?.pid;
      const pending = withdraw(draft.report.id);
      expect(await blockedBy(pid ?? -1)).toBe(true);
      await other.query('commit');
      expect((await pending).status).toBe(200);
    } finally {
      await other.end();
    }
    expect(await documentsOf([first.ref.figureId, late])).toHaveLength(0);
    const links = await h.owner.query('select 1 from report_figure where report_id = $1', [
      draft.report.id,
    ]);
    expect(links.rowCount).toBe(0);
  });

  it('refuses a practitioner and a coordinator, and a withdraw with no reason', async () => {
    const record = await kept();
    for (const as of [SEEDED.practitioner, SEEDED.admin]) {
      expect((await withdraw(record.id, as)).status, String(as)).toBe(403);
    }
    const none = await withdraw(record.id, SEEDED.owner, '   ');
    expect(none.status).toBe(400);
    expect(((await none.json()) as { error: string }).error).toBe('reason_required');
    expect((await rowOf(record.id)).withdrawn_at).toBeNull();
  });

  it('refuses a reason longer than the stamp keeps', async () => {
    const record = await kept();
    const res = await withdraw(
      record.id,
      SEEDED.owner,
      `Kept against the wrong client. ${'More words. '.repeat(20)}`,
    );
    expect(res.status).toBe(400);
    expect(await codeOf(res)).toBe('reason_too_long');
  });

  it('refuses a second withdraw, and a report signed in the app', async () => {
    const record = await kept();
    expect((await withdraw(record.id)).status).toBe(200);
    expect(await codeOf(await withdraw(record.id))).toBe('already_withdrawn');
    const ours = await qeegSteps(h, clientId).newDraft(SEEDED.owner);
    expect(await codeOf(await withdraw(ours.id))).toBe('not_a_past_record');
  });

  it('refuses while a follow-up is compared with it, and names the follow-up', async () => {
    const record = await kept();
    const follow = await h.call(
      'POST',
      '/api/reports/draft',
      SEEDED.owner,
      {
        clientId,
        kind: 'qeeg',
        locale: 'en',
        content: { ...sent(sparseFollowUp()), comparedWith: { reportId: record.id } },
      },
      { 'x-reason': 'Saving the brain-map draft' },
    );
    expect(follow.status).toBe(201);
    const followId = ((await follow.json()) as QeegDraftResponse).report.id;
    const res = await withdraw(record.id);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'in_comparison', reportIds: [followId] });
    const row = await rowOf(record.id);
    expect(row.withdrawn_at).toBeNull();
    expect(Object.keys((row.content as unknown as QeegContent).maps)).toEqual(['map-0']);
  });

  it('lets the same file come in again for the right client once withdrawn from the wrong one', async () => {
    const file = newFile();
    const wrong = await kept(otherClientId, file);
    expect((await withdraw(wrong.id)).status).toBe(200);
    // The stamp stays on the wrong client: that file is refused there again.
    const there = await bringIn(bodyFor(file, otherClientId));
    expect(there.status).toBe(409);
    expect(await there.json()).toMatchObject({ code: 'already_imported', status: 'imported' });
    expect((await bringIn(bodyFor(file, clientId))).status).toBe(201);
  });
});

describe('every other door refuses a past record by its code', () => {
  let keptId: string;
  let draftId: string;
  let draftSavedAt: string;
  let contactId: string;

  beforeAll(async () => {
    keptId = (await kept()).id;
    const draft = await brought();
    draftId = draft.report.id;
    draftSavedAt = draft.savedAt;
    const contact = await h.owner.query<{ id: string }>(
      'select id from contact where client_id = $1 order by id limit 1',
      [clientId],
    );
    contactId = contact.rows[0]?.id ?? '';
  });

  const reason = { 'x-reason': 'Trying a door on a past record' };

  it('refuses to sign one', async () => {
    const onKept = await h.call(
      'POST',
      `/api/reports/${keptId}/issue`,
      SEEDED.owner,
      { savedAt: draftSavedAt },
      reason,
    );
    expect(onKept.status).toBe(422);
    expect(await codeOf(onKept)).toBe('imported_record');
    const onDraft = await h.call(
      'POST',
      `/api/reports/${draftId}/issue`,
      SEEDED.owner,
      { savedAt: draftSavedAt },
      reason,
    );
    expect(onDraft.status).toBe(422);
    expect(await codeOf(onDraft)).toBe('imported_draft');
  });

  it('refuses to correct one', async () => {
    const body = { reason: 'A correction nobody should make.' };
    const onKept = await h.call(
      'POST',
      `/api/reports/${keptId}/supersede`,
      SEEDED.owner,
      body,
      reason,
    );
    expect(onKept.status).toBe(422);
    expect(await codeOf(onKept)).toBe('imported_record');
    const onDraft = await h.call(
      'POST',
      `/api/reports/${draftId}/supersede`,
      SEEDED.owner,
      body,
      reason,
    );
    expect(onDraft.status).toBe(422);
    expect(await codeOf(onDraft)).toBe('imported_draft');
  });

  it('refuses to send one to the household', async () => {
    const body = { contactId, channel: 'email' };
    const onKept = await h.call(
      'POST',
      `/api/reports/${keptId}/deliver`,
      SEEDED.owner,
      body,
      reason,
    );
    expect(onKept.status).toBe(422);
    expect(await codeOf(onKept)).toBe('imported_record');
    const onDraft = await h.call(
      'POST',
      `/api/reports/${draftId}/deliver`,
      SEEDED.owner,
      body,
      reason,
    );
    expect(onDraft.status).toBe(422);
    expect(await codeOf(onDraft)).toBe('imported_draft');
  });

  it('refuses the other language of one', async () => {
    for (const id of [keptId, draftId]) {
      const res = await h.call('POST', `/api/reports/${id}/twin`, SEEDED.owner, {}, reason);
      expect(res.status).toBe(422);
      expect(await codeOf(res)).toBe('imported_record');
    }
  });

  it('refuses to save over one through the draft door', async () => {
    const onKept = await h.call(
      'POST',
      '/api/reports/draft',
      SEEDED.owner,
      { id: keptId, clientId, kind: 'qeeg', savedAt: draftSavedAt, content: {} },
      reason,
    );
    expect(onKept.status).toBe(422);
    expect(await codeOf(onKept)).toBe('imported_record');
    const onDraft = await h.call(
      'POST',
      '/api/reports/draft',
      SEEDED.owner,
      { id: draftId, clientId, kind: 'qeeg', savedAt: draftSavedAt, content: {} },
      reason,
    );
    expect(onDraft.status).toBe(422);
    expect(await codeOf(onDraft)).toBe('imported_draft');
  });

  it('refuses a preview: a past record has no pages of this app’s', async () => {
    const onKept = await h.call('GET', `/api/reports/${keptId}/preview?locale=en`, SEEDED.owner);
    expect(onKept.status).toBe(422);
    expect(await codeOf(onKept)).toBe('imported_record');
    const onDraft = await h.call('GET', `/api/reports/${draftId}/preview?locale=en`, SEEDED.owner);
    expect(onDraft.status).toBe(422);
    expect(await codeOf(onDraft)).toBe('imported_draft');
  });

  it('shows a household neither the draft nor the kept record', async () => {
    for (const id of [keptId, draftId]) {
      expect((await h.callAs('GET', `/api/reports/${id}`, household)).status).toBe(404);
    }
    const list = await h.callAs('GET', `/api/reports?clientId=${clientId}`, household);
    expect(list.status).toBe(200);
    const ids = ((await list.json()) as ReportListResponse).reports.map((row) => row.id);
    expect(ids).not.toContain(keptId);
    expect(ids).not.toContain(draftId);
  });
});

describe('a household never sees a brain-map picture (change request 11a)', () => {
  it('lists none and opens none, while staff see them and the household’s other documents stay', async () => {
    const record = await keptWithTwo();
    const draft = await brought();
    const draftMap = await upload(draft.report.id, 900);
    const pictures = [...record.maps.map((map) => map.figureId), draftMap.ref.figureId];
    const filed = await h.call(
      'POST',
      `/api/clients/${clientId}/documents`,
      SEEDED.owner,
      {
        kind: 'referral',
        file: {
          mimeType: 'application/pdf',
          bytesBase64: Buffer.from('%PDF-1.7\n% synthetic\n').toString('base64'),
        },
      },
      { 'x-reason': 'Filing a referral letter' },
    );
    expect(filed.status).toBe(201);
    const referral = ((await filed.json()) as { id: string }).id;

    const staff = await listedAs({ seeded: SEEDED.owner }, clientId);
    const home = await listedAs({ authId: household }, clientId);
    expect(staff.map((doc) => doc.id)).toEqual(expect.arrayContaining(pictures));
    expect(home.filter((doc) => doc.kind === 'report_figure')).toEqual([]);
    expect(home.map((doc) => doc.id)).toContain(referral);
    // Every other document the staff see, the household sees as before.
    expect(home.map((doc) => doc.id).sort()).toEqual(
      staff
        .filter((doc) => doc.kind !== 'report_figure')
        .map((doc) => doc.id)
        .sort(),
    );

    for (const id of pictures) {
      const path = `/api/clients/${clientId}/documents/${id}/link`;
      expect((await h.callAs('GET', path, household)).status, id).toBe(404);
      expect(
        (await h.call('GET', path, SEEDED.owner, undefined, { 'x-reason': 'Opening a map' }))
          .status,
      ).toBe(200);
    }
    expect(
      (await h.callAs('GET', `/api/clients/${clientId}/documents/${referral}/link`, household))
        .status,
    ).toBe(200);
  });
});

describe('the row policy on a picture (change request 11a)', () => {
  it('gives a household contact no report_figure row under row security, and staff every one', async () => {
    const record = await keptWithTwo();
    const ids = record.maps.map((map) => map.figureId);
    const householdUser = HOUSEHOLD_USER;
    expect(await read(householdUser, 'client_contact', ids)).toEqual([]);
    // A document of the household's own that is not a picture is read, so
    // the empty answer above is the policy's exclusion and not a read that
    // finds nothing at all.
    const referral = await fileReferral();
    expect(await read(householdUser, 'client_contact', [...ids, referral])).toEqual([referral]);
    const owner = h.data.users[SEEDED.owner];
    if (!owner) throw new Error('No owner.');
    expect((await read(owner.id, 'owner', [...ids, referral])).sort()).toEqual(
      [...ids, referral].sort(),
    );
  });
});

describe('the Documents route on a picture, with the policy’s exclusion taken away', () => {
  it('still lists none and opens none for a household: the route’s own filter holds', async () => {
    const record = await keptWithTwo();
    const ids = record.maps.map((map) => map.figureId);
    const referral = await fileReferral();
    // The contact arm without `kind <> 'report_figure'`, as it stood before
    // request 11a, so the household's reads reach the pictures' rows.
    await h.owner.query('drop policy client_record_readers on public.document');
    await h.owner.query(
      'create policy client_record_readers on public.document as restrictive for select ' +
        "to app_role using (case when client_id is null then app.actor_has_role('owner') " +
        "else app.actor_has_role('owner') or (app.actor_has_role('client_contact') " +
        'and app.actor_is_contact_of(client_id)) end)',
    );
    try {
      expect(await read(HOUSEHOLD_USER, 'client_contact', ids)).toHaveLength(ids.length);
      const home = await listedAs({ authId: household }, clientId);
      expect(home.filter((doc) => doc.kind === 'report_figure')).toEqual([]);
      expect(home.map((doc) => doc.id)).toContain(referral);
      for (const id of ids) {
        const path = `/api/clients/${clientId}/documents/${id}/link`;
        expect((await h.callAs('GET', path, household)).status, id).toBe(404);
      }
    } finally {
      // The policies as the runner applies them.
      await h.owner.query(readFileSync('db/policies/client/readers.sql', 'utf8'));
    }
    expect(await read(HOUSEHOLD_USER, 'client_contact', ids)).toEqual([]);
  });
});

describe('an erasure reaches a past record', () => {
  it('clears its fingerprint and removes its maps, and the trail still verifies', async () => {
    const record = await kept(erasedClientId);
    const request = await h.owner.query<{ id: string }>(
      'insert into erasure_request (tenant_id, client_id, reason) ' +
        "values ($1, $2, 'The household asked.') returning id",
      [h.data.tenant.id, erasedClientId],
    );
    await h.owner.query(
      "select set_config('app.tenant_id', $1, false), set_config('app.actor_roles', 'owner', false)",
      [h.data.tenant.id],
    );
    try {
      await h.owner.query('select app.erase_client($1, $2)', [erasedClientId, request.rows[0]?.id]);
    } finally {
      await h.owner.query(
        "select set_config('app.tenant_id', '', false), set_config('app.actor_roles', '', false)",
      );
    }
    const row = await rowOf(record.id);
    expect(row.source_sha256).toBeNull();
    const links = await h.owner.query('select 1 from report_figure where report_id = $1', [
      record.id,
    ]);
    expect(links.rowCount).toBe(0);
    const broken = await h.owner.query<{ broken: string | null }>(
      'select app.verify_audit_chain()::text as broken',
    );
    expect(broken.rows[0]?.broken).toBeNull();
  });
});

describe('a follow-up compared with a kept past record', () => {
  it('is listed with its day of recording, and a follow-up compared with it saves, previews and signs', async () => {
    const draft = await brought();
    const first = await upload(draft.report.id, 500);
    const second = await upload(draft.report.id, 501);
    const keptRes = await keep(draft.report.id, {
      savedAt: second.savedAt,
      maps: placed([first.ref, second.ref]),
      leftOut: [],
    });
    expect(keptRes.status).toBe(200);
    const pastId = draft.report.id;

    const list = await h.call('GET', `/api/reports?clientId=${clientId}`, SEEDED.owner);
    const row = ((await list.json()) as ReportListResponse).reports.find((r) => r.id === pastId);
    expect(row).toMatchObject({ status: 'imported', pastRecord: true, recordedOn: '2026-03-14' });

    const follow = await h.call(
      'POST',
      '/api/reports/draft',
      SEEDED.owner,
      {
        clientId,
        kind: 'qeeg',
        locale: 'en',
        content: { ...sent(sparseFollowUp()), comparedWith: { reportId: pastId } },
      },
      { 'x-reason': 'Saving the brain-map draft' },
    );
    expect(follow.status).toBe(201);
    const blank = (await follow.json()) as QeegDraftResponse;
    expect(blank.content).toMatchObject({
      comparedWith: { reportId: pastId, origin: 'imported', reference: null },
    });
    let savedAt = blank.savedAt;
    const own: FigureRef[] = [];
    for (const seed of [510, 511, 512, 513]) {
      const filed = await upload(blank.report.id, seed);
      own.push(filed.ref);
      savedAt = filed.savedAt;
    }
    const [mapA, mapB, laterClosed, laterOpen] = own;
    if (!mapA || !mapB || !laterClosed || !laterOpen) throw new Error('Uploads went missing.');
    const full = fullFollowUp();
    const content = {
      ...sent(full),
      comparedWith: { reportId: pastId },
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
    };
    const saved = await h.call(
      'POST',
      '/api/reports/draft',
      SEEDED.owner,
      { clientId, kind: 'qeeg', id: blank.report.id, savedAt, content },
      { 'x-reason': 'Saving the brain-map draft' },
    );
    if (saved.status !== 200)
      throw new Error(`Save refused: ${saved.status} ${await saved.text()}`);
    const body = (await saved.json()) as QeegDraftResponse;

    const preview = await h.call(
      'GET',
      `/api/reports/${blank.report.id}/preview?locale=en`,
      SEEDED.owner,
    );
    expect(preview.status).toBe(200);
    const signed = await h.call(
      'POST',
      `/api/reports/${blank.report.id}/issue`,
      SEEDED.owner,
      { savedAt: body.savedAt },
      { 'x-reason': 'Signing the brain-map report' },
    );
    expect(signed.status).toBe(201);
  });
});
