import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  HomeResponse,
  OfficeAnnouncementsResponse,
  PublishAnnouncementResponse,
} from '../../../app/api/portal/schema';
import { IDS } from '../../db/helpers';
import { PORTAL, startPortalHarness, type PortalHarness } from './support';

/**
 * The announcements' routes, through `createApi` exactly as the server builds
 * it (docs/SPEC/client-portal.md sections 3.1, 3.10 and 7; migration 705).
 *
 * The household's half is `GET /api/portal/home`; the practice's half is
 * Settings › Announcements' three routes. Every write carries `X-Reason` and
 * the trail records it beside the row. Every row here is invented.
 */

const OWNER_AUTH = '00000001-0000-4000-8000-000000000010';
const REASON = { 'x-reason': 'Practice news for the households' };

const SEEDED = {
  oldest: '00000001-0000-4000-8000-0000000000f1',
  older: '00000001-0000-4000-8000-0000000000f2',
  newer: '00000001-0000-4000-8000-0000000000f3',
  newest: '00000001-0000-4000-8000-0000000000f4',
  withdrawn: '00000001-0000-4000-8000-0000000000f5',
  future: '00000001-0000-4000-8000-0000000000f6',
} as const;

const DRAFT = {
  title: { en: 'A new practitioner', ar: 'ممارسة جديدة' },
  body: {
    en: 'A second practitioner has joined the practice for home visits.',
    ar: 'انضمت ممارسة ثانية إلى المركز للزيارات المنزلية.',
  },
};

let h: PortalHarness;

async function seed(id: string, daysAgo: number, extra = ''): Promise<void> {
  await h.owner.query(
    'insert into announcement (id, tenant_id, title_en, title_ar, body_en, body_ar, ' +
      'created_at, created_by, withdrawn_at, withdrawn_by, visible_from) ' +
      `values ($1, $2, 'News ${daysAgo}', 'خبر', 'Practice news.', 'خبر من المركز.', ` +
      `now() - interval '${daysAgo} days', $3, ` +
      (extra === 'withdrawn' ? 'now(), $3, ' : 'null, null, ') +
      (extra === 'future' ? 'current_date + 10)' : 'null)'),
    [id, IDS.tenantA, IDS.ownerA],
  );
}

beforeAll(async () => {
  h = await startPortalHarness();
  await seed(SEEDED.oldest, 9);
  await seed(SEEDED.older, 7);
  await seed(SEEDED.newer, 5);
  await seed(SEEDED.newest, 3);
  await seed(SEEDED.withdrawn, 1, 'withdrawn');
  await seed(SEEDED.future, 1, 'future');
});

afterAll(async () => {
  await h?.close();
});

async function home(authId: string): Promise<HomeResponse> {
  const res = await h.callAs('GET', '/api/portal/home', authId);
  expect(res.status).toBe(200);
  return (await res.json()) as HomeResponse;
}

async function readsLogged(id: string): Promise<number> {
  const rows = await h.owner.query<{ n: string }>(
    "select count(*)::text as n from audit_log where action = 'read' " +
      "and entity_type = 'announcement' and entity_id = $1",
    [id],
  );
  return Number(rows.rows[0]?.n ?? 0);
}

describe('the household’s home', () => {
  it('carries the current announcements, newest first, at most three, in both languages', async () => {
    const answer = await home(PORTAL.motherAuth);
    expect(answer.announcements.map((a) => a.id)).toEqual([
      SEEDED.newest,
      SEEDED.newer,
      SEEDED.older,
    ]);
    expect(answer.announcements[0]).toEqual({
      id: SEEDED.newest,
      title: { en: 'News 3', ar: 'خبر' },
      body: { en: 'Practice news.', ar: 'خبر من المركز.' },
    });
  });

  it('carries the same to an adult who is their own contact', async () => {
    const answer = await home(PORTAL.adultAuth);
    expect(answer.announcements.map((a) => a.id)).toEqual([
      SEEDED.newest,
      SEEDED.newer,
      SEEDED.older,
    ]);
  });

  it("carries none to a young person's own login, and logs no read", async () => {
    const before = await readsLogged(SEEDED.newest);
    const answer = await home(PORTAL.minorAuth);
    expect(answer.announcements).toEqual([]);
    expect(await readsLogged(SEEDED.newest)).toBe(before);
  });

  it('logs each announcement shown as read, and none it did not show', async () => {
    const before = await readsLogged(SEEDED.newer);
    await home(PORTAL.motherAuth);
    expect(await readsLogged(SEEDED.newer)).toBe(before + 1);
    expect(await readsLogged(SEEDED.oldest)).toBe(0);
    expect(await readsLogged(SEEDED.withdrawn)).toBe(0);
    expect(await readsLogged(SEEDED.future)).toBe(0);
  });
});

describe('Settings › Announcements: the list', () => {
  it('lists every announcement to the owner and an admin, each with its state', async () => {
    for (const auth of [OWNER_AUTH, PORTAL.adminAuth]) {
      const res = await h.callAs('GET', '/api/portal/announcements', auth);
      expect(res.status).toBe(200);
      const body = (await res.json()) as OfficeAnnouncementsResponse;
      const state = new Map(body.announcements.map((a) => [a.id, a.state]));
      expect(state.get(SEEDED.newest)).toBe('current');
      // Current by its own days, but the home shows the newest three.
      expect(state.get(SEEDED.oldest)).toBe('current_not_shown');
      expect(state.get(SEEDED.withdrawn)).toBe('withdrawn');
      expect(state.get(SEEDED.future)).toBe('scheduled');
      expect(body.announcements.find((a) => a.id === SEEDED.newest)?.publishedBy).toBe(
        'Synthetic Studio Owner',
      );
    }
  });

  it('refuses the rest of the practice and every household', async () => {
    for (const auth of [
      PORTAL.leadAuth,
      PORTAL.practitionerAuth,
      PORTAL.financeAuth,
      PORTAL.motherAuth,
    ]) {
      const res = await h.callAs('GET', '/api/portal/announcements', auth);
      expect(res.status, auth).toBe(403);
    }
  });
});

describe('Settings › Announcements: publishing', () => {
  it('publishes one with a reason, and the trail records the reason with the row', async () => {
    const res = await h.callAs(
      'POST',
      '/api/portal/announcements',
      PORTAL.adminAuth,
      { ...DRAFT, visibleUntil: null },
      REASON,
    );
    expect(res.status).toBe(201);
    const { announcement } = (await res.json()) as PublishAnnouncementResponse;
    expect(announcement.state).toBe('current');
    expect(announcement.publishedBy).toBe('Iris Harbour');

    const trail = await h.owner.query<{ action: string; reason: string | null }>(
      "select action, reason from audit_log where entity_type = 'announcement' " +
        'and entity_id = $1 order by id',
      [announcement.id],
    );
    expect(trail.rows).toEqual([
      { action: 'insert', reason: REASON['x-reason'] },
      { action: 'portal.announcement.published', reason: REASON['x-reason'] },
    ]);
  });

  it('refuses a publication with no reason', async () => {
    const res = await h.callAs('POST', '/api/portal/announcements', PORTAL.adminAuth, DRAFT);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('reason_required');
  });

  it('refuses a reason that cleans to nothing', async () => {
    const res = await h.callAs('POST', '/api/portal/announcements', PORTAL.adminAuth, DRAFT, {
      'x-reason': '\u007f\u0085\u009f',
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('reason_required');
  });

  it('asks for an ambiguous word to be confirmed, and records the confirmation', async () => {
    const draft = { ...DRAFT, title: { en: 'A treat for Eid', ar: 'هدية العيد' } };
    const unconfirmed = await h.callAs(
      'POST',
      '/api/portal/announcements',
      PORTAL.adminAuth,
      draft,
      REASON,
    );
    expect(unconfirmed.status).toBe(422);
    expect(await unconfirmed.json()).toMatchObject({
      error: 'confirm_wording',
      warnings: [{ field: 'titleEn', term: 'treat' }],
    });

    const confirmed = await h.callAs(
      'POST',
      '/api/portal/announcements',
      PORTAL.adminAuth,
      { ...draft, confirmedWarnings: true },
      REASON,
    );
    expect(confirmed.status).toBe(201);
    const { announcement } = (await confirmed.json()) as PublishAnnouncementResponse;
    const action = await h.owner.query<{ new_values: Record<string, string> }>(
      "select new_values from audit_log where action = 'portal.announcement.published' " +
        'and entity_id = $1',
      [announcement.id],
    );
    expect(action.rows[0]?.new_values).toEqual({ confirmedWarnings: 'titleEn:treat' });
  });

  it('refuses a medical word, in either language, with the field it is in', async () => {
    const res = await h.callAs(
      'POST',
      '/api/portal/announcements',
      PORTAL.adminAuth,
      { ...DRAFT, body: { en: DRAFT.body.en, ar: 'علاج في المنزل' } },
      REASON,
    );
    expect(res.status).toBe(422);
    expect(((await res.json()) as { problems: unknown }).problems).toEqual([
      { field: 'bodyAr', code: 'medical_word' },
    ]);
  });

  it('refuses a day the calendar does not have', async () => {
    const res = await h.callAs(
      'POST',
      '/api/portal/announcements',
      PORTAL.adminAuth,
      { ...DRAFT, visibleFrom: '2026-13-45' },
      REASON,
    );
    expect(res.status).toBe(400);
  });

  it('refuses the rest of the practice and every household, and writes nothing', async () => {
    const before = await h.owner.query('select id from announcement');
    for (const auth of [PORTAL.leadAuth, PORTAL.financeAuth, PORTAL.motherAuth]) {
      const res = await h.callAs('POST', '/api/portal/announcements', auth, DRAFT, REASON);
      expect(res.status, auth).toBe(403);
    }
    const after = await h.owner.query('select id from announcement');
    expect(after.rowCount).toBe(before.rowCount);
  });

  it('publishes a correction and withdraws what it corrects, in one act', async () => {
    const res = await h.callAs(
      'POST',
      '/api/portal/announcements',
      OWNER_AUTH,
      { ...DRAFT, supersedesId: SEEDED.oldest },
      REASON,
    );
    expect(res.status).toBe(201);
    const { announcement } = (await res.json()) as PublishAnnouncementResponse;
    expect(announcement.supersedesId).toBe(SEEDED.oldest);
    const old = await h.owner.query<{ withdrawn_by: string | null }>(
      'select withdrawn_by from announcement where id = $1',
      [SEEDED.oldest],
    );
    expect(old.rows[0]?.withdrawn_by).toBe(IDS.ownerA);

    const again = await h.callAs(
      'POST',
      '/api/portal/announcements',
      OWNER_AUTH,
      { ...DRAFT, supersedesId: SEEDED.oldest },
      REASON,
    );
    expect(again.status).toBe(409);
  });

  it('leaves the old one standing and shown when its correction starts on a later day', async () => {
    const later = await h.owner.query<{ day: string }>(
      "select to_char((now() at time zone timezone)::date + 3, 'YYYY-MM-DD') as day " +
        'from tenant where id = $1',
      [IDS.tenantA],
    );
    const res = await h.callAs(
      'POST',
      '/api/portal/announcements',
      OWNER_AUTH,
      { ...DRAFT, visibleFrom: later.rows[0]?.day, supersedesId: SEEDED.older },
      REASON,
    );
    expect(res.status).toBe(201);
    const { announcement } = (await res.json()) as PublishAnnouncementResponse;
    expect(announcement.state).toBe('scheduled');
    const old = await h.owner.query<{ withdrawn_at: Date | null }>(
      'select withdrawn_at from announcement where id = $1',
      [SEEDED.older],
    );
    expect(old.rows[0]?.withdrawn_at).toBeNull();
    // Still standing, so still current on the practice's own list (shown or
    // not, depending on how many newer ones the earlier cases published).
    const list = await h.callAs('GET', '/api/portal/announcements', OWNER_AUTH);
    const body = (await list.json()) as OfficeAnnouncementsResponse;
    const state = body.announcements.find((a) => a.id === SEEDED.older)?.state;
    expect(['current', 'current_not_shown']).toContain(state);
    expect(body.announcements.find((a) => a.id === SEEDED.older)?.correctedById).toBe(
      announcement.id,
    );
  });

  it('refuses a correction of an announcement that does not exist', async () => {
    const res = await h.callAs(
      'POST',
      '/api/portal/announcements',
      OWNER_AUTH,
      { ...DRAFT, supersedesId: '00000001-0000-4000-8000-0000000000ff' },
      REASON,
    );
    expect(res.status).toBe(404);
  });
});

describe('Settings › Announcements: withdrawing', () => {
  it('withdraws one with a reason, once, and the households stop seeing it', async () => {
    const path = `/api/portal/announcements/${SEEDED.newer}/withdraw`;
    expect((await h.callAs('POST', path, PORTAL.adminAuth, {})).status).toBe(400);
    expect((await h.callAs('POST', path, PORTAL.motherAuth, {}, REASON)).status).toBe(403);

    const res = await h.callAs('POST', path, PORTAL.adminAuth, {}, REASON);
    expect(res.status).toBe(200);
    expect((await h.callAs('POST', path, PORTAL.adminAuth, {}, REASON)).status).toBe(409);

    const answer = await home(PORTAL.motherAuth);
    expect(answer.announcements.map((a) => a.id)).not.toContain(SEEDED.newer);

    const trail = await h.owner.query<{ action: string; reason: string | null }>(
      "select action, reason from audit_log where entity_type = 'announcement' " +
        "and entity_id = $1 and action not in ('read', 'insert') order by id",
      [SEEDED.newer],
    );
    expect(trail.rows).toEqual([
      { action: 'update', reason: REASON['x-reason'] },
      { action: 'portal.announcement.withdrawn', reason: REASON['x-reason'] },
    ]);
  });

  it('answers 404 for an announcement that does not exist', async () => {
    const res = await h.callAs(
      'POST',
      '/api/portal/announcements/00000001-0000-4000-8000-0000000000ff/withdraw',
      PORTAL.adminAuth,
      {},
      REASON,
    );
    expect(res.status).toBe(404);
  });
});
