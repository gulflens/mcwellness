import type { Hono } from 'hono';
import { z } from 'zod';
import { canActor } from '@domain/shared';
import {
  TESTIMONIAL_STATUSES,
  moveTestimonial,
  type TestimonialLanguage,
  type TestimonialStatus,
} from '@domain/testimonial';
import { logAction, logReads } from '../_middleware/audit';
import type { ApiEnv } from '../_middleware/request-context';
import {
  MoveTestimonialBody,
  TestimonialCountResponse,
  TestimonialListResponse,
  type Testimonial,
} from './schema';

/**
 * What the office does with a review sent from the website
 * (docs/SPEC/testimonials.md section 5). Behind the fence, so every route here
 * has an actor; the rows are fenced again by row security to the same two
 * roles (db/policies/testimonial).
 *
 * The table is outside the audit trigger (migration 978), so this file is the
 * trail: a list read is logged as a read of each review on it, and every
 * decision as an action under the person who made it — by id and never by
 * content, so that when a review is withdrawn and later swept away its words
 * are gone from the system and not kept on in the log.
 */

type Row = {
  id: string;
  submitted_at: Date;
  display_name: string;
  context: string | null;
  rating: number;
  body: string;
  language: TestimonialLanguage;
  status: TestimonialStatus;
  decided_at: Date | null;
  decided_by_name: string | null;
};

const COLUMNS =
  't.id, t.submitted_at, t.display_name, t.context, t.rating, t.body, t.language, t.status, ' +
  't.decided_at, u.display_name as decided_by_name';

/**
 * The page's own order (app.published_testimonials, migration 978): by place,
 * a review never placed above the placed ones, newest decision first. The
 * console's Approved table reads the same way, English first, so what the
 * office arranges is what the website shows.
 */
const PUBLISHED_ORDER = 't.published_order asc nulls first, t.decided_at desc, t.id';

const ORDER_BY: Record<TestimonialStatus, string> = {
  pending: 't.submitted_at desc, t.id',
  approved: `(t.language = 'en') desc, ${PUBLISHED_ORDER}`,
  declined: 't.decided_at desc, t.id',
};

/** Far more than will ever wait at once; the definer stops taking new ones at five hundred. */
const LIST_LIMIT = 500;

function toWire(row: Row): Testimonial {
  return {
    id: row.id,
    submittedAt: row.submitted_at.toISOString(),
    displayName: row.display_name,
    context: row.context,
    rating: row.rating,
    body: row.body,
    language: row.language,
    status: row.status,
    decidedAt: row.decided_at ? row.decided_at.toISOString() : null,
    decidedByName: row.decided_by_name,
  };
}

const StatusQuery = z.enum(TESTIMONIAL_STATUSES).default('pending');

export function mountTestimonials(api: Hono<ApiEnv>, now: () => Date): void {
  /**
   * How many are waiting, for the rail's badge. A count names nobody, so it
   * logs no read — where asking the list on every navigation would write a
   * read of every waiting review into the trail each time.
   */
  api.get('/api/testimonials/count', async (c) => {
    const actor = c.get('actor');
    const requestId = c.get('requestId');
    if (!canActor(actor, { type: 'testimonial.list' }, {}, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const { rows } = await c
      .get('db')
      .query<{ n: number }>("select count(*)::int as n from testimonial where status = 'pending'");
    return c.json(TestimonialCountResponse.parse({ pending: rows[0]?.n ?? 0 }));
  });

  api.get('/api/testimonials', async (c) => {
    const actor = c.get('actor');
    const db = c.get('db');
    const requestId = c.get('requestId');
    if (!canActor(actor, { type: 'testimonial.list' }, {}, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const status = StatusQuery.safeParse(c.req.query('status'));
    if (!status.success) {
      return c.json({ error: 'bad_request', field: 'status', requestId }, 400);
    }
    const { rows } = await db.query<Row>(
      `select ${COLUMNS} from testimonial t left join app_user u on u.id = t.decided_by ` +
        `where t.status = $1 order by ${ORDER_BY[status.data]} limit ${LIST_LIMIT}`,
      [status.data],
    );
    const counted = await db.query<{ status: TestimonialStatus; n: number }>(
      'select status, count(*)::int as n from testimonial group by status',
    );
    const counts = { pending: 0, approved: 0, declined: 0 };
    for (const row of counted.rows) counts[row.status] = row.n;
    // A name somebody chose to be published under, and their words: a read of
    // a person, logged as one for each row on the screen.
    await logReads(
      db,
      'testimonial',
      rows.map((row) => ({ id: row.id, clientId: null })),
      'list',
    );
    return c.json(TestimonialListResponse.parse({ testimonials: rows.map(toWire), counts }));
  });

  /**
   * One decision. `from` is what the row must be now and `to` what it becomes;
   * a row that is not `from` (already decided, withdrawn, another practice's,
   * never there) is one answer, not found. Withdraw stamps whoever withdrew it
   * and when, so the thirty days before the sweep run from the withdrawal.
   */
  const decision = (
    path: 'approve' | 'decline' | 'withdraw',
    from: TestimonialStatus,
    to: 'approved' | 'declined',
  ) =>
    api.post(`/api/testimonials/:id/${path}`, async (c) => {
      const actor = c.get('actor');
      const db = c.get('db');
      const requestId = c.get('requestId');
      if (!canActor(actor, { type: 'testimonial.decide' }, {}, now())) {
        return c.json({ error: 'forbidden', requestId }, 403);
      }
      const id = z.uuid().safeParse(c.req.param('id'));
      if (!id.success) return c.json({ error: 'not_found', requestId }, 404);
      const updated = await db.query(
        'update testimonial set status = $2, decided_by = $3, decided_at = now(), ' +
          'ip_hash = null, published_order = null where id = $1 and status = $4',
        [id.data, to, actor.userId, from],
      );
      if (updated.rowCount !== 1) return c.json({ error: 'not_found', requestId }, 404);
      await logAction(db, path, { type: 'testimonial', id: id.data, clientId: null }, {});
      return c.json({ ok: true });
    });

  decision('approve', 'pending', 'approved');
  decision('decline', 'pending', 'declined');
  decision('withdraw', 'approved', 'declined');

  /**
   * Moves an approved review one place up or down among the approved reviews
   * in its own language — the list the website's page in that language shows.
   * The whole list is renumbered from one, under a lock, so the places are
   * always a plain 1, 2, 3 whatever was approved or withdrawn in between.
   */
  api.post('/api/testimonials/:id/move', async (c) => {
    const actor = c.get('actor');
    const db = c.get('db');
    const requestId = c.get('requestId');
    if (!canActor(actor, { type: 'testimonial.decide' }, {}, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const body = MoveTestimonialBody.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) {
      return c.json({ error: 'bad_request', field: 'direction', requestId }, 400);
    }
    const id = z.uuid().safeParse(c.req.param('id'));
    if (!id.success) return c.json({ error: 'not_found', requestId }, 404);
    const found = await db.query<{ language: TestimonialLanguage }>(
      "select language from testimonial where id = $1 and status = 'approved'",
      [id.data],
    );
    const language = found.rows[0]?.language;
    if (language === undefined) return c.json({ error: 'not_found', requestId }, 404);
    const listed = await db.query<{ id: string }>(
      "select t.id from testimonial t where t.status = 'approved' and t.language = $1 " +
        `order by ${PUBLISHED_ORDER} for update`,
      [language],
    );
    const order = moveTestimonial(
      listed.rows.map((row) => row.id),
      id.data,
      body.data.direction,
    );
    // Already first, or already last: nothing to do, and nothing to say.
    if (order === null) return c.json({ ok: true, moved: false });
    await db.query(
      'update testimonial t set published_order = o.place ' +
        'from unnest($1::uuid[]) with ordinality as o(id, place) where t.id = o.id',
      [order],
    );
    await logAction(
      db,
      'move',
      { type: 'testimonial', id: id.data, clientId: null },
      { direction: body.data.direction },
    );
    return c.json({ ok: true, moved: true });
  });
}
