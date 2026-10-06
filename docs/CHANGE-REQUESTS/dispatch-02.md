# dispatch-02: what piece twenty-five asks of the shared zone and of other streams

Written 6 October 2026 with the piece, from `docs/SPEC/dispatch.md` section
15. As dispatch-01 did, and by the precedent of pieces seven to ten and
seventeen and the cost rules of `docs/HANDOVER.md` section 6, items 1 to 15
ride in the piece's own branch (`round-73/live-location`) under the
integrator's widening for one piece (items 10 to 15 by fix round 1, on the
coordinator's instruction to apply the rule and register texts in the
branch); items 16 and 17 are proposed and not applied.

## Applied in the branch

1. **The stream's paths.** The `dispatch` row in `docs/SPEC/OWNERSHIP.md`
   gains `app/api/location/**`, `app/therapist/location/**`,
   `db/policies/dispatch/**`, `domain/scheduling/locationSharing.ts` (with its
   test, as `lateness.ts` already is) and `docs/CONSENT/staff/**`. Migration
   `211_live_location.sql` is in the stream's own range. Proposed row text:
   `app/admin/schedule/board/**`, `app/api/appointments/board.ts`,
   `app/api/appointments/reassign.ts`, `app/api/location/**`,
   `app/therapist/location/**`, `domain/scheduling/lateness.ts`,
   `domain/scheduling/locationSharing.ts`, `db/policies/dispatch/**`,
   `docs/CONSENT/staff/**`, `tests/dispatch/**`.
2. **`domain/scheduling/index.ts`** (scheduling's): the rule's exports, as
   `lateness.ts`'s already are.
3. **`app/therapist/today/TodayPage.tsx`** (the practitioner's day): one
   import and one element, `<LocationSharing />`, under the heading. Nothing
   else on the day sheet changes; a day sheet whose `/api/location/me`
   answers anything but 200 renders exactly as before, which is why the
   existing `TodayPage.test.tsx` needed no change.
4. **`app/api/create-api.ts`** (shared): `mountLocation(api, deps.now)`
   after the routing group, below the fence.
5. **`app/api/scheduler.ts` and its test** (shared since trunk round 39): a
   third job, `location-positions`, due on every change of the hour, run as
   `admin` through `app.purge_practitioner_positions` with the domain's
   two-day cutoff; `SchedulerDeps` gains an optional `now`, which
   `startScheduler` passes its own clock into. The three existing
   `dueJobs` expectations now include the new job wherever the hour changes.
6. **`domain/shared/audit-narrative.ts`** (shared): three nouns —
   `staff_consent`, `location_sharing`, `practitioner_position` ("shared
   location", `الموقع المُشارَك`) — so the trail reads in words. Tested in
   `tests/dispatch/narrative.test.ts`; the shared test file is untouched.
7. **`tests/db/schema.test.ts`** (trunk's): the test that fails any table in
   `public` without the audit trigger admits `practitioner_position` the way
   it admits `enquiry` — by name, and only while the table's own comment
   begins `unaudited by decision`. The list is `UNAUDITED_BY_DECISION`.
8. **`app/admin/schedule/map/DayMap.tsx`, `DayMapPage.tsx`, `map.css`**
   (scheduling's day map): the board has no map of its own (spec 4.1 keeps it
   free of third-party script), so "the board's map" is the day map. `DayMap`
   takes an optional `here` and draws it as a label of its own, never a
   numbered stop, never in the extent; `DayMapPage` reads
   `/api/location/positions` on today's map only and says the age in the
   panel. The existing day-map tests are untouched and pass.
9. **A dependency, not an edit:** `app/therapist/location/LocationSharing.tsx`
   renders the notice with client-record's `ConsentText`
   (`app/admin/clients/ConsentText.tsx`), unchanged, so a wording file is
   rendered one way everywhere and never through `dangerouslySetInnerHTML`.

## Applied in fix round 1 (6 October 2026)

10. **`.claude/rules/data-model.md`**, the standard-column exemptions
    paragraph: the exemption sentence for `practitioner_position` before
    "Nothing else is exempt", and the sentence that the five-year retention
    rule concerns client records, a staff position not being one.
11. **`.claude/rules/compliance.md`**: "every table holding personal data has
    the audit trigger" names its two exceptions, `enquiry` and
    `practitioner_position`; the retention bullet says it concerns client
    records and that a staff position is deleted after two days by design.
    CLAUDE.md is not edited.
12. **`docs/COMPLIANCE/approved-vendors.md`**, the Google Maps Platform row:
    a practitioner's shared location is drawn on the day map by the app, is
    not part of the map's extent, and is sent in no Google request; the
    position comes from the browser's own geolocation, which sends nothing to
    a vendor.
13. **`.github/workflows/backup.yml`** (shared, build and deploy): the weekly
    dump excludes `practitioner_position`'s rows and keeps its shape, with
    `tests/dispatch/backup-leaves-positions-out.test.ts` holding every
    `pg_dump` line to it.
14. **`app/therapist/TodayLanding.tsx`**: one import and one element,
    `<LocationSharing />`, so somebody who can no longer share can still
    withdraw. It renders nothing for anybody who never agreed.
15. **Migration `212_live_location_floor.sql`**, in the stream's own range.

## Proposed, not applied

16. **`docs/CONSENT/README.md`**: one paragraph saying `staff/` holds notices
    the practice gives its own staff, which the client wording loader does not
    read (it files top-level files only), and that a staff consent is recorded
    in `staff_consent` against the notice's `version:` rather than as a
    `consent_text` document. Not edited here because the README is the
    approved-wording record and its status lines are the operator's.
17. **`docs/SPEC/00-data-model.md`**: deliberately **not** edited, as
    dispatch-01 item 1 did not edit it for migration 210. The three entities
    are written down in `docs/SPEC/dispatch.md` section 15.4.
