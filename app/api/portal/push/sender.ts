import { randomUUID } from 'node:crypto';
import { pushPayload, type PushKind } from '../../../../domain/portal';
import { logAction } from '../../_middleware/audit';
import type { PoolClientLike, PoolLike } from '../../_middleware/request-context';
import {
  encryptPayload,
  fromBase64Url,
  vapidAuthorization,
  vapidKeysFromEnv,
  type VapidKeys,
} from './webpush';

/**
 * Delivering a sent message to every device it is for, from inside the API
 * process (the push memo's "What gets built", step 4: "a sending job that
 * runs from inside the API process the way the two existing jobs do",
 * app/api/scheduler.ts).
 *
 * **When.** The Send route writes the message and its recipients in its own
 * transaction and, once that has committed, hands the message to `deliver`
 * (`afterCommit`). Delivery never runs inside the request: the record of what
 * was sent stands whether or not a push service answers, and a slow service
 * cannot hold the request's transaction open. `deliver` returns at once; the
 * work is tracked so a test, or a shutdown, can wait for it (`idle`).
 *
 * **As whom.** The scheduler's shape: its own transactions on the pool, as
 * `app_role`, stamped with the practice, the person who pressed Send, the
 * `admin` role — the least that opens what it touches — a fresh request id
 * and a reason. So `app.audit_row` records the delivery's writes as it
 * records a request's, and row security governs them.
 *
 * **Once.** A message is delivered once. A process that stops between the
 * commit and the delivery leaves the message recorded and undelivered
 * (`delivered_at` null), and the Send screen says so; nothing retries it on a
 * timer, because a second delivery of an offer is a third offer in somebody's
 * pocket. Each device is posted to once.
 *
 * **What a service says.** 201, 202 or 200: delivered. 404 or 410: the device
 * is gone, and its row is deleted (`app.push_subscriptions_gone`). Anything
 * else, or no answer within ten seconds: failed, and the device is kept.
 *
 * Nothing here logs an address, a key, an id or a word of a message — a line
 * per delivery with counts and nothing else.
 */

/** How long a service keeps a message for a phone that is off: four days. */
export const PUSH_TTL_SECONDS = 4 * 24 * 60 * 60;
const POST_TIMEOUT_MS = 10_000;
/** Devices posted to at once. A practice's households, not a newsletter. */
const AT_ONCE = 6;

export type DeliverJob = { tenantId: string; messageId: string; senderId: string };

export type PushSender = {
  /** Whether the practice's key pair is set: absent, push is off cleanly. */
  readonly configured: boolean;
  /** The public key a browser subscribes against, or null when off. */
  readonly publicKey: string | null;
  /** Starts delivering a committed message; returns at once. */
  deliver(job: DeliverJob): void;
  /** Resolves once every delivery started so far has finished. */
  idle(): Promise<void>;
  describe(): string;
};

type Fetch = (input: string, init: RequestInit) => Promise<{ status: number }>;

export type PushSenderDeps = {
  pool: PoolLike;
  keys: VapidKeys | null;
  fetch?: Fetch;
  now?: () => Date;
  /** One line per delivery; the console by default. Never an id or an address. */
  log?: (line: string) => void;
};

type Target = {
  subscription_id: string;
  user_id: string;
  locale: 'en' | 'ar';
  push_endpoint: string;
  push_p256dh: string;
  push_auth: string;
};

type Message = {
  kind: PushKind;
  title_en: string;
  title_ar: string;
  body_en: string;
  body_ar: string;
};

type Outcome = 'delivered' | 'gone' | 'failed';

const CONTEXT_SQL =
  "select set_config('app.tenant_id', $1, true), set_config('app.actor_id', $2, true), " +
  "set_config('app.actor_roles', 'admin', true), set_config('app.request_id', $3, true), " +
  "set_config('app.reason', 'notification delivery', true)";

/** The off switch: what a deployment without the three variables runs. */
export function pushSenderOff(): PushSender {
  return {
    configured: false,
    publicKey: null,
    deliver() {
      // Nothing is sent from a deployment with no key pair; the Send route
      // refuses before anything is written, so this is never reached.
    },
    idle: async () => undefined,
    describe: () => 'off (PUSH_VAPID_* not set)',
  };
}

export function pushSender(deps: PushSenderDeps): PushSender {
  const keys = deps.keys;
  if (keys === null) return pushSenderOff();
  const post: Fetch = deps.fetch ?? ((input, init) => fetch(input, init));
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? ((line: string) => console.log(line));
  const running = new Set<Promise<void>>();

  async function inContext<T>(
    job: DeliverJob,
    work: (client: PoolClientLike) => Promise<T>,
  ): Promise<T> {
    const client = await deps.pool.connect();
    try {
      await client.query('begin');
      await client.query('set local role app_role');
      await client.query(CONTEXT_SQL, [job.tenantId, job.senderId, randomUUID()]);
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

  async function postOne(target: Target, message: Message, key: VapidKeys): Promise<Outcome> {
    try {
      const payload = Buffer.from(JSON.stringify(pushPayload(draftOf(message), target.locale)));
      const body = encryptPayload(
        payload,
        fromBase64Url(target.push_p256dh),
        fromBase64Url(target.push_auth),
      );
      const answer = await post(target.push_endpoint, {
        method: 'POST',
        headers: {
          authorization: vapidAuthorization(target.push_endpoint, key, now()),
          'content-encoding': 'aes128gcm',
          'content-type': 'application/octet-stream',
          ttl: String(PUSH_TTL_SECONDS),
          urgency: 'normal',
        },
        body: new Uint8Array(body),
        redirect: 'error',
        signal: AbortSignal.timeout(POST_TIMEOUT_MS),
      });
      if (answer.status === 404 || answer.status === 410) return 'gone';
      if (answer.status >= 200 && answer.status < 300) return 'delivered';
      return 'failed';
    } catch {
      return 'failed';
    }
  }

  async function run(job: DeliverJob, key: VapidKeys): Promise<void> {
    const read = await inContext(job, async (client) => {
      const message = await client.query<Message>(
        'select kind::text as kind, title_en, title_ar, body_en, body_ar from push_message ' +
          'where tenant_id = app.current_tenant_id() and id = $1 and delivered_at is null',
        [job.messageId],
      );
      const targets = await client.query<Target>(
        'select subscription_id, user_id, locale::text as locale, push_endpoint, push_p256dh, ' +
          'push_auth from app.push_delivery_targets($1)',
        [job.messageId],
      );
      return { message: message.rows[0] ?? null, targets: targets.rows };
    });
    if (read.message === null) return;
    const message = read.message;

    const outcomes: Outcome[] = [];
    const gone: string[] = [];
    for (let start = 0; start < read.targets.length; start += AT_ONCE) {
      const batch = read.targets.slice(start, start + AT_ONCE);
      const answers = await Promise.all(batch.map((target) => postOne(target, message, key)));
      answers.forEach((outcome, index) => {
        outcomes.push(outcome);
        const target = batch[index];
        if (outcome === 'gone' && target) gone.push(target.subscription_id);
      });
    }
    const count = (outcome: Outcome) => outcomes.filter((each) => each === outcome).length;
    const delivered = count('delivered');
    const failed = count('failed');

    await inContext(job, async (client) => {
      if (gone.length > 0) {
        await client.query('select app.push_subscriptions_gone($1::uuid[])', [gone]);
      }
      await client.query(
        'update push_message set delivered_count = $2, gone_count = $3, failed_count = $4, ' +
          'delivered_at = now() where tenant_id = app.current_tenant_id() and id = $1',
        [job.messageId, delivered, gone.length, failed],
      );
      await logAction(
        client,
        'portal.push.delivered',
        { type: 'push_message', id: job.messageId, clientId: null },
        { delivered: String(delivered), gone: String(gone.length), failed: String(failed) },
      );
    });
    log(
      `Push: ${delivered} of ${outcomes.length} devices took the message, ` +
        `${gone.length} gone, ${failed} failed.`,
    );
  }

  return {
    configured: true,
    publicKey: keys.publicKey,
    deliver(job) {
      const work = run(job, keys)
        .catch((error: unknown) => {
          const shape = (error ?? {}) as { name?: string; code?: string };
          log(
            `Push: a delivery did not finish. ${[shape.name, shape.code].filter(Boolean).join(' ')}`,
          );
        })
        .finally(() => {
          running.delete(work);
        });
      running.add(work);
    },
    async idle() {
      while (running.size > 0) await Promise.all([...running]);
    },
    describe: () => 'on (web push, the practice’s own key pair)',
  };
}

function draftOf(message: Message) {
  return {
    kind: message.kind,
    title: { en: message.title_en, ar: message.title_ar },
    body: { en: message.body_en, ar: message.body_ar },
  };
}

/** What the server runs: on when the three variables are set, off when none is. */
export function pushSenderFromEnv(
  env: Parameters<typeof vapidKeysFromEnv>[0],
  pool: PoolLike,
): PushSender {
  return pushSender({ pool, keys: vapidKeysFromEnv(env) });
}
