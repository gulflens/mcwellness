import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { QeegDraftResponse } from '../../../app/api/reports/schema';
import {
  FIGURE_SENTENCES,
  type FigureFiledResponse,
  type FigureRemovedResponse,
} from '../../../app/api/reports/qeeg/figureSchema';
import { clientDocumentKey } from '../../../domain/shared';
import { blankFollowUp, blankInitial } from '../../../domain/reports/qeeg/blank';
import type { ComparedWith, QeegInitial } from '../../../domain/reports/qeeg/types';
import { goodPng, handPng, jpegBytes, linkFigureAsOwner, sha256Hex } from './figures-support';
import { SEEDED, startHarness, type Harness } from './support';

/**
 * A brain-map report's pictures: the upload door, the remove door, the link
 * table's guard and its readers, borrowing, and the draft route's refusal of a
 * map that is not the report's own (docs/SPEC/reports-qeeg.md sections 9, 13
 * and 14; brief N; brief L's "For PR 7").
 *
 * Every picture is synthetic, made from arithmetic (`figures-support.ts`), and
 * every person is the seed's own invention.
 */

const NOW = () => new Date('2026-09-30T08:00:00.000Z');
const REASON = 'Adding the brain maps to the draft';

let h: Harness;
let clientId: string;
/** Another client of the practice, whose reports no picture of `clientId`'s may reach. */
let otherClientId: string;
let signedNumber = 700;

function headersFor(bytes: Uint8Array, over: Record<string, string> = {}): Record<string, string> {
  return {
    'content-type': 'image/png',
    'x-sha256': sha256Hex(bytes),
    'x-reason': REASON,
    ...over,
  };
}

async function upload(
  reportId: string,
  bytes: Uint8Array,
  options: { as?: number; query?: string; headers?: Record<string, string> } = {},
): Promise<Response> {
  return h.raw(
    'PUT',
    `/api/reports/${reportId}/figures${options.query ?? ''}`,
    options.as ?? SEEDED.practitioner,
    bytes,
    headersFor(bytes, options.headers),
  );
}

async function remove(reportId: string, figureId: string, as: number = SEEDED.practitioner) {
  return h.raw('DELETE', `/api/reports/${reportId}/figures/${figureId}`, as, undefined, {
    'x-reason': REASON,
  });
}

/** A body with the parts the server writes taken out, as the editor sends it. */
function sent(content: object, over: Record<string, unknown> = {}): Record<string, unknown> {
  const body = Object.fromEntries(
    Object.entries(structuredClone(content)).filter(
      ([key]) => key !== 'subject' && key !== 'provenance',
    ),
  );
  return { ...body, ...over };
}

async function newDraft(forClient = clientId, as: number = SEEDED.practitioner) {
  const res = await h.call(
    'POST',
    '/api/reports/draft',
    as,
    { clientId: forClient, kind: 'qeeg', locale: 'en', content: sent(blankInitial()) },
    { 'x-reason': 'Starting the brain-map draft' },
  );
  if (res.status !== 201) throw new Error(`Refused: ${res.status} ${await res.text()}`);
  return (await res.json()) as QeegDraftResponse;
}

async function saveOver(
  draft: { id: string; savedAt: string },
  content: Record<string, unknown>,
  as: number = SEEDED.practitioner,
) {
  return h.call(
    'POST',
    '/api/reports/draft',
    as,
    { id: draft.id, clientId, kind: 'qeeg', savedAt: draft.savedAt, content },
    { 'x-reason': 'Saving the brain-map draft' },
  );
}

async function count(sql: string, params: unknown[] = []): Promise<number> {
  const { rows } = await h.owner.query<{ n: string }>(sql, params);
  return Number(rows[0]?.n);
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

/** A draft written as the table owner, for a client and a content the test chooses. */
async function ownerDraft(forClient: string, content: object = blankInitial()): Promise<string> {
  const { rows } = await h.owner.query<{ id: string }>(
    "insert into report (tenant_id, client_id, kind, content) values ($1, $2, 'qeeg', $3::jsonb) " +
      'returning id',
    [h.data.tenant.id, forClient, JSON.stringify(content)],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error('The draft was not written.');
  return id;
}

/** Runs `sql` on the owner's own connection, with no role assumed, and returns the SQLSTATE it failed with. */
async function ownerFails(sql: string, params: unknown[] = []): Promise<string | null> {
  await h.owner.query('begin');
  try {
    await h.owner.query(sql, params);
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? 'unknown';
  } finally {
    await h.owner.query('rollback');
  }
}

/** A question asked as the API role, with a person's context, in a transaction that is rolled back. */
async function asRole<T>(who: { userId: string; roles: string }, fn: () => Promise<T>): Promise<T> {
  await h.owner.query('begin');
  try {
    await h.owner.query('set local role app_role');
    await h.owner.query(
      "select set_config('app.tenant_id', $1, true), set_config('app.actor_id', $2, true), " +
        "set_config('app.actor_roles', $3, true)",
      [h.data.tenant.id, who.userId, who.roles],
    );
    return await fn();
  } finally {
    await h.owner.query('rollback');
  }
}

function seededUser(index: number): { userId: string; roles: string } {
  const user = h.data.users[index];
  if (!user) throw new Error(`No seeded user ${index}.`);
  const roles = h.data.roles
    .filter((role) => role.userId === user.id)
    .map((role) => role.role)
    .join(',');
  return { userId: user.id, roles };
}

beforeAll(async () => {
  h = await startHarness(NOW);
  const index = h.data.clients.findIndex(
    (c) => c.status === 'active' && c.givenNameAr !== null && c.sexAtBirth !== 'unknown',
  );
  if (index < 0) throw new Error('The seed has no client to write about.');
  clientId = h.clientId(index);
  await h.onSchedule(index, SEEDED.practitioner);
  // Another client, one the practitioner cannot reach, asked of the database itself.
  const reachable = await h.asPerson(SEEDED.practitioner, async (db) => {
    const { rows } = await db.query<{ id: string; visible: boolean }>(
      "select id, app.client_visible_to_practitioner(id) as visible from client where status = 'active'",
    );
    return rows;
  });
  const stranger = reachable.find((row) => !row.visible && row.id !== clientId);
  if (!stranger) throw new Error('The practitioner reaches every client.');
  otherClientId = stranger.id;
}, 180_000);

afterAll(async () => {
  await h.close();
});

describe('uploading a brain map to a draft', () => {
  it('files a valid PNG, writes the bytes after the commit, and answers the new savedAt', async () => {
    const draft = await newDraft();
    const bytes = await goodPng(40, 30, 1);
    const res = await upload(draft.report.id, bytes, { query: '?condition=eyes_open&position=0' });
    expect(res.status, await res.clone().text()).toBe(201);
    const body = (await res.json()) as FigureFiledResponse;
    expect(body.figure).toMatchObject({
      sha256: sha256Hex(bytes),
      widthPx: 40,
      heightPx: 30,
      condition: 'eyes_open',
      position: 0,
      borrowed: false,
    });
    expect(body.savedAt > draft.savedAt).toBe(true);

    const { rows } = await h.owner.query<{
      kind: string;
      mime_type: string;
      is_immutable: boolean;
      storage_key: string;
      client_id: string;
    }>('select kind, mime_type, is_immutable, storage_key, client_id from document where id = $1', [
      body.figure.figureId,
    ]);
    expect(rows[0]).toMatchObject({
      kind: 'report_figure',
      mime_type: 'image/png',
      is_immutable: false,
      client_id: clientId,
    });
    const stored = await h.storage.get(rows[0]?.storage_key ?? '');
    expect(stored && sha256Hex(stored)).toBe(sha256Hex(bytes));

    const link = await h.owner.query<{ report_id: string; width_px: number; condition: string }>(
      'select report_id, width_px, condition from report_figure where document_id = $1',
      [body.figure.figureId],
    );
    expect(link.rows).toEqual([
      { report_id: draft.report.id, width_px: 40, condition: 'eyes_open' },
    ]);

    // The link's row on the trail carries the reason the door was given.
    const trail = await h.owner.query<{ reason: string }>(
      "select reason from audit_log where entity_type = 'report_figure' and action = 'insert' " +
        "and new_values->>'document_id' = $1",
      [body.figure.figureId],
    );
    expect(trail.rows[0]?.reason).toBe(REASON);

    // A save made over the stamp before the upload is a save over an older one.
    const stale = await saveOver(
      { id: draft.report.id, savedAt: draft.savedAt },
      sent(blankInitial()),
    );
    expect(stale.status).toBe(409);
    const fresh = await saveOver(
      { id: draft.report.id, savedAt: body.savedAt },
      sent(blankInitial()),
    );
    expect(fresh.status).toBe(200);
  });

  it('hands back the same picture when the same bytes are sent again', async () => {
    const draft = await newDraft();
    const bytes = await goodPng(20, 20, 2);
    const first = (await (await upload(draft.report.id, bytes)).json()) as FigureFiledResponse;
    const again = await upload(draft.report.id, bytes);
    expect(again.status).toBe(200);
    expect(((await again.json()) as FigureFiledResponse).figure.figureId).toBe(
      first.figure.figureId,
    );
    expect(
      await count('select count(*)::text as n from report_figure where report_id = $1', [
        draft.report.id,
      ]),
    ).toBe(1);
  });

  it('lets the owner upload, and refuses an admin, and a practitioner off the client’s schedule', async () => {
    const draft = await newDraft();
    expect(
      (await upload(draft.report.id, await goodPng(10, 10, 3), { as: SEEDED.owner })).status,
    ).toBe(201);
    expect(
      (await upload(draft.report.id, await goodPng(10, 10, 4), { as: SEEDED.admin })).status,
    ).toBe(403);
    const stranger = await newDraft(otherClientId, SEEDED.owner);
    expect((await upload(stranger.report.id, await goodPng(10, 10, 5))).status).toBe(404);
  });

  it('refuses a request with no reason, no digest, or a type other than PNG', async () => {
    const draft = await newDraft();
    const bytes = await goodPng(10, 10, 6);
    expect((await upload(draft.report.id, bytes, { headers: { 'x-reason': '' } })).status).toBe(
      400,
    );
    const noDigest = await upload(draft.report.id, bytes, { headers: { 'x-sha256': 'nope' } });
    expect(noDigest.status).toBe(400);
    expect(((await noDigest.json()) as { code: string }).code).toBe('digest_missing');
    const jpegType = await upload(draft.report.id, bytes, {
      headers: { 'content-type': 'image/jpeg' },
    });
    expect(jpegType.status).toBe(415);
    const badCondition = await upload(draft.report.id, bytes, { query: '?condition=eyes-open' });
    expect(badCondition.status).toBe(400);
  });
});

describe('the caps, each refused by its sentence', () => {
  let reportId: string;
  beforeAll(async () => {
    reportId = (await newDraft()).report.id;
  });

  async function refusal(res: Response) {
    return (await res.json()) as { code: string; sentence: string };
  }

  it('refuses a picture wider than 4,096 pixels', async () => {
    const res = await upload(reportId, handPng({ width: 4097, height: 1 }));
    expect(res.status).toBe(422);
    expect(await refusal(res)).toMatchObject({
      code: 'too_wide',
      sentence: FIGURE_SENTENCES.too_wide,
    });
  });

  it('refuses a picture taller than 4,096 pixels', async () => {
    const res = await upload(reportId, handPng({ width: 1, height: 4097 }));
    expect(res.status).toBe(422);
    expect(await refusal(res)).toMatchObject({
      code: 'too_tall',
      sentence: FIGURE_SENTENCES.too_tall,
    });
  });

  it('refuses a picture of more than 12 million pixels', async () => {
    const res = await upload(reportId, handPng({ width: 4096, height: 2930 }));
    expect(res.status).toBe(422);
    expect(await refusal(res)).toMatchObject({
      code: 'too_many_pixels',
      sentence: FIGURE_SENTENCES.too_many_pixels,
    });
  });

  it('refuses a file of more than 5 MiB', async () => {
    const res = await upload(reportId, new Uint8Array(5 * 1024 * 1024 + 1));
    expect(res.status).toBe(413);
    expect(await refusal(res)).toMatchObject({
      code: 'too_many_bytes',
      sentence: FIGURE_SENTENCES.too_many_bytes,
    });
  });

  it('refuses a ninth picture on one report', async () => {
    const draft = await newDraft();
    for (let i = 0; i < 8; i += 1) {
      expect((await upload(draft.report.id, await goodPng(8, 8, 100 + i))).status).toBe(201);
    }
    const res = await upload(draft.report.id, await goodPng(8, 8, 200));
    expect(res.status).toBe(422);
    expect(await refusal(res)).toMatchObject({
      code: 'too_many_maps',
      sentence: FIGURE_SENTENCES.too_many_maps,
    });
    expect(
      await count(
        "select count(*)::text as n from document where kind = 'report_figure' and id in " +
          '(select document_id from report_figure where report_id = $1)',
        [draft.report.id],
      ),
    ).toBe(8);
  });

  it('writes nothing for any of them', async () => {
    expect(
      await count('select count(*)::text as n from report_figure where report_id = $1', [reportId]),
    ).toBe(0);
  });
});

describe('what arrives must be exactly an opaque 8-bit RGB PNG', () => {
  let reportId: string;
  beforeAll(async () => {
    reportId = (await newDraft()).report.id;
  });

  async function codeOf(res: Response) {
    return ((await res.json()) as { code: string; sentence: string }).code;
  }

  it('refuses a JPEG', async () => {
    const res = await upload(reportId, jpegBytes());
    expect(res.status).toBe(415);
    expect(await codeOf(res)).toBe('not_a_png');
  });

  it('refuses a PNG with an alpha channel', async () => {
    const res = await upload(reportId, handPng({ width: 4, height: 4, colourType: 6 }));
    expect(res.status).toBe(422);
    expect(await codeOf(res)).toBe('not_rgb');
  });

  it('refuses a greyscale PNG', async () => {
    const res = await upload(reportId, handPng({ width: 4, height: 4, colourType: 0 }));
    expect(res.status).toBe(422);
    expect(await codeOf(res)).toBe('not_rgb');
  });

  it('refuses a 16-bit PNG', async () => {
    const res = await upload(reportId, handPng({ width: 4, height: 4, depth: 16 }));
    expect(res.status).toBe(422);
    expect(await codeOf(res)).toBe('not_8_bit');
  });

  it('refuses a PNG whose image data inflates to fewer bytes than its header says', async () => {
    const res = await upload(reportId, handPng({ width: 4, height: 4, rows: 3 }));
    expect(res.status).toBe(422);
    expect(await codeOf(res)).toBe('damaged');
  });

  it('refuses a PNG whose image data inflates to more bytes than its header says', async () => {
    const res = await upload(reportId, handPng({ width: 4, height: 4, rows: 5 }));
    expect(res.status).toBe(422);
    expect(await codeOf(res)).toBe('damaged');
  });

  it('refuses bytes whose digest is not the one declared', async () => {
    const bytes = await goodPng(6, 6, 7);
    const res = await upload(reportId, bytes, { headers: { 'x-sha256': 'a'.repeat(64) } });
    expect(res.status).toBe(400);
    expect(await codeOf(res)).toBe('digest_mismatch');
  });

  it('filed none of them', async () => {
    expect(
      await count('select count(*)::text as n from report_figure where report_id = $1', [reportId]),
    ).toBe(0);
  });
});

describe('removing a map from a draft', () => {
  it('removes the link, the document and, after the commit, the bytes', async () => {
    const draft = await newDraft();
    const filed = (await (
      await upload(draft.report.id, await goodPng(12, 12, 8))
    ).json()) as FigureFiledResponse;
    const key = (
      await h.owner.query<{ storage_key: string }>(
        'select storage_key from document where id = $1',
        [filed.figure.figureId],
      )
    ).rows[0]?.storage_key;
    expect(key && (await h.storage.exists(key))).toBe(true);

    const res = await remove(draft.report.id, filed.figure.figureId);
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as FigureRemovedResponse;
    expect(body.savedAt > filed.savedAt).toBe(true);
    expect(
      await count('select count(*)::text as n from report_figure where document_id = $1', [
        filed.figure.figureId,
      ]),
    ).toBe(0);
    expect(
      await count('select count(*)::text as n from document where id = $1', [
        filed.figure.figureId,
      ]),
    ).toBe(0);
    expect(await h.storage.exists(key ?? '')).toBe(false);
  });

  it('answers not found for a map the report does not hold', async () => {
    const draft = await newDraft();
    const res = await remove(draft.report.id, '0000000d-0000-4000-8000-0000000000f1');
    expect(res.status).toBe(404);
  });

  it('refuses to remove a map the saved draft still prints, naming where', async () => {
    const draft = await newDraft();
    const filed = (await (
      await upload(draft.report.id, await goodPng(14, 10, 9))
    ).json()) as FigureFiledResponse;
    const { figureId, sha256, widthPx, heightPx } = filed.figure;
    const saved = await saveOver(
      { id: draft.report.id, savedAt: filed.savedAt },
      sent(blankInitial(), {
        maps: {
          'map-0': {
            figureId,
            sha256,
            widthPx,
            heightPx,
            condition: 'eyes_open',
            caption: null,
            position: 0,
          },
        },
      }),
    );
    expect(saved.status, await saved.clone().text()).toBe(200);
    const res = await remove(draft.report.id, figureId);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'figure_in_use', field: 'maps.map-0.figureId' });
  });
});

describe('frozen when the report leaves draft', () => {
  const SHA = 'd'.repeat(64);

  it('refuses a map added to, removed from or changed on a signed report, the owner included', async () => {
    const reportId = await ownerDraft(clientId);
    const figure = await linkFigureAsOwner(
      h.owner,
      { tenantId: h.data.tenant.id, clientId, reportId },
      { documentId: '0000000d-0000-4000-8000-0000000000a1', sha256: SHA },
    );
    await signAsOwner(reportId);

    // The picture itself is frozen with the report (903 holds it from here).
    const doc = await h.owner.query<{ is_immutable: boolean }>(
      'select is_immutable from document where id = $1',
      [figure.figureId],
    );
    expect(doc.rows[0]?.is_immutable).toBe(true);

    // Through the doors.
    expect((await upload(reportId, await goodPng(10, 10, 10), { as: SEEDED.owner })).status).toBe(
      422,
    );
    expect((await remove(reportId, figure.figureId, SEEDED.owner)).status).toBe(422);

    // And by the guard, on the owner's own connection.
    expect(await ownerFails('delete from report_figure where report_id = $1', [reportId])).toBe(
      '23001',
    );
    expect(
      await ownerFails('update report_figure set position = 1 where report_id = $1', [reportId]),
    ).toBe('23001');
    const anotherDoc = '0000000d-0000-4000-8000-0000000000a2';
    await h.owner.query(
      'insert into document (id, tenant_id, client_id, kind, storage_key, mime_type, sha256) ' +
        "values ($1, $2, $3, 'report_figure', $4, 'image/png', decode($5, 'hex'))",
      [
        anotherDoc,
        h.data.tenant.id,
        clientId,
        clientDocumentKey(h.data.tenant.id, clientId, anotherDoc),
        SHA,
      ],
    );
    expect(
      await ownerFails(
        'insert into report_figure (tenant_id, client_id, report_id, document_id, sha256, ' +
          "width_px, height_px) values ($1, $2, $3, $4, decode($5, 'hex'), 10, 10)",
        [h.data.tenant.id, clientId, reportId, anotherDoc, SHA],
      ),
    ).toBe('23001');
  });

  it('refuses the same on a kept past record', async () => {
    const { rows } = await h.owner.query<{ id: string }>(
      "insert into report (tenant_id, client_id, kind, content, imported_from, source_sha256) values ($1, $2, 'qeeg', $3::jsonb, 'qeeg.json/1', $4) returning id",
      [h.data.tenant.id, clientId, JSON.stringify(blankInitial()), 'e'.repeat(64)],
    );
    const reportId = rows[0]?.id ?? '';
    const figure = await linkFigureAsOwner(
      h.owner,
      { tenantId: h.data.tenant.id, clientId, reportId },
      { documentId: '0000000d-0000-4000-8000-0000000000a3', sha256: SHA },
    );
    await h.owner.query("update report set status = 'imported' where id = $1", [reportId]);
    expect((await upload(reportId, await goodPng(10, 10, 11), { as: SEEDED.owner })).status).toBe(
      422,
    );
    expect((await remove(reportId, figure.figureId, SEEDED.owner)).status).toBe(422);
    expect(await ownerFails('delete from report_figure where report_id = $1', [reportId])).toBe(
      '23001',
    );

    // Withdrawn, kept against the wrong client: its maps are removed
    // (section 11, point 7), and the picture, frozen, stays for the erasure.
    await h.owner.query(
      "update report set withdrawn_at = now(), withdraw_reason = 'Kept against the wrong client', " +
        "content = '{}'::jsonb where id = $1",
      [reportId],
    );
    const removed = await asRole(seededUser(SEEDED.owner), async () => {
      const { rows: out } = await h.owner.query<{ key: string | null }>(
        'select app.remove_report_figure($1, $2) as key',
        [reportId, figure.figureId],
      );
      const left = await h.owner.query<{ n: string }>(
        'select count(*)::text as n from report_figure where report_id = $1',
        [reportId],
      );
      return { key: out[0]?.key, left: Number(left.rows[0]?.n) };
    });
    expect(removed).toEqual({ key: null, left: 0 });
  });
});

describe('borrowing an earlier report’s picture', () => {
  const SHA = 'f'.repeat(64);
  let signedId: string;
  let figureId: string;

  beforeAll(async () => {
    signedId = await ownerDraft(clientId);
    figureId = (
      await linkFigureAsOwner(
        h.owner,
        { tenantId: h.data.tenant.id, clientId, reportId: signedId },
        {
          documentId: '0000000d-0000-4000-8000-0000000000b1',
          sha256: SHA,
          condition: 'eyes_closed',
        },
      )
    ).figureId;
    await signAsOwner(signedId);
  });

  it('links a signed report’s picture to a draft of the same client', async () => {
    const draft = await newDraft();
    const link = await asRole(seededUser(SEEDED.practitioner), async () => {
      await h.owner.query('select app.borrow_report_figure($1, $2, $3)', [
        draft.report.id,
        signedId,
        figureId,
      ]);
      const { rows } = await h.owner.query<{ borrowed: string; condition: string }>(
        'select borrowed_from_report_id as borrowed, condition from report_figure ' +
          'where report_id = $1',
        [draft.report.id],
      );
      return rows;
    });
    expect(link).toEqual([{ borrowed: signedId, condition: 'eyes_closed' }]);
  });

  it('refuses to borrow from another client’s report', async () => {
    const theirs = await ownerDraft(otherClientId);
    await linkFigureAsOwner(
      h.owner,
      { tenantId: h.data.tenant.id, clientId: otherClientId, reportId: theirs },
      { documentId: '0000000d-0000-4000-8000-0000000000b2', sha256: SHA },
    );
    await signAsOwner(theirs);
    const draft = await newDraft();
    const code = await asRole(seededUser(SEEDED.owner), async () => {
      try {
        await h.owner.query('select app.borrow_report_figure($1, $2, $3)', [
          draft.report.id,
          theirs,
          '0000000d-0000-4000-8000-0000000000b2',
        ]);
        return null;
      } catch (error) {
        return (error as { code?: string }).code;
      }
    });
    expect(code).toBe('23503');
  });

  it('refuses to borrow from a draft, whose maps may still go', async () => {
    const earlierDraft = await ownerDraft(clientId);
    await linkFigureAsOwner(
      h.owner,
      { tenantId: h.data.tenant.id, clientId, reportId: earlierDraft },
      { documentId: '0000000d-0000-4000-8000-0000000000b3', sha256: SHA },
    );
    const draft = await newDraft();
    const code = await asRole(seededUser(SEEDED.owner), async () => {
      try {
        await h.owner.query('select app.borrow_report_figure($1, $2, $3)', [
          draft.report.id,
          earlierDraft,
          '0000000d-0000-4000-8000-0000000000b3',
        ]);
        return null;
      } catch (error) {
        return (error as { code?: string }).code;
      }
    });
    expect(code).toBe('23001');
  });

  it('borrows the earlier picture when a follow-up is saved, so the pair is its own', async () => {
    const mapId = '0000000d-0000-4000-8000-0000000000b4';
    const earlier: QeegInitial = {
      ...blankInitial(),
      recording: { recordedOn: '2026-03-14', eyes: 'closed_and_open', handedness: 'right' },
      maps: {
        'map-0': {
          figureId: mapId,
          sha256: SHA,
          widthPx: 800,
          heightPx: 600,
          condition: 'eyes_closed',
          caption: null,
          position: 0,
        },
      },
    };
    const withMap = await ownerDraft(clientId, earlier);
    await linkFigureAsOwner(
      h.owner,
      { tenantId: h.data.tenant.id, clientId, reportId: withMap },
      { documentId: mapId, sha256: SHA, condition: 'eyes_closed' },
    );
    await signAsOwner(withMap);

    const placeholder: ComparedWith = {
      reportId: withMap,
      recordedOn: '2026-03-14',
      relation: 'initial',
      origin: 'issued',
      reference: 'RPT-000000',
    };
    const res = await h.call(
      'POST',
      '/api/reports/draft',
      SEEDED.practitioner,
      {
        clientId,
        kind: 'qeeg',
        content: sent(blankFollowUp(placeholder, 'follow_up'), {
          comparedWith: { reportId: withMap },
        }),
      },
      { 'x-reason': 'Starting the follow-up' },
    );
    expect(res.status, await res.clone().text()).toBe(201);
    const body = (await res.json()) as QeegDraftResponse;
    const content = body.content as ReturnType<typeof blankFollowUp>;
    expect(content.change.pairs.eyes_closed.earlier?.figureId).toBe(mapId);
    const links = await h.owner.query<{ borrowed: string }>(
      'select borrowed_from_report_id as borrowed from report_figure where report_id = $1',
      [body.report.id],
    );
    expect(links.rows).toEqual([{ borrowed: withMap }]);
  });
});

describe('a draft names only the maps linked to it', () => {
  it('refuses a new draft naming any map, by name, and writes nothing', async () => {
    const before = await count("select count(*)::text as n from report where kind = 'qeeg'");
    const res = await h.call(
      'POST',
      '/api/reports/draft',
      SEEDED.practitioner,
      {
        clientId,
        kind: 'qeeg',
        content: sent(blankInitial(), {
          maps: {
            'map-0': {
              figureId: '0000000d-0000-4000-8000-0000000000c1',
              sha256: 'a'.repeat(64),
              widthPx: 10,
              heightPx: 10,
              condition: null,
              caption: null,
              position: 0,
            },
          },
        }),
      },
      { 'x-reason': 'Starting the brain-map draft' },
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      code: 'unlinked_figure',
      field: 'maps.map-0.figureId',
    });
    expect(await count("select count(*)::text as n from report where kind = 'qeeg'")).toBe(before);
  });

  it('refuses a map linked to another report of the same client', async () => {
    const other = await newDraft();
    const filed = (await (
      await upload(other.report.id, await goodPng(9, 9, 12))
    ).json()) as FigureFiledResponse;
    const draft = await newDraft();
    const { figureId, sha256, widthPx, heightPx } = filed.figure;
    const res = await saveOver(
      { id: draft.report.id, savedAt: draft.savedAt },
      sent(blankInitial(), {
        maps: {
          'map-0': {
            figureId,
            sha256,
            widthPx,
            heightPx,
            condition: null,
            caption: null,
            position: 0,
          },
        },
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      code: 'unlinked_figure',
      field: 'maps.map-0.figureId',
    });
  });

  it('refuses a linked map named with another digest or size', async () => {
    const draft = await newDraft();
    const filed = (await (
      await upload(draft.report.id, await goodPng(9, 7, 13))
    ).json()) as FigureFiledResponse;
    const { figureId, sha256, widthPx } = filed.figure;
    const res = await saveOver(
      { id: draft.report.id, savedAt: filed.savedAt },
      sent(blankInitial(), {
        maps: {
          'map-0': {
            figureId,
            sha256,
            widthPx,
            heightPx: 70,
            condition: null,
            caption: null,
            position: 0,
          },
        },
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      code: 'figure_mismatch',
      field: 'maps.map-0.heightPx',
    });
  });

  it('refuses a follow-up whose later picture is not its own', async () => {
    const signed = await ownerDraft(clientId, {
      ...blankInitial(),
      recording: { recordedOn: '2026-03-14', eyes: 'closed_and_open', handedness: 'right' },
    });
    await signAsOwner(signed);
    const placeholder: ComparedWith = {
      reportId: signed,
      recordedOn: '2026-03-14',
      relation: 'initial',
      origin: 'issued',
      reference: 'RPT-000000',
    };
    const followUp = blankFollowUp(placeholder, 'follow_up');
    const res = await h.call(
      'POST',
      '/api/reports/draft',
      SEEDED.practitioner,
      {
        clientId,
        kind: 'qeeg',
        content: sent(followUp, {
          comparedWith: { reportId: signed },
          change: {
            ...followUp.change,
            pairs: {
              ...followUp.change.pairs,
              eyes_open: {
                earlier: null,
                later: {
                  figureId: '0000000d-0000-4000-8000-0000000000c2',
                  sha256: 'a'.repeat(64),
                  widthPx: 10,
                  heightPx: 10,
                },
              },
            },
          },
        }),
      },
      { 'x-reason': 'Starting the follow-up' },
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      code: 'unlinked_figure',
      field: 'change.pairs.eyes_open.later.figureId',
    });
  });

  it('saves a draft naming its own maps', async () => {
    const draft = await newDraft();
    const filed = (await (
      await upload(draft.report.id, await goodPng(9, 5, 14), { query: '?condition=eyes_closed' })
    ).json()) as FigureFiledResponse;
    const { figureId, sha256, widthPx, heightPx } = filed.figure;
    const res = await saveOver(
      { id: draft.report.id, savedAt: filed.savedAt },
      sent(blankInitial(), {
        maps: {
          'map-0': {
            figureId,
            sha256,
            widthPx,
            heightPx,
            condition: 'eyes_closed',
            caption: null,
            position: 0,
          },
        },
      }),
    );
    expect(res.status, await res.clone().text()).toBe(200);
  });
});

describe('who reads the links', () => {
  it('shows a practitioner the links of a client on their schedule, and a household none', async () => {
    const draft = await newDraft();
    await upload(draft.report.id, await goodPng(7, 7, 15));

    const staff = await asRole(seededUser(SEEDED.practitioner), async () =>
      Number(
        (
          await h.owner.query<{ n: string }>(
            'select count(*)::text as n from report_figure where client_id = $1',
            [clientId],
          )
        ).rows[0]?.n,
      ),
    );
    expect(staff).toBeGreaterThan(0);

    // A legal guardian with a portal login of their own, made as the portal's
    // own door makes one.
    const contact = await h.owner.query<{ id: string }>(
      'select id from contact where client_id = $1 order by id limit 1',
      [clientId],
    );
    const userId = '0000000d-0000-4000-8000-0000000000e3';
    await h.owner.query(
      'insert into app_user (id, tenant_id, auth_id, display_name) values ($1, $2, $3, $4)',
      [userId, h.data.tenant.id, '0000000d-0000-4000-8000-0000000000e4', 'Household login'],
    );
    await h.owner.query(
      "insert into user_role (tenant_id, user_id, role) values ($1, $2, 'client_contact')",
      [h.data.tenant.id, userId],
    );
    await h.owner.query('update contact set user_id = $1, is_legal_guardian = true where id = $2', [
      userId,
      contact.rows[0]?.id,
    ]);
    const household = await asRole({ userId, roles: 'client_contact' }, async () =>
      Number(
        (await h.owner.query<{ n: string }>('select count(*)::text as n from report_figure'))
          .rows[0]?.n,
      ),
    );
    expect(household).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Fix round 1 (N-review.md findings 1, 3, 4, 6 and 10).
// ---------------------------------------------------------------------------

/** Calls `app.file_report_figure` as a person, and answers the SQLSTATE it refused with, or null. */
async function fileDirectly(who: { userId: string; roles: string }, reportId: string, n: number) {
  const documentId = `0000000d-0000-4000-8000-0000000003${String(n).padStart(2, '0')}`;
  return asRole(who, async () => {
    try {
      await h.owner.query(
        'select app.file_report_figure($1, $2, $3, $4, 10, 10, null, null, now())',
        [
          reportId,
          documentId,
          clientDocumentKey(h.data.tenant.id, clientId, documentId),
          Buffer.alloc(32, n),
        ],
      );
      return null;
    } catch (error) {
      return (error as { code?: string }).code ?? 'unknown';
    }
  });
}

/** A draft brought in from a file, as the table owner writes one. */
async function importDraft(sha: string): Promise<string> {
  const { rows } = await h.owner.query<{ id: string }>(
    'insert into report (tenant_id, client_id, kind, content, imported_from, source_sha256) ' +
      "values ($1, $2, 'qeeg', $3::jsonb, 'qeeg.json/1', $4) returning id",
    [h.data.tenant.id, clientId, JSON.stringify(blankInitial()), sha],
  );
  return rows[0]?.id ?? '';
}

describe('fix round 1: the functions ask who is calling', () => {
  let erasedDraft: string;

  beforeAll(async () => {
    // A third client, with a draft, then erased through the erasure itself.
    const spare = h.data.clients.find(
      (c) => c.status === 'active' && c.id !== clientId && c.id !== otherClientId,
    );
    if (!spare) throw new Error('The seed has too few active clients.');
    erasedDraft = await ownerDraft(spare.id);
    await h.owner.query('begin');
    await h.owner.query(
      "select set_config('app.tenant_id', $1, true), set_config('app.actor_roles', 'owner', true)",
      [h.data.tenant.id],
    );
    const request = await h.owner.query<{ id: string }>(
      'insert into erasure_request (tenant_id, client_id, reason) ' +
        "values ($1, $2, 'The household asked.') returning id",
      [h.data.tenant.id, spare.id],
    );
    await h.owner.query('select app.erase_client($1, $2)', [spare.id, request.rows[0]?.id]);
    await h.owner.query('commit');
  });

  it('refuses an admin', async () => {
    const draft = await newDraft();
    expect(await fileDirectly(seededUser(SEEDED.admin), draft.report.id, 1)).toBe('42501');
  });

  it('refuses a practitioner for a client off their schedule', async () => {
    const draft = await newDraft(otherClientId, SEEDED.owner);
    expect(await fileDirectly(seededUser(SEEDED.practitioner), draft.report.id, 2)).toBe('42501');
  });

  it('refuses a practitioner on a draft brought in from a file, at the function and at the door', async () => {
    const reportId = await importDraft('9'.repeat(64));
    expect(await fileDirectly(seededUser(SEEDED.practitioner), reportId, 3)).toBe('42501');
    expect(await fileDirectly(seededUser(SEEDED.owner), reportId, 4)).toBeNull();
    expect((await upload(reportId, await goodPng(6, 6, 30))).status).toBe(403);
  });

  it('refuses everybody for an erased client, the owner included', async () => {
    expect(await fileDirectly(seededUser(SEEDED.owner), erasedDraft, 5)).toBe('42501');
  });

  it('answers the owner’s upload to an erased client’s draft with 403 and a sentence, not 500', async () => {
    const res = await upload(erasedDraft, await goodPng(6, 6, 31), { as: SEEDED.owner });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      code: 'not_permitted',
      sentence: FIGURE_SENTENCES.not_permitted,
    });
  });
});

describe('fix round 1: the guard refuses a link that is not what it says', () => {
  const SHA = '7'.repeat(64);

  it('refuses a link whose digest is not its document’s', async () => {
    const reportId = await ownerDraft(clientId);
    const documentId = '0000000d-0000-4000-8000-000000000401';
    await h.owner.query(
      'insert into document (id, tenant_id, client_id, kind, storage_key, mime_type, sha256) ' +
        "values ($1, $2, $3, 'report_figure', $4, 'image/png', decode($5, 'hex'))",
      [
        documentId,
        h.data.tenant.id,
        clientId,
        clientDocumentKey(h.data.tenant.id, clientId, documentId),
        SHA,
      ],
    );
    expect(
      await ownerFails(
        'insert into report_figure (tenant_id, client_id, report_id, document_id, sha256, ' +
          "width_px, height_px) values ($1, $2, $3, $4, decode($5, 'hex'), 10, 10)",
        [h.data.tenant.id, clientId, reportId, documentId, '8'.repeat(64)],
      ),
    ).toBe('23514');
  });

  it('refuses a link to a document that is not a brain map', async () => {
    const reportId = await ownerDraft(clientId);
    const documentId = '0000000d-0000-4000-8000-000000000402';
    await h.owner.query(
      'insert into document (id, tenant_id, client_id, kind, storage_key, mime_type, sha256) ' +
        "values ($1, $2, $3, 'referral', $4, 'image/png', decode($5, 'hex'))",
      [
        documentId,
        h.data.tenant.id,
        clientId,
        clientDocumentKey(h.data.tenant.id, clientId, documentId),
        SHA,
      ],
    );
    expect(
      await ownerFails(
        'insert into report_figure (tenant_id, client_id, report_id, document_id, sha256, ' +
          "width_px, height_px) values ($1, $2, $3, $4, decode($5, 'hex'), 10, 10)",
        [h.data.tenant.id, clientId, reportId, documentId, SHA],
      ),
    ).toBe('23514');
  });

  it('refuses borrowing a picture the earlier report does not print', async () => {
    const signed = await ownerDraft(clientId);
    await signAsOwner(signed);
    const draft = await ownerDraft(clientId);
    const loose = await ownerDraft(clientId);
    const documentId = '0000000d-0000-4000-8000-000000000403';
    await linkFigureAsOwner(
      h.owner,
      { tenantId: h.data.tenant.id, clientId, reportId: loose },
      { documentId, sha256: SHA },
    );
    expect(
      await ownerFails(
        'insert into report_figure (tenant_id, client_id, report_id, document_id, ' +
          'borrowed_from_report_id, sha256, width_px, height_px) values ($1, $2, $3, $4, $5, ' +
          "decode($6, 'hex'), 800, 600)",
        [h.data.tenant.id, clientId, draft, documentId, signed, SHA],
      ),
    ).toBe('23503');
  });

  it('refuses a follow-up of a report whose content names a map it does not hold', async () => {
    const earlier: QeegInitial = {
      ...blankInitial(),
      recording: { recordedOn: '2026-03-14', eyes: 'closed_and_open', handedness: 'right' },
      maps: {
        'map-0': {
          figureId: '0000000d-0000-4000-8000-000000000404',
          sha256: SHA,
          widthPx: 800,
          heightPx: 600,
          condition: 'eyes_open',
          caption: null,
          position: 0,
        },
      },
    };
    const signed = await ownerDraft(clientId, earlier);
    await signAsOwner(signed);
    const placeholder: ComparedWith = {
      reportId: signed,
      recordedOn: '2026-03-14',
      relation: 'initial',
      origin: 'issued',
      reference: 'RPT-000000',
    };
    const res = await h.call(
      'POST',
      '/api/reports/draft',
      SEEDED.practitioner,
      {
        clientId,
        kind: 'qeeg',
        content: sent(blankFollowUp(placeholder, 'follow_up'), {
          comparedWith: { reportId: signed },
        }),
      },
      { 'x-reason': 'Starting the follow-up' },
    );
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({
      code: 'cannot_compare',
      reason: 'map_not_held',
      field: 'change.pairs.eyes_open.earlier.figureId',
    });
  });

  it('refuses taking a link away when its report cannot be found', async () => {
    const reportId = await ownerDraft(clientId);
    await linkFigureAsOwner(
      h.owner,
      { tenantId: h.data.tenant.id, clientId, reportId },
      { documentId: '0000000d-0000-4000-8000-000000000405', sha256: SHA },
    );
    // Only reachable with the foreign keys switched off, which is the point:
    // the guard does not lean on them.
    await h.owner.query('begin');
    try {
      await h.owner.query('set local session_replication_role = replica');
      await h.owner.query('delete from report where id = $1', [reportId]);
      const code = await h.owner
        .query('delete from report_figure where report_id = $1', [reportId])
        .then(
          () => null,
          (error: { code?: string }) => error.code,
        );
      expect(code).toBe('23001');
    } finally {
      await h.owner.query('rollback');
    }
  });
});

describe('fix round 1: the door', () => {
  it('refuses a picture carrying a text chunk, by its sentence', async () => {
    const draft = await newDraft();
    const res = await upload(
      draft.report.id,
      handPng({ width: 4, height: 4, before: [{ type: 'tEXt' }] }),
    );
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: 'text', sentence: FIGURE_SENTENCES.text });
  });

  it('puts back the bytes of a picture whose first put never landed, when it is sent again', async () => {
    const draft = await newDraft();
    const bytes = await goodPng(11, 7, 40);
    const first = (await (await upload(draft.report.id, bytes)).json()) as FigureFiledResponse;
    const key =
      (
        await h.owner.query<{ storage_key: string }>(
          'select storage_key from document where id = $1',
          [first.figure.figureId],
        )
      ).rows[0]?.storage_key ?? '';
    await h.storage.delete(key);
    expect(await h.storage.exists(key)).toBe(false);
    const again = await upload(draft.report.id, bytes);
    expect(again.status).toBe(200);
    const stored = await h.storage.get(key);
    expect(stored && sha256Hex(stored)).toBe(sha256Hex(bytes));
  });

  it('refuses the same picture sent again with another condition or place, saying what it is', async () => {
    const draft = await newDraft();
    const bytes = await goodPng(11, 8, 41);
    expect(
      (await upload(draft.report.id, bytes, { query: '?condition=eyes_open&position=1' })).status,
    ).toBe(201);
    const res = await upload(draft.report.id, bytes, {
      query: '?condition=eyes_closed&position=1',
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string; sentence: string };
    expect(body.code).toBe('already_on_report');
    expect(body.sentence).toContain('already on the report as eyes open, in place 2');
    const same = await upload(draft.report.id, bytes, { query: '?condition=eyes_open&position=1' });
    expect(same.status).toBe(200);
  });

  it('takes one of two uploads racing for the eighth place and refuses the other', async () => {
    const draft = await newDraft();
    for (let i = 0; i < 7; i += 1) {
      expect((await upload(draft.report.id, await goodPng(8, 8, 300 + i))).status).toBe(201);
    }
    const [a, b] = await Promise.all([
      upload(draft.report.id, await goodPng(8, 8, 400)),
      upload(draft.report.id, await goodPng(8, 8, 401)),
    ]);
    expect([a?.status, b?.status].sort()).toEqual([201, 422]);
    const refused = a?.status === 422 ? a : b;
    expect(await refused?.json()).toMatchObject({ code: 'too_many_maps' });
    expect(
      await count('select count(*)::text as n from report_figure where report_id = $1', [
        draft.report.id,
      ]),
    ).toBe(8);
  });

  it('answers the removal of a map the report does not hold with a sentence', async () => {
    const draft = await newDraft();
    const res = await remove(draft.report.id, '0000000d-0000-4000-8000-0000000004ff');
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({
      code: 'no_such_map',
      sentence: FIGURE_SENTENCES.no_such_map,
    });
  });
});
