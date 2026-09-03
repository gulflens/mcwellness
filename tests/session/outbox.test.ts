import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Outbox,
  takeBatch,
  type FlushOutcome,
  type PostEvents,
} from '../../app/therapist/session/outbox/outbox';
import {
  PRUNE_AFTER_DAYS,
  createMemoryStore,
  type OutboxRecord,
} from '../../app/therapist/session/outbox/store';

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
    // An append asks for a flush but does not wait on the network for it, so
    // the UI is never held up by a phone with no signal; this waits for its
    // turn in the queue the way the summary screen's own drain does.
    await outbox.flush();

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
      lastSeq: 6,
    });

    const second = new Outbox(store, async () => 'retry');
    expect(await second.openVisit()).toMatchObject({
      sessionId: SESSION,
      clientLabel: 'Rowan M.',
      // The high-water mark comes back too, so a resume with no signal does
      // not restart the numbering (app/therapist/session/SessionRunner.tsx).
      lastSeq: 6,
    });
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

describe('what the outbox keeps and lets go', () => {
  it('waits for a flush already running rather than returning over the top of it', async () => {
    const store = createMemoryStore();
    await store.append(record(1));
    let resolvePost: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      resolvePost = resolve;
    });
    const outbox = new Outbox(store, async (_sessionId, events) => {
      await held;
      return { acknowledged: events.map((e) => e.id), refused: [] };
    });

    const first = outbox.flush();
    const drained = outbox.drain();
    resolvePost();
    await first;
    // The drain must not have answered before the flush it queued behind.
    expect(await drained).toBe(true);
  });

  it('splits a batch the server refused for its size, rather than retrying it for ever', async () => {
    const store = createMemoryStore();
    for (let seq = 1; seq <= 4; seq++) await store.append(record(seq));
    const sizes: number[] = [];
    let refusals = 0;
    const outbox = new Outbox(store, async (_sessionId, events) => {
      sizes.push(events.length);
      if (events.length > 2 && refusals < 1) {
        refusals += 1;
        return 'too-large';
      }
      return { acknowledged: events.map((e) => e.id), refused: [] };
    });

    await outbox.flush();
    expect(sizes[0]).toBe(4);
    expect(sizes[1]).toBe(2);
    expect(await store.pending()).toEqual([]);
  });

  it('lets go of a single event no batch size can make small enough', async () => {
    const store = createMemoryStore();
    await store.append(record(1));
    const outbox = new Outbox(store, async () => 'too-large');
    await outbox.flush();
    expect(await store.pending()).toEqual([]);
  });

  it('caps a batch by bytes, not only by count', async () => {
    // Twenty kilobytes of note apiece, which is what a thousand characters
    // of observation looks like once a few of them are in one batch. Two fit
    // under the 48 KB cap and a third does not, so the batch stops at two —
    // well short of the fifty the count alone would have allowed, and well
    // under the API's own 64 KB door.
    const long = 'x'.repeat(20_000);
    const records = [1, 2, 3, 4].map((seq) => ({ ...record(seq), payload: { note: long } }));
    expect(takeBatch(records)).toHaveLength(2);
  });

  it('takes a single event that is over the cap on its own, rather than sending nothing', async () => {
    // Sending nothing would be a loop: the same queue, the same first
    // record, for ever. One event goes on its own and the server refuses it
    // with a 413, which the loop above reads as "let this one go".
    const records = [{ ...record(1), payload: { note: 'x'.repeat(60_000) } }, record(2)];
    expect(takeBatch(records)).toHaveLength(1);
  });

  it('empties itself completely when the practitioner signs out', async () => {
    const store = createMemoryStore();
    const outbox = new Outbox(store, async () => 'retry');
    await outbox.append(record(1));
    await outbox.rememberOpenVisit({
      sessionId: SESSION,
      clientLabel: 'Rowan M.',
      serviceTypeId: '00000000-0000-4000-8000-0000000000f1',
      checkedInAt: '2026-09-03T10:32:00.000Z',
      number: 4,
      of: null,
      lastSeq: 1,
    });

    await outbox.forgetEverything();
    expect(await store.pending()).toEqual([]);
    expect(await store.readOpenVisit()).toBeNull();
  });
});

describe('the device store', () => {
  it('wipes a store that belonged to somebody else before it is used', async () => {
    const store = createMemoryStore();
    expect(await store.claim('00000000-0000-4000-8000-00000000aa01')).toBe(false);
    await store.append(record(1));

    expect(await store.claim('00000000-0000-4000-8000-00000000aa02')).toBe(true);
    expect(await store.pending()).toEqual([]);
  });

  it('leaves the same practitioner own store alone', async () => {
    const store = createMemoryStore();
    await store.claim('00000000-0000-4000-8000-00000000aa01');
    await store.append(record(1));

    expect(await store.claim('00000000-0000-4000-8000-00000000aa01')).toBe(false);
    expect(await store.pending()).toHaveLength(1);
  });

  it('drops an event a week old, and keeps one from yesterday', async () => {
    const store = createMemoryStore();
    const now = new Date('2026-09-10T08:00:00.000Z');
    await store.append({ ...record(1), deviceAt: '2026-09-09T08:00:00.000Z' });
    await store.append({ ...record(2), deviceAt: '2026-09-01T08:00:00.000Z' });

    expect(await store.prune(PRUNE_AFTER_DAYS, now)).toBe(1);
    expect((await store.pending()).map((r) => r.seq)).toEqual([1]);
  });
});
