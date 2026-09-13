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

**3.1 Check in.** Tap at the door. The location is recorded only when the practitioner switches sharing on — as proof of attendance, read only by the practice, following the session's own retention (section 7 has the full rule); the switch ships with the check-in screen, off by default. Blocks if, as shipped: participation consent is missing; a minor's guardian consent is missing; home-visit consent is missing; the practitioner is not set up to deliver this service today (role or certification); the client's date of birth is not on file — five reasons `domain/session/canCheckIn.ts` itself returns, each a 422 `blocked` answer rendered as its own plain sentence (the route's own status since the gate shipped; this sentence said 403 until 2026-09-10). A sixth, already checked in on another device, is not a gate reason at all: it is refused by the database, `session_one_open_per_practitioner`'s partial unique index, and the route renders that conflict as a 409 in the same plain-sentence style. A seventh, the record number matching no appointment booked for this practitioner today — "not booked for you today" — is resolved by `app.checkin_context` and refused as a 400, shipped by pull request 23. An eighth, from 10 September 2026 (the operator's decision 5 of `docs/OPERATOR/2026-09-10-decisions.md`, trunk round 42): the visit the practitioner is standing in front of is `proposed` — the household was never told — and the gate refuses it as `visit_not_confirmed`, rendered "This visit was not confirmed with the household. Call the office."; the route resolves the visit before the gate for that, and a confirmed or already-open visit is admitted as before. Each block names the reason and who to call. Phase 2 intention, not built: an offline mode. Consent and certification are always checked at execution time on the server and never cached on the device (.claude/rules/compliance.md); an offline design must keep that true as of last sync, with a visible "verified at HH:MM" note.

**3.2 Pre-flight.** Checklist from `service_type` (data, not code): client identity confirmed, guardian present if minor, environment suitable, electrodes/consumables ready. Each item a large toggle. Pre-session rating: 3–5 questions per protocol (e.g. sleep last night, focus today) on 0–10 sliders.

**3.3 Signal check.** Impedance/quality per site entered manually or from the amplifier's export (Phase 1: manual entry of the vendor software's numbers; Phase 2: file ingest). Shows the five-dot indicator from the design brief. Below threshold → warning, practitioner decides.

**Amended 2026-09-13 (trunk round 49, the operator's instruction of 13 September 2026).** This step is dormant. The practice runs its brain mapping and its neurofeedback on its own professional software, on the Windows laptop the practitioner carries as part of the equipment, and no longer transcribes signal quality off that software's screen into this app — what the paragraph above describes is what stops. The step is shipped, tested and unreachable rather than removed: `tenant.record_readings` (migration 918, `db/migrations/918_practice_records_readings.sql`), off by default on a fresh environment, is what withholds it. `stepsFor(recordReadings)` (`app/therapist/session/steps.ts`) drops this screen — and the run screen's reading panel, section 3.4 below — from the sequence while the switch is false, and every piece behind them stays on disk, wired into a file that runs and covered by a test that runs: `SignalStep.tsx`, `scoreSignalQuality`, `deriveObservationFlag`, and the `reading` and `telemetry_chunk` event shapes. `tests/lint/dormant-readings-stay-alive.test.ts` checks all of that, statically, on every commit, whether or not the switch is on for anyone. Turning `record_readings` on in Settings › Practice brings this step back with no further work and no deploy. What the practice takes instead is that software's own exported result, attached to the visit at the Summary step (section 3.6).

**3.4 Run.** Full-bleed: client name, session N of M, signal indicator, elapsed timer, one button "End session." Every 60 seconds a `telemetry_chunk` event is written with whatever the practitioner has entered or the amplifier exported (per-band amplitude, threshold, % time in reward, artefact %). Phase 1 accepts a single end-of-session summary if per-minute data isn't available. No navigation chrome.

**Amended 2026-09-13 (trunk round 49).** The signal indicator and the reading panel behind it are dormant along with section 3.3's step, for the same reason and behind the same switch, `tenant.record_readings`. While it is false the run screen shows the client's name, session N of M, the elapsed timer and the one button, and nothing else — no indicator, no panel, no `telemetry_chunk` write. A visit that already holds readings from before the switch was turned off keeps showing them regardless of the switch's current value: nothing that displays a score reads `record_readings`, only `stepsFor` does. The panel, the event shape and the domain functions behind this screen are untouched and still tested; only whether this screen offers them to a practitioner has changed.

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

Parsing the vendor's export to recover its figures, live signal streaming, real-time supervision, practitioner editing after close, multi-device, studio booking.

*Amended 2026-09-13 (trunk round 49): this item was "amplifier file ingest" until the practice's own software took over the readings — see section 3.3's amendment. A session now takes that software's exported result as a file: `PUT /api/sessions/:id/export` (migration 307), attached at the Summary step, idempotent on the digest, and never a gate on check-out. What remains out of scope is reading the figures back out of that file — signal quality, artefact percent and time in reward, recovered from the vendor's own format rather than typed or switched off. That needs real exported files in hand to write fixtures against, and it is exactly what `record_readings` would turn back on if it is ever built.*

## 10. Done when

- `replayEvents` passes a property-based test: any permutation of a valid event stream with duplicates yields the same final state.
- Airplane-mode drill on a real phone: check in, run a 5-minute session, check out, all offline; turn radio on; server shows the full session within 60s; entitlement consumed exactly once.
- Force-quit mid-session and reopen: resume offered, no data lost.
- Second device check-in is refused.
- `pnpm verify` green; both review agents pass; lead practitioner has signed off the `scoreSignalQuality` formula.
