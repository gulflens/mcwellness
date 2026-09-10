# SPEC — Scheduling (manual, Phase 1)

*Worktree: `scheduling`. Entities: `appointment`, reads `client`, `location`, `practitioner`, `credential`, `service_type`, `entitlement`, `kit`. No route solver in Phase 1 — a coordinator places appointments by hand; the system stops them making mistakes.*

---

## 1. Purpose

Get the right practitioner to the right door in the right 45-minute window, with the right credential and a working kit, without double-booking anyone. Replace the spreadsheet.

## 2. Who uses it

| Role | Can |
|---|---|
| `admin` | Create, move, cancel, reassign any appointment; see all practitioners |
| `lead_practitioner` | Same, plus override session-spacing warnings with reason |
| `practitioner` | See own appointments (today list and week); request a change (Stage 2); cannot create |
| `client_contact` | See upcoming appointments (portal, Stage 2) |

## 3. Appointment lifecycle

```
proposed ──► confirmed ──► checked_in ──► completed
    │            │
    └────────────┴──► cancelled | cancelled_late | no_show
confirmed ──► rescheduled (new appointment, old linked)
```

- `proposed`: placed on the calendar, client not yet informed. Holds the slot.
- `confirmed`: client informed (manual toggle in Phase 1; WhatsApp in Phase 2).
- `checked_in`/`completed`/`no_show`: set by the session-capture flow; scheduling only reads them.
- `cancelled_late`: cancelled inside 24 hours → a call-out fee on the household's account unless waived, and **never a session from the package** (FINANCE §4.3, amended 2026-09-06 on the founder's decision of 4 September). Waiver requires reason. A `practice_request` cancellation is recorded here too and carries no fee.
- Rescheduling creates a new appointment with `rescheduled_from_id`; the old one becomes `rescheduled`. Never edit times on a confirmed appointment in place.

## 4. Screens (admin)

**4.1 Week calendar.** Practitioners as columns (or rows on narrow screens), days across, 15-minute grid. Appointment block shows client name, service, location label, delivery mode icon. Drag to move, drag edge to change duration, drag between columns to reassign. Every drag runs `checkConflicts` before commit and shows blocking errors or warnings inline.

**4.2 Day map.** **Built in piece seventeen (2026-09-07); the screen is specified in `docs/SPEC/route-planning.md` Part A, which supersedes the sketch below where the two differ.** Full-bleed map for one day. Pins numbered in time order; straight lines between consecutive stops with estimated drive minutes from the Maps API (cached per pair per hour-bucket). Click a pin → appointment. Toggle practitioners on/off. This is the screen for noticing "she's in Jumeirah at 2 and Mirdif at 3." *Not* each practitioner a colour: the design brief reserves hue for the bands and the three status states, so a pin carries its stop number and nothing more (`docs/SPEC/route-planning.md` 4.2).

**4.3 New appointment.** From calendar slot, from client record, or from the "unscheduled" list. Fields: client, service type, delivery mode, location (client's locations, or the studio), practitioner (filtered to those credentialed for the service type), window start (window end = start + 45), travel buffer (default from previous stop's estimated drive + 10 min). Shows entitlement balance for that service type and blocks if zero unless admin overrides with reason (creates a receivable, see FINANCE).

**4.4 Unscheduled list.** Active clients with available entitlements and no future appointment, sorted by days since last session. This is the coordinator's daily to-do.

## 5. Screens (practitioner PWA)

**5.1 Today.** One column. Each stop: window, client first name + initial, age, service, location label, "Navigate" (opens Google Maps / Waze with parking point), "Brief" (opens client brief: protocol summary, last session notes, access notes, contacts), and the check-in button (handled by session-capture). Current stop is emphasised; past stops collapse. Offline: renders from the last sync; shows a calm "last updated HH:MM" band.

**5.2 Week.** Read-only agenda.

## 6. Rules (pure functions in `domain/scheduling`, each tested)

1. `checkConflicts(appointment, context)` → `{ blocking[], warnings[] }`
   - **Blocking:** practitioner overlap (including travel buffer); client overlap; practitioner lacks valid `credential.can_execute_session` for `service_type` on that date; client not `active`; required consents not active; kit assigned to practitioner has calibration overdue on that date; window outside practitioner working hours.
   - **Warnings:** session spacing — fewer than `service_type.min_gap_hours` since client's last completed session of same type (default 20h), or more than `max_sessions_per_week` (default 3); zero entitlement balance; prayer-time overlap for a practitioner flagged as observing; drive time from previous stop exceeds buffer; different practitioner from client's last 3 sessions (continuity).
2. `travelBufferMinutes(fromLocation, toLocation, departAt, estimates)` — estimate + 10, min 15, max 90. Estimates come from a cached matrix; the function never calls the network.
3. `windowFor(start)` → `{ start, end: start + 45min }`.
4. `isLateCancellation(appointment, cancelledAt)` — < 24h before `window_start`.
   _Amended 2026-09-06 on the founder's decision of 4 September._ What "late"
   costs is a **call-out fee** on the household's account — AED 150,
   `scheduling_setting.unfit_fee_fils` — and **never a session from a package**.
   The same fee, and no session, for a visit that cannot go ahead once the
   practitioner has arrived and for a `no_show`; nothing at all for a
   cancellation with notice, for a withdrawn consent, or for a visit the
   practice itself called off (which still records `cancelled_late`, because
   fault belongs in the reason rather than in the status). The money rule is
   billing's `callOutFeeFor` and the ledger applies it in migration 408; this
   function decides only which side of the notice period a visit falls on.
   Charging a no-show the fee is Claude's default of 2026-09-06 rather than the
   founder's decision (`docs/CHANGE-REQUESTS/billing-05.md`).
5. `nextAvailableSlots(practitioner, day, durationMin, constraints)` — for the "find a slot" helper.
6. `workingHours(practitioner, date)` — from `practitioner.working_hours` jsonb; Ramadan override table (data, not code).

## 7. Data the module owns

- `appointment` (data model §5)
- `practitioner.working_hours jsonb` — added via change request to core: weekly template + date overrides
- `service_type.min_gap_hours`, `max_sessions_per_week` — change request to core
- `drive_estimate` cache table (migrations 200–299): `from_location_id`, `to_location_id`, `hour_bucket`, `seconds`, `fetched_at`

## 8. Integrations

Google Maps Distance Matrix for estimates; Places for pin verification is client-record's. Navigation handoff is a deep link, nothing more. **From piece seventeen the day's own order is optimised** (`docs/SPEC/route-planning.md` section 5): within one day, around the visits already agreed with their households, applied through the move rule of section 3. The dispatch board is piece twenty-two's (`docs/SPEC/dispatch.md`, 2026-09-10); live tracking stays out until piece twenty-five.

## 9. Audit

Create, move, reassign, cancel each logged with before/after times and practitioner. Reason required for: late-cancellation waiver, session-spacing override, zero-entitlement override.

## 10. Out of scope

Live tracking (piece twenty-five), client notifications, practitioner-initiated changes, recurring appointments (Phase 2: "book the next 10 Tuesdays"). *Route solver* left this list in piece seventeen, within the limits section 8 now states: one day at a time, around the confirmed visits, never across days and never a fleet. *The dispatch board* left this list on 2026-09-10 for piece twenty-two.

## 11. Done when

- `checkConflicts` has a test for every blocking and warning rule, including buffer-overlap edge cases and a credential expiring mid-week.
- On staging with synthetic data: place 25 appointments across 3 practitioners over a week by drag; the day map shows them; a deliberate double-booking is blocked; a 19-hour gap warns.
- The practitioner "Today" screen renders offline from the last sync.
- The day screen and the booking drawer show the coordinator only what they need to place a visit — window, names, practitioner, service, place, status — and never an identity number or a clinical note; a blocking refusal (credential, consent, inactive client) is never overridable from either screen, only the entitlement and session-spacing warnings in section 6 carry that override.
- `pnpm verify` green; both review agents pass.
