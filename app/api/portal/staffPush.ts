import type { Hono } from 'hono';
import { pushEndpointAllowed, staffNotificationsOffered } from '../../../domain/portal';
import { logAction } from '../_middleware/audit';
import type { ApiEnv, Db } from '../_middleware/request-context';
import { attempt } from './attempt';
import { keysAreSound } from './push';
import { pushSenderOff, type PushSender } from './push/sender';
import { NotificationsResponse, SubscribeInput, UnsubscribeInput } from './schema';

/**
 * The console's "Phone notifications" switch (the practice's list of 6
 * October 2026, item 7; migration 708): a member of staff who can see
 * Enquiries turns on notices for this browser, and is told when a website
 * enquiry lands — "New website enquiry", and never a word of who sent it.
 *
 * `GET /api/me/notifications` says whether it is offered and hands the
 * practice's public key to subscribe with; `POST .../subscriptions` keeps this
 * browser for the person signed in (`app.staff_subscribe_push`), and
 * `.../remove` lets it go. Offered to the roles `canActor` lets see Enquiries
 * (`staffNotificationsOffered`), and only when the key pair is configured;
 * the database refuses anybody else again. The household's own step is
 * ./push.ts, and the two never share a device row.
 */

export function mountStaffPush(
  api: Hono<ApiEnv>,
  now: () => Date = () => new Date(),
  sender: PushSender = pushSenderOff(),
): void {
  async function answer(db: Db, offered: boolean): Promise<NotificationsResponse> {
    const devices = await db.query<{ n: number }>(
      'select count(*)::int as n from staff_push_subscription ' +
        'where tenant_id = app.current_tenant_id() and user_id = app.current_actor_id()',
    );
    return NotificationsResponse.parse({
      configured: sender.configured,
      offered: sender.configured && offered,
      publicKey: sender.configured && offered ? sender.publicKey : null,
      devices: devices.rows[0]?.n ?? 0,
    });
  }

  api.get('/api/me/notifications', async (c) => {
    const offered = staffNotificationsOffered(c.get('actor').roles, now());
    return c.json(await answer(c.get('db'), offered));
  });

  api.post('/api/me/notifications/subscriptions', async (c) => {
    const requestId = c.get('requestId');
    const db = c.get('db');
    if (!staffNotificationsOffered(c.get('actor').roles, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    if (!sender.configured) return c.json({ error: 'push_not_configured', requestId }, 503);
    const body = SubscribeInput.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'bad_request', requestId }, 400);
    const { endpoint, keys } = body.data;
    if (!pushEndpointAllowed(endpoint)) {
      return c.json({ error: 'endpoint_not_allowed', requestId }, 422);
    }
    if (!keysAreSound(keys.p256dh, keys.auth)) {
      return c.json({ error: 'bad_keys', requestId }, 422);
    }
    const saved = await attempt(db, () =>
      db.query<{ id: string }>('select app.staff_subscribe_push($1, $2, $3) as id', [
        endpoint,
        keys.p256dh,
        keys.auth,
      ]),
    );
    if (!saved.ok) {
      if (saved.code === '42501') return c.json({ error: 'forbidden', requestId }, 403);
      if (saved.code === '23514') return c.json({ error: 'bad_keys', requestId }, 422);
      throw saved.error;
    }
    const id = saved.value.rows[0]?.id;
    if (id) {
      await logAction(
        db,
        'staff.push.subscribed',
        { type: 'staff_push_subscription', id, clientId: null },
        {},
      );
    }
    return c.json(await answer(db, true), 201);
  });

  api.post('/api/me/notifications/subscriptions/remove', async (c) => {
    const requestId = c.get('requestId');
    const db = c.get('db');
    const body = UnsubscribeInput.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'bad_request', requestId }, 400);
    // Row security admits the person's own rows and nobody else's.
    const removed = await db.query<{ id: string }>(
      'delete from staff_push_subscription where tenant_id = app.current_tenant_id() ' +
        'and user_id = app.current_actor_id() and push_endpoint = $1 returning id',
      [body.data.endpoint],
    );
    for (const row of removed.rows) {
      await logAction(
        db,
        'staff.push.unsubscribed',
        { type: 'staff_push_subscription', id: row.id, clientId: null },
        {},
      );
    }
    const offered = staffNotificationsOffered(c.get('actor').roles, now());
    return c.json(await answer(db, offered));
  });
}
