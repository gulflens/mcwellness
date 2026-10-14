import { randomUUID } from 'node:crypto';
import {
  enquiryNoticeDue,
  eventPayload,
  householdEventRecipients,
  staffEventRecipients,
  type EventFacts,
  type VisitEventKind,
} from '../../../../domain/portal';
import { isoDateIn } from '../../../../domain/shared';
import { logAction } from '../../_middleware/audit';
import type { PoolClientLike, PoolLike } from '../../_middleware/request-context';
import { AT_ONCE, sealAndPost, type Fetch, type Outcome } from './post';
import type { VapidKeys } from './webpush';

/**
 * Phone notifications for events (the practice's list of 6 October 2026,
 * items 6 and 7; migration 708; docs/OPERATOR/2026-10-15-event-notifications.md).
 *
 * **When.** The route that did the act — confirmed a visit, moved it, called
 * it off, issued a report, lodged a website enquiry — hands the event to the
 * sender once its own transaction has committed (`queuePushEvent`, or the
 * enquiry door's own commit). The sender starts this and returns at once, so
 * the act is never slowed and never fails for a notice: the work is tracked
 * so a test or a shutdown can wait for it (`idle`), and a fault is one line
 * with no ids and no words. pg-boss is named in CLAUDE.md's stack, but no job
 * in this repository runs on it: every one runs in this process the way
 * round 75's delivery and app/api/scheduler.ts's jobs do, and so does this.
 *
 * **As whom.** The scheduler's shape: its own transactions on the pool, as
 * `app_role`, stamped with the practice, the `admin` role — the least that
 * opens the target lists — **no actor** (nobody pressed Send; the act that
 * caused this is already on the trail under the person who did it), a fresh
 * request id and a reason.
 *
 * **Once.** The record of the event (`push_event`) is unique per kind and
 * subject and is written before anything is posted; an event already recorded
 * is not notified again. Each device is posted to once and never retried: a
 * process that stops between the record and the posting leaves the event
 * recorded with no outcome. Gone devices are deleted as round 75's are.
 *
 * **What it carries.** The words are the domain's (`eventPayload`), written
 * from the kind and, for a visit, its start — never a name, an address, a
 * practitioner, a service or a report's kind. The record keeps the kind, the
 * subject's id and the counts, and no word of what was sent.
 */

export type PushEvent =
  | {
      kind: VisitEventKind;
      tenantId: string;
      /** The appointment, as it stands after the act (a move's new row). */
      subjectId: string;
      clientId: string;
      startsAt: Date;
    }
  | { kind: 'report_ready'; tenantId: string; subjectId: string; clientId: string }
  /** The practice is the one the door lodged it with; found again here. */
  | { kind: 'enquiry_new'; subjectId: string };

export type EventDeliveryDeps = {
  pool: PoolLike;
  key: VapidKeys;
  post: Fetch;
  now: () => Date;
  log: (line: string) => void;
};

const CONTEXT_SQL =
  "select set_config('app.tenant_id', $1, true), set_config('app.actor_id', '', true), " +
  "set_config('app.actor_roles', 'admin', true), set_config('app.request_id', $2, true), " +
  "set_config('app.reason', 'event notification', true)";

const HOUSEHOLD_TARGETS_SQL =
  'select subscription_id, user_id, locale::text as locale, push_endpoint, push_p256dh, ' +
  'push_auth, contacts, on_record from app.push_event_household_targets($1)';

const STAFF_TARGETS_SQL =
  'select subscription_id, user_id, roles, push_endpoint, push_p256dh, push_auth ' +
  'from app.push_event_staff_targets()';

const RECORD_SQL =
  'insert into push_event (id, tenant_id, kind, subject_id, recipient_count, device_count) ' +
  'values ($1, app.current_tenant_id(), $2::push_event_kind, $3, $4, $5) ' +
  'on conflict (tenant_id, kind, subject_id) do nothing returning id';

const OUTCOME_SQL =
  'update push_event set delivered_count = $2, gone_count = $3, failed_count = $4, ' +
  'delivered_at = now() where tenant_id = app.current_tenant_id() and id = $1';

type HouseholdTarget = {
  subscription_id: string;
  user_id: string;
  locale: 'en' | 'ar';
  push_endpoint: string;
  push_p256dh: string;
  push_auth: string;
  contacts: { relationship: string; dateOfBirth: string | null }[];
  on_record: { relationship: string; isLegalGuardian: boolean; dateOfBirth: string | null };
};

type StaffTarget = {
  subscription_id: string;
  user_id: string;
  roles: string[];
  push_endpoint: string;
  push_p256dh: string;
  push_auth: string;
};

/** One device the event is posted to, in the language it is posted in. */
type Device = {
  subscriptionId: string;
  locale: 'en' | 'ar';
  push_endpoint: string;
  push_p256dh: string;
  push_auth: string;
};

async function inContext<T>(
  pool: PoolLike,
  tenantId: string,
  work: (client: PoolClientLike) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('set local role app_role');
    await client.query(CONTEXT_SQL, [tenantId, randomUUID()]);
    const result = await work(client);
    await client.query('commit');
    client.release();
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    client.release(true);
    throw error;
  }
}

/** Which practice a lodged enquiry belongs to: the door names none. */
async function enquiryTenant(pool: PoolLike, enquiryId: string): Promise<string | null> {
  const client = await pool.connect();
  let tenants: string[];
  try {
    await client.query('begin');
    await client.query('set local role app_role');
    const rows = await client.query<{ id: string }>(
      'select id from app.scheduled_tenants() as t(id)',
    );
    await client.query('commit');
    client.release();
    tenants = rows.rows.map((row) => row.id);
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    client.release(true);
    throw error;
  }
  for (const tenantId of tenants) {
    const found = await inContext(pool, tenantId, (db) =>
      db.query('select 1 from enquiry where tenant_id = app.current_tenant_id() and id = $1', [
        enquiryId,
      ]),
    );
    if ((found.rowCount ?? 0) > 0) return tenantId;
  }
  return null;
}

function factsOf(event: PushEvent, timeZone: string): EventFacts {
  switch (event.kind) {
    case 'visit_booked':
    case 'visit_moved':
    case 'visit_called_off':
      return { kind: event.kind, startsAt: event.startsAt, timeZone };
    case 'report_ready':
      return { kind: 'report_ready' };
    case 'enquiry_new':
      return { kind: 'enquiry_new' };
  }
}

/**
 * The devices this event goes to, read and decided in the practice's own
 * context, with the event recorded once in the same transaction. Null when
 * the event was already recorded.
 */
async function planned(
  client: PoolClientLike,
  event: PushEvent,
  now: Date,
): Promise<{ eventId: string; zone: string; devices: Device[] } | null> {
  const zone =
    (
      await client.query<{ timezone: string }>(
        'select timezone from tenant where id = app.current_tenant_id()',
      )
    ).rows[0]?.timezone ?? 'Asia/Dubai';
  const today = isoDateIn(now, zone);

  let devices: Device[];
  let people: number;
  if (event.kind === 'enquiry_new') {
    const targets = (await client.query<StaffTarget>(STAFF_TARGETS_SQL)).rows;
    const counts = new Map<string, { roles: string[]; devices: number }>();
    for (const target of targets) {
      const seen = counts.get(target.user_id);
      counts.set(target.user_id, { roles: target.roles, devices: (seen?.devices ?? 0) + 1 });
    }
    // One notice per quiet spell: a burst of enquiries is recorded, each by
    // id, and told once (enquiryNoticeDue).
    const last =
      (
        await client.query<{ last: Date | null }>(
          'select max(created_at) as last from push_event ' +
            "where tenant_id = app.current_tenant_id() and kind = 'enquiry_new' and device_count > 0",
        )
      ).rows[0]?.last ?? null;
    const recipients = enquiryNoticeDue(last, now)
      ? staffEventRecipients(
          [...counts].map(([userId, facts]) => ({ userId, ...facts })),
          event.kind,
          now,
        )
      : [];
    const chosen = new Set(recipients.map((recipient) => recipient.userId));
    people = chosen.size;
    devices = targets
      .filter((target) => chosen.has(target.user_id))
      .map((target) => ({
        subscriptionId: target.subscription_id,
        locale: 'en',
        push_endpoint: target.push_endpoint,
        push_p256dh: target.push_p256dh,
        push_auth: target.push_auth,
      }));
  } else {
    const targets = (await client.query<HouseholdTarget>(HOUSEHOLD_TARGETS_SQL, [event.clientId]))
      .rows;
    const byUser = new Map<string, { target: HouseholdTarget; devices: number }>();
    for (const target of targets) {
      const seen = byUser.get(target.user_id);
      byUser.set(target.user_id, { target, devices: (seen?.devices ?? 0) + 1 });
    }
    const recipients = householdEventRecipients(
      [...byUser].map(([userId, { target, devices: count }]) => ({
        userId,
        devices: count,
        contacts: target.contacts,
        onThisRecord: target.on_record,
      })),
      event.kind,
      today,
    );
    const chosen = new Set(recipients.map((recipient) => recipient.userId));
    people = chosen.size;
    devices = targets
      .filter((target) => chosen.has(target.user_id))
      .map((target) => ({
        subscriptionId: target.subscription_id,
        locale: target.locale,
        push_endpoint: target.push_endpoint,
        push_p256dh: target.push_p256dh,
        push_auth: target.push_auth,
      }));
  }

  const recorded = await client.query<{ id: string }>(RECORD_SQL, [
    randomUUID(),
    event.kind,
    event.subjectId,
    people,
    devices.length,
  ]);
  const eventId = recorded.rows[0]?.id;
  if (!eventId) return null;
  return { eventId, zone, devices };
}

/** Notifies one event, start to finish. Throws only what the caller logs by name. */
export async function deliverEvent(deps: EventDeliveryDeps, event: PushEvent): Promise<void> {
  const tenantId =
    event.kind === 'enquiry_new' ? await enquiryTenant(deps.pool, event.subjectId) : event.tenantId;
  if (tenantId === null) return;

  const plan = await inContext(deps.pool, tenantId, (client) => planned(client, event, deps.now()));
  if (plan === null) return;

  const facts = factsOf(event, plan.zone);
  const outcomes: Outcome[] = [];
  const gone: string[] = [];
  for (let start = 0; start < plan.devices.length; start += AT_ONCE) {
    const batch = plan.devices.slice(start, start + AT_ONCE);
    const answers = await Promise.all(
      batch.map((device) =>
        sealAndPost(deps.post, deps.now(), device, eventPayload(facts, device.locale), deps.key),
      ),
    );
    answers.forEach((outcome, index) => {
      outcomes.push(outcome);
      const device = batch[index];
      if (outcome === 'gone' && device) gone.push(device.subscriptionId);
    });
  }
  const count = (outcome: Outcome) => outcomes.filter((each) => each === outcome).length;
  const delivered = count('delivered');
  const failed = count('failed');

  await inContext(deps.pool, tenantId, async (client) => {
    if (gone.length > 0) {
      await client.query(
        event.kind === 'enquiry_new'
          ? 'select app.staff_push_subscriptions_gone($1::uuid[])'
          : 'select app.push_subscriptions_gone($1::uuid[])',
        [gone],
      );
    }
    await client.query(OUTCOME_SQL, [plan.eventId, delivered, gone.length, failed]);
    await logAction(
      client,
      'portal.push.event_delivered',
      { type: 'push_event', id: plan.eventId, clientId: null },
      {
        kind: event.kind,
        delivered: String(delivered),
        gone: String(gone.length),
        failed: String(failed),
      },
    );
  });
  deps.log(
    `Push: an event notice reached ${delivered} of ${outcomes.length} devices, ` +
      `${gone.length} gone, ${failed} failed.`,
  );
}
