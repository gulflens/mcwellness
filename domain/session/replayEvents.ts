import { parseEventPayload } from './events';
import type {
  GeoPoint,
  SessionEvent,
  SessionProjection,
  TelemetrySample,
  SessionPhase,
} from './types';

/**
 * Folds a session's event stream into its current projection
 * (docs/SPEC/session-capture.md section 2: "the server replays events into
 * the session row... the session is the projection").
 *
 * Deterministic and order-independent by construction, which is what section
 * 10's property test asks for. Two steps make it so:
 *
 * 1. **Dedup by id.** A duplicate id is a resend of the same event, never a
 *    correction — the id is the outbox's idempotency key — so which copy is
 *    kept cannot matter.
 * 2. **A total order before folding.** Events sort by `seq`, then `deviceAt`,
 *    then `id`. Every tie is broken by a value the event itself carries, so
 *    two devices, two arrival orders and two replays of the same set all
 *    reach the same total order and therefore the same projection.
 *
 * Within the fold, "latest wins" for the states a practitioner can revise (the
 * checklist, the ratings, the signal reading, the photo) and "append" for
 * telemetry, which is a record of the run rather than a value being edited.
 *
 * A malformed payload is skipped rather than thrown on: an append-only log
 * written by a device that may be older or newer than this code is a thing to
 * be read as carefully as possible, not a reason to lose the rest of the
 * visit. `replayEvents` never reads a clock — the only times in the result
 * are the ones the events themselves carry.
 */
export function replayEvents(events: readonly SessionEvent[]): SessionProjection | null {
  const byId = new Map<string, SessionEvent>();
  for (const event of events) {
    byId.set(event.id, event);
  }
  const ordered = [...byId.values()].sort((a, b) => {
    if (a.seq !== b.seq) return a.seq - b.seq;
    if (a.deviceAt !== b.deviceAt) return a.deviceAt < b.deviceAt ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  let projection: SessionProjection | null = null;
  const telemetry: TelemetrySample[] = [];

  for (const event of ordered) {
    if (event.kind === 'session_started') {
      if (projection !== null) {
        // A second start is a resend the dedup did not catch (a device that
        // generated a fresh id for the same tap). The visit began once.
        continue;
      }
      const payload = parseEventPayload('session_started', event.payload);
      if (!payload) continue;
      projection = {
        phase: 'in_progress',
        practitionerId: payload.practitionerId,
        serviceTypeId: payload.serviceTypeId,
        deliveryMode: payload.deliveryMode,
        locationId: payload.locationId,
        checkedInAt: event.deviceAt,
        preflight: [],
        preRating: [],
        postRating: [],
        signal: null,
        telemetry,
        observations: null,
        photo: null,
        startedAt: null,
        endedAt: null,
        checkedOutAt: null,
        checkedOutPoint: null,
      };
      continue;
    }
    // Nothing before the visit opened is part of it. An event that arrives
    // ahead of its own session_started is not dropped — the sort above puts
    // the start first whenever the start is present at all.
    if (projection === null) continue;

    switch (event.kind) {
      case 'observation_recorded': {
        const payload = parseEventPayload('observation_recorded', event.payload);
        if (!payload) break;
        if (payload.topic === 'preflight') {
          projection = { ...projection, preflight: payload.items };
        } else {
          projection = {
            ...projection,
            observations: {
              chips: payload.chips,
              tolerance: payload.tolerance,
              engagement: payload.engagement,
              note: payload.note,
            },
          };
        }
        break;
      }
      case 'rating_recorded': {
        const payload = parseEventPayload('rating_recorded', event.payload);
        if (!payload) break;
        projection =
          payload.phase === 'pre'
            ? { ...projection, preRating: payload.answers }
            : { ...projection, postRating: payload.answers };
        break;
      }
      case 'signal_checked': {
        const payload = parseEventPayload('signal_checked', event.payload);
        if (!payload) break;
        projection = {
          ...projection,
          signal: { sites: payload.sites, overridden: payload.overridden, at: event.deviceAt },
        };
        break;
      }
      case 'telemetry_chunk': {
        const payload = parseEventPayload('telemetry_chunk', event.payload);
        if (!payload) break;
        // A run whose end event has not arrived still began somewhere: the
        // earliest chunk stands in until session_ended says exactly when.
        if (projection.startedAt === null || event.deviceAt < projection.startedAt) {
          projection = { ...projection, startedAt: event.deviceAt };
        }
        telemetry.push({
          seconds: payload.seconds,
          artefactPercent: payload.artefactPercent,
          timeInRewardPercent: payload.timeInRewardPercent,
          bands: payload.bands,
          threshold: payload.threshold,
          at: event.deviceAt,
        });
        break;
      }
      case 'photo_captured': {
        const payload = parseEventPayload('photo_captured', event.payload);
        if (!payload) break;
        projection = { ...projection, photo: payload };
        break;
      }
      case 'session_ended': {
        const payload = parseEventPayload('session_ended', event.payload);
        if (!payload) break;
        projection = {
          ...projection,
          phase: laterPhase(projection.phase, 'ended'),
          // The run screen's own reading wins over the telemetry fallback.
          startedAt: payload.startedAt,
          endedAt: event.deviceAt,
        };
        break;
      }
      case 'checked_out': {
        const payload = parseEventPayload('checked_out', event.payload);
        if (!payload) break;
        const point: GeoPoint | null = payload.point;
        projection = {
          ...projection,
          phase: laterPhase(projection.phase, 'checked_out'),
          checkedOutAt: event.deviceAt,
          checkedOutPoint: point,
        };
        break;
      }
    }
  }

  // telemetry is the same array the projection has held throughout; the
  // spreads above copy the reference, so the pushes land where they belong.
  return projection;
}

const PHASE_ORDER: Record<SessionPhase, number> = {
  in_progress: 0,
  ended: 1,
  checked_out: 2,
};

/** A visit never goes backwards: an out-of-order pair still lands on the furthest phase reached. */
function laterPhase(a: SessionPhase, b: SessionPhase): SessionPhase {
  return PHASE_ORDER[a] >= PHASE_ORDER[b] ? a : b;
}
