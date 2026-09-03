import { describe, expect, it } from 'vitest';
import { replayEvents } from './replayEvents';
import type { SessionEvent } from './types';

const SESSION_ID = '00000000-0000-4000-8000-0000000000c9';
const PRACTITIONER = '00000000-0000-4000-8000-0000000000b9';
const SERVICE_TYPE = '00000000-0000-4000-8000-0000000000f1';
const LOCATION = '00000000-0000-4000-8000-0000000000d1';
const SHA = 'b'.repeat(64);

function event(
  seq: number,
  kind: SessionEvent['kind'],
  payload: unknown,
  minute: number,
): SessionEvent {
  return {
    id: `00000000-0000-4000-8000-0000000${String(seq).padStart(5, '0')}`,
    sessionId: SESSION_ID,
    seq,
    kind,
    deviceAt: `2026-09-03T06:${String(minute).padStart(2, '0')}:00.000Z`,
    payload,
  };
}

const STARTED = event(
  1,
  'session_started',
  {
    practitionerId: PRACTITIONER,
    serviceTypeId: SERVICE_TYPE,
    deliveryMode: 'home',
    locationId: LOCATION,
  },
  30,
);

/** A whole visit, in the order the device wrote it. */
function wholeVisit(): SessionEvent[] {
  return [
    STARTED,
    event(
      2,
      'observation_recorded',
      {
        topic: 'preflight',
        items: [
          { key: 'identity_confirmed', done: true },
          { key: 'environment_suitable', done: true },
        ],
      },
      32,
    ),
    event(3, 'rating_recorded', { phase: 'pre', answers: [{ key: 'sleep', value: 6 }] }, 33),
    event(4, 'signal_checked', { sites: [{ site: 'Cz', quality: 0.82 }], overridden: false }, 35),
    event(
      5,
      'telemetry_chunk',
      {
        seconds: 60,
        artefactPercent: 10,
        timeInRewardPercent: 50,
        bands: { alpha: 12 },
        threshold: 4,
      },
      36,
    ),
    event(
      6,
      'telemetry_chunk',
      {
        seconds: 60,
        artefactPercent: 20,
        timeInRewardPercent: 60,
        bands: {},
        threshold: null,
      },
      37,
    ),
    event(7, 'session_ended', { startedAt: '2026-09-03T06:36:00.000Z' }, 58),
    event(8, 'rating_recorded', { phase: 'post', answers: [{ key: 'sleep', value: 8 }] }, 59),
    event(
      9,
      'observation_recorded',
      {
        topic: 'post',
        chips: ['fatigue'],
        tolerance: 8,
        engagement: 7,
        note: null,
      },
      59,
    ),
    event(
      10,
      'photo_captured',
      {
        storageKey: 'sessions/one/setup-photo.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 240_000,
        sha256: SHA,
      },
      59,
    ),
    event(11, 'checked_out', {}, 59),
  ];
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

  it('has no projection for a stream that never opened a visit', () => {
    expect(
      replayEvents([event(9, 'session_ended', { startedAt: '2026-09-03T06:36:00.000Z' }, 40)]),
    ).toBeNull();
  });

  it('has no projection when the opening event is malformed', () => {
    expect(replayEvents([{ ...STARTED, payload: { deliveryMode: 'ferry' } }])).toBeNull();
  });

  it('opens the visit at the device time of the opening event', () => {
    const projection = replayEvents([STARTED]);
    expect(projection).toMatchObject({
      phase: 'in_progress',
      practitionerId: PRACTITIONER,
      serviceTypeId: SERVICE_TYPE,
      deliveryMode: 'home',
      locationId: LOCATION,
      checkedInAt: '2026-09-03T06:30:00.000Z',
      preflight: [],
      preRating: [],
      postRating: [],
      signal: null,
      telemetry: [],
      observations: null,
      photo: null,
      startedAt: null,
      endedAt: null,
      checkedOutAt: null,
    });
  });

  it('folds a whole visit into the record the summary screen reads', () => {
    const projection = replayEvents(wholeVisit());
    expect(projection).toMatchObject({
      phase: 'checked_out',
      preflight: [
        { key: 'identity_confirmed', done: true },
        { key: 'environment_suitable', done: true },
      ],
      preRating: [{ key: 'sleep', value: 6 }],
      postRating: [{ key: 'sleep', value: 8 }],
      observations: { chips: ['fatigue'], tolerance: 8, engagement: 7, note: null },
      startedAt: '2026-09-03T06:36:00.000Z',
      endedAt: '2026-09-03T06:58:00.000Z',
      checkedOutAt: '2026-09-03T06:59:00.000Z',
    });
    expect(projection?.signal?.sites).toEqual([{ site: 'Cz', quality: 0.82 }]);
    expect(projection?.telemetry).toHaveLength(2);
    expect(projection?.photo?.sha256).toBe(SHA);
  });

  it('keeps the practitioner latest answer when a rating is recorded twice', () => {
    const first = event(
      3,
      'rating_recorded',
      { phase: 'pre', answers: [{ key: 's', value: 2 }] },
      33,
    );
    const second = {
      ...event(4, 'rating_recorded', { phase: 'pre', answers: [{ key: 's', value: 9 }] }, 34),
      id: '00000000-0000-4000-8000-0000000000ff',
    };
    expect(replayEvents([STARTED, first, second])?.preRating).toEqual([{ key: 's', value: 9 }]);
  });

  it('appends telemetry rather than replacing it', () => {
    const visit = wholeVisit();
    expect(replayEvents(visit)?.telemetry.map((t) => t.timeInRewardPercent)).toEqual([50, 60]);
  });

  it('skips a malformed later event and keeps the rest of the visit', () => {
    const visit = wholeVisit();
    const broken = visit.map((e) =>
      e.kind === 'signal_checked' ? { ...e, payload: { sites: [] } } : e,
    );
    const projection = replayEvents(broken);
    expect(projection?.signal).toBeNull();
    expect(projection?.phase).toBe('checked_out');
  });

  it('never moves the visit backwards when a later event arrives out of order', () => {
    const endedLate = {
      ...event(20, 'session_ended', {}, 59),
      id: '00000000-0000-4000-8000-00000000ee01',
    };
    expect(replayEvents([...wholeVisit(), endedLate])?.phase).toBe('checked_out');
  });

  it('ignores a second opening event with a fresh id', () => {
    const twin = {
      ...STARTED,
      id: '00000000-0000-4000-8000-00000000ee02',
      seq: 2,
      deviceAt: '2026-09-03T06:31:00.000Z',
    };
    expect(replayEvents([STARTED, twin])?.checkedInAt).toBe('2026-09-03T06:30:00.000Z');
  });

  it('any permutation of a valid stream, with duplicates, yields the same projection', () => {
    const visit = wholeVisit();
    const base = replayEvents(visit);
    expect(base).not.toBeNull();

    // Every event resent once, and two of them resent a third time: a
    // duplicate id is the same event, never a correction (section 2).
    const withDuplicates = [
      ...visit,
      ...visit,
      visit[5] as SessionEvent,
      visit[10] as SessionEvent,
    ];
    for (let seed = 1; seed <= 300; seed++) {
      expect(replayEvents(shuffled(withDuplicates, seed)), `seed ${seed}`).toEqual(base);
    }
  });

  it('reaches the same projection whether the stream arrives whole or in pieces', () => {
    const visit = wholeVisit();
    const whole = replayEvents(visit);
    // The outbox flushes in batches; replaying batch by batch and replaying
    // everything at once must not differ.
    const inPieces = replayEvents([...visit.slice(6), ...visit.slice(0, 6)]);
    expect(inPieces).toEqual(whole);
  });
});
