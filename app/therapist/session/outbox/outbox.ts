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
export type PostEvents = (
  sessionId: string,
  events: readonly OutboxRecord[],
) => Promise<FlushOutcome | 'retry' | 'give-up'>;

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

type Listener = (state: OutboxState) => void;

export class Outbox {
  private readonly listeners = new Set<Listener>();
  private state: OutboxState;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private queued = false;

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
   * Delivers what it can, once. Concurrent calls collapse into one run
   * followed by at most one more, so an append during a flush is never lost
   * and never starts a second flush racing the first.
   */
  async flush(): Promise<void> {
    if (this.running) {
      this.queued = true;
      return;
    }
    this.running = true;
    this.publish({ flushing: true });
    try {
      await this.deliver();
    } finally {
      this.running = false;
      this.publish({ flushing: false });
      if (this.queued) {
        this.queued = false;
        await this.flush();
      }
    }
  }

  private async deliver(): Promise<void> {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      // Working offline is normal, not a failure. Nothing is marked behind.
      await this.refreshCount();
      return;
    }
    let pending = await this.store.pending();
    while (pending.length > 0) {
      const sessionId = pending[0]!.sessionId;
      const batch = pending.filter((record) => record.sessionId === sessionId).slice(0, BATCH_SIZE);
      const outcome = await this.post(sessionId, batch);
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
