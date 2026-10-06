import type { Hono } from 'hono';
import { z } from 'zod';
import {
  announcementsVisibleTo,
  checkPushMessage,
  offersLeft,
  pushAudience,
  pushEndpointAllowed,
  pushRecipients,
  pushWarnings,
  type PushCandidate,
  type PushKind,
} from '../../../domain/portal';
import { canActor, isoDateIn } from '../../../domain/shared';
import { logAction, logReads } from '../_middleware/audit';
import type { ApiEnv, Db } from '../_middleware/request-context';
import { cleanText } from '../_middleware/text';
import { attempt } from './attempt';
import { readHousehold } from './household';
import { fromBase64Url } from './push/webpush';
import { pushSenderOff, type PushSender } from './push/sender';
import {
  NotificationsResponse,
  OfficePushRecordResponse,
  OfficePushResponse,
  SendPushInput,
  SendPushResponse,
  SubscribeInput,
  UnsubscribeInput,
  type OfficePushMessage,
} from './schema';

/**
 * Phone notifications (the push memo's decisions 2 and 3,
 * docs/OPERATOR/2026-09-17-push-notifications.md, answered "as recommended"
 * on 6 October 2026; migration 707).
 *
 * Two halves, one file, as `announcements.ts` holds both of its sides:
 *
 * - **The household's** "Turn on notifications" step.
 *   `GET /api/portal/notifications` says whether it is offered and hands the
 *   practice's public key to subscribe with; `POST
 *   /api/portal/notifications/subscriptions` keeps this device for the person
 *   signed in, and `.../remove` lets it go. Offered only to an adult of some
 *   household, and only when the practice's key pair is configured.
 * - **The practice's** Send screen. `GET /api/portal/push` says how many each
 *   kind would reach today, how many offers are left this month, and lists
 *   every message sent; `GET /api/portal/push/messages/:id` is the record of
 *   one, recipient by recipient; `POST /api/portal/push/messages` sends one,
 *   once. The owner and an admin (`portal.push.send`), and a send carries
 *   `X-Reason`.
 *
 * **What decides who receives what** is domain/portal/push.ts, over the facts
 * `app.push_audience` reads at the moment of sending: an announcement to
 * every adult login with a device, an offer only where that person's own
 * marketing consent stands, never a young person's own login, at most two
 * offers a calendar month.
 *
 * **Delivery is not in the request.** The send writes the message and its
 * recipients, and once that has committed the sender seals and posts to every
 * device from inside this process (push/sender.ts).
 */

const TIMEZONE_SQL = 'select timezone from tenant where id = app.current_tenant_id()';

const AUDIENCE_SQL =
  'select user_id, devices, locale::text as locale, contacts, marketing_consent_id ' +
  'from app.push_audience()';

const OFFER_DAYS_SQL =
  "select to_char(created_at at time zone $1, 'YYYY-MM-DD') as day from push_message " +
  "where tenant_id = app.current_tenant_id() and kind = 'offer' " +
  "and created_at > now() - interval '62 days'";

const MESSAGE_COLUMNS =
  'm.id, m.kind::text as kind, m.title_en, m.title_ar, m.body_en, m.body_ar, ' +
  'm.created_at, u.display_name as sent_by, m.recipient_count, m.device_count, ' +
  'm.delivered_count, m.gone_count, m.failed_count, m.delivered_at';

const MESSAGES_SQL =
  `select ${MESSAGE_COLUMNS} from push_message m ` +
  'left join app_user u on u.id = m.created_by ' +
  'where m.tenant_id = app.current_tenant_id() order by m.created_at desc, m.id desc limit 200';

const MESSAGE_SQL =
  `select ${MESSAGE_COLUMNS} from push_message m ` +
  'left join app_user u on u.id = m.created_by ' +
  'where m.tenant_id = app.current_tenant_id() and m.id = $1';

const RECIPIENTS_SQL =
  'select r.user_id, u.display_name as name, r.devices, r.marketing_standing::text as standing, ' +
  'd.version as wording_version from push_recipient r ' +
  'join app_user u on u.id = r.user_id ' +
  'left join consent cs on cs.id = r.marketing_consent_id ' +
  'left join document d on d.id = cs.text_document_id ' +
  'where r.tenant_id = app.current_tenant_id() and r.message_id = $1 ' +
  'order by u.display_name, r.user_id';

type AudienceRow = {
  user_id: string;
  devices: number;
  locale: 'en' | 'ar';
  contacts: { relationship: string; dateOfBirth: string | null }[];
  marketing_consent_id: string | null;
};

type MessageRow = {
  id: string;
  kind: PushKind;
  title_en: string;
  title_ar: string;
  body_en: string;
  body_ar: string;
  created_at: Date;
  sent_by: string | null;
  recipient_count: number;
  device_count: number;
  delivered_count: number | null;
  gone_count: number | null;
  failed_count: number | null;
  delivered_at: Date | null;
};

function toOffice(row: MessageRow): OfficePushMessage {
  return {
    id: row.id,
    kind: row.kind,
    title: { en: row.title_en, ar: row.title_ar },
    body: { en: row.body_en, ar: row.body_ar },
    sentAt: row.created_at.toISOString(),
    sentBy: row.sent_by,
    recipients: row.recipient_count,
    devices: row.device_count,
    delivery:
      row.delivered_at === null
        ? null
        : {
            delivered: row.delivered_count ?? 0,
            gone: row.gone_count ?? 0,
            failed: row.failed_count ?? 0,
            at: row.delivered_at.toISOString(),
          },
  };
}

function candidatesOf(rows: readonly AudienceRow[]): PushCandidate[] {
  return rows.map((row) => ({
    userId: row.user_id,
    contacts: row.contacts,
    devices: row.devices,
    marketingConsentId: row.marketing_consent_id,
  }));
}

/** The reason as the fence stamps it, refused when it draws nothing. */
function reasonOf(header: string | undefined): string | null {
  const reason = cleanText(header ?? '', 500);
  return reason.length === 0 ? null : reason;
}

const IdParams = z.object({ id: z.uuid() });

/** A device key as the browser hands it over: a P-256 point, and 16 bytes. */
function keysAreSound(p256dh: string, auth: string): boolean {
  const point = fromBase64Url(p256dh);
  return point.length === 65 && point[0] === 0x04 && fromBase64Url(auth).length === 16;
}

export function mountPortalPush(
  api: Hono<ApiEnv>,
  now: () => Date = () => new Date(),
  sender: PushSender = pushSenderOff(),
): void {
  async function practiceToday(db: Db): Promise<{ zone: string; today: string }> {
    const zone = (await db.query<{ timezone: string }>(TIMEZONE_SQL)).rows[0]?.timezone;
    const timezone = zone ?? 'Asia/Dubai';
    return { zone: timezone, today: isoDateIn(now(), timezone) };
  }

  // -------------------------------------------------------------------------
  // The household's step.
  // -------------------------------------------------------------------------

  async function notifications(db: Db, offered: boolean): Promise<NotificationsResponse> {
    const devices = await db.query<{ n: number }>(
      'select count(*)::int as n from push_subscription where user_id = app.current_actor_id()',
    );
    return NotificationsResponse.parse({
      configured: sender.configured,
      offered: sender.configured && offered,
      publicKey: sender.configured && offered ? sender.publicKey : null,
      devices: devices.rows[0]?.n ?? 0,
    });
  }

  api.get('/api/portal/notifications', async (c) => {
    const requestId = c.get('requestId');
    const db = c.get('db');
    const household = await readHousehold(db, c.get('actor'), now());
    if (household === null) return c.json({ error: 'forbidden', requestId }, 403);
    const offered = announcementsVisibleTo(household.clients, household.today);
    return c.json(await notifications(db, offered));
  });

  api.post('/api/portal/notifications/subscriptions', async (c) => {
    const requestId = c.get('requestId');
    const db = c.get('db');
    const household = await readHousehold(db, c.get('actor'), now());
    if (household === null) return c.json({ error: 'forbidden', requestId }, 403);
    if (!sender.configured) return c.json({ error: 'push_not_configured', requestId }, 503);
    if (!announcementsVisibleTo(household.clients, household.today)) {
      return c.json({ error: 'not_offered', requestId }, 403);
    }
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
      db.query<{ id: string }>('select app.portal_subscribe_push($1, $2, $3) as id', [
        endpoint,
        keys.p256dh,
        keys.auth,
      ]),
    );
    if (!saved.ok) {
      if (saved.code === '42501') return c.json({ error: 'not_offered', requestId }, 403);
      if (saved.code === '23514') return c.json({ error: 'bad_keys', requestId }, 422);
      throw saved.error;
    }
    const id = saved.value.rows[0]?.id;
    if (id) {
      await logAction(
        db,
        'portal.push.subscribed',
        { type: 'push_subscription', id, clientId: null },
        {},
      );
    }
    return c.json(await notifications(db, true), 201);
  });

  api.post('/api/portal/notifications/subscriptions/remove', async (c) => {
    const requestId = c.get('requestId');
    const db = c.get('db');
    const household = await readHousehold(db, c.get('actor'), now());
    if (household === null) return c.json({ error: 'forbidden', requestId }, 403);
    const body = UnsubscribeInput.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'bad_request', requestId }, 400);
    // Row security admits the person's own rows and nobody else's, so an
    // address that is somebody else's device removes nothing.
    const removed = await db.query<{ id: string }>(
      'delete from push_subscription where tenant_id = app.current_tenant_id() ' +
        'and user_id = app.current_actor_id() and push_endpoint = $1 returning id',
      [body.data.endpoint],
    );
    for (const row of removed.rows) {
      await logAction(
        db,
        'portal.push.unsubscribed',
        { type: 'push_subscription', id: row.id, clientId: null },
        {},
      );
    }
    const offered = announcementsVisibleTo(household.clients, household.today);
    return c.json(await notifications(db, offered));
  });

  // -------------------------------------------------------------------------
  // The practice's Send screen.
  // -------------------------------------------------------------------------

  api.get('/api/portal/push', async (c) => {
    const requestId = c.get('requestId');
    const db = c.get('db');
    if (!canActor(c.get('actor'), { type: 'portal.push.send' }, {}, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const { zone, today } = await practiceToday(db);
    const [audience, offers, messages] = await Promise.all([
      db.query<AudienceRow>(AUDIENCE_SQL),
      db.query<{ day: string }>(OFFER_DAYS_SQL, [zone]),
      db.query<MessageRow>(MESSAGES_SQL),
    ]);
    return c.json(
      OfficePushResponse.parse({
        configured: sender.configured,
        today,
        audience: pushAudience(candidatesOf(audience.rows), today),
        offersLeft: offersLeft(
          offers.rows.map((row) => row.day),
          today,
        ),
        messages: messages.rows.map(toOffice),
      }),
    );
  });

  api.get('/api/portal/push/messages/:id', async (c) => {
    const requestId = c.get('requestId');
    const db = c.get('db');
    if (!canActor(c.get('actor'), { type: 'portal.push.send' }, {}, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const params = IdParams.safeParse(c.req.param());
    if (!params.success) return c.json({ error: 'not_found', requestId }, 404);
    const message = (await db.query<MessageRow>(MESSAGE_SQL, [params.data.id])).rows[0];
    if (!message) return c.json({ error: 'not_found', requestId }, 404);
    const recipients = await db.query<{
      user_id: string;
      name: string;
      devices: number;
      standing: 'on' | 'off';
      wording_version: string | null;
    }>(RECIPIENTS_SQL, [params.data.id]);
    // Who it went to names people: the read is on the trail, by id alone.
    await logReads(db, 'push_recipient', [{ id: params.data.id, clientId: null }], 'list');
    return c.json(
      OfficePushRecordResponse.parse({
        message: toOffice(message),
        recipients: recipients.rows.map((row) => ({
          name: row.name,
          devices: row.devices,
          standing: row.standing,
          wordingVersion: row.wording_version,
        })),
      }),
    );
  });

  api.post('/api/portal/push/messages', async (c) => {
    const requestId = c.get('requestId');
    const db = c.get('db');
    const actor = c.get('actor');
    if (!canActor(actor, { type: 'portal.push.send' }, {}, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    if (!sender.configured) return c.json({ error: 'push_not_configured', requestId }, 503);
    if (reasonOf(c.req.header('x-reason')) === null) {
      return c.json({ error: 'reason_required', requestId }, 400);
    }
    const body = SendPushInput.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      const field = body.error.issues[0]?.path.join('.');
      return c.json({ error: 'bad_request', code: field || 'invalid', requestId }, 400);
    }
    const input = body.data;
    const draft = { kind: input.kind, title: input.title, body: input.body };
    const problems = checkPushMessage(draft);
    if (problems.length > 0) return c.json({ error: 'wording', problems, requestId }, 422);
    const warnings = pushWarnings(draft);
    if (warnings.length > 0 && !input.confirmedWarnings) {
      return c.json({ error: 'confirm_wording', warnings, requestId }, 422);
    }

    // One send at a time per practice, the same lock the database's own
    // ceiling takes, so two presses cannot both be the second offer.
    await db.query(
      "select pg_advisory_xact_lock(hashtextextended('push_message:' || $1::text, 0))",
      [actor.tenantId],
    );
    const already = await db.query('select 1 from push_message where id = $1', [input.id]);
    if ((already.rowCount ?? 0) > 0) return c.json({ error: 'already_sent', requestId }, 409);

    const { zone, today } = await practiceToday(db);
    if (input.kind === 'offer') {
      const offers = await db.query<{ day: string }>(OFFER_DAYS_SQL, [zone]);
      if (
        offersLeft(
          offers.rows.map((row) => row.day),
          today,
        ) === 0
      ) {
        return c.json({ error: 'offer_ceiling', requestId }, 409);
      }
    }

    const audience = await db.query<AudienceRow>(AUDIENCE_SQL);
    const recipients = pushRecipients(candidatesOf(audience.rows), input.kind, today);
    if (recipients.length === 0) return c.json({ error: 'no_recipients', requestId }, 409);
    const devices = recipients.reduce((sum, recipient) => sum + recipient.devices, 0);

    const written = await attempt(db, () =>
      db.query(
        'insert into push_message (id, tenant_id, kind, title_en, title_ar, body_en, body_ar, ' +
          'recipient_count, device_count, created_by) values ($1, $2, $3::push_kind, $4, $5, ' +
          '$6, $7, $8, $9, $10)',
        [
          input.id,
          actor.tenantId,
          input.kind,
          input.title.en.trim(),
          input.title.ar.trim(),
          input.body.en.trim(),
          input.body.ar.trim(),
          recipients.length,
          devices,
          actor.userId,
        ],
      ),
    );
    if (!written.ok) {
      if (written.hint === 'offer_ceiling') {
        return c.json({ error: 'offer_ceiling', requestId }, 409);
      }
      throw written.error;
    }
    await db.query(
      'insert into push_recipient (tenant_id, message_id, user_id, devices, ' +
        'marketing_standing, marketing_consent_id, created_by) ' +
        'select $1, $2, r.user_id, r.devices, r.standing::push_consent_standing, ' +
        'r.consent_id, $3 from unnest($4::uuid[], $5::int[], $6::text[], $7::uuid[]) ' +
        'as r(user_id, devices, standing, consent_id)',
      [
        actor.tenantId,
        input.id,
        actor.userId,
        recipients.map((recipient) => recipient.userId),
        recipients.map((recipient) => recipient.devices),
        recipients.map((recipient) => recipient.standing),
        recipients.map((recipient) => recipient.consentId),
      ],
    );
    const confirmed = warnings.map((warning) => `${warning.field}:${warning.term}`).join(',');
    await logAction(
      db,
      'portal.push.sent',
      { type: 'push_message', id: input.id, clientId: null },
      {
        kind: input.kind,
        recipients: String(recipients.length),
        devices: String(devices),
        ...(confirmed === '' ? {} : { confirmedWarnings: confirmed }),
      },
    );

    c.get('afterCommit')(() => {
      sender.deliver({ tenantId: actor.tenantId, messageId: input.id, senderId: actor.userId });
    });

    const message = (await db.query<MessageRow>(MESSAGE_SQL, [input.id])).rows[0];
    if (!message) throw new Error('The message was written and could not be read back.');
    return c.json(SendPushResponse.parse({ message: toOffice(message) }), 201);
  });
}
