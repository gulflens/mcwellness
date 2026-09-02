# SPEC — Session Capture (practitioner PWA, offline-tolerant)

*Worktree: `session-capture`. Entities: `session`, `visit_actuals`, writes `entitlement.status`, reads `appointment`, `client_protocol`, `consent`, `kit`. Defined in `00-data-model.md`.*

---

## 1. Purpose

The practitioner is standing in a client's living room, possibly with no signal, carrying an EEG kit. This module lets them run and record the visit with one hand and guarantees the record reaches the server intact. It is the highest-stakes screen in the product and the simplest.

## 2. The offline model — read this before anything else

We do **not** build a sync engine. We build a **single-writer outbox**.

- A session record has exactly one author: the practitioner on that device, during that visit. Nobody else edits it until it's closed. So there are no conflicts to resolve — only delivery to guarantee.
- Every write during a visit goes to a local IndexedDB outbox as an append-only event: `session_started`, `signal_checked`, `telemetry_chunk`, `rating_recorded`, `observation_recorded`, `photo_captured`, `session_ended`, `checked_out`.
- A background task flushes the outbox to `POST /api/sessions/{id}/events` whenever the browser has connectivity. Each event has a client-generated UUID; the server is idempotent on it. Order is preserved per session.
- The server replays events into the `session` row. The session is `closed` only when the server has the `checked_out` event *and* the practitioner has confirmed the summary.
- The device keeps every event until the server acknowledges it. The Today screen shows a calm "3 events waiting to sync" band, never a red alert. Working offline is normal.
- **Read data** (today's list, client briefs, protocols) is cached on every successful sync and served from cache when offline. It is never edited on the device.

What can still go wrong, and the answer:
- Phone dies mid-session → events already written to IndexedDB survive; on restart the app offers "resume session for Client L., started 14:32."
- Phone lost → session shows `in_progress` server-side with a partial event stream; admin closes it as `aborted` with reason; entitlement not consumed.
- Two devices for one practitioner → not supported in Phase 1; the second check-in is refused by the server ("already checked in on another device").

## 3. The flow

```
Today ► [Check in] ► Pre-flight ► Signal check ► Run ► End ► Post ► Summary ► [Check out]
```

**3.1 Check in.** Tap at the door. The location is recorded only when the practitioner switches sharing on — as proof of attendance, read only by the practice, following the session's own retention (section 7 has the full rule); the switch ships with the check-in screen, off by default. Blocks if, as shipped: participation consent is missing; a minor's guardian consent is missing; home-visit consent is missing; the practitioner is not set up to deliver this service today (role or certification); the client's date of birth is not on file — five reasons `domain/session/canCheckIn.ts` itself returns, each a 403 rendered as its own plain sentence. A sixth, already checked in on another device, is not a gate reason at all: it is refused by the database, `session_one_open_per_practitioner`'s partial unique index, and the route renders that conflict as a 409 in the same plain-sentence style. Each block names the reason and who to call. Phase 2 intention, not built: an offline mode. Consent and certification are always checked at execution time on the server and never cached on the device (.claude/rules/compliance.md); an offline design must keep that true as of last sync, with a visible "verified at HH:MM" note.

**3.2 Pre-flight.** Checklist from `service_type` (data, not code): client identity confirmed, guardian present if minor, environment suitable, electrodes/consumables ready. Each item a large toggle. Pre-session rating: 3–5 questions per protocol (e.g. sleep last night, focus today) on 0–10 sliders.

**3.3 Signal check.** Impedance/quality per site entered manually or from the amplifier's export (Phase 1: manual entry of the vendor software's numbers; Phase 2: file ingest). Shows the five-dot indicator from the design brief. Below threshold → warning, practitioner decides.

**3.4 Run.** Full-bleed: client name, session N of M, signal indicator, elapsed timer, one button "End session." Every 60 seconds a `telemetry_chunk` event is written with whatever the practitioner has entered or the amplifier exported (per-band amplitude, threshold, % time in reward, artefact %). Phase 1 accepts a single end-of-session summary if per-minute data isn't available. No navigation chrome.

**3.5 End & post.** Post-session ratings (same questions as pre). Structured observations: tolerance, engagement, after-session observations (none / headache / fatigue / irritability / other), each a chip; free-text note beside them. Optional setup photo (requires `photo_video` consent; blocked otherwise).

**3.6 Summary.** One screen: duration, signal score, pre/post deltas, observations. Practitioner confirms → `checked_out` event with GPS and time. `visit_actuals` prompts: parking cost, Salik crossings (count; cost resolved server-side), access issues (free text → feeds `location.access_notes` as a suggestion for admin approval).

## 4. Server-side effects on close

In one transaction:
1. `session.status = completed`, `closed_at`, immutable from now on.
2. The matching `entitlement` → `consumed`, `consumed_by_session_id` set; revenue recognition event emitted for billing.
3. `appointment.status = completed`.
4. `visit_actuals` row written.
5. `signal_quality_score` computed by `domain/session.scoreSignalQuality(telemetry)`.
6. Audit rows via triggers; `session_closed` is a sensitive action carrying `request_id`.

Late edits after close are a new `session` version with `amendment_reason`, authored from the admin console, never from the device.

## 5. Rules (pure functions in `domain/session`, each tested)

1. `canCheckIn(appointment, consents, credential, kit, now)` → `{ ok, reasons[] }`
2. `replayEvents(events[])` → session state; must be deterministic and tolerate duplicates and out-of-order arrival within a session.
3. `scoreSignalQuality(telemetry)` → 0–1, defined in the design brief as cleanliness × time-in-target; exact formula agreed with lead practitioner, documented in the function.
4. `sessionNumber(clientHistory, session)` → N of M from completed sessions and entitlements.
5. `deriveObservationFlag(observations)` → true if any observation chip other than none; surfaces in the lead practitioner's queue.
6. `isLateCancellation` shared with scheduling → lives in `domain/shared`.

## 6. Data the module owns

- `session`, `visit_actuals` (data model §4–5)
- `session_event` (migrations 300–399): `id` (client UUID), `session_id`, `seq`, `kind`, `payload jsonb`, `device_at`, `received_at`. Append-only. This is the source of truth; `session` is the projection.
- `service_type.preflight_checklist jsonb`, `service_type.rating_questions jsonb` — change request to core.

## 7. PWA requirements

- Installable (manifest, icons), standalone display.
- Service worker: cache app shell and today's read data; background sync where available, foreground retry every 30s otherwise (iOS).
- Storage: IndexedDB via a thin wrapper; request persistent storage on install; warn if the browser reports storage pressure.
- Geolocation with graceful degradation: if denied, check-in still works and records `point = null` with an audit note.
- The check-in point exists as proof of attendance at the door, not for tracking: the practitioner may decline it exactly as above, only the practitioner's own scope and the practice roles (owner, admin, lead practitioner, finance) may ever read it, it follows the session's own retention rather than a schedule of its own, and it is never copied into the audit trail — the trunk drops `checked_in_point` in redaction, unconditionally, alongside the Emirates ID columns (098_erasure_guard.sql; docs/SPEC/audit.md section 8).
- Camera via `<input capture>`; photos compressed client-side to ≤ 1 MB before queueing.
- Test on iOS Safari and Android Chrome. iOS is the risk: verify that a session survives the app being backgrounded for 45 minutes.

## 8. Audit

Check-in/out, every event replay, every block reason, session close, and any admin `aborted` are logged. Photos never appear in audit `new_values` — only the document id.

## 9. Out of scope

Amplifier file ingest, live signal streaming, real-time supervision, practitioner editing after close, multi-device, studio booking.

## 10. Done when

- `replayEvents` passes a property-based test: any permutation of a valid event stream with duplicates yields the same final state.
- Airplane-mode drill on a real phone: check in, run a 5-minute session, check out, all offline; turn radio on; server shows the full session within 60s; entitlement consumed exactly once.
- Force-quit mid-session and reopen: resume offered, no data lost.
- Second device check-in is refused.
- `pnpm verify` green; both review agents pass; lead practitioner has signed off the `scoreSignalQuality` formula.
