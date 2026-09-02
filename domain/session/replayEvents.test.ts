import { describe, expect, it } from 'vitest';
import { replayEvents } from './replayEvents';
import type { SessionEvent } from './types';

const SESSION_ID = '00000000-0000-4000-8000-0000000000c9';

function startedEvent(overrides: Partial<SessionEvent> = {}): SessionEvent {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    sessionId: SESSION_ID,
    seq: 1,
    kind: 'session_started',
    deviceAt: '2026-09-02T06:32:00.000Z',
    payload: {
      practitionerId: '00000000-0000-4000-8000-0000000000b9',
      serviceTypeId: '00000000-0000-4000-8000-0000000000f1',
      deliveryMode: 'home',
      locationId: '00000000-0000-4000-8000-0000000000d1',
    },
    ...overrides,
  };
}

/** A small deterministic shuffle: no external dependency, reproducible from a seed. */
function shuffled<T>(items: readonly T[], seed: number): T[] {
  const arr = [...items];
  let s = seed;
  const random = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const a = arr[i] as T;
    const b = arr[j] as T;
    arr[i] = b;
    arr[j] = a;
  }
  return arr;
}

describe('replayEvents', () => {
  it('has no projection for an empty stream', () => {
    expect(replayEvents([])).toBeNull();
  });

  it('projects a session_started event', () => {
    expect(replayEvents([startedEvent()])).toEqual({
      status: 'in_progress',
      practitionerId: '00000000-0000-4000-8000-0000000000b9',
      serviceTypeId: '00000000-0000-4000-8000-0000000000f1',
      deliveryMode: 'home',
      locationId: '00000000-0000-4000-8000-0000000000d1',
      checkedInAt: '2026-09-02T06:32:00.000Z',
    });
  });

  it('has no projection for a reserved kind this pull request does not implement', () => {
    expect(replayEvents([{ ...startedEvent(), kind: 'checked_out', payload: {} }])).toBeNull();
  });

  it('any permutation of a valid stream, with duplicate copies and distinct later events, yields the same projection', () => {
    const started = startedEvent();
    // A distinct later event of a not-yet-implemented kind: present in the
    // stream (so ordering and dedup must still cope with it) but inert.
    const laterNoop: SessionEvent = {
      id: '00000000-0000-4000-8000-000000000002',
      sessionId: SESSION_ID,
      seq: 2,
      kind: 'checked_out',
      deviceAt: '2026-09-02T06:50:00.000Z',
      payload: {},
    };
    const base = replayEvents([started, laterNoop]);
    expect(base).not.toBeNull();

    // Three exact copies of `started` (a resend is identical, never a
    // correction — see the comment in replayEvents.ts) plus two of `laterNoop`.
    const stream = [started, started, started, laterNoop, laterNoop];
    for (let seed = 1; seed <= 200; seed++) {
      expect(replayEvents(shuffled(stream, seed))).toEqual(base);
    }
  });
});
