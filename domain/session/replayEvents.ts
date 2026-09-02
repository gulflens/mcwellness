import type { SessionEvent, SessionProjection, SessionStartedPayload } from './types';

function isSessionStartedPayload(payload: unknown): payload is SessionStartedPayload {
  if (typeof payload !== 'object' || payload === null) {
    return false;
  }
  const p = payload as Record<string, unknown>;
  return (
    typeof p.practitionerId === 'string' &&
    typeof p.serviceTypeId === 'string' &&
    typeof p.deliveryMode === 'string' &&
    (p.locationId === null || typeof p.locationId === 'string')
  );
}

/**
 * Folds a session's event stream into its current projection
 * (docs/SPEC/session-capture.md section 2: "the server replays events into
 * the session row... the session is the projection"). Deterministic and
 * order-independent: events are deduplicated by id, then sorted by seq (tied
 * events break on device_at, then id) before folding, so any permutation of
 * a valid stream — duplicates included — yields the same result
 * (replayEvents.test.ts, section 10's "done when").
 *
 * This pull request projects only 'session_started'. Every other kind in
 * SESSION_EVENT_KINDS is recognised by the type so the event store's shape
 * is stable, but folds to no change yet — each is added alongside the
 * screen that writes it.
 */
export function replayEvents(events: readonly SessionEvent[]): SessionProjection | null {
  const byId = new Map<string, SessionEvent>();
  for (const event of events) {
    // A duplicate id is a resend of the same event, never a correction
    // (section 2: the id is the outbox's idempotency key), so which copy
    // is kept does not matter — they are identical.
    byId.set(event.id, event);
  }
  const ordered = [...byId.values()].sort((a, b) => {
    if (a.seq !== b.seq) return a.seq - b.seq;
    if (a.deviceAt !== b.deviceAt) return a.deviceAt < b.deviceAt ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  let projection: SessionProjection | null = null;
  for (const event of ordered) {
    if (
      projection === null &&
      event.kind === 'session_started' &&
      isSessionStartedPayload(event.payload)
    ) {
      projection = {
        status: 'in_progress',
        practitionerId: event.payload.practitionerId,
        serviceTypeId: event.payload.serviceTypeId,
        deliveryMode: event.payload.deliveryMode,
        locationId: event.payload.locationId,
        checkedInAt: event.deviceAt,
      };
    }
    // Every other kind is reserved for a later pull request.
  }
  return projection;
}
