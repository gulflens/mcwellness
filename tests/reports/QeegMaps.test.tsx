// @vitest-environment jsdom
import { createHash } from 'node:crypto';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProviderBoundary } from '../../app/shell/auth/AuthContext';
import { QeegEditor } from '../../app/admin/reports/qeeg/QeegEditor';
import { FIGURE_REFUSALS } from '../../app/admin/reports/qeeg/refusals';
import { SAVE_REASONS } from '../../app/admin/reports/qeeg/useQeegDraft';
import { FIGURE_SENTENCES } from '../../app/api/reports/qeeg/figureSchema';
import { LEAD_PRACTITIONER, signedInProvider } from '../../app/admin/clients/testActors';
import { blankFollowUp, blankInitial } from '../../domain/reports/qeeg/blank';
import { addMap, choosePair } from '../../domain/reports/qeeg/maps';
import type { ComparedWith, FigureRef, QeegContent } from '../../domain/reports/qeeg/types';

/**
 * The brain maps' section of the brain-map form, against a fake API: the
 * upload door `PUT /api/reports/:id/figures` and the remove door
 * `DELETE /api/reports/:id/figures/:figureId` (app/api/reports/qeeg/figures.ts),
 * and the draft route they sit beside (docs/SPEC/reports-qeeg.md sections 9,
 * 10 and 15).
 *
 * What matters most here: a picture over a cap is refused before anything is
 * sent and never shrunk; what is sent carries the digest of its own bytes; a
 * changed draft is saved before a picture joins it; every refusal is a
 * sentence and leaves the form as it was; a map is removed only after she
 * says so, inside the form, and never from under a page that still prints it.
 *
 * The browser's decoder is stood in for (`decodePicture.ts`): a test browser
 * has none. Each test file names its picture's size and kind in its text,
 * and the stand-in makes those pixels. Everything after the decode is the
 * real thing: the trim, the flattening, the PNG, the compressor and the
 * digest. Text boxes are typed with `user.type`, files given with
 * `user.upload`. Ids are in the reserved synthetic shape.
 */

vi.mock('../../app/admin/reports/qeeg/decodePicture', () => ({
  openPicture: vi.fn(async (file: Blob) => {
    const [size, kind] = (await file.text()).split(' ');
    if (size === 'unreadable') return null;
    const [width, height] = (size ?? '').split('x').map(Number) as [number, number];
    return {
      width,
      height,
      pixels: () => {
        const data = new Uint8ClampedArray(width * height * 4);
        let seed = 7;
        for (let i = 0; i < data.length; i += 4) {
          if (kind === 'noise') {
            for (let c = 0; c < 3; c += 1) {
              seed ^= seed << 13;
              seed ^= seed >>> 17;
              seed ^= seed << 5;
              data[i + c] = seed & 255;
            }
          } else {
            data[i] = 90;
            data[i + 1] = 60;
            data[i + 2] = 150;
          }
          data[i + 3] = 255;
        }
        return { width, height, data };
      },
      close: () => undefined,
    };
  }),
}));

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:map-chosen');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  cleanup();
});

const CLIENT = '00000008-0000-4000-8000-000000000005';
const EARLIER = '00000006-0000-4000-8000-000000000001';
const DRAFT = '00000006-0000-4000-8000-000000000009';
const FIGURE = '0000000d-0000-4000-8000-000000000001';
const EARLIER_FIGURE = '0000000d-0000-4000-8000-000000000002';
const STAMP = '2026-09-30T08:00:00.000000Z';
const LOADED_STAMP = '2026-09-30T08:01:00.000000Z';
const FILED_STAMP = '2026-09-30T08:02:00.000000Z';
const REMOVED_STAMP = '2026-09-30T08:03:00.000000Z';

const COMPARED: ComparedWith = {
  reportId: EARLIER,
  recordedOn: '2026-06-01',
  relation: 'initial',
  origin: 'issued',
  reference: 'RPT-000001',
};

const OWN: FigureRef = { figureId: FIGURE, sha256: 'a'.repeat(64), widthPx: 40, heightPx: 30 };
const THEIRS: FigureRef = {
  figureId: EARLIER_FIGURE,
  sha256: 'b'.repeat(64),
  widthPx: 50,
  heightPx: 30,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function row(over: Record<string, unknown> = {}) {
  return {
    id: DRAFT,
    clientId: CLIENT,
    kind: 'qeeg',
    status: 'draft',
    locale: 'en',
    reference: null,
    issuedOn: null,
    coverageFrom: null,
    coverageTo: null,
    signedByName: null,
    version: 1,
    supersedesId: null,
    amendmentReason: null,
    documentId: null,
    deliveries: 0,
    createdAt: '2026-09-30T08:00:00+04:00',
    ...over,
  };
}

const SIGNED_BRAIN_MAP = row({
  id: EARLIER,
  status: 'issued',
  reference: 'RPT-000001',
  issuedOn: '2026-06-02',
  signedByName: 'Rowan Ridge',
  createdAt: '2026-06-02T08:00:00+04:00',
});

type Call = {
  url: string;
  method: string;
  reason: string | null;
  headers: Headers;
  body: unknown;
  bytes: Uint8Array | null;
};

function asSaved(sent: Record<string, unknown>): QeegContent {
  const content = {
    ...sent,
    subject: { nameAr: null, ageYears: 9, sex: 'female' },
    provenance: { origin: 'app' },
  } as Record<string, unknown>;
  if (sent['edition'] === 'follow-up') content['comparedWith'] = { ...COMPARED };
  return content as unknown as QeegContent;
}

function mountApi({
  upload,
  remove,
  stored,
  earlier,
}: {
  /** How the upload door answers; by default it files the picture. */
  upload?: (call: Call) => Response | Promise<Response | null> | null;
  remove?: (call: Call) => Response | null;
  /** What `GET /api/reports/<draft>` holds. */
  stored?: QeegContent;
  /** What the earlier report holds. */
  earlier?: QeegContent;
} = {}) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers = new Headers(init?.headers);
    const raw = init?.body;
    const bytes = raw instanceof Uint8Array ? raw : null;
    const body: unknown = typeof raw === 'string' ? JSON.parse(raw) : undefined;
    const call = { url, method, reason: headers.get('x-reason'), headers, body, bytes };
    calls.push(call);
    if (url === '/api/me') return json(LEAD_PRACTITIONER);
    if (url === '/api/reports/draft') {
      const sent = (body as { content: Record<string, unknown> }).content;
      return json(
        { report: row(), content: asSaved(sent), savedAt: STAMP },
        (body as { id?: string }).id ? 200 : 201,
      );
    }
    if (url.startsWith(`/api/reports/${DRAFT}/figures`) && method === 'PUT') {
      const answer = await upload?.(call);
      if (answer) return answer;
      const query = new URL(url, 'http://localhost').searchParams;
      return json(
        {
          figure: {
            figureId: FIGURE,
            sha256: headers.get('x-sha256'),
            widthPx: 40,
            heightPx: 30,
            condition: query.get('condition'),
            position: query.has('position') ? Number(query.get('position')) : null,
            borrowed: false,
          },
          savedAt: FILED_STAMP,
        },
        201,
      );
    }
    if (url.startsWith(`/api/reports/${DRAFT}/figures/`) && method === 'DELETE') {
      const answer = remove?.(call);
      if (answer) return answer;
      return json({ removed: true, savedAt: REMOVED_STAMP });
    }
    if (url === `/api/reports/${DRAFT}`) {
      return json({
        report: row(),
        content: stored ?? asSaved({ ...blankInitial() }),
        deliveries: [],
        url: null,
        expiresInSeconds: null,
        savedAt: LOADED_STAMP,
      });
    }
    if (url === `/api/reports/${EARLIER}` && earlier) {
      return json({
        report: SIGNED_BRAIN_MAP,
        content: earlier,
        deliveries: [],
        url: null,
        expiresInSeconds: null,
        savedAt: STAMP,
      });
    }
    return json({ error: 'not_found' }, 404);
  });
  const saves = () => calls.filter((call) => call.url === '/api/reports/draft');
  const uploads = () => calls.filter((call) => call.method === 'PUT');
  const removals = () => calls.filter((call) => call.method === 'DELETE');
  /** Everything but the sign-in's own question and the draft's first read. */
  const sent = () => calls.filter((call) => call.url !== '/api/me' && call.method !== 'GET');
  return { calls, saves, uploads, removals, sent, fetchImpl };
}

function mountEditor(
  start: QeegContent | null,
  api = mountApi(),
  { reportId = null }: { reportId?: string | null } = {},
) {
  render(
    <AuthProviderBoundary provider={signedInProvider} fetchImpl={api.fetchImpl}>
      <QeegEditor
        clientId={CLIENT}
        reportId={reportId}
        start={start}
        reports={[SIGNED_BRAIN_MAP] as never}
        onDone={vi.fn()}
      />
    </AuthProviderBoundary>,
  );
  return api;
}

async function openSection(user: ReturnType<typeof userEvent.setup>, title: string) {
  const toggle = await screen.findByRole('button', { name: new RegExp(`^${title}`) });
  if (toggle.getAttribute('aria-expanded') !== 'true') await user.click(toggle);
  return toggle;
}

/** A picture file whose size and kind the decoder's stand-in reads. */
function picture(size: string, kind = 'plain'): File {
  return new File([`${size} ${kind}`], 'export.png', { type: 'image/png' });
}

async function choose(user: ReturnType<typeof userEvent.setup>, file: File) {
  await user.upload(screen.getByLabelText('Choose a brain map'), file);
}

function sentContent(call: Call | undefined): Record<string, unknown> {
  return (call?.body as { content: Record<string, unknown> }).content;
}

const withOwnMap = (content: QeegContent) => asSaved({ ...addMap(content, OWN, 'eyes_closed') });

describe('the brain maps section', () => {
  it('is the fifth of a first report’s twelve sections', async () => {
    mountEditor(blankInitial());
    await screen.findByRole('button', { name: /^Client and recording/ });
    const toggles = screen.getAllByRole('button', { name: /left to fill$/ });
    expect(toggles).toHaveLength(12);
    expect(toggles[4]?.textContent).toMatch(/^Brain maps1 left to fill$/);
  });

  it('counts the bands without the maps', async () => {
    const user = userEvent.setup();
    mountEditor(blankInitial());
    const bands = await openSection(user, 'Frequency bands');
    expect(bands.textContent).toMatch(/5 left to fill$/);
  });
});

describe('adding a picture', () => {
  it('saves the new draft first, uploads the prepared picture with its own digest, and the count goes down', async () => {
    const user = userEvent.setup();
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const api = mountApi({
      upload: async () => {
        await held;
        return null;
      },
    });
    mountEditor(blankInitial(), api);
    const maps = await openSection(user, 'Brain maps');
    await user.selectOptions(screen.getByLabelText('Recorded with'), 'eyes_closed');
    await choose(user, picture('40x30'));

    expect(await screen.findByText('Uploading the map.')).toBeTruthy();
    release();
    await waitFor(() => expect(maps.textContent).toMatch(/Nothing left to fill$/));

    const [save] = api.saves();
    const [put] = api.uploads();
    expect(save?.reason).toBe(SAVE_REASONS.upload);
    expect(api.calls.indexOf(save as Call)).toBeLessThan(api.calls.indexOf(put as Call));
    expect(put?.url).toBe(`/api/reports/${DRAFT}/figures?condition=eyes_closed&position=0`);
    expect(put?.headers.get('content-type')).toBe('image/png');
    expect(put?.reason).toBeTruthy();
    const bytes = put?.bytes as Uint8Array;
    // An opaque 8-bit RGB PNG, fingerprinted over exactly the bytes sent.
    expect(Array.from(bytes.subarray(1, 4), (b) => String.fromCharCode(b)).join('')).toBe('PNG');
    expect(bytes[24]).toBe(8);
    expect(bytes[25]).toBe(2);
    expect(put?.headers.get('x-sha256')).toBe(createHash('sha256').update(bytes).digest('hex'));

    const listed = screen.getByRole('table', { name: 'Brain maps on this report' });
    expect(within(listed).getByText('40 × 30 pixels')).toBeTruthy();
    expect(within(listed).getByRole('img', { name: 'Map 1, as chosen' })).toBeTruthy();
    expect((within(listed).getByLabelText('Recorded with, map 1') as HTMLSelectElement).value).toBe(
      'eyes_closed',
    );

    // The next save names the map, and is made over the stamp the upload gave.
    await user.click(screen.getByRole('button', { name: 'Save the draft' }));
    const next = api.saves().at(-1);
    expect((next?.body as { savedAt: string }).savedAt).toBe(FILED_STAMP);
    expect(Object.values(sentContent(next)['maps'] as object)).toEqual([
      {
        figureId: FIGURE,
        sha256: put?.headers.get('x-sha256'),
        widthPx: 40,
        heightPx: 30,
        condition: 'eyes_closed',
        caption: null,
        position: 0,
      },
    ]);
  });

  it('saves a changed draft before an upload, and an unchanged one not at all', async () => {
    const user = userEvent.setup();
    const api = mountApi({ upload: () => null });
    mountEditor(null, api, { reportId: DRAFT });
    await openSection(user, 'Brain maps');
    await choose(user, picture('40x30'));
    await waitFor(() => expect(api.uploads()).toHaveLength(1));
    expect(api.saves()).toHaveLength(0);
    expect(api.uploads()[0]?.url).toBe(`/api/reports/${DRAFT}/figures?position=0`);

    // The draft now names the map, and its condition is changed: unsaved changes.
    await user.selectOptions(screen.getByLabelText('Recorded with, map 1'), 'eyes_open');
    const before = api.calls.length;
    await choose(user, picture('41x30'));
    await waitFor(() => expect(api.uploads()).toHaveLength(2));
    const after = api.calls.slice(before);
    expect(after.map((call) => call.method)).toEqual(['POST', 'PUT']);
    expect(after[0]?.reason).toBe(SAVE_REASONS.upload);
    expect((after[0]?.body as { savedAt: string }).savedAt).toBe(FILED_STAMP);
  });

  const caps: [string, File][] = [
    ['too_wide', picture('4097x10')],
    ['too_tall', picture('10x4097')],
    ['too_many_pixels', picture('4000x3001')],
    ['too_many_bytes', picture('1400x1400', 'noise')],
    ['undecodable', picture('unreadable')],
  ];

  it.each(caps)(
    'refuses a picture that is %s before any request',
    async (code, file) => {
      const user = userEvent.setup();
      const api = mountEditor(blankInitial());
      const maps = await openSection(user, 'Brain maps');
      await choose(user, file);
      expect(
        await screen.findByText(FIGURE_REFUSALS[code] as string, {}, { timeout: 8000 }),
      ).toBeTruthy();
      expect(api.sent()).toEqual([]);
      expect(maps.textContent).toMatch(/1 left to fill$/);
    },
    15_000,
  );

  it('refuses a ninth map before any request', async () => {
    const user = userEvent.setup();
    let full: QeegContent = blankInitial();
    for (let n = 0; n < 8; n += 1) {
      full = addMap(full, { ...OWN, figureId: `0000000d-0000-4000-8000-00000000001${n}` }, null);
    }
    const api = mountApi({ stored: asSaved({ ...full }) });
    mountEditor(null, api, { reportId: DRAFT });
    await openSection(user, 'Brain maps');
    await choose(user, picture('40x30'));
    expect(await screen.findByText(FIGURE_REFUSALS['too_many_maps'] as string)).toBeTruthy();
    expect(api.sent()).toEqual([]);
  });
});

describe('every refusal of the upload door has its sentence', () => {
  const route: [string, number, Record<string, unknown>][] = [
    ['invalid_request', 400, { error: 'bad_request', code: 'invalid_request' }],
    ['digest_missing', 400, { error: 'bad_request', code: 'digest_missing' }],
    ['digest_mismatch', 400, { error: 'bad_request', code: 'digest_mismatch' }],
    ['empty_body', 400, { error: 'bad_request', code: 'empty_body' }],
    ['reason_required', 400, { error: 'reason_required' }],
    ['unsupported_media_type', 415, { error: 'unsupported_media_type' }],
    ['storage_unavailable', 503, { error: 'storage_unavailable' }],
    ['wrong_kind', 422, { error: 'unprocessable', code: 'wrong_kind' }],
  ];
  const picture422 = (Object.keys(FIGURE_SENTENCES) as string[])
    .filter((code) => code !== 'already_on_report')
    .map((code): [string, number, Record<string, unknown>] => [
      code,
      code === 'too_many_bytes' ? 413 : code === 'not_permitted' ? 403 : 422,
      { error: 'unprocessable', code, sentence: 'The door’s own words.' },
    ]);

  it.each([...route, ...picture422])(
    'says what %s means, and leaves the form as it was',
    async (code, status, body) => {
      const user = userEvent.setup();
      const api = mountApi({ upload: () => json(body, status) });
      mountEditor(null, api, { reportId: DRAFT });
      const maps = await openSection(user, 'Brain maps');
      await choose(user, picture('40x30'));
      expect(await screen.findByText(FIGURE_REFUSALS[code] as string)).toBeTruthy();
      expect(maps.textContent).toMatch(/1 left to fill$/);
      expect(screen.queryByRole('table', { name: 'Brain maps on this report' })).toBeNull();
    },
  );

  it('says who may not, and what is gone', async () => {
    for (const [status, words] of [
      [403, /not allowed/],
      [404, /could not be found/],
    ] as const) {
      const user = userEvent.setup();
      mountEditor(null, mountApi({ upload: () => json({ error: 'x' }, status) }), {
        reportId: DRAFT,
      });
      await openSection(user, 'Brain maps');
      await choose(user, picture('40x30'));
      expect(await screen.findByText(words)).toBeTruthy();
      cleanup();
    }
  });

  it('says a picture sent again is already on the report, and lists one the form had lost', async () => {
    const user = userEvent.setup();
    const figure = { ...OWN, condition: 'eyes_open', position: 0, borrowed: false };
    const api = mountApi({
      upload: () =>
        json({ error: 'conflict', code: 'already_on_report', sentence: 'x', figure }, 409),
    });
    mountEditor(null, api, { reportId: DRAFT });
    const maps = await openSection(user, 'Brain maps');
    await choose(user, picture('40x30'));
    expect(await screen.findByText(FIGURE_REFUSALS['already_on_report'] as string)).toBeTruthy();
    // The link was there and the draft did not name it: it is named now, as filed.
    expect(maps.textContent).toMatch(/Nothing left to fill$/);
    const listed = screen.getByRole('table', { name: 'Brain maps on this report' });
    expect((within(listed).getByLabelText('Recorded with, map 1') as HTMLSelectElement).value).toBe(
      'eyes_open',
    );
  });

  it('adds a picture the door hands back once, however often it is chosen', async () => {
    const user = userEvent.setup();
    const figure = { ...OWN, condition: 'eyes_closed', position: 0, borrowed: false };
    const api = mountApi({
      stored: withOwnMap(blankInitial()),
      upload: () => json({ figure, savedAt: FILED_STAMP }, 200),
    });
    mountEditor(null, api, { reportId: DRAFT });
    await openSection(user, 'Brain maps');
    await choose(user, picture('40x30'));
    expect(await screen.findByText('This picture is already on the report.')).toBeTruthy();
    const listed = screen.getByRole('table', { name: 'Brain maps on this report' });
    expect(within(listed).getAllByRole('row')).toHaveLength(2);
  });
});

describe('placing a picture', () => {
  it('sets its condition, its own label, and its place', async () => {
    const user = userEvent.setup();
    const second = { ...OWN, figureId: '0000000d-0000-4000-8000-000000000003' };
    const api = mountApi({
      stored: asSaved({ ...addMap(addMap(blankInitial(), OWN, null), second, 'eyes_open') }),
    });
    mountEditor(null, api, { reportId: DRAFT });
    await openSection(user, 'Brain maps');
    const listed = screen.getByRole('table', { name: 'Brain maps on this report' });
    await user.selectOptions(within(listed).getByLabelText('Recorded with, map 1'), 'eyes_closed');
    await user.selectOptions(within(listed).getByLabelText('Recorded with, map 2'), '');
    await user.type(within(listed).getByLabelText('Label, map 2'), 'Coherence');
    await user.click(within(listed).getByRole('button', { name: 'Move map 2 earlier' }));
    await user.click(screen.getByRole('button', { name: 'Save the draft' }));
    const maps = sentContent(api.saves().at(-1))['maps'] as Record<string, Record<string, unknown>>;
    const ordered = Object.values(maps).sort(
      (a, b) => (a['position'] as number) - (b['position'] as number),
    );
    expect(
      ordered.map((entry) => [entry['figureId'], entry['condition'], entry['caption']]),
    ).toEqual([
      [second.figureId, null, { en: 'Coherence', ar: null }],
      [OWN.figureId, 'eyes_closed', null],
    ]);
  });
});

describe('removing a picture', () => {
  it('asks inside the form, saves the draft without it, then removes it', async () => {
    const user = userEvent.setup();
    const api = mountApi({ stored: withOwnMap(blankInitial()) });
    mountEditor(null, api, { reportId: DRAFT });
    const maps = await openSection(user, 'Brain maps');
    expect(maps.textContent).toMatch(/Nothing left to fill$/);

    await user.click(screen.getByRole('button', { name: 'Remove map 1' }));
    expect(screen.getByText(/Remove map 1 from the report\?/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(api.sent()).toEqual([]);

    await user.click(screen.getByRole('button', { name: 'Remove map 1' }));
    await user.click(screen.getByRole('button', { name: 'Remove the map' }));
    await waitFor(() => expect(api.removals()).toHaveLength(1));
    const [save] = api.saves();
    const [removal] = api.removals();
    expect(save?.reason).toBe(SAVE_REASONS.remove);
    expect(sentContent(save)['maps']).toEqual({});
    expect(api.calls.indexOf(save as Call)).toBeLessThan(api.calls.indexOf(removal as Call));
    expect(removal?.url).toBe(`/api/reports/${DRAFT}/figures/${FIGURE}`);
    expect(removal?.reason).toBeTruthy();
    await waitFor(() => expect(maps.textContent).toMatch(/1 left to fill$/));
    expect(screen.queryByRole('table', { name: 'Brain maps on this report' })).toBeNull();

    // The next save is made over the stamp the removal gave.
    await openSection(user, 'Key findings');
    await user.click(screen.getByLabelText('Mental Fatigue'));
    await user.click(screen.getByRole('button', { name: 'Save the draft' }));
    expect((api.saves().at(-1)?.body as { savedAt: string }).savedAt).toBe(REMOVED_STAMP);
  });

  it('says where a map is still used, and does not take it out from under that page', async () => {
    const user = userEvent.setup();
    const paired = choosePair(
      addMap(blankFollowUp(COMPARED, 'follow_up'), OWN, 'eyes_open'),
      'eyes_open',
      'later',
      OWN,
    );
    const api = mountApi({
      stored: asSaved({ ...paired }),
      earlier: asSaved({ ...blankInitial() }),
    });
    mountEditor(null, api, { reportId: DRAFT });
    await openSection(user, 'Brain maps');
    await user.click(screen.getByRole('button', { name: 'Remove map 1' }));
    await user.click(screen.getByRole('button', { name: 'Remove the map' }));
    expect(
      await screen.findByText(
        'This map is still used in What has changed, before and after, eyes open, the later side. Take it out there first, then remove it.',
      ),
    ).toBeTruthy();
    expect(api.sent()).toEqual([]);
    expect(screen.getByRole('table', { name: 'Brain maps on this report' })).toBeTruthy();
  });

  it('answers the door’s figure_in_use with its sentence, and puts the map back', async () => {
    const user = userEvent.setup();
    const api = mountApi({
      stored: withOwnMap(blankInitial()),
      remove: () =>
        json(
          {
            error: 'conflict',
            code: 'figure_in_use',
            field: 'change.pairs.eyes_closed.later.figureId',
          },
          409,
        ),
    });
    mountEditor(null, api, { reportId: DRAFT });
    const maps = await openSection(user, 'Brain maps');
    await user.click(screen.getByRole('button', { name: 'Remove map 1' }));
    await user.click(screen.getByRole('button', { name: 'Remove the map' }));
    expect(
      await screen.findByText(
        'This map is still used in What has changed, before and after, eyes closed, the later side. Take it out there first, then remove it.',
      ),
    ).toBeTruthy();
    expect(maps.textContent).toMatch(/Nothing left to fill$/);
    expect(screen.getByRole('table', { name: 'Brain maps on this report' })).toBeTruthy();
  });
});

describe('a follow-up’s before-and-after pairs', () => {
  it('offer the earlier report’s maps before and this report’s own after', async () => {
    const user = userEvent.setup();
    const api = mountApi({
      stored: asSaved({ ...addMap(blankFollowUp(COMPARED, 'follow_up'), OWN, 'eyes_closed') }),
      earlier: asSaved({ ...addMap(blankInitial(), THEIRS, 'eyes_closed') }),
    });
    mountEditor(null, api, { reportId: DRAFT });
    await openSection(user, 'What has changed');
    const before = (await screen.findByLabelText('Eyes closed, before')) as HTMLSelectElement;
    const after = screen.getByLabelText('Eyes closed, after') as HTMLSelectElement;
    await waitFor(() => expect(within(before).getAllByRole('option')).toHaveLength(2));
    expect(
      within(before)
        .getAllByRole('option')
        .map((o) => o.getAttribute('value')),
    ).toEqual(['', EARLIER_FIGURE]);
    expect(
      within(after)
        .getAllByRole('option')
        .map((o) => o.getAttribute('value')),
    ).toEqual(['', FIGURE]);
    await user.selectOptions(before, EARLIER_FIGURE);
    await user.selectOptions(after, FIGURE);
    await user.click(screen.getByRole('button', { name: 'Save the draft' }));
    const change = sentContent(api.saves().at(-1))['change'] as {
      pairs: Record<string, unknown>;
    };
    expect(change.pairs['eyes_closed']).toEqual({ earlier: THEIRS, later: OWN });
    expect(change.pairs['eyes_open']).toEqual({ earlier: null, later: null });
    // No Arabic on a staff screen.
    expect(document.body.textContent).not.toMatch(/[؀-ۿ]/);
  });
});
