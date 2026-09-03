import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Outbox,
  type FlushOutcome,
  type PostEvents,
} from '../../app/therapist/session/outbox/outbox';
import { createMemoryStore, type OutboxRecord } from '../../app/therapist/session/outbox/store';

/**
 * The outbox's own rules (docs/SPEC/session-capture.md section 2): what it
 * keeps, what it lets go, and what it does when there is no connection.
 *
 * Run against the memory store rather than IndexedDB, which jsdom does not
 * implement — and which is exactly why the store is a seam with two
 * implementations rather than a direct call (app/therapist/session/outbox/
 * store.ts). The IndexedDB half is a thin wrapper over that same interface
 * and is proved by the flight-mode drill on a real phone, written out in the
 * pull request body.
 */

const SESSION = '00000000-0000-4000-8000-000000000c01';
const OTHER_SESSION = '00000000-0000-4000-8000-000000000c02';

afterEach(() => {
  vi.unstubAllGlobals();
});

function record(seq: number, sessionId = SESSION): OutboxRecord {
  return {
    id: `00000000-0000-4000-8000-0000000${sessionId === SESSION ? '1' : '2'}${String(seq).padStart(4, '0')}`,
    sessionId,
    seq,
    kind: 'telemetry_chunk',
    deviceAt: `2026-09-03T06:${String(seq).padStart(2, '0')}:00.000Z`,
    payload: { seconds: 60, artefactPercent: 0, timeInRewardPercent: 100 },
  };
}

function acceptAll(): FlushOutcome {
  return { acknowledged: [], refused: [] };
}

describe('the outbox', () => {
  it('keeps every event until the server says it has it', async () => {
    const store = createMemoryStore();
    const posted: OutboxRecord[][] = [];
    const post: PostEvents = async (_sessionId, events) => {
      posted.push([...events]);
      return { acknowledged: events.map((e) => e.id), refused: [] };
    };
    const outbox = new Outbox(store, post);

    await outbox.append(record(1));
    await outbox.append(record(2));

    // Each append flushes what is waiting, so the two go out as they arrive.
    expect(posted.flat().map((e) => e.seq)).toEqual([1, 2]);
    expect(await store.pending()).toEqual([]);
  });

  it('posts a session events in seq order however they were appended', async () => {
    const store = createMemoryStore();
    await store.append(record(3));
    await store.append(record(1));
    await store.append(record(2));
    const seen: number[] = [];
    const outbox = new Outbox(store, async (_sessionId, events) => {
      seen.push(...events.map((e) => e.seq));
      return { acknowledged: events.map((e) => e.id), refused: [] };
    });

    await outbox.flush();
    expect(seen).toEqual([1, 2, 3]);
  });

  it('posts one session at a time, never two visits in one batch', async () => {
    const store = createMemoryStore();
    await store.append(record(1));
    await store.append(record(1, OTHER_SESSION));
    const batches: string[][] = [];
    const outbox = new Outbox(store, async (_sessionId, events) => {
      batches.push(events.map((e) => e.sessionId));
      return { acknowledged: events.map((e) => e.id), refused: [] };
    });

    await outbox.flush();
    expect(batches).toEqual([[SESSION], [OTHER_SESSION]]);
  });

  it('lets go of an event the server refused, so it is not retried forever', async () => {
    const store = createMemoryStore();
    await store.append(record(1));
    const outbox = new Outbox(store, async (_sessionId, events) => ({
      acknowledged: [],
      refused: events.map((e) => ({ id: e.id, reason: 'consent_missing_photo_video' })),
    }));

    await outbox.flush();
    expect(await store.pending()).toEqual([]);
  });

  it('keeps everything and says it is behind when a flush cannot be delivered', async () => {
    const store = createMemoryStore();
    await store.append(record(1));
    const outbox = new Outbox(store, async () => 'retry');
    const states: number[] = [];
    outbox.subscribe((state) => states.push(state.pending));

    await outbox.flush();
    expect(await store.pending()).toHaveLength(1);
    expect(states.at(-1)).toBe(1);
  });

  it('lets go of a batch the server will never take', async () => {
    const store = createMemoryStore();
    await store.append(record(1));
    const outbox = new Outbox(store, async () => 'give-up');

    await outbox.flush();
    expect(await store.pending()).toEqual([]);
  });

  it('posts nothing while the device is offline, and loses nothing either', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const store = createMemoryStore();
    const post = vi.fn(async () => acceptAll());
    const outbox = new Outbox(store, post);

    await outbox.append(record(1));
    expect(post).not.toHaveBeenCalled();
    expect(await store.pending()).toHaveLength(1);
  });

  it('does not start a second flush racing the first', async () => {
    const store = createMemoryStore();
    await store.append(record(1));
    let inFlight = 0;
    let overlaps = 0;
    const outbox = new Outbox(store, async (_sessionId, events) => {
      inFlight += 1;
      if (inFlight > 1) overlaps += 1;
      await Promise.resolve();
      inFlight -= 1;
      return { acknowledged: events.map((e) => e.id), refused: [] };
    });

    await Promise.all([outbox.flush(), outbox.flush(), outbox.flush()]);
    expect(overlaps).toBe(0);
  });

  it('queues the same event once however many times it is appended', async () => {
    const store = createMemoryStore();
    const outbox = new Outbox(store, async () => 'retry');
    await outbox.append(record(1));
    await outbox.append(record(1));
    expect(await store.pending()).toHaveLength(1);
  });

  it('survives a reload: a new outbox over the same store still has the visit', async () => {
    const store = createMemoryStore();
    const first = new Outbox(store, async () => 'retry');
    await first.append(record(1));
    await first.rememberOpenVisit({
      sessionId: SESSION,
      clientLabel: 'Rowan M.',
      serviceTypeId: '00000000-0000-4000-8000-0000000000f1',
      checkedInAt: '2026-09-03T10:32:00.000Z',
      number: 4,
      of: null,
    });

    const second = new Outbox(store, async () => 'retry');
    expect(await second.openVisit()).toMatchObject({ sessionId: SESSION, clientLabel: 'Rowan M.' });
    expect(await store.pending()).toHaveLength(1);
  });

  it('reports whether the queue would actually survive a reload', async () => {
    const store = createMemoryStore();
    const outbox = new Outbox(store, async () => 'retry');
    let durable: boolean | null = null;
    outbox.subscribe((state) => {
      durable = state.durable;
    });
    expect(durable).toBe(false);
  });
});
