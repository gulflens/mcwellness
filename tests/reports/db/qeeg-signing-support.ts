import type { QeegDraftResponse } from '../../../app/api/reports/schema';
import { blankInitial } from '../../../domain/reports/qeeg/blank';
import { fullReport } from '../../../domain/reports/qeeg/testing/reports';
import type { FigureRef, QeegContent, QeegInitial } from '../../../domain/reports/qeeg/types';
import { goodPng, sha256Hex } from './figures-support';
import type { Harness } from './support';

/**
 * The steps a brain-map report takes on its way to a signature, as the form
 * takes them through the API: a draft saved, its maps uploaded through their
 * door, its content saved naming them. Shared by the preview, issue and
 * supersede tests (brief P), so each asks for a complete report the same way.
 *
 * Everything is invented: the seed's own people, bodies built from the
 * domain's blanks and fixtures, pictures made from arithmetic.
 */

export const SAVE_REASON = 'Saving the brain-map draft';
export const MAP_SIZE = Object.freeze({ width: 800, height: 600 });

/** The count of pages a PDF says it has. */
export function pageCount(pdf: Uint8Array): number {
  const found = /\/Type \/Pages \/Count (\d+)/.exec(Buffer.from(pdf).toString('latin1'));
  return Number(found?.[1] ?? -1);
}

/** A body with the parts the server writes taken out, as the editor sends it. */
export function sent(content: object): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(structuredClone(content)).filter(
      ([key]) => key !== 'subject' && key !== 'provenance',
    ),
  );
}

/**
 * A first report with nothing left to fill (`missingForIssue` is empty), as
 * the pages' fixture fills one, placing the maps given. The fixture leaves the
 * phase lag's regions empty, which a signature needs, so one is named.
 */
export function completeReport(maps: readonly FigureRef[], over: Partial<QeegInitial> = {}) {
  const full = fullReport();
  const content: QeegInitial = {
    ...full,
    connectivity: {
      ...full.connectivity,
      phase_lag: { level: 'normal', regions: ['frontal'] },
    },
    maps: Object.fromEntries(
      maps.map((ref, place) => [
        `map-${place}`,
        {
          ...ref,
          condition: place % 2 === 0 ? ('eyes_closed' as const) : ('eyes_open' as const),
          caption: null,
          position: place,
        },
      ]),
    ),
    ...over,
  };
  return content;
}

export type Saved = { id: string; savedAt: string; content: QeegContent };

/** The seed's first active client with an Arabic name, a birth date and a sex on file. */
export function clientToWriteAbout(h: Harness): { index: number; id: string } {
  const index = h.data.clients.findIndex(
    (c) => c.status === 'active' && c.givenNameAr !== null && c.sexAtBirth !== 'unknown',
  );
  if (index < 0) throw new Error('The seed has no client to write about.');
  return { index, id: h.clientId(index) };
}

/**
 * A legal guardian of the client with a portal login of their own, made the
 * way the portal's own door makes one. `n` keeps two logins apart.
 */
export async function householdOf(h: Harness, clientId: string, n: number): Promise<string> {
  const contact = await h.owner.query<{ id: string }>(
    'select id from contact where client_id = $1 order by id limit 1',
    [clientId],
  );
  const contactId = contact.rows[0]?.id;
  if (!contactId) throw new Error('The seed gave the client no contact.');
  const tail = String(n).padStart(2, '0');
  const userId = `0000000d-0000-4000-8000-0000000001${tail}`;
  const authId = `0000000d-0000-4000-8000-0000000002${tail}`;
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
  return authId;
}

export function qeegSteps(h: Harness, clientId: string) {
  async function saveAs(
    as: number,
    body: Record<string, unknown>,
    reason = SAVE_REASON,
  ): Promise<Response> {
    return h.call(
      'POST',
      '/api/reports/draft',
      as,
      { clientId, kind: 'qeeg', ...body },
      {
        'x-reason': reason,
      },
    );
  }

  /** A new first report, saved blank. */
  async function newDraft(as: number): Promise<Saved> {
    const res = await saveAs(as, { locale: 'en', content: sent(blankInitial()) });
    if (res.status !== 201) throw new Error(`Refused: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as QeegDraftResponse;
    return { id: body.report.id, savedAt: body.savedAt, content: body.content as QeegContent };
  }

  /** A picture uploaded to a draft through its door; the draft's new stamp with it. */
  async function upload(
    reportId: string,
    as: number,
    seed: number,
  ): Promise<{ ref: FigureRef; savedAt: string }> {
    const bytes = await goodPng(MAP_SIZE.width, MAP_SIZE.height, seed);
    const res = await h.raw('PUT', `/api/reports/${reportId}/figures`, as, bytes, {
      'content-type': 'image/png',
      'x-sha256': sha256Hex(bytes),
      'x-reason': 'Adding a brain map to the draft',
    });
    if (res.status !== 201 && res.status !== 200) {
      throw new Error(`Upload refused: ${res.status} ${await res.text()}`);
    }
    const body = (await res.json()) as {
      figure: { figureId: string; sha256: string; widthPx: number; heightPx: number };
      savedAt: string;
    };
    const { figureId, sha256, widthPx, heightPx } = body.figure;
    return { ref: { figureId, sha256, widthPx, heightPx }, savedAt: body.savedAt };
  }

  /** A save over the draft's stamp, answered as the route answers it. */
  async function saveOver(draft: { id: string; savedAt: string }, content: object, as: number) {
    return saveAs(as, { id: draft.id, savedAt: draft.savedAt, content: sent(content) });
  }

  async function saved(
    draft: { id: string; savedAt: string },
    content: object,
    as: number,
  ): Promise<Saved> {
    const res = await saveOver(draft, content, as);
    if (res.status !== 200) throw new Error(`Save refused: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as QeegDraftResponse;
    return { id: body.report.id, savedAt: body.savedAt, content: body.content as QeegContent };
  }

  /**
   * A complete first report with `maps` pictures uploaded and placed, saved.
   * `over` changes the content before it is saved (a brain map with no
   * programme, say).
   */
  async function completeDraft(
    as: number,
    options: { maps?: number; over?: Partial<QeegInitial>; seed?: number } = {},
  ): Promise<Saved & { maps: FigureRef[] }> {
    const draft = await newDraft(as);
    let stamp = draft.savedAt;
    const maps: FigureRef[] = [];
    for (let place = 0; place < (options.maps ?? 2); place += 1) {
      const filed = await upload(draft.id, as, (options.seed ?? 0) * 10 + place);
      maps.push(filed.ref);
      stamp = filed.savedAt;
    }
    const done = await saved(
      { id: draft.id, savedAt: stamp },
      completeReport(maps, options.over),
      as,
    );
    return { ...done, maps };
  }

  return { saveAs, newDraft, upload, saveOver, saved, completeDraft };
}
