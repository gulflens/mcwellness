import { randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import { z } from 'zod';
import {
  announcementState,
  announcementsFor,
  announcementsVisibleTo,
  checkAnnouncement,
  type AnnouncementRow,
} from '../../../domain/portal';
import { canActor, isoDateIn } from '../../../domain/shared';
import { logAction, logReads } from '../_middleware/audit';
import type { ApiEnv, Db } from '../_middleware/request-context';
import type { Household } from './household';
import {
  OfficeAnnouncementsResponse,
  PublishAnnouncementInput,
  PublishAnnouncementResponse,
  WithdrawAnnouncementResponse,
  type OfficeAnnouncement,
  type PortalAnnouncement,
} from './schema';

/**
 * The practice's announcements (docs/SPEC/client-portal.md sections 3.1 and
 * 3.10 as amended 2026-10-06; the push memo's decisions 3 and 4,
 * docs/OPERATOR/2026-09-17-push-notifications.md).
 *
 * Two halves, one file, as `access.ts` holds both of its sides:
 *
 * - **The household's.** `homeAnnouncements` is what `GET /api/portal/home`
 *   carries: the current ones, newest first, at most three, and none at all
 *   for a young person's own login — `announcementsFor`'s rule, asked before
 *   anything is read, over rows the read policy has already narrowed to the
 *   current ones (migration 705). Each one shown is logged as read, the
 *   portal's other reads' way.
 * - **The practice's.** `GET /api/portal/announcements` lists every one;
 *   `POST /api/portal/announcements` publishes one, or a correction of one;
 *   `POST /api/portal/announcements/:id/withdraw` withdraws one. The owner and
 *   an admin (`portal.announcement.write`), and every write carries
 *   `X-Reason`, which the fence stamps on the transaction and the row trigger
 *   records beside the row.
 *
 * **Never edited in place.** There is no route that changes an announcement's
 * words. A correction is a new announcement naming the one it replaces, and
 * the old one is withdrawn in the same transaction; `app.guard_announcement`
 * refuses anything else beneath this.
 */

const ROW_COLUMNS =
  'a.id, a.title_en, a.title_ar, a.body_en, a.body_ar, ' +
  "to_char(a.visible_from, 'YYYY-MM-DD') as visible_from, " +
  "to_char(a.visible_until, 'YYYY-MM-DD') as visible_until, " +
  "to_char(a.created_at at time zone $1, 'YYYY-MM-DD') as published_on, " +
  'a.created_at, a.withdrawn_at, a.supersedes_id';

type Row = {
  id: string;
  title_en: string;
  title_ar: string;
  body_en: string;
  body_ar: string;
  visible_from: string | null;
  visible_until: string | null;
  published_on: string;
  created_at: Date;
  withdrawn_at: Date | null;
  supersedes_id: string | null;
};

type OfficeRow = Row & { published_by: string | null; withdrawn_by_name: string | null };

/**
 * The household's read. Only the standing ones are asked for: the read policy
 * admits nothing else to a household in any case, and a withdrawn one is
 * never shown. Capped well above what is shown, because the rule — not the
 * query — decides which three.
 */
const HOME_SQL =
  `select ${ROW_COLUMNS} from announcement a ` +
  'where a.tenant_id = app.current_tenant_id() and a.withdrawn_at is null ' +
  'order by a.created_at desc, a.id desc limit 50';

const OFFICE_FROM =
  `select ${ROW_COLUMNS}, pub.display_name as published_by, wd.display_name as withdrawn_by_name ` +
  'from announcement a ' +
  'left join app_user pub on pub.id = a.created_by ' +
  'left join app_user wd on wd.id = a.withdrawn_by ' +
  'where a.tenant_id = app.current_tenant_id()';

const OFFICE_SQL = `${OFFICE_FROM} order by a.created_at desc, a.id desc limit 200`;

const ONE_SQL = `${OFFICE_FROM} and a.id = $2`;

const TIMEZONE_SQL = 'select timezone from tenant where id = app.current_tenant_id()';

function toRule(row: Row): AnnouncementRow {
  return {
    id: row.id,
    title: { en: row.title_en, ar: row.title_ar },
    body: { en: row.body_en, ar: row.body_ar },
    visibleFrom: row.visible_from,
    visibleUntil: row.visible_until,
    publishedOn: row.published_on,
    publishedAt: row.created_at.toISOString(),
    withdrawn: row.withdrawn_at !== null,
  };
}

function toOffice(row: OfficeRow, today: string): OfficeAnnouncement {
  const rule = toRule(row);
  return {
    id: row.id,
    title: rule.title,
    body: rule.body,
    visibleFrom: rule.visibleFrom,
    visibleUntil: rule.visibleUntil,
    publishedAt: rule.publishedAt,
    publishedOn: rule.publishedOn,
    publishedBy: row.published_by,
    withdrawnAt: row.withdrawn_at === null ? null : row.withdrawn_at.toISOString(),
    withdrawnBy: row.withdrawn_by_name,
    supersedesId: row.supersedes_id,
    state: announcementState(rule, today),
  };
}

/** What the household's home carries, and the reads it records. */
export async function homeAnnouncements(
  db: Db,
  household: Household,
): Promise<PortalAnnouncement[]> {
  const viewer = household.clients.map((client) => ({
    relationship: client.relationship,
    dateOfBirth: client.dateOfBirth,
  }));
  // A young person's own login, or a person who is nobody's contact: nothing
  // is read at all, so nothing is logged as read.
  if (!announcementsVisibleTo(viewer, household.today)) return [];

  const rows = await db.query<Row>(HOME_SQL, [household.practice.timezone]);
  const shown = announcementsFor(rows.rows.map(toRule), viewer, household.today);
  await logReads(
    db,
    'announcement',
    shown.map((announcement) => ({ id: announcement.id, clientId: null })),
    'read',
  );
  return shown.map((announcement) => ({
    id: announcement.id,
    title: announcement.title,
    body: announcement.body,
  }));
}

const IdParams = z.object({ id: z.uuid() });

function reasonOf(header: string | undefined): string | null {
  const reason = (header ?? '').trim();
  return reason.length === 0 ? null : reason;
}

export function mountPortalAnnouncements(
  api: Hono<ApiEnv>,
  now: () => Date = () => new Date(),
): void {
  async function practiceToday(db: Db): Promise<{ zone: string; today: string }> {
    const zone = (await db.query<{ timezone: string }>(TIMEZONE_SQL)).rows[0]?.timezone;
    const timezone = zone ?? 'Asia/Dubai';
    return { zone: timezone, today: isoDateIn(now(), timezone) };
  }

  api.get('/api/portal/announcements', async (c) => {
    const requestId = c.get('requestId');
    const db = c.get('db');
    if (!canActor(c.get('actor'), { type: 'portal.announcement.write' }, {}, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const { zone, today } = await practiceToday(db);
    const rows = await db.query<OfficeRow>(OFFICE_SQL, [zone]);
    return c.json(
      OfficeAnnouncementsResponse.parse({
        today,
        announcements: rows.rows.map((row) => toOffice(row, today)),
      }),
    );
  });

  api.post('/api/portal/announcements', async (c) => {
    const requestId = c.get('requestId');
    const db = c.get('db');
    const actor = c.get('actor');
    if (!canActor(actor, { type: 'portal.announcement.write' }, {}, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    if (reasonOf(c.req.header('x-reason')) === null) {
      return c.json({ error: 'reason_required', requestId }, 400);
    }
    const body = PublishAnnouncementInput.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      const field = body.error.issues[0]?.path.join('.');
      return c.json({ error: 'bad_request', code: field || 'invalid', requestId }, 400);
    }
    const input = body.data;
    const { zone, today } = await practiceToday(db);

    const problems = checkAnnouncement(input, today);
    if (problems.length > 0) {
      return c.json({ error: 'wording', problems, requestId }, 422);
    }

    if (input.supersedesId !== null) {
      // The one it corrects: standing, and not already corrected. Locked, so
      // two corrections pressed at once end with one winner.
      const old = await db.query<{ withdrawn: boolean; corrected: boolean }>(
        'select a.withdrawn_at is not null as withdrawn, exists (select 1 from announcement n ' +
          'where n.tenant_id = a.tenant_id and n.supersedes_id = a.id) as corrected ' +
          'from announcement a where a.tenant_id = app.current_tenant_id() and a.id = $1 ' +
          'for update',
        [input.supersedesId],
      );
      const standing = old.rows[0];
      if (!standing) return c.json({ error: 'not_found', requestId }, 404);
      if (standing.withdrawn) return c.json({ error: 'already_withdrawn', requestId }, 409);
      if (standing.corrected) return c.json({ error: 'already_corrected', requestId }, 409);
    }

    const id = randomUUID();
    await db.query(
      'insert into announcement (id, tenant_id, title_en, title_ar, body_en, body_ar, ' +
        'visible_from, visible_until, supersedes_id, created_by) ' +
        'values ($1, $2, $3, $4, $5, $6, $7::date, $8::date, $9, $10)',
      [
        id,
        actor.tenantId,
        input.title.en,
        input.title.ar,
        input.body.en,
        input.body.ar,
        input.visibleFrom,
        input.visibleUntil,
        input.supersedesId,
        actor.userId,
      ],
    );
    // The row trigger has recorded the insert, with the reason. This names
    // the act, with ids alone.
    await logAction(
      db,
      'portal.announcement.published',
      { type: 'announcement', id, clientId: null },
      input.supersedesId === null ? {} : { supersedesId: input.supersedesId },
    );

    if (input.supersedesId !== null) {
      await db.query(
        'update announcement set withdrawn_at = now(), withdrawn_by = $2 ' +
          'where tenant_id = app.current_tenant_id() and id = $1',
        [input.supersedesId, actor.userId],
      );
      await logAction(
        db,
        'portal.announcement.withdrawn',
        { type: 'announcement', id: input.supersedesId, clientId: null },
        { correctedBy: id },
      );
    }

    const written = await db.query<OfficeRow>(ONE_SQL, [zone, id]);
    const row = written.rows[0];
    if (!row) return c.json({ error: 'not_found', requestId }, 404);
    return c.json(PublishAnnouncementResponse.parse({ announcement: toOffice(row, today) }), 201);
  });

  api.post('/api/portal/announcements/:id/withdraw', async (c) => {
    const requestId = c.get('requestId');
    const db = c.get('db');
    const actor = c.get('actor');
    if (!canActor(actor, { type: 'portal.announcement.write' }, {}, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    if (reasonOf(c.req.header('x-reason')) === null) {
      return c.json({ error: 'reason_required', requestId }, 400);
    }
    const params = IdParams.safeParse(c.req.param());
    if (!params.success) return c.json({ error: 'not_found', requestId }, 404);
    const { id } = params.data;

    const found = await db.query<{ withdrawn: boolean }>(
      'select withdrawn_at is not null as withdrawn from announcement ' +
        'where tenant_id = app.current_tenant_id() and id = $1 for update',
      [id],
    );
    const row = found.rows[0];
    if (!row) return c.json({ error: 'not_found', requestId }, 404);
    if (row.withdrawn) return c.json({ error: 'already_withdrawn', requestId }, 409);

    await db.query(
      'update announcement set withdrawn_at = now(), withdrawn_by = $2 ' +
        'where tenant_id = app.current_tenant_id() and id = $1',
      [id, actor.userId],
    );
    await logAction(
      db,
      'portal.announcement.withdrawn',
      { type: 'announcement', id, clientId: null },
      {},
    );
    return c.json(WithdrawAnnouncementResponse.parse({ ok: true }));
  });
}
