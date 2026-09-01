# Navigation & Driving — Field Operations Spec

*How therapists actually get to the door. Dubai-specific throughout.*

---

## 1. The problem you're actually solving

Routing software assumes an address resolves to a door. In Dubai it doesn't. A pin dropped from "Villa 42, Arabian Ranches" lands at the community entrance, 1.4km and one security gate from the client. A tower in JLT has three entrances and the residential lobby isn't the one Google picks. New developments have street names that no map has yet.

Your therapist is carrying an EEG kit, has a 4pm session, and is now driving in circles. That is 15 minutes of paid time, one late arrival, and a cascade through the rest of the day.

**Three layers solve it:**

1. **Makani** — the official coordinate, to the entrance.
2. **Arrival intelligence** — the accumulated human knowledge of the last 100 metres.
3. **Handoff** — let a real navigation app do the driving.

---

## 2. Makani is your address primitive

Dubai Municipality assigns every building entrance a unique 10-digit Makani number. As of the most recent published index there are roughly **186,000 Makani numbers** across the emirate, and — critically — the dataset carries `entrance_count` and per-entrance point geometry. Entrance-level, not building-level, not community-level.

**Store Makani as the primary location key.** Free-text address is a display convenience; Makani is the truth.

```ts
type ClientLocation = {
  makaniNumber: string | null   // "30245 95127" — primary
  entrancePoint: LatLng          // resolved from Makani
  parkingPoint: LatLng | null    // where the therapist actually stops
  communityGate: LatLng | null   // if gated
  displayAddress: string         // for humans
  emirate: 'DXB' | 'AUH' | 'SHJ' | ...
}
```

**Two coordinates, not one.** The entrance is where the client is. The parking point is where the car stops. In villa communities and towers these differ by several minutes of walking, and your route solver should be pathing to the parking point while your therapist's arrival instructions reference the entrance.

**Capture Makani at booking.** Add it to the intake form with a "find my Makani" helper — the client can get it from the official Makani app in ten seconds, and most Dubai residents already know theirs. This single field will do more for your on-time rate than any routing algorithm.

**Outside Dubai:** Makani is Dubai-only. Abu Dhabi and the Northern Emirates fall back to geocoded address plus a mandatory verified pin. Design the location type so Makani is optional and a verified coordinate is not.

---

## 3. Arrival intelligence — the last 100 metres

This is proprietary operational knowledge that compounds, and no competitor has it. Every visit should make the next visit easier.

**Structured fields on the client location record:**

```
Access type        villa · gated community · tower · compound
Gate procedure     name at gate / visitor pass / call resident / open access
Gate contact       number to call if refused entry
Parking            visitor bay 3 / street, free after 6pm / paid zone, code 233A
Building entrance  which of three lobbies
Floor & unit
Lift               service lift required for equipment?
Walk time          parking to door, in minutes — measured, not guessed
Pets               relevant: a therapist allergic to cats needs to know
Best approach      "enter from Al Thanya St, the Umm Suqeim St gate is exit-only"
Photos             gate, parking spot, front door
```

**Capture it automatically.** After a first visit, the therapist app prompts once: *"Anything the next person should know about finding this place?"* One free-text box, one optional photo. Thirty seconds. That field feeds the structured record after admin review.

**Photos matter more than text.** A photo of the correct gate removes all ambiguity in a way that "the second gate on the left" never does.

**Walk time is a routing input.** Measured parking-to-door time goes into the solver as fixed overhead per stop. A tower in Marina with a 6-minute walk and a lift wait is a materially different stop from a villa where you park at the door — and if you don't model it, your schedule will be wrong for exactly those clients, every time.

---

## 4. Route cost — Salik changes the maths

Since 31 January 2025, Salik replaced the flat AED 4 crossing with variable pricing. Since 1 June 2026, rates are VAT-inclusive:

| Window | Rate per gate |
|---|---|
| Peak — 06:00–10:00 and 16:00–20:00, weekdays | **AED 6.30** |
| Off-peak — 10:00–16:00 and 20:00–01:00 | **AED 4.20** |
| Sunday, flat (outside the free window) | AED 4.20 |
| 01:00–06:00 daily | Free |

Ramadan shifts the windows: peak 09:00–17:00, off-peak 07:00–09:00 and 17:00–02:00, free 02:00–07:00.

The rate charged is **the rate at the moment the vehicle crosses the beam**, not when the journey started. There are ten gates, concentrated on Sheikh Zayed Road, Al Ittihad Road and the creek crossings.

### Why this matters to your solver

A therapist doing six home visits a day across Dubai might cross six to ten gates. At peak that's AED 63; off-peak AED 42. Over four therapists, twenty-two working days, the difference is **roughly AED 22,000 a year** — and that's before the fact that peak crossings coincide with the traffic that destroys your schedule anyway.

**Model Salik as a first-class cost term:**

```
cost(leg) = driveMinutes × therapistCostPerMinute
          + Σ salikRate(gate, crossingTime)
          + parkingCost(destination, arrivalTime)
```

Encode the ten gate locations and the tariff calendar (weekday/Sunday/Ramadan/public holiday) as data, not constants. Rates have changed twice in eighteen months; they will change again.

**The optimisation this unlocks:** the solver will naturally learn to cluster after-school sessions within one side of the creek, and to schedule cross-city legs into the 10:00–16:00 window. That's a real margin improvement that falls out of correct cost modelling rather than clever heuristics.

**Two therapist-cost realities to encode:** whether the therapist is on a company vehicle or reimbursed for their own, and whether Salik is billed to the company tag or reimbursed. These change the incentive and should change the cost weights.

### Parking

Dubai paid parking zones, RTA tariffs by zone and time, free periods (Sundays and public holidays, and evenings in many zones). Model as a per-stop cost with a time dimension. In practice the bigger operational issue is *finding* a space in Marina or Deira at 6pm — so treat known-difficult locations as extra arrival buffer, not just extra cost.

---

## 5. Driving safety and the law

**Do not build turn-by-turn navigation.** You will not beat Google or Waze, you'll be liable for the outcome if it's wrong, and it doubles your app's complexity. Hand off.

**Hard rule: the app must be unusable while driving.** UAE law penalises phone use at the wheel severely, and your therapist is an employee driving on your instruction. Build for that:

- **Motion lock.** When the device detects sustained vehicle-speed movement, the app collapses to a single full-screen card: next stop name, ETA, and one large "Navigate" button that hands off. Nothing else is reachable. No session notes, no client list, no messaging.
- **Voice-only alerts.** Schedule changes en route are announced audibly. No notification requires a tap while moving.
- **No typing.** Any text input is disabled under motion lock. Session notes are captured at the door, before the drive, or after arrival — never between.
- **Handoff, not embed.** Tapping Navigate opens Google Maps, Waze or Apple Maps at the *parking point* with a deep link, and passes the Makani number in the label so it appears on the driver's screen.

```ts
// Deep link to the parking point, labelled with what the therapist needs
`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}` +
`&travelmode=driving&dir_action=navigate`
```

**Lone-worker safety, which is a separate concern from driving:**

- Check-in on arrival, check-out on departure, both timestamped and geofenced.
- If a check-out doesn't arrive within session duration + 20 minutes, admin is alerted automatically.
- Discreet panic control — a long-press that fires location and an alert without visible UI change.
- Live location visible to admin **only during an active visit window**, never continuously. That's both a privacy commitment to your staff and the right default; state it in their contract.
- Two-person policy flag on the client record, respected by the solver, for any visit an assessment has flagged.

---

## 6. Client-facing ETA

UAE clients have been trained by Careem and Talabat to expect live arrival tracking. Not offering it generates "where are you?" calls that cost your admin real time.

**What to show:** therapist first name and photo, a live ETA, and a map showing approach — but a coarse position, updating every 30–60 seconds. Not a precise real-time dot. Your therapist is an employee, not a delivery driver, and second-by-second tracking of a clinician into a family home is the wrong relationship.

**Automated messages via WhatsApp** (the default channel in the UAE, not email):

- Evening before: confirmation with tomorrow's window.
- On departure: "Sara is on her way, arriving around 4:15."
- If ETA slips more than 10 minutes: proactive update with the new time. Automatic, before the client notices.
- On completion: session logged, report ready when applicable.

The proactive delay message is the single highest-value automation in this module. Lateness is forgivable; unannounced lateness isn't.

---

## 7. Offline

Coverage in Dubai is excellent, but underground parking, lifts, and villa interiors with thick walls all drop signal — and that's exactly where your therapist is standing when they need the day's route.

**Pre-cache at start of shift:** the full day's stops with coordinates, arrival intelligence, photos, and client briefs. Everything needed for the whole day, downloaded once.

**Queue outbound:** check-ins, session records, notes and photos write locally and sync when signal returns. The therapist should never see a spinner.

**Show sync state calmly.** A quiet persistent indicator, not a red error. Working offline is normal.

---

## 8. Data model additions

```ts
type SalikGate = { id: string; name: string; point: LatLng; direction: string }

type TariffCalendar = {
  // resolves (gate, timestamp) -> AED, handling weekday/Sunday/
  // Ramadan/public-holiday variants. Data, not constants.
}

type RouteLeg = {
  fromStopId: string
  toStopId: string
  driveSeconds: number          // from live traffic matrix
  salikGates: SalikGate[]
  salikCostAed: number
  parkingCostAed: number
  walkSeconds: number           // parking point to door
}

type VisitRecord = {
  arrivedAt: Date               // geofenced check-in
  departedAt: Date
  actualDriveSeconds: number    // for calibrating future estimates
  actualWalkSeconds: number
  accessIssues: string | null   // feeds arrival intelligence
}
```

**Feed actuals back.** Every completed visit records real drive and walk times. After a few hundred visits your estimates come from your own data rather than Google's, and your schedule stops lying to you. This is the compounding advantage — a competitor starting fresh has none of it.

---

## 9. Build sequence

**Phase 1 — no solver.** Makani capture at intake, entrance and parking points, arrival intelligence fields, manual assignment on a map, deep-link handoff to Google Maps, motion lock, check-in/out, WhatsApp ETA messages. With three therapists this is entirely sufficient and it starts accumulating the arrival data the solver will later need.

**Phase 2 — the solver.** OR-Tools VRPTW with the full cost model: drive time, Salik by crossing window, parking, walk overhead, plus the constraints from the market study (licence scope, certification, prayer times, Ramadan hours, clinical session spacing, kit location, therapist continuity). Nightly solve, incremental re-solve on disruption. Dispatch board with live status.

**Phase 3 — calibration.** Replace Google's estimates with your own measured drive times per corridor per time-of-day. Predictive delay alerting. Demand heat maps to decide where hub two goes.

---

## 10. Three decisions to make now

1. **Company vehicles or personal cars with reimbursement?** Changes your Salik accounting, your insurance, your cost model, and whether you can standardise kit storage in the boot. Company vehicles are more expensive and much simpler.
2. **How much live tracking do you promise clients?** Coarse ETA is the right answer, but decide it explicitly and write it into both your client-facing copy and your therapist contracts before you build it.
3. **What's your on-time commitment?** "Within a 30-minute window" is achievable in Dubai traffic with good buffering. "At 4:00" is not, and promising it will make you look worse than promising the window.
