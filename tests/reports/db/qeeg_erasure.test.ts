import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { QeegDraftResponse } from '../../../app/api/reports/schema';
import type { FigureFiledResponse } from '../../../app/api/reports/qeeg/figureSchema';
import { blankFollowUp, blankInitial } from '../../../domain/reports/qeeg/blank';
import type { ComparedWith, QeegInitial } from '../../../domain/reports/qeeg/types';
import { goodPng, linkFigureAsOwner, sha256Hex } from './figures-support';
import { SEEDED, startHarness, type Harness } from './support';

/**
 * An erasure reaches a brain-map report's pictures and its past records
 * (docs/SPEC/reports-qeeg.md section 9, point 8; migration 972; J's "For 972").
 *
 * The links go, then the documents under the same act as every other document
 * of the client's, their storage keys onto the worklist the after-commit sweep
 * reads. A past record's fingerprint goes, and a withdrawn one's reason is
 * replaced by the fixed phrase. Afterwards nothing that could identify the
 * pictures, the files brought in or what was written about the household is
 * left in any column of any table the erasure is answerable for, and the audit
 * chain is whole.
 *
 * Every picture is synthetic and every person is the seed's own invention.
 */

const NOW = () => new Date('2026-09-30T08:00:00.000Z');
const SIGNED_SHA = '1'.repeat(64);
const SOURCE_SHA = '2'.repeat(64);
const WITHDRAWN_SHA = '3'.repeat(64);
const WITHDRAW_REASON = 'Kept against the wrong household on the day';
const SIGNED_FIGURE = '0000000d-0000-4000-8000-0000000000d1';
/** The name a signed report snapshots at signing (600): a seed family name. */
const RECIPIENT = 'Cedar Meadow';

let h: Harness;
let clientId: string;

/** What the erasure must leave nowhere, and where each came from. */
const needles: { what: string; text: string }[] = [];
let uploadedKey = '';
let signedKey = '';
let summary: Record<string, unknown> = {};
let erasedDraftImport = '';
/** The client's own name as the seed wrote it, in each script it holds. */
let ownNames: string[] = [];

beforeAll(async () => {
  h = await startHarness(NOW);
  const index = h.data.clients.findIndex(
    (c) => c.status === 'active' && c.givenNameAr !== null && c.sexAtBirth !== 'unknown',
  );
  if (index < 0) throw new Error('The seed has no client to write about.');
  clientId = h.clientId(index);
  const tenantId = h.data.tenant.id;
  const person = h.data.clients[index];
  ownNames = [
    `${person?.givenName ?? ''} ${person?.familyName ?? ''}`,
    `${person?.givenNameAr ?? ''} ${person?.familyNameAr ?? ''}`,
  ];

  // 1. A draft with a picture uploaded through the door.
  const draftRes = await h.call(
    'POST',
    '/api/reports/draft',
    SEEDED.owner,
    {
      clientId,
      kind: 'qeeg',
      content: Object.fromEntries(
        Object.entries(blankInitial()).filter(([k]) => k !== 'subject' && k !== 'provenance'),
      ),
    },
    { 'x-reason': 'Starting the brain-map draft' },
  );
  const draft = (await draftRes.json()) as QeegDraftResponse;
  const bytes = await goodPng(16, 12, 42);
  const filedRes = await h.raw(
    'PUT',
    `/api/reports/${draft.report.id}/figures`,
    SEEDED.owner,
    bytes,
    {
      'content-type': 'image/png',
      'x-sha256': sha256Hex(bytes),
      'x-reason': 'Adding the brain maps',
    },
  );
  if (filedRes.status !== 201) throw new Error(`Upload refused: ${filedRes.status}`);
  const filed = (await filedRes.json()) as FigureFiledResponse;
  needles.push({ what: 'the uploaded picture', text: filed.figure.figureId });
  needles.push({ what: 'the uploaded digest', text: filed.figure.sha256 });

  // 2. A signed first report that prints a picture, and a follow-up that
  //    borrows it.
  const earlier: QeegInitial = {
    ...blankInitial(),
    recording: { recordedOn: '2026-03-14', eyes: 'closed_and_open', handedness: 'right' },
    maps: {
      'map-0': {
        figureId: SIGNED_FIGURE,
        sha256: SIGNED_SHA,
        widthPx: 800,
        heightPx: 600,
        condition: 'eyes_open',
        caption: null,
        position: 0,
      },
    },
  };
  const signed = await h.owner.query<{ id: string }>(
    "insert into report (tenant_id, client_id, kind, content) values ($1, $2, 'qeeg', $3::jsonb) " +
      'returning id',
    [tenantId, clientId, JSON.stringify(earlier)],
  );
  const signedId = signed.rows[0]?.id ?? '';
  await linkFigureAsOwner(
    h.owner,
    { tenantId, clientId, reportId: signedId },
    { documentId: SIGNED_FIGURE, sha256: SIGNED_SHA },
  );
  await h.owner.query(
    "update report set status = 'issued', number = 811, issued_on = current_date, " +
      "signed_at = now(), signed_by_practitioner_id = $2, signed_by_name = 'Rowan Ridge', " +
      "signed_by_certification = 'bcia_bcn', recipient_name = $3, " +
      "recipient_record_number = 'MW-000001', practice_legal_name = 'Synthetic Studio' " +
      'where id = $1',
    [signedId, h.practitionerIdOf(SEEDED.owner), RECIPIENT],
  );
  needles.push({ what: 'the name the signed report was made out to', text: RECIPIENT });
  needles.push({ what: 'the signed picture', text: SIGNED_FIGURE });
  needles.push({ what: 'the signed digest', text: SIGNED_SHA });

  const placeholder: ComparedWith = {
    reportId: signedId,
    recordedOn: '2026-03-14',
    relation: 'initial',
    origin: 'issued',
    reference: 'RPT-000000',
  };
  const followUp = await h.call(
    'POST',
    '/api/reports/draft',
    SEEDED.owner,
    {
      clientId,
      kind: 'qeeg',
      content: {
        ...Object.fromEntries(
          Object.entries(blankFollowUp(placeholder, 'follow_up')).filter(
            ([k]) => k !== 'subject' && k !== 'provenance',
          ),
        ),
        comparedWith: { reportId: signedId },
      },
    },
    { 'x-reason': 'Starting the follow-up' },
  );
  if (followUp.status !== 201) throw new Error(`Follow-up refused: ${await followUp.text()}`);

  // 3. A past record, kept; and another, kept and then withdrawn.
  const kept = await h.owner.query<{ id: string }>(
    'insert into report (tenant_id, client_id, kind, content, imported_from, source_sha256) ' +
      "values ($1, $2, 'qeeg', $3::jsonb, 'qeeg.json/1', $4) returning id",
    [tenantId, clientId, JSON.stringify(blankInitial()), SOURCE_SHA],
  );
  await h.owner.query("update report set status = 'imported' where id = $1", [kept.rows[0]?.id]);
  needles.push({ what: 'the kept record’s fingerprint', text: SOURCE_SHA });

  const withdrawn = await h.owner.query<{ id: string }>(
    'insert into report (tenant_id, client_id, kind, content, imported_from, source_sha256) ' +
      "values ($1, $2, 'qeeg', $3::jsonb, 'qeeg.json/1', $4) returning id",
    [tenantId, clientId, JSON.stringify(blankInitial()), WITHDRAWN_SHA],
  );
  const withdrawnId = withdrawn.rows[0]?.id;
  await h.owner.query("update report set status = 'imported' where id = $1", [withdrawnId]);
  await h.owner.query(
    "update report set withdrawn_at = now(), withdraw_reason = $2, content = '{}'::jsonb " +
      'where id = $1',
    [withdrawnId, WITHDRAW_REASON],
  );
  needles.push({ what: 'the withdrawn record’s fingerprint', text: WITHDRAWN_SHA });
  needles.push({ what: 'the reason it was withdrawn', text: WITHDRAW_REASON });

  // 4. A draft brought in from a file and not yet kept.
  const importDraft = await h.owner.query<{ id: string }>(
    'insert into report (tenant_id, client_id, kind, content, imported_from, source_sha256) ' +
      "values ($1, $2, 'qeeg', $3::jsonb, 'qeeg.json/1', $4) returning id",
    [tenantId, clientId, JSON.stringify(blankInitial()), '4'.repeat(64)],
  );
  erasedDraftImport = importDraft.rows[0]?.id ?? '';
  needles.push({ what: 'the import draft’s fingerprint', text: '4'.repeat(64) });

  const keys = await h.owner.query<{ id: string; storage_key: string }>(
    'select id, storage_key from document where id = any($1::uuid[])',
    [[filed.figure.figureId, SIGNED_FIGURE]],
  );
  uploadedKey = keys.rows.find((r) => r.id === filed.figure.figureId)?.storage_key ?? '';
  signedKey = keys.rows.find((r) => r.id === SIGNED_FIGURE)?.storage_key ?? '';

  // The erasure, through app.erase_client as the record's own route calls it.
  const request = await h.owner.query<{ id: string }>(
    'insert into erasure_request (tenant_id, client_id, reason) ' +
      "values ($1, $2, 'The household asked.') returning id",
    [tenantId, clientId],
  );
  await h.owner.query(
    "select set_config('app.tenant_id', $1, false), set_config('app.actor_roles', 'owner', false)",
    [tenantId],
  );
  const erased = await h.owner.query<{ summary: Record<string, unknown> }>(
    'select app.erase_client($1, $2) as summary',
    [clientId, request.rows[0]?.id],
  );
  summary = erased.rows[0]?.summary ?? {};
  await h.owner.query(
    "select set_config('app.tenant_id', '', false), set_config('app.actor_roles', '', false)",
  );
}, 180_000);

afterAll(async () => {
  await h.close();
});

describe('an erasure reaches the brain maps', () => {
  it('removes every link of the client’s, the borrowed one included', async () => {
    expect(summary['reportFiguresUnlinked']).toBe(3);
    const { rows } = await h.owner.query<{ n: string }>(
      'select count(*)::text as n from report_figure where client_id = $1',
      [clientId],
    );
    expect(Number(rows[0]?.n)).toBe(0);
  });

  it('deletes the pictures and queues their bytes for the sweep, as every other document', async () => {
    const { rows } = await h.owner.query<{ n: string }>(
      "select count(*)::text as n from document where client_id = $1 and kind = 'report_figure'",
      [clientId],
    );
    expect(Number(rows[0]?.n)).toBe(0);
    const pending = await h.owner.query<{ keys: { storageKey: string }[] }>(
      'select storage_keys_pending as keys from erasure_request where client_id = $1',
      [clientId],
    );
    const queued = pending.rows[0]?.keys.map((entry) => entry.storageKey) ?? [];
    expect(queued).toContain(uploadedKey);
    expect(queued).toContain(signedKey);
  });

  it('clears the past records’ fingerprints and a withdrawal’s reason, and keeps the rest of the row', async () => {
    const { rows } = await h.owner.query<{
      status: string;
      imported_from: string | null;
      source_sha256: string | null;
      withdraw_reason: string | null;
      withdrawn: boolean;
      content: unknown;
    }>(
      'select status::text as status, imported_from, source_sha256, withdraw_reason, ' +
        'withdrawn_at is not null as withdrawn, content from report ' +
        'where client_id = $1 and imported_from is not null order by created_at',
      [clientId],
    );
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.source_sha256).toBeNull();
      expect(row.imported_from).toBe('qeeg.json/1');
      expect(row.content).toEqual({});
      expect(row.withdraw_reason).toBe(row.withdrawn ? 'Erased with the record' : null);
    }
    expect(rows.map((row) => row.status)).toEqual(['imported', 'imported', 'draft']);
  });

  it('makes a signed report out to the erased client, and leaves a draft made out to nobody', async () => {
    const { rows } = await h.owner.query<{ status: string; recipient_name: string | null }>(
      'select status::text as status, recipient_name from report where client_id = $1',
      [clientId],
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.recipient_name).toBe(row.status === 'issued' ? 'Erased client' : null);
    }
    expect(rows.some((row) => row.status === 'issued')).toBe(true);
  });

  it('leaves the client’s name in no column of any of their reports', async () => {
    const columns = await h.owner.query<{ name: string }>(
      'select attname as name from pg_attribute ' +
        "where attrelid = 'public.report'::regclass and attnum > 0 and not attisdropped " +
        'order by attnum',
    );
    expect(columns.rows.length).toBeGreaterThan(20);
    const names = [RECIPIENT, ...ownNames.filter((name) => name.trim() !== '')];
    const found: string[] = [];
    for (const { name: column } of columns.rows) {
      for (const text of names) {
        const { rows } = await h.owner.query<{ n: string }>(
          `select count(*)::text as n from public.report where client_id = $1 ` +
            `and ${JSON.stringify(column)}::text like $2`,
          [clientId, `%${text}%`],
        );
        if (Number(rows[0]?.n) > 0) found.push(`${text} in report.${column}`);
      }
    }
    expect(found).toEqual([]);
  });

  it('leaves nothing that could identify them in any column of any table', async () => {
    const tables = await h.owner.query<{ name: string }>(
      'select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace ' +
        "where n.nspname = 'public' and c.relkind = 'r' " +
        // The trail (the table and its monthly partitions) is append-only and
        // outlives the record by design; the erasure's own request holds the
        // worklist of keys it must remove.
        "and c.relname not like 'audit\\_log%' and c.relname <> 'erasure_request' order by 1",
    );
    const found: string[] = [];
    for (const { name } of tables.rows) {
      for (const needle of needles) {
        const { rows } = await h.owner.query<{ n: string }>(
          `select count(*)::text as n from public.${name} as x where x::text like $1`,
          [`%${needle.text}%`],
        );
        if (Number(rows[0]?.n) > 0) found.push(`${needle.what} in ${name}`);
      }
    }
    expect(found).toEqual([]);
  });

  it('leaves the audit chain whole', async () => {
    const { rows } = await h.owner.query<{ broken: string | null }>(
      'select app.verify_audit_chain()::text as broken',
    );
    expect(rows[0]?.broken).toBeNull();
  });
});

describe('a past record needs its fingerprint while it says anything', () => {
  it('never keeps a draft brought in from a file whose content is empty', async () => {
    await h.owner.query('begin');
    try {
      await h.owner.query(
        "select set_config('app.tenant_id', $1, true), set_config('app.actor_roles', 'owner', true)",
        [h.data.tenant.id],
      );
      const code = await h.owner
        .query('select app.keep_imported_report($1)', [erasedDraftImport])
        .then(
          () => null,
          (error: { code?: string }) => error.code,
        );
      expect(code).toBe('23514');
    } finally {
      await h.owner.query('rollback');
    }
  });

  it('refuses a past record that says something and has no fingerprint', async () => {
    const other = h.data.clients.find((c) => c.status === 'active' && c.id !== clientId);
    const code = await h.owner
      .query(
        'insert into report (tenant_id, client_id, kind, status, content, imported_from) ' +
          "values ($1, $2, 'qeeg', 'imported', $3::jsonb, 'qeeg.json/1')",
        [h.data.tenant.id, other?.id, JSON.stringify(blankInitial())],
      )
      .then(
        () => null,
        (error: { code?: string }) => error.code,
      );
    expect(code).toBe('23514');
  });
});
