import type { OpenVisitNote, OutboxRecord, OutboxStore } from './store';

/**
 * The single-writer outbox (docs/SPEC/session-capture.md section 2).
 *
 * "We do not build a sync engine. We build a single-writer outbox." One
 * author, one device, one visit: so there is nothing here about merging or
 * resolving, only about delivery. Every write during a visit is appended
 * locally first and posted when there is a connection; nothing is deleted
 * until the server has said, by id, that it holds it.
 *
 * The flush loop is deliberately dull. It runs when the browser says it is
 * online, when a new event is appended, and every 30 seconds regardless —
 * section 7's "foreground retry every 30s otherwise (iOS)", where background
 * sync does not exist. It never backs off exponentially and never gives up:
 * a practitioner in a basement for an hour comes back up with a full queue
 * and the next tick delivers it.
 *
 * State is published to whoever is listening so the running screen can show
 * "3 events waiting to sync" as the calm band section 6.1 of the design
 * brief asks for, and never an alert.
 */

export type FlushOutcome = {
  acknowledged: readonly string[];
  refused: readonly { id: string; reason: string }[];
};

/** How the outbox reaches the server. Injected, so the loop is testable without one. */
/**
 * What the server said. 'retry' is a failure that may pass; 'give-up' is a
 * refusal that never will; 'too-large' is neither — the batch was rejected
 * for its size, so the same events go again in smaller pieces.
 */
export type PostEvents = (
  sessionId: string,
  events: readonly OutboxRecord[],
) => Promise<FlushOutcome | 'retry' | 'give-up' | 'too-large'>;

export type OutboxState = {
  pending: number;
  flushing: boolean;
  /** True once a flush has failed and not yet succeeded. Informational, never an alarm. */
  behind: boolean;
  durable: boolean;
};

export const RETRY_MS = 30_000;
/** The server takes fifty at a time (app/api/sessions/schema.ts). */
export const BATCH_SIZE = 50;
/**
 * And no more than this many bytes, whatever the count. The API's body cap
 * is 64 KB (app/api/create-api.ts) and one observation may carry a thousand
 * characters of note, so fifty events can be well over it — and a batch that
 * is always refused for its size is a batch the loop retries every thirty
 * seconds for the rest of the day. Measured on the encoded body, with room
 * left for the envelope.
 */
export const BATCH_BYTES = 48 * 1024;

type Listener = (state: OutboxState) => void;

/**
 * As many events as fit, by count and by encoded size. Always at least one:
 * a single event over the cap is the caller's problem to refuse, not a
 * reason to send nothing and spin.
 */
export function takeBatch(records: readonly OutboxRecord[], limit = BATCH_SIZE): OutboxRecord[] {
  const batch: OutboxRecord[] = [];
  let bytes = 0;
  for (const record of records) {
    if (batch.length >= limit) break;
    const size = new TextEncoder().encode(JSON.stringify(record)).length;
    if (batch.length > 0 && bytes + size > BATCH_BYTES) break;
    batch.push(record);
    bytes += size;
  }
  return batch;
}

export class Outbox {
  private readonly listeners = new Set<Listener>();
  private state: OutboxState;
  private timer: ReturnType<typeof setInterval> | null = null;
  /**
   * Flushes run one after another, never at the same time, and every caller
   * gets back a promise that resolves when *its* turn has finished. A queued
   * flag would have been enough to stop two running at once, but not to let
   * `drain` below wait for one already in flight — and a drain that returns
   * while the queue is still going is a check-out posted over events the
   * server has not got, which is a 409 and a thirty-second wait the
   * practitioner should never have seen.
   */
  private chain: Promise<void> = Promise.resolve();

  private readonly store: OutboxStore;
  private readonly post: PostEvents;

  constructor(store: OutboxStore, post: PostEvents) {
    this.store = store;
    this.post = post;
    this.state = { pending: 0, flushing: false, behind: false, durable: store.durable };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private publish(next: Partial<OutboxState>): void {
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) listener(this.state);
  }

  /** Queues one event and asks for a flush. Never throws: a full disk must not lose a visit. */
  async append(record: OutboxRecord): Promise<void> {
    await this.store.append(record);
    await this.refreshCount();
    void this.flush();
  }

  async openVisit(): Promise<OpenVisitNote | null> {
    return this.store.readOpenVisit();
  }

  async rememberOpenVisit(note: OpenVisitNote | null): Promise<void> {
    await this.store.writeOpenVisit(note);
  }

  private async refreshCount(): Promise<void> {
    this.publish({ pending: (await this.store.pending()).length });
  }

  /**
   * Delivers what it can, once, after whatever is already running. The
   * returned promise resolves when this call's own turn is done, so an
   * append during a flush is never lost and a caller that waits actually
   * waits.
   */
  flush(): Promise<void> {
    this.chain = this.chain.then(async () => {
      this.publish({ flushing: true });
      try {
        await this.deliver();
      } finally {
        this.publish({ flushing: false });
      }
    });
    return this.chain;
  }

  private async deliver(): Promise<void> {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      // Working offline is normal, not a failure. Nothing is marked behind.
      await this.refreshCount();
      return;
    }
    let pending = await this.store.pending();
    // Halved on a 413 and restored on the next success: a batch refused for
    // its size is split rather than retried, and one long note does not
    // shrink every batch after it for ever.
    let limit = BATCH_SIZE;
    while (pending.length > 0) {
      const sessionId = pending[0]!.sessionId;
      const batch = takeBatch(
        pending.filter((record) => record.sessionId === sessionId),
        limit,
      );
      const outcome = await this.post(sessionId, batch);
      if (outcome === 'too-large') {
        if (batch.length <= 1) {
          // One event, on its own, still too big for the door. Nothing about
          // it will change; keeping it would mean retrying it for ever.
          await this.store.forget(batch.map((record) => record.id));
          pending = await this.store.pending();
          continue;
        }
        limit = Math.max(1, Math.floor(batch.length / 2));
        continue;
      }
      limit = BATCH_SIZE;
      if (outcome === 'retry') {
        this.publish({ behind: true, pending: pending.length });
        return;
      }
      if (outcome === 'give-up') {
        // The server will never take these: the visit is closed, or gone.
        // Keeping them would mean retrying forever every thirty seconds.
        await this.store.forget(batch.map((record) => record.id));
      } else {
        const done = [...outcome.acknowledged, ...outcome.refused.map((r) => r.id)];
        await this.store.forget(done);
        if (done.length === 0) {
          // Nothing moved and nothing was refused: stop rather than spin.
          this.publish({ behind: true, pending: pending.length });
          return;
        }
      }
      pending = await this.store.pending();
    }
    this.publish({ behind: false, pending: 0 });
  }

  /**
   * Delivers everything, or reports that it could not. Used by the summary
   * screen, which must not post a close while the visit's own events are
   * still queued behind it — the server refuses a close it has no check-out
   * for, and the practitioner would be left waiting under copy telling them
   * they need not.
   */
  async drain(): Promise<boolean> {
    await this.flush();
    return (await this.store.pending()).length === 0;
  }

  /** Everything this device holds for this practitioner, gone (sign-out). */
  async forgetEverything(): Promise<void> {
    await this.store.forgetEverything();
    this.publish({ pending: 0, behind: false });
  }

  /** Starts the loop: on reconnection, on becoming visible again, and every 30 seconds. */
  start(): () => void {
    const onWake = () => void this.flush();
    if (typeof window !== 'undefined') {
      window.addEventListener('online', onWake);
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onWake);
    }
    this.timer = setInterval(onWake, RETRY_MS);
    void this.refreshCount().then(() => this.flush());
    return () => {
      if (typeof window !== 'undefined') window.removeEventListener('online', onWake);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onWake);
      if (this.timer !== null) clearInterval(this.timer);
      this.timer = null;
    };
  }
}
