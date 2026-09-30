import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { QeegLayoutNotes } from '../../../app/api/reports/schema';
import { DRAFT_WORDING, WORDS } from '../../../domain/reports/document/strings';
import type * as Pages from '../../../domain/reports/qeeg/document';
import { QEEG_ONLY } from '../../../domain/reports/qeeg/catalogue/ids';
import { phrase } from '../../../domain/reports/qeeg/wording';
import { extractAll } from '../../../domain/shared/document';
import { clientDocumentKey } from '../../../domain/shared/storage';
import { clientToWriteAbout, householdOf, pageCount, qeegSteps } from './qeeg-signing-support';
import { SEEDED, startHarness, type Harness } from './support';

/**
 * The preview of a brain-map report (docs/SPEC/reports-qeeg.md sections 12
 * and 14; brief P): `GET /api/reports/:id/preview?locale=` renders the draft
 * on the server, through the report's own pages, as the PDF a household would
 * get, and tells the editor what it found in a header beside it. It refuses by
 * name a page that runs over and a picture whose bytes are gone.
 *
 * Everything is invented: the seed's own people, the pages' own fixtures and
 * pictures made from arithmetic.
 */

/**
 * A layout that runs over, on request. No block of this report is both fitted
 * and kept (section 12, known limit 1), so no content a person can type makes
 * one; the refusal is reached by saying the layout reported it.
 */
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

let h: Harness;
let clientId: string;
let steps: ReturnType<typeof qeegSteps>;
let household: string;

async function preview(id: string, as: number = SEEDED.owner, query = '?locale=en') {
  return h.call('GET', `/api/reports/${id}/preview${query}`, as);
}

async function pdfOf(res: Response): Promise<Uint8Array> {
  return new Uint8Array(await res.arrayBuffer());
}

function notesOf(res: Response) {
  return QeegLayoutNotes.parse(JSON.parse(res.headers.get('x-report-layout') ?? 'null'));
}

beforeAll(async () => {
  h = await startHarness(NOW);
  clientId = clientToWriteAbout(h).id;
  steps = qeegSteps(h, clientId);
  household = await householdOf(h, clientId, 1);
}, 180_000);

afterAll(async () => {
  await h.close();
});

describe('the preview of a brain-map draft', () => {
  it('renders a blank draft as a PDF, with the signature room, no signer and the draft line', async () => {
    const draft = await steps.newDraft(SEEDED.owner);
    const res = await preview(draft.id);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('cache-control')).toBe('no-store');
    const pdf = await pdfOf(res);
    const notes = notesOf(res);
    expect(notes.pages).toBe(pageCount(pdf));
    expect(notes.pages).toBeGreaterThan(0);
    expect(notes.overflowing).toEqual([]);
    expect(notes.maps).toEqual([]);

    const text = extractAll(pdf);
    expect(text).toContain(WORDS.signedBy.en);
    // No signer yet (section 12, point 9), so no certificate either.
    expect(text).not.toContain(WORDS.certificateNumber.en);
    // Every language of the wording is still a draft.
    expect(text.replace(/\s+/g, '')).toContain(DRAFT_WORDING.en.replace(/\s+/g, ''));
  });

  it('renders a full draft with its maps, the page count and how each map will print', async () => {
    const draft = await steps.completeDraft(SEEDED.owner);
    const res = await preview(draft.id);
    expect(res.status).toBe(200);
    const pdf = await pdfOf(res);
    const notes = notesOf(res);
    expect(notes.pages).toBe(pageCount(pdf));
    expect(notes.maps.map((map) => map.figureId)).toEqual(draft.maps.map((map) => map.figureId));
    for (const map of notes.maps) {
      expect(map.dpi).toBeGreaterThan(0);
      // An 800 by 600 map drawn a page wide prints below 220 to the inch.
      expect(['fair', 'poor']).toContain(map.quality);
    }
    expect(notes.dashboardScale).toBeGreaterThan(0.75);
    expect(notes.unprintable).toEqual([]);
    // Both maps are embedded, losslessly.
    const raw = Buffer.from(pdf).toString('latin1');
    expect(raw.match(/\/Interpolate true/g)?.length).toBe(2);
    expect(raw).not.toContain('/DCTDecode');
    // The client's name, from the record.
    const person = h.data.clients.find((c) => c.id === clientId);
    expect(extractAll(pdf)).toContain(person?.givenName ?? 'no name');
  });

  it('leaves the programme’s page text out of a brain map with no programme after it', async () => {
    const draft = await steps.completeDraft(SEEDED.owner, {
      seed: 2,
      over: { plan: { sessions: QEEG_ONLY, approach: null } },
    });
    const res = await preview(draft.id);
    expect(res.status).toBe(200);
    const text = extractAll(await pdfOf(res));
    const say = (key: string) => phrase(key, 'initial', 'en');
    expect(text).toContain(say('heading.programme'));
    expect(text).not.toContain(say('heading.approach'));
    expect(text).not.toContain(say('label.qeeg_only'));
    expect(text).not.toMatch(/[0-9]+ Sessions?/);
    const opening = say('text.programme_length').replaceAll('**', '').split(' ').slice(0, 4);
    expect(text).not.toContain(opening.join(' '));
  });

  it('renders the same draft in Arabic when asked, and refuses a language it does not know', async () => {
    const draft = await steps.newDraft(SEEDED.owner);
    const arabic = await preview(draft.id, SEEDED.owner, '?locale=ar');
    expect(arabic.status).toBe(200);
    expect(arabic.headers.get('content-type')).toBe('application/pdf');
    expect((await preview(draft.id, SEEDED.owner, '?locale=fr')).status).toBe(400);
  });

  it('refuses a draft whose pages run over, naming what ran over, and produces no file', async () => {
    const draft = await steps.newDraft(SEEDED.owner);
    overrun.parts = ['summary.1'];
    try {
      const res = await preview(draft.id);
      expect(res.status).toBe(422);
      expect(res.headers.get('content-type')).toContain('application/json');
      const body = (await res.json()) as { code: string; parts: string[]; layout: unknown };
      expect(body.code).toBe('overrun');
      expect(body.parts).toEqual(['summary.1']);
      expect(QeegLayoutNotes.parse(body.layout).overflowing).toEqual(['summary.1']);
    } finally {
      overrun.parts = null;
    }
  });

  it('refuses a map whose bytes are gone from the store, naming where it is placed', async () => {
    const draft = await steps.completeDraft(SEEDED.owner, { seed: 3 });
    const gone = draft.maps[1];
    if (!gone) throw new Error('No second map.');
    await h.storage.delete(clientDocumentKey(h.data.tenant.id, clientId, gone.figureId));
    const res = await preview(draft.id);
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({
      code: 'map_missing',
      field: 'maps.map-1.figureId',
      figureId: gone.figureId,
    });
  });

  it('records the preview as a read of the report and of the client', async () => {
    const draft = await steps.newDraft(SEEDED.owner);
    await preview(draft.id);
    const { rows } = await h.owner.query<{ entity_type: string }>(
      "select entity_type from audit_log where action = 'read' and " +
        "((entity_type = 'report' and entity_id = $1) or " +
        "(entity_type = 'client' and entity_id = $2)) and occurred_at > now() - interval '1 minute'",
      [draft.id, clientId],
    );
    expect(rows.map((row) => row.entity_type)).toEqual(
      expect.arrayContaining(['report', 'client']),
    );
  });
});

describe('who may preview one', () => {
  it('lets a practitioner with the client on her schedule preview a draft', async () => {
    await h.onSchedule(clientToWriteAbout(h).index, SEEDED.practitioner);
    const draft = await steps.newDraft(SEEDED.practitioner);
    expect((await preview(draft.id, SEEDED.practitioner)).status).toBe(200);
  });

  it('refuses an admin, who drafts nothing', async () => {
    const draft = await steps.newDraft(SEEDED.owner);
    expect((await preview(draft.id, SEEDED.admin)).status).toBe(403);
  });

  it('shows a household neither the preview of a draft nor the draft itself', async () => {
    const draft = await steps.newDraft(SEEDED.owner);
    const shown = await h.callAs('GET', `/api/reports/${draft.id}/preview?locale=en`, household);
    expect(shown.status).toBe(404);
    const read = await h.callAs('GET', `/api/reports/${draft.id}`, household);
    expect(read.status).toBe(404);
  });

  it('refuses a draft whose body is not one the shape accepts, by the field', async () => {
    const draft = await steps.newDraft(SEEDED.owner);
    await h.owner.query(
      'update report set content = content || \'{"plan": 7}\'::jsonb where id = $1',
      [draft.id],
    );
    const res = await preview(draft.id);
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: 'invalid_content', field: 'plan' });
  });
});
