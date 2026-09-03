import { describe, expect, it } from 'vitest';
import {
  EVENT_PAYLOAD_SCHEMAS,
  ObservationRecordedPayload,
  PhotoCapturedPayload,
  SessionEventEnvelope,
  SignalCheckedPayload,
  TelemetryChunkPayload,
  parseEventPayload,
} from './events';
import { SESSION_EVENT_KINDS } from './types';

const SHA = 'a'.repeat(64);

describe('the event vocabulary', () => {
  it('has a payload schema for every kind section 2 names', () => {
    expect(Object.keys(EVENT_PAYLOAD_SCHEMAS).sort()).toEqual([...SESSION_EVENT_KINDS].sort());
  });

  it('accepts one event of each kind through the envelope', () => {
    const envelope = SessionEventEnvelope.safeParse({
      id: '00000000-0000-4000-8000-000000000001',
      seq: 4,
      kind: 'rating_recorded',
      deviceAt: '2026-09-03T06:40:00.000Z',
      payload: { phase: 'pre', answers: [{ key: 'sleep', value: 7 }] },
    });
    expect(envelope.success).toBe(true);
  });

  it('refuses an event whose payload belongs to another kind', () => {
    const envelope = SessionEventEnvelope.safeParse({
      id: '00000000-0000-4000-8000-000000000001',
      seq: 4,
      kind: 'rating_recorded',
      deviceAt: '2026-09-03T06:40:00.000Z',
      payload: { point: null },
    });
    expect(envelope.success).toBe(false);
  });
});

describe('signal_checked', () => {
  it('refuses a quality outside 0 to 1', () => {
    expect(
      SignalCheckedPayload.safeParse({ sites: [{ site: 'Cz', quality: 1.4 }], overridden: false })
        .success,
    ).toBe(false);
  });

  it('records that the practitioner carried on below the threshold', () => {
    const parsed = SignalCheckedPayload.parse({
      sites: [{ site: 'Cz', quality: 0.3 }],
      overridden: true,
    });
    expect(parsed.overridden).toBe(true);
  });
});

describe('telemetry_chunk', () => {
  it('defaults the bands and the threshold so a summary-only visit still parses', () => {
    const parsed = TelemetryChunkPayload.parse({
      seconds: 1800,
      artefactPercent: 12,
      timeInRewardPercent: 44,
    });
    expect(parsed.bands).toEqual({});
    expect(parsed.threshold).toBeNull();
  });

  it('refuses a share outside 0 to 100', () => {
    expect(
      TelemetryChunkPayload.safeParse({
        seconds: 60,
        artefactPercent: 120,
        timeInRewardPercent: 10,
      }).success,
    ).toBe(false);
  });
});

describe('observation_recorded', () => {
  it('carries the pre-flight checklist under its own topic', () => {
    const parsed = ObservationRecordedPayload.parse({
      topic: 'preflight',
      items: [{ key: 'identity_confirmed', done: true }],
    });
    expect(parsed.topic).toBe('preflight');
  });

  it('carries the after-session chips and the note beside them', () => {
    const parsed = ObservationRecordedPayload.parse({
      topic: 'post',
      chips: ['fatigue'],
      tolerance: 8,
      engagement: 6,
      note: 'Quieter than usual towards the end.',
    });
    expect(parsed).toMatchObject({ chips: ['fatigue'], tolerance: 8 });
  });

  it('refuses a chip that is not one of the five', () => {
    expect(
      ObservationRecordedPayload.safeParse({
        topic: 'post',
        chips: ['dizziness'],
        tolerance: null,
        engagement: null,
        note: null,
      }).success,
    ).toBe(false);
  });
});

describe('photo_captured', () => {
  it('refuses a photo above the one-megabyte ceiling section 7 sets', () => {
    expect(
      PhotoCapturedPayload.safeParse({
        storageKey: 'sessions/x/setup-photo.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 1024 * 1024 + 1,
        sha256: SHA,
      }).success,
    ).toBe(false);
  });

  it('refuses a digest that is not a sha256', () => {
    expect(
      PhotoCapturedPayload.safeParse({
        storageKey: 'sessions/x/setup-photo.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 1000,
        sha256: 'not-a-digest',
      }).success,
    ).toBe(false);
  });
});

describe('parseEventPayload', () => {
  it('returns null for a malformed payload rather than throwing', () => {
    expect(parseEventPayload('checked_out', { point: { lat: 200, lng: 0 } })).toBeNull();
  });

  it('parses a good payload of the kind asked for', () => {
    expect(parseEventPayload('checked_out', { point: null })).toEqual({ point: null });
  });
});
