import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type {
  IssueResponse,
  QeegDraftResponse,
  ReportResponse,
} from '../../../app/api/reports/schema';
import { WORDS } from '../../../domain/reports/document/strings';
import { missingForIssue } from '../../../domain/reports/qeeg/complete';
import type * as Pages from '../../../domain/reports/qeeg/document';
import { fullFollowUp, sparseFollowUp } from '../../../domain/reports/qeeg/testing/reports';
import type { FigureRef, QeegInitial } from '../../../domain/reports/qeeg/types';
import type * as Wording from '../../../domain/reports/qeeg/wording';
import { extractAll } from '../../../domain/shared/document';
import { clientDocumentKey } from '../../../domain/shared/storage';
import { goodPng, sha256Hex } from './figures-support';
import {
  clientToWriteAbout,
  completeReport,
  householdOf,
  MAP_SIZE,
  pageCount,
  qeegSteps,
  sent,
} from './qeeg-signing-support';
import { SEEDED, startHarness, type Harness } from './support';

/**
 * Signing a brain-map report (docs/SPEC/reports-qeeg.md sections 9, 12 and
 * 14; brief P): `POST /api/reports/:id/issue` for a `qeeg` draft. It refuses,
 * each with its own code, a draft with anything left to fill, a language whose
 * words are still a draft, a picture uploaded and never placed, a map whose
 * bytes are gone, a page that runs over, a client who has been erased and a
 * save made since. Otherwise it gathers the client once more, snapshots the
 * signer, files the PDF with its digest, moves the report out of draft and
 * freezes its maps, with the reason on the trail.
 *
 * **The words are approved here by a test double.** Every language of the
 * wording is a draft on this branch (`WORDING_STATUS`), and changing that is
 * the practice's approval, never a test's. So this file stands in for the
 * approval of English, and one test turns it back to show the refusal.
 *
 * Everything is invented: the seed's people, the pages' fixtures, pictures
 * made from arithmetic.
 */

const wording = vi.hoisted(() => ({
  status: { en: 'approved', ar: 'draft' } as Record<string, string>,
}));
vi.mock('../../../domain/reports/qeeg/wording', async (importOriginal) => {
  const actual = await importOriginal<typeof Wording>();
  return { ...actual, WORDING_STATUS: wording.status };
});

const overrun = vi.hoisted(() => ({ parts: null as null | string[] }));
vi.mock('../../../domain/reports/qeeg/document', async (importOriginal) => {
  const actual = await importOriginal<typeof Pages>();
  return {
    ...actual,
    layoutQeegReport: (...args: Parameters<typeof actual.layoutQeegReport>) => {
      const laid = actual.layoutQeegReport(...args);
      return overrun.parts === null ? laid : { ...laid, overflowing: overrun.parts };
    },
  };
});

const NOW = () => new Date('2026-09-30T08:00:00.000Z');
const SIGN_REASON = 'Signing the brain-map report';

let h: Harness;
let clientId: string;
let clientIndex: number;
let steps: ReturnType<typeof qeegSteps>;
let household: string;

async function issue(
  draft: { id: string; savedAt: string },
  as: number = SEEDED.owner,
  headers: Record<string, string> = { 'x-reason': SIGN_REASON },
): Promise<Response> {
  return h.call('POST', `/api/reports/${draft.id}/issue`, as, { savedAt: draft.savedAt }, headers);
}

async function codeOf(res: Response): Promise<string> {
  return ((await res.json()) as { code?: string }).code ?? '';
}

async function statusOf(id: string): Promise<{ status: string; number: number | null }> {
  const { rows } = await h.owner.query<{ status: string; number: number | null }>(
    'select status::text as status, number from report where id = $1',
    [id],
  );
  const row = rows[0];
  if (!row) throw new Error('No such report.');
  return row;
}

beforeAll(async () => {
  h = await startHarness(NOW);
  const client = clientToWriteAbout(h);
  clientId = client.id;
  clientIndex = client.index;
  steps = qeegSteps(h, clientId);
  household = await householdOf(h, clientId, 2);
}, 180_000);

afterAll(async () => {
  await h.close();
});

describe('what the issue refuses, each by its own code', () => {
  it('refuses a signature that gives no reason', async () => {
    const draft = await steps.completeDraft(SEEDED.owner);
    const res = await issue(draft, SEEDED.owner, {});
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('reason_required');
  });

  it('refuses a body that names anything but the save it was made over', async () => {
    const draft = await steps.newDraft(SEEDED.owner);
    const res = await h.call(
      'POST',
      `/api/reports/${draft.id}/issue`,
      SEEDED.owner,
      { savedAt: draft.savedAt, practitionerId: h.practitionerIdOf(SEEDED.owner) },
      { 'x-reason': SIGN_REASON },
    );
    expect(res.status).toBe(400);
    expect(await codeOf(res)).toBe('invalid_request');
  });

  it('refuses a draft saved since the version on her screen', async () => {
    const draft = await steps.completeDraft(SEEDED.owner);
    const newer = await steps.saved(draft, draft.content, SEEDED.owner);
    expect(newer.savedAt).not.toBe(draft.savedAt);
    const res = await issue(draft);
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe('stale_draft');
  });

  it('refuses a draft with anything left to fill, and lists what', async () => {
    const draft = await steps.newDraft(SEEDED.owner);
    const res = await issue(draft);
    expect(res.status).toBe(422);
    const body = (await res.json()) as {
      code: string;
      missing: { section: string; what: string }[];
    };
    expect(body.code).toBe('incomplete');
    // The list the form counts: the domain's own, of what was saved.
    expect(body.missing).toEqual(missingForIssue(draft.content));
    expect(body.missing.length).toBeGreaterThan(20);
    expect((await statusOf(draft.id)).status).toBe('draft');
  });

  it('refuses to sign in a language whose words are still a draft', async () => {
    const draft = await steps.completeDraft(SEEDED.owner);
    wording.status.en = 'draft';
    try {
      const res = await issue(draft);
      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({ code: 'wording_draft', locale: 'en' });
    } finally {
      wording.status.en = 'approved';
    }
  });

  it('refuses while a picture uploaded to the draft is not placed on it, and names it', async () => {
    const draft = await steps.completeDraft(SEEDED.owner, { seed: 4 });
    const loose = await steps.upload(draft.id, SEEDED.owner, 49);
    const res = await issue({ id: draft.id, savedAt: loose.savedAt });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({
      code: 'unplaced_figures',
      figures: [loose.ref.figureId],
    });
  });

  it('refuses a map whose bytes are gone from the store, by the field that places it', async () => {
    const draft = await steps.completeDraft(SEEDED.owner, { seed: 5 });
    const gone = draft.maps[0];
    if (!gone) throw new Error('No map.');
    await h.storage.delete(clientDocumentKey(h.data.tenant.id, clientId, gone.figureId));
    const res = await issue(draft);
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({
      code: 'map_missing',
      field: 'maps.map-0.figureId',
      figureId: gone.figureId,
    });
    expect((await statusOf(draft.id)).status).toBe('draft');
  });

  it('refuses a map whose stored bytes are not the picture that was filed', async () => {
    const draft = await steps.completeDraft(SEEDED.owner, { seed: 12 });
    const changed = draft.maps[1];
    if (!changed) throw new Error('No map.');
    await h.storage.put(
      clientDocumentKey(h.data.tenant.id, clientId, changed.figureId),
      await goodPng(MAP_SIZE.width, MAP_SIZE.height, 98),
      'image/png',
      { overwrite: true },
    );
    const res = await issue(draft);
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({
      code: 'map_differs',
      field: 'maps.map-1.figureId',
      figureId: changed.figureId,
    });
    expect((await statusOf(draft.id)).status).toBe('draft');
  });

  it('refuses a map the draft names but no longer holds', async () => {
    const draft = await steps.completeDraft(SEEDED.owner, { seed: 13 });
    const loose = draft.maps[0];
    if (!loose) throw new Error('No map.');
    // Written by hand: the draft door refuses to save this (`unlinked_figure`).
    await h.owner.query('delete from report_figure where report_id = $1 and document_id = $2', [
      draft.id,
      loose.figureId,
    ]);
    const { rows } = await h.owner.query<{ saved_at: string }>(
      'select to_char(updated_at at time zone \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.US"Z"\') as saved_at ' +
        'from report where id = $1',
      [draft.id],
    );
    const res = await issue({ id: draft.id, savedAt: rows[0]?.saved_at ?? '' });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({
      code: 'unlinked_figure',
      field: 'maps.map-0.figureId',
      figureId: loose.figureId,
    });
  });

  it('refuses pages that run over, and takes no number and leaves it a draft', async () => {
    const draft = await steps.completeDraft(SEEDED.owner, { seed: 6 });
    overrun.parts = ['recommendation.2'];
    try {
      const res = await issue(draft);
      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({ code: 'overrun', parts: ['recommendation.2'] });
    } finally {
      overrun.parts = null;
    }
    expect(await statusOf(draft.id)).toEqual({ status: 'draft', number: null });
    const { rows } = await h.owner.query<{ n: string }>(
      "select count(*)::text as n from document where kind = 'report' and client_id = $1",
      [clientId],
    );
    const filedBefore = Number(rows[0]?.n);
    // The counter moved back with the refusal: the next signature takes the next number.
    const signed = await issue(draft);
    expect(signed.status).toBe(201);
    const after = await h.owner.query<{ n: string }>(
      "select count(*)::text as n from document where kind = 'report' and client_id = $1",
      [clientId],
    );
    expect(Number(after.rows[0]?.n)).toBe(filedBefore + 1);
  });

  it('refuses a client whose record has been erased', async () => {
    const index = h.data.clients.findIndex(
      (c, at) => c.status === 'active' && at !== clientIndex && c.givenNameAr !== null,
    );
    const other = qeegSteps(h, h.clientId(index));
    const draft = await other.completeDraft(SEEDED.owner, { seed: 7 });
    await h.owner.query("update client set status = 'erased' where id = $1", [h.clientId(index)]);
    const res = await issue(draft);
    expect(res.status).toBe(422);
    expect(await codeOf(res)).toBe('client_erased');
  });

  it('refuses a practitioner whose certificate does not let her sign', async () => {
    await h.onSchedule(clientIndex, SEEDED.practitioner);
    const draft = await steps.completeDraft(SEEDED.practitioner, { seed: 8 });
    const res = await issue(draft, SEEDED.practitioner);
    expect(res.status).toBe(403);
    expect(await codeOf(res)).toBe('credential_cannot_sign');
  });

  it('lets a household neither sign a draft nor see one', async () => {
    const draft = await steps.completeDraft(SEEDED.owner, { seed: 9 });
    const res = await h.callAs(
      'POST',
      `/api/reports/${draft.id}/issue`,
      household,
      { savedAt: draft.savedAt },
      { 'x-reason': SIGN_REASON },
    );
    expect(res.status).toBe(404);
  });
});

describe('a complete draft, signed', () => {
  let draft: Awaited<ReturnType<typeof steps.completeDraft>>;
  let answer: IssueResponse;
  let stored: Uint8Array;
  let documentRow: { id: string; storage_key: string; sha256: Buffer; is_immutable: boolean };

  beforeAll(async () => {
    draft = await steps.completeDraft(SEEDED.owner, { seed: 11 });
    // The record corrected after the last save: the signature reads it again.
    await h.owner.query(
      "update client set given_name_ar = 'ريم', date_of_birth = '1990-01-02', " +
        "sex_at_birth = 'male' where id = $1",
      [clientId],
    );
    const res = await issue(draft);
    if (res.status !== 201) throw new Error(`Refused: ${res.status} ${await res.text()}`);
    answer = (await res.json()) as IssueResponse;
    const { rows } = await h.owner.query<{
      id: string;
      storage_key: string;
      sha256: Buffer;
      is_immutable: boolean;
    }>(
      'select d.id, d.storage_key, d.sha256, d.is_immutable from report r ' +
        'join document d on d.id = r.document_id where r.id = $1',
      [draft.id],
    );
    const row = rows[0];
    if (!row) throw new Error('No document was filed.');
    documentRow = row;
    const bytes = await h.storage.get(row.storage_key);
    if (!bytes) throw new Error('The store holds nothing at that key.');
    stored = bytes;
  }, 60_000);

  it('issues a reference and moves the report out of draft', () => {
    expect(answer.report.status).toBe('issued');
    expect(answer.report.kind).toBe('qeeg');
    expect(answer.report.reference).toMatch(/^RPT-\d{6}$/);
    expect(answer.report.documentId).toBe(documentRow.id);
  });

  it('files the PDF as a document of the client, with the digest of its bytes', () => {
    expect(Buffer.from(stored.subarray(0, 8)).toString('latin1')).toBe('%PDF-1.7');
    expect(createHash('sha256').update(stored).digest('hex')).toBe(
      documentRow.sha256.toString('hex'),
    );
    expect(documentRow.is_immutable).toBe(true);
    expect(documentRow.storage_key).toBe(
      clientDocumentKey(h.data.tenant.id, clientId, documentRow.id),
    );
    expect(pageCount(stored)).toBeGreaterThan(3);
  });

  it('gathers the client once more at signing', async () => {
    const { rows } = await h.owner.query<{ content: QeegInitial }>(
      'select content from report where id = $1',
      [draft.id],
    );
    expect(rows[0]?.content.subject).toEqual({
      nameAr: expect.stringContaining('ريم'),
      ageYears: 36,
      sex: 'male',
    });
  });

  it('snapshots the signer, and prints the signature', async () => {
    const { rows } = await h.owner.query<{
      signed_by_practitioner_id: string;
      signed_by_name: string;
      signed_by_certification: string;
      signed_by_certificate_number: string | null;
    }>(
      'select signed_by_practitioner_id, signed_by_name, signed_by_certification, ' +
        'signed_by_certificate_number from report where id = $1',
      [draft.id],
    );
    const row = rows[0];
    expect(row?.signed_by_practitioner_id).toBe(h.practitionerIdOf(SEEDED.owner));
    expect(row?.signed_by_name).toBe(h.data.users[SEEDED.owner]?.displayName);
    expect(row?.signed_by_certification).toBeTruthy();
    const text = extractAll(stored);
    expect(text).toContain(row?.signed_by_name ?? 'no signer');
    expect(text).toContain(WORDS.certificateNumber.en);
    expect(text).toContain(answer.report.reference ?? 'no reference');
  });

  it('records the signature on the trail with the reason it was given', async () => {
    const { rows } = await h.owner.query<{ action: string; reason: string | null }>(
      "select action, reason from audit_log where entity_type = 'report' and entity_id = $1 " +
        "and action in ('update', 'report.issued') order by id desc limit 3",
      [draft.id],
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.reason === SIGN_REASON)).toBe(true);
    expect(rows.map((row) => row.action)).toContain('report.issued');
  });

  it('freezes its maps: a picture can be neither added nor removed', async () => {
    const bytes = await goodPng(MAP_SIZE.width, MAP_SIZE.height, 77);
    const added = await h.raw('PUT', `/api/reports/${draft.id}/figures`, SEEDED.owner, bytes, {
      'content-type': 'image/png',
      'x-sha256': sha256Hex(bytes),
      'x-reason': 'Adding a brain map after signing',
    });
    expect(added.status).toBe(422);
    expect(await codeOf(added)).toBe('not_a_draft');
    const first = draft.maps[0];
    if (!first) throw new Error('No map.');
    const removed = await h.raw(
      'DELETE',
      `/api/reports/${draft.id}/figures/${first.figureId}`,
      SEEDED.owner,
      undefined,
      { 'x-reason': 'Removing a brain map after signing' },
    );
    expect(removed.status).toBe(422);
    expect(await codeOf(removed)).toBe('not_a_draft');
    const { rows } = await h.owner.query<{ is_immutable: boolean }>(
      'select is_immutable from document where id = any($1::uuid[])',
      [draft.maps.map((map) => map.figureId)],
    );
    expect(rows.map((row) => row.is_immutable)).toEqual([true, true]);
  });

  it('cannot be edited: a save over it is refused', async () => {
    const res = await steps.saveOver(
      { id: draft.id, savedAt: draft.savedAt },
      { ...sent(draft.content), summary: { en: { text: 'Changed.', marks: [] }, ar: null } },
      SEEDED.owner,
    );
    expect(res.status).toBe(422);
    expect(await codeOf(res)).toBe('already_issued');
    const again = await issue(draft);
    expect(again.status).toBe(422);
    expect(await codeOf(again)).toBe('already_issued');
  });

  it('previews as exactly the file that was filed', async () => {
    const res = await h.call('GET', `/api/reports/${draft.id}/preview?locale=en`, SEEDED.owner);
    expect(res.status).toBe(200);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(Buffer.from(bytes).equals(Buffer.from(stored))).toBe(true);
    const arabic = await h.call('GET', `/api/reports/${draft.id}/preview?locale=ar`, SEEDED.owner);
    expect(arabic.status).toBe(422);
    expect(await codeOf(arabic)).toBe('locale_fixed');
  });

  it('is repaired from its row when the store lost its bytes, to the same bytes', async () => {
    await h.storage.delete(documentRow.storage_key);
    const res = await h.call('GET', `/api/reports/${draft.id}`, SEEDED.owner);
    expect(res.status).toBe(200);
    expect(((await res.json()) as ReportResponse).url).toBeTruthy();
    const back = await h.storage.get(documentRow.storage_key);
    expect(back && Buffer.from(back).equals(Buffer.from(stored))).toBe(true);
  });

  it('refuses to repair, by the field, when a map it prints is gone, and hands out no link', async () => {
    const first = draft.maps[0];
    if (!first) throw new Error('No map.');
    const mapKey = clientDocumentKey(h.data.tenant.id, clientId, first.figureId);
    const mapBytes = await h.storage.get(mapKey);
    if (!mapBytes) throw new Error('The map is not in the store.');
    await h.storage.delete(documentRow.storage_key);
    await h.storage.delete(mapKey);
    try {
      const res = await h.call('GET', `/api/reports/${draft.id}`, SEEDED.owner);
      expect(res.status).toBe(409);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toMatchObject({
        code: 'map_missing',
        field: 'maps.map-0.figureId',
        figureId: first.figureId,
      });
      expect(typeof body['sentence']).toBe('string');
      expect(body['url']).toBeUndefined();
      expect(await h.storage.exists(documentRow.storage_key)).toBe(false);
    } finally {
      await h.storage.put(mapKey, mapBytes, 'image/png', { overwrite: true });
      await h.storage.put(documentRow.storage_key, stored, 'application/pdf', { overwrite: true });
    }
  });

  it('answers a household 404 when its file is missing, never the practice’s repair sentence', async () => {
    const first = draft.maps[0];
    if (!first) throw new Error('No map.');
    const mapKey = clientDocumentKey(h.data.tenant.id, clientId, first.figureId);
    const mapBytes = await h.storage.get(mapKey);
    if (!mapBytes) throw new Error('The map is not in the store.');
    await h.storage.delete(documentRow.storage_key);
    await h.storage.delete(mapKey);
    try {
      const res = await h.callAs('GET', `/api/reports/${draft.id}`, household);
      expect(res.status).toBe(404);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body['sentence']).toBeUndefined();
      expect(body['url']).toBeUndefined();
      expect(body['code']).toBeUndefined();
      // Nothing re-rendered on the household's behalf either.
      expect(await h.storage.exists(documentRow.storage_key)).toBe(false);
    } finally {
      await h.storage.put(mapKey, mapBytes, 'image/png', { overwrite: true });
      await h.storage.put(documentRow.storage_key, stored, 'application/pdf', { overwrite: true });
    }
  });

  it('refuses to repair, by name, when its pages would now run over, and hands out no link', async () => {
    await h.storage.delete(documentRow.storage_key);
    overrun.parts = ['summary.1'];
    try {
      const res = await h.call('GET', `/api/reports/${draft.id}`, SEEDED.owner);
      expect(res.status).toBe(409);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toMatchObject({ code: 'document_overrun' });
      expect(typeof body['sentence']).toBe('string');
      expect(body['url']).toBeUndefined();
      expect(await h.storage.exists(documentRow.storage_key)).toBe(false);
    } finally {
      overrun.parts = null;
      await h.storage.put(documentRow.storage_key, stored, 'application/pdf', { overwrite: true });
    }
  });

  it('refuses to repair, by name, when its content can no longer be read, and hands out no link', async () => {
    const { rows } = await h.owner.query<{ content: unknown }>(
      'select content from report where id = $1',
      [draft.id],
    );
    const content = rows[0]?.content;
    // Past the guard, for this test alone and put back after: no route writes a signed body.
    const rewrite = async (value: unknown) => {
      await h.owner.query('alter table report disable trigger guard_report_write');
      try {
        await h.owner.query('update report set content = $2::jsonb where id = $1', [
          draft.id,
          JSON.stringify(value),
        ]);
      } finally {
        await h.owner.query('alter table report enable always trigger guard_report_write');
      }
    };
    await h.storage.delete(documentRow.storage_key);
    await rewrite({ ...(content as object), plan: 7 });
    try {
      const res = await h.call('GET', `/api/reports/${draft.id}`, SEEDED.owner);
      expect(res.status).toBe(409);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toMatchObject({ code: 'document_unreadable' });
      expect(typeof body['sentence']).toBe('string');
      expect(body['url']).toBeUndefined();
    } finally {
      await rewrite(content);
      await h.storage.put(documentRow.storage_key, stored, 'application/pdf', { overwrite: true });
    }
  });

  it('refuses to repair, by the field, when a map it prints is not what was filed', async () => {
    const second = draft.maps[1];
    if (!second) throw new Error('No map.');
    const mapKey = clientDocumentKey(h.data.tenant.id, clientId, second.figureId);
    const mapBytes = await h.storage.get(mapKey);
    if (!mapBytes) throw new Error('The map is not in the store.');
    await h.storage.delete(documentRow.storage_key);
    const other = await goodPng(MAP_SIZE.width, MAP_SIZE.height, 99);
    await h.storage.put(mapKey, other, 'image/png', { overwrite: true });
    try {
      const res = await h.call('GET', `/api/reports/${draft.id}`, SEEDED.owner);
      expect(res.status).toBe(409);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toMatchObject({ code: 'map_differs', field: 'maps.map-1.figureId' });
      expect(body['url']).toBeUndefined();
    } finally {
      await h.storage.put(mapKey, mapBytes, 'image/png', { overwrite: true });
      await h.storage.put(documentRow.storage_key, stored, 'application/pdf', { overwrite: true });
    }
  });

  it('refuses to repair with bytes that differ from what was filed', async () => {
    await h.storage.delete(documentRow.storage_key);
    await h.owner.query(
      "update document set sha256 = decode(repeat('ab', 32), 'hex') where id = $1",
      [documentRow.id],
    );
    try {
      const res = await h.call('GET', `/api/reports/${draft.id}`, SEEDED.owner);
      expect(res.status).toBe(409);
      expect(await codeOf(res)).toBe('document_bytes_differ');
      expect(await h.storage.exists(documentRow.storage_key)).toBe(false);
    } finally {
      await h.owner.query('update document set sha256 = $2 where id = $1', [
        documentRow.id,
        documentRow.sha256,
      ]);
      await h.storage.put(documentRow.storage_key, stored, 'application/pdf', { overwrite: true });
    }
  });
});

describe('two signatures at once', () => {
  it('signs once: one 201, one stale refusal, and one reference taken', async () => {
    const draft = await steps.completeDraft(SEEDED.owner, { seed: 41 });
    const before = await h.owner.query<{ next_number: number }>(
      'select next_number from report_number_series where tenant_id = $1',
      [h.data.tenant.id],
    );
    const [one, two] = await Promise.all([issue(draft), issue(draft)]);
    const statuses = [one.status, two.status].sort();
    expect(statuses).toEqual([201, 409]);
    const refused = one.status === 409 ? one : two;
    expect(await codeOf(refused)).toBe('stale_draft');
    const after = await h.owner.query<{ next_number: number }>(
      'select next_number from report_number_series where tenant_id = $1',
      [h.data.tenant.id],
    );
    expect(after.rows[0]?.next_number).toBe((before.rows[0]?.next_number ?? 0) + 1);
    // The reference on the report row is the one the winner was answered with,
    // made from the one number taken.
    const winner = (await (one.status === 201 ? one : two).json()) as IssueResponse;
    const row = await h.owner.query<{ reference: string; number: number }>(
      'select reference, number from report where id = $1',
      [draft.id],
    );
    expect(row.rows[0]?.reference).toBe(winner.report.reference);
    expect(row.rows[0]?.number).toBe(before.rows[0]?.next_number);
  });
});

describe('a follow-up, signed', () => {
  it('signs a follow-up compared with a signed first report, printing both sides of each pair', async () => {
    const first = await steps.completeDraft(SEEDED.owner, { seed: 21 });
    const firstSigned = await issue(first);
    expect(firstSigned.status).toBe(201);

    const draft = await steps.saveAs(SEEDED.owner, {
      locale: 'en',
      content: { ...sent(sparseFollowUp()), comparedWith: { reportId: first.id } },
    });
    expect(draft.status).toBe(201);
    const blank = (await draft.json()) as QeegDraftResponse;
    let savedAt = blank.savedAt;
    const own: FigureRef[] = [];
    for (const seed of [31, 32, 33, 34]) {
      const filed = await steps.upload(blank.report.id, SEEDED.owner, seed);
      own.push(filed.ref);
      savedAt = filed.savedAt;
    }
    const [mapA, mapB, laterClosed, laterOpen] = own;
    if (!mapA || !mapB || !laterClosed || !laterOpen) throw new Error('Uploads went missing.');
    const full = fullFollowUp();
    const content = {
      ...sent(full),
      comparedWith: { reportId: first.id },
      recording: { ...full.recording, recordedOn: '2026-09-28' },
      maps: completeReport([mapA, mapB]).maps,
      change: {
        ...full.change,
        sessionsCompleted: { count: 20, source: 'typed' },
        pairs: {
          // The earlier sides are the first report's, written by the server.
          eyes_closed: { earlier: null, later: laterClosed },
          eyes_open: { earlier: null, later: laterOpen },
        },
      },
    };
    const saved = await steps.saveAs(SEEDED.owner, { id: blank.report.id, savedAt, content });
    if (saved.status !== 200)
      throw new Error(`Save refused: ${saved.status} ${await saved.text()}`);
    const body = (await saved.json()) as QeegDraftResponse;

    const res = await issue({ id: blank.report.id, savedAt: body.savedAt });
    expect(res.status).toBe(201);
    const pdf = await h.call(
      'GET',
      `/api/reports/${blank.report.id}/preview?locale=en`,
      SEEDED.owner,
    );
    expect(pdf.status).toBe(200);
    // Its own two maps and both sides of both pairs: six pictures drawn.
    const raw = Buffer.from(await pdf.arrayBuffer()).toString('latin1');
    expect(raw.match(/\/Interpolate true/g)?.length).toBe(6);
  });
});

describe('what a household is answered for a signed brain map', () => {
  const UNTICKED = 'A line she typed and left unticked';
  const EARLIER_ASSESSMENT = '0000000d-0000-4000-8000-0000000003a1';
  const LATER_ASSESSMENT = '0000000d-0000-4000-8000-0000000003a2';
  let signedId = '';
  let comparedId = '';

  beforeAll(async () => {
    // A first report, signed, that the follow-up below names.
    const first = await steps.completeDraft(SEEDED.owner, { seed: 41 });
    const firstSigned = await issue(first);
    if (firstSigned.status !== 201) throw new Error(`Refused: ${firstSigned.status}`);
    comparedId = first.id;

    // A signed follow-up whose body holds what the page never prints: an item
    // she left unticked, a calculated figure's assessments, and the id of the
    // report it is compared with. Written as the owner, as a stored row can
    // hold it, because the draft route refuses a calculated figure today.
    const full = fullFollowUp();
    const content = {
      ...full,
      comparedWith: { ...full.comparedWith, reportId: comparedId },
      findings: {
        ...full.findings,
        custom: {
          ...full.findings.custom,
          c9: { label: { en: UNTICKED, ar: null }, note: null, chosen: false, position: 9 },
        },
      },
      change: {
        ...full.change,
        table: {
          ...full.change.table,
          delta: {
            position: 0,
            eyesOpen: {
              kind: 'percent',
              direction: 'decrease',
              low: 25,
              high: null,
              source: 'calculated',
              basis: {
                earlierAssessmentId: EARLIER_ASSESSMENT,
                laterAssessmentId: LATER_ASSESSMENT,
                unit: 'uV2',
                sitesPaired: 19,
              },
            },
            eyesClosed: null,
          },
        },
      },
    };
    const inserted = await h.owner.query<{ id: string }>(
      "insert into report (tenant_id, client_id, kind, content) values ($1, $2, 'qeeg', $3::jsonb) " +
        'returning id',
      [h.data.tenant.id, clientId, JSON.stringify(content)],
    );
    signedId = inserted.rows[0]?.id ?? '';
    await h.owner.query(
      "update report set status = 'issued', number = 977, issued_on = current_date, " +
        "signed_at = now(), signed_by_practitioner_id = $2, signed_by_name = 'Rowan Ridge', " +
        "signed_by_certification = 'bcia_bcn', recipient_name = 'Hazel Harbour', " +
        "recipient_record_number = 'MW-000001', practice_legal_name = 'Synthetic Studio' " +
        'where id = $1',
      [signedId, h.practitionerIdOf(SEEDED.owner)],
    );
  });

  it('gives the practice the whole body, as its own screen reads it', async () => {
    const res = await h.call('GET', `/api/reports/${signedId}`, SEEDED.owner);
    expect(res.status).toBe(200);
    const text = await res.text();
    for (const held of [UNTICKED, EARLIER_ASSESSMENT, LATER_ASSESSMENT, comparedId]) {
      expect(text).toContain(held);
    }
  });

  it('gives a household the row and nothing of the body: no unticked item, assessment or compared report', async () => {
    const res = await h.callAs('GET', `/api/reports/${signedId}`, household);
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text) as ReportResponse;
    expect(body.report.id).toBe(signedId);
    expect(body.report.status).toBe('issued');
    expect(body.content).toBeNull();
    for (const held of [UNTICKED, EARLIER_ASSESSMENT, LATER_ASSESSMENT, comparedId]) {
      expect(text).not.toContain(held);
    }
  });
});
