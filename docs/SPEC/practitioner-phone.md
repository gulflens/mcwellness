# SPEC — The practitioner's phone (piece eight)

*Worktree: `session-capture`, branch `session-capture-4`. For this piece the row in `OWNERSHIP.md` is widened to the whole practitioner face (`app/therapist/**`, Today included), `app/api/sessions/**`, `app/api/kit/**`, `app/api/routing/**`, `app/admin/kit/**`, `domain/session/**`, one file in `domain/scheduling/` (`legs.ts`), `db/policies/session/**`, one policy file in `db/policies/scheduling/`, `tests/session/**`, migrations `306–399` and the one scheduling migration `204` that `scheduling-manual.md` section 7 already names. The shared-zone edits it needs are listed and authorised in `docs/CHANGE-REQUESTS/session-capture-04.md` and ride in the piece's own pull request. Builds on `session-capture.md` (sections 2, 3.5 and 7) and `navigation.md` (sections 5, 7 and 9, Phase 1); entities are defined in `00-data-model.md`. This file defines behaviour.*

Status: **approved for building, 2026-09-05**, under the operator's approval of `docs/PLAN/pieces-seven-to-nine.md` on 4 September. The plan's two decisions for this piece stand with their defaults (photographs built now and switched on per household by a signed agreement; the map paid for, capped in Google's console). The further decisions this spec had to take are in section 12, each with the default marked as Claude's; the operator may overrule any of them.

---

## 1. Purpose

The session runner works and keeps its record on the phone until signal returns. What is missing is everything around it: the app does not install, opens to the browser's offline page in a basement car park, cannot take the sensor photograph the household agreed to, shows the day as a list with no sense of the drive, and cannot refuse a session on an amplifier whose calibration has lapsed because the kit table was never created. This piece adds those four things and nothing else. It is the practitioner's phone, dark, one column, one decision per screen (docs/DESIGN-BRIEF.md section 6.1), and working offline is normal, never an error.

## 2. What exists, and what this adds

| Already built | This piece adds |
|---|---|
| The single-writer outbox in IndexedDB, flushed every thirty seconds and on reconnect (`app/therapist/session/outbox/`) | A service worker that caches the app and the day's reads, so the app opens with no signal; a blob queue beside the event queue for the photograph |
| The `photo_captured` event, refused by the server without `photo_video` consent; the device module that compresses and digests a picture (deleted at `d22373f`, restorable from history) | The door the bytes go through, the document row, the link on the visit, the picture shown at the next visit |
| Today's stops with the Navigate hand-off (`domain/scheduling/navigation.ts`) | The drive between stops, estimated, cached and labelled as an estimate; a picture of the day |
| `canCheckIn` with five block reasons, and the note that "kit calibration overdue" waits for the table | The `kit` table, its screen, and the sixth reason |

## 3. Installable, and usable in a lift

**3.1 The manifest and the icon.** `public/manifest.webmanifest` (name, `start_url` `/today`, `display` `standalone`, portrait, the practitioner ground's paper colour as the theme, copied verbatim from `app/shell/tokens.css` with a comment saying so — and that comment names all three places a token's value is written out, the manifest, `public/icon.svg` and the Static Maps style in `app/api/_middleware/routing/google.ts`, since none of the three can read a custom property) and `public/icon.svg`, achromatic, one glyph, no accent, exactly as change request 02 section 1a and 1b drafted them. `index.html` links the manifest and the same file as `apple-touch-icon`. A raster iOS icon is a binary asset the operator may supply later; its absence costs polish, not installability.

**3.2 The worker.** `vite-plugin-pwa` in `injectManifest` mode, with `app/shell/sw.ts` as the source (decision 1). The build writes the precache list of every hashed asset, font subsets included, into it. Beyond the precache the worker carries exactly the three runtime rules of change request 02 section 1d and no others:

1. a navigation is network-first and falls back to the cached shell;
2. `/assets/*` is served from the precache;
3. exactly the GET reads named in section 3.4 keep their last good answer, network-first, one entry per query string.

And the two messages from the same draft: `forget-reads` empties the read cache, and a `sync` event tagged `session-outbox` posts `flush-outbox` to every open client rather than re-implementing the outbox in the worker. Nothing else touching `/api` is ever cached: no POST, no PUT, no close, no signed link, no audit read. The worker is registered from `app/shell/main.tsx` after first render and only in a production build, so it never fights the dev server.

**3.3 iOS.** Safari has no install prompt and evicts a site's storage after seven days unused unless it is on the home screen. So: Today asks `navigator.storage.persist()` once, the first time it renders for a practitioner; when the app is not running standalone on an iPhone, Today shows one calm Note with the two taps (Share, then Add to Home Screen) and a dismiss that is remembered on the device; the check-in and session screens show nothing about it. The outbox already survives a force-quit; the drill in section 13 proves the cached app does too.

**3.4 What is cached, and what never is.** Cached, each per query string: `GET /api/appointments?date=…&scope=own` (the day), `GET /api/sessions/service-types`, `GET /api/routing/day?date=…` and its picture (section 5). Never cached: anything under `/api/sessions/:id`, `/api/kit`, `/api/billing`, any signed link, the check-in context, `/api/me`. The check-in itself stays online-only, as `session-capture.md` section 3.1 says; a practitioner in a lift can open the app and read the day, and checks in at the door where there is signal.

**3.5 Sign-out.** A signed-out device keeps nothing of anybody. `AuthContext.signOut` calls the outbox's own `forgetDevice()` and posts `forget-reads` to the worker, exactly change request 02 sections 1f and 5b, so the rule holds from whichever screen the person signs out of. The blob queue in section 4.2 is emptied by the same call.

**3.6 The content security policy is all but unchanged.** The worker, the manifest and every picture come from the app's own origin. No script, style, image or connection is added to the policy in `app/api/_middleware/security.ts`; section 5 keeps Google on the server side for exactly this reason. **Amended in the second round, 2026-09-06:** the one change to the policy is `blob:` on images — `img-src 'self' data: blob:` — for the pictures the app itself fetched with its bearer header and holds as revocable object URLs (the day's map here and the last sensor placement in section 4.5), which `'self'` cannot match because a `blob:` URL's scheme is `blob`; a `blob:` URL can be created only by this app's own scripts, so nothing third-party is admitted, and `tests/security/headers.test.ts` pins the directive exactly.

## 4. The sensor photograph

**4.1 When it is offered.** On the post-session step, and only when the check-in answer said the household's `photo_video` consent is active right now (`app.session_consent_active`, already read in `app/api/sessions/checkin.ts`). The wording on the screen stays: the sensor placement only, not the face, not the room. A household that has not agreed, or a device that could not ask, sees the sentence it sees today and no camera. The three states in `PostStep.tsx` stay three; `PHOTO_STORAGE_AVAILABLE` becomes a check for the storage seam rather than a constant, as `photo-availability.ts` says it will.

**4.2 On the device.** `app/therapist/session/photo.ts` comes back from history unchanged: `<input type="file" accept="image/*" capture="environment">`, resized to 1600 px on the long edge, JPEG, re-encoded down the quality steps until under 1 MB, digested with SHA-256. The `photo_captured` event carries the type, size and digest it carries today; nothing about the payload changes. The bytes go into a second IndexedDB object store beside the events, keyed by session id (one setup photograph per visit, as `session.setup_photo_document_id` is singular), with the digest and type. The outbox flushes **events first, then bytes**: a blob is posted only after the event that names its digest has been acknowledged, and it is forgotten when the server answers 200 or 201, or refuses with anything but a retryable failure. It is pruned with the events after seven days, and it is emptied by sign-out and by a store claimed by somebody else. A retake before check-out replaces the blob and appends a new event; the projection's `photo` is already the last event's payload.

**4.3 The door.** `PUT /api/sessions/:id/photo`, the practitioner's own visit only. Raw body, `Content-Type` `image/jpeg`, `image/webp` or `image/png`, at most 1 MB (`PHOTO_LIMIT_BYTES` beside `BODY_LIMIT_BYTES` in `create-api.ts`, the one exemption from the 64 KB cap and from `jsonOnly`, change request 04 item 4). A header `X-Photo-Sha256` declares the digest; the route computes its own over the bytes and refuses a mismatch with 400 `digest_mismatch`. Then, in the request's transaction:

- `photo_video` consent is checked at that moment, first of the three and before the event; missing, the answer is 403 `consent_missing_photo_video`, audited as a refusal, and the device drops the blob. **Amended in the fix round, 2026-09-05:** the door is `app.setup_photo_consent_active` (migration 306) and not `app.session_consent_active`, which 304 wrote to answer only about a visit still open — and by decision 4 these bytes arrive after the visit has closed, so 304's door would refuse every offline day's photograph. The new one asks the same question with the same guardian rule and the same tenant and practitioner binding, without the open-visit clause, and narrower in the other direction: one purpose, and no argument that could ask it about another;
- the visit's projection must already carry a `photo_captured` payload with this digest: none yet, 409 `photo_event_pending` and the device retries after its next flush; a different digest, 409 `photo_superseded` and the device drops the blob;
- a photograph already filed with the same digest answers 200 with the same document id (an idempotent retry); one filed with a different digest answers 409 `document_exists`, because a filed evidence document is never replaced (docs/SEAMS.md).

**4.4 Filing.** A `document` row of kind `setup_photo` against the visit's client: the storage key from the seam's own `clientDocumentKey(tenantId, clientId, documentId)`, ids only, never the session-derived path `setupPhotoKey` in `close.ts` sketched, which is retired; `mime_type`, `sha256`, `uploaded_by`, `retention_until` computed the way the client record files a signed consent. The bytes go through `storage.put` with `overwrite` false. Then `app.file_setup_photo(session_id, document_id)`, a security-definer function granted to the API role, sets `session.setup_photo_document_id`. Because the bytes may reach the server after an offline day has closed the visit, the immutability trigger of migration 302 admits exactly this one change on a closed row, from null to a value, made by that function, and nothing else; a second filing is refused as above. The document row is written before the bytes and the bytes before the link, and the `afterCommit` hook is not used here because there is nothing to delete.

**4.5 Shown at the next visit.** The check-in answer gains `previousSetupPhotoDocumentId`: the photograph on the client's most recent completed visit, or null. The pre-flight step shows a button, "Show last placement", and only on that tap asks `GET /api/sessions/photo/:documentId/link`, which calls `auditDocumentRead` and then `getSignedUrl` for a short-lived link, exactly as every signed link in this codebase does. Nothing is fetched unasked (decision 6), so the trail records the practitioner who looked, once, and never a photograph nobody opened. Offline between check-in and pre-flight, the button says the picture is not available without signal.

**4.6 Withdrawal and erasure.** Nothing new is needed and the piece proves it: withdrawing `photo_video` already removes the bytes (`app/api/clients/withdrawal.ts`), and an erasure already unlinks `setup_photo_document_id` and deletes the client's documents (migration 105). One database test per path filing a photograph first.

**4.7 Audit.** The filing is an action `session.photo_filed` carrying the document id only. Bytes never appear in a payload, a log line or the trail; the `photo_captured` event's payload is a type, a size and a digest, as it is today.

## 5. The day's map and drive estimates

**5.1 The routing seam** (`docs/SEAMS.md`, new row). Interface `domain/shared/routing.ts`, browser-safe:

```
driveMatrix(legs: { from: GeoPoint; to: GeoPoint; departAt: Date }[]) -> { seconds, metres, source: 'traffic' | 'straight-line' }[]
dayPicture(points: GeoPoint[]) -> Uint8Array | null
```

Real: Google Maps Platform, the **Routes API's compute route matrix** for the estimates and the **Maps Static API** for the picture (decision 3), called from the API process under a server key (`GOOGLE_MAPS_API_KEY`, already in `.env.example`; a Static API request is signed when `GOOGLE_MAPS_SIGNING_SECRET` is set). Fallback: the pure arithmetic beside the interface, straight-line distance times a road factor times an hour multiplier, and no picture. Chosen by `ROUTING_PROVIDER`, `straight-line` or `google`, explicit outside development or the API refuses to start, exactly as `STORAGE_PROVIDER` is. A forced-fallback test proves Today renders whole with the real one switched off. What leaves the server is coordinates and a departure time: never a name, a record number, an address, a Makani number, an id.

**5.2 The estimates.** `domain/scheduling/legs.ts`, pure: given the day's stops in order and the practitioner's home base (`practitioner.home_base_location_id`, when set), the ordered legs, each from the previous stop's `window_end` plus the service's `duration_minutes` to the next stop's `parking_point` or entrance, home base first when there is one, no return leg. Each leg is looked up in `drive_estimate` (scheduling-manual.md section 7, migration 204: `from_location_id`, `to_location_id`, `hour_bucket`, `seconds`, `metres`, `source`, `fetched_at`, unique per tenant on the first three), fresh for thirty days; the missing ones go to the seam in one call and are written back. A day of six stops is at most six lookups the first time it is opened and none after; a stop moved to another hour is one more. The row references two locations and names no person; it is declared `audited: no client` with that reason in its comment.

**5.3 The picture** (decision 2). One PNG per practitioner-day from the Static API: a dark, achromatic basemap styled by parameters, numbered markers in stop order, a hairline path between them, 640 by 400 at scale 2, the request built from coordinates only. The route holds it in process memory keyed by the practitioner, the day and a fingerprint of the ordered coordinates, until the end of that day in the practice's time zone, capped at two hundred entries; nothing is written to a table, because a picture of several households' positions is personal data with no single `client_id` to file it under, and the device's worker already caches it with the day. Under the fallback there is no picture and the screen says the map needs the practice's key.

**5.4 On Today.** Above the stop list, the picture when there is one, sized to the column; between consecutive stops, one line, "about 25 min, 18 km, estimate from traffic" or "about 25 min, straight-line estimate", never a point time and always the word estimate (docs/SEAMS.md). **Amended in the fix round, 2026-09-05:** commas throughout and no middle dot, because docs/DESIGN-BRIEF.md section 4.5 prohibits the dot-joined metadata string and this line is a sentence, not a row of fields; the design brief wins, and the fallback's line carries no distance, as it always read here. Rows never reflow when the estimates arrive: the line renders "– –" until it has a figure. `GET /api/routing/day?date=` answers the legs and the picture's URL; `GET /api/routing/day-picture?date=&v=<fingerprint>` answers the PNG; both are cached by the worker (section 3.4), so the lift shows the day the practitioner last saw.

**5.5 Cost and the key.** Compute route matrix and the Static API are both metered per request; at six stops a day the practice sits inside Google's monthly free allowance, and the cap the operator sets in the console bounds it regardless. The server key is its own key, restricted to those two products, never the key shipped inside the old app's binaries; enabling the two products and minting it is a console act of the operator's (Claude can do it with `gcloud` if asked). The vendor row in `docs/COMPLIANCE/approved-vendors.md` is amended in this spec's pull request to name the two products and what each receives.

**5.6 The fallback's figures** are data, not code: `scheduling_setting` gains `drive_road_factor` (default 1.35) and `drive_peak_multiplier` (default 1.5, applied 06:00 to 10:00 and 16:00 to 20:00 on working days in `tenant.timezone`), owner and admin editable through the existing settings route. The arithmetic and the hour bucket are tested in `domain/shared/routing.test.ts` with fixed clocks.

## 6. The kit

**6.1 The table** (migration 306, `00-data-model.md` section 5): `kit` with `serial`, `model`, `kind` (enum `kit_kind`: `amplifier`, `laptop`, `electrode_set`), `status` (`active_status`), `assigned_practitioner_id` (nullable), `last_calibrated_at`, `calibration_due_at` (both timestamptz, nullable: a laptop is never calibrated), the standard columns, the tenant-bound key, unique on `(tenant_id, serial)`, `audited: no client`. `session.kit_id` is added in the same migration, referencing `kit`, set at check-in to the practitioner's one active amplifier when exactly one is assigned and left null otherwise, so the record says which instrument ran the visit without guessing.

**6.2 Who may.** Two actions in `domain/shared/actor.ts`: `kit.manage` (owner, admin, lead practitioner: list, add, edit, assign, record a calibration) and `kit.read` (the same three for the practice's register; a practitioner for the items assigned to them). `db/policies/session/kit.sql` says the same in the database, restrictive, with one deny test per grant.

**6.3 The rule at check-in** (decision 5). `app.checkin_context` is replaced in migration 306 to return `kit_calibration_overdue` and `kit_id` beside what it returns today; `canCheckIn` gains `kitCalibrationOverdue: boolean` and the reason `kit_calibration_overdue`; the screen renders it as its own sentence, "The amplifier's calibration is overdue. Call the practice." Overdue means: at least one active item assigned to the practitioner has a `calibration_due_at` before now. No item assigned is no block, because the register starts empty and the day it ships must not stop every visit; a spare the practice wants ignored is unassigned or set inactive. The rule is not added to `checkConflicts`: a booking is a promise weeks ahead and the calibration may be done before the day; the moment the rule protects is the start of the session, which is where `session-capture.md` section 3.1 has always put it.

**6.4 The screen.** `/admin/kit` (`app/admin/kit/KitPage.tsx`), a table in the console's manner (44 px rows, hairlines, a drawer, not a modal): serial, model, kind, status, assigned to, last calibrated, due, with the overdue ones carrying the status dot. The drawer adds or edits an item and records a calibration as a date, which is the only date the practice records. The rail gains "Kit" behind `canOpenKit`.

## 7. Rules (pure functions in `domain/`, each tested)

1. `canCheckIn(input, now)` — one more field, one more reason (6.3).
2. `isCalibrationOverdue(kit, now)` in `domain/session/kit.ts`, the rule the SQL in `checkin_context` mirrors, with the boundary tested in the practice's time zone.
3. `dayLegs(stops, homeBase)` in `domain/scheduling/legs.ts` (5.2), including the empty day, a single stop, and a stop with no parking point.
4. `straightLineSeconds(from, to, departAt, factors)` and `hourBucket(departAt, timeZone)` in `domain/shared/routing.ts` (5.1, 5.6), the haversine checked against two known distances.
5. `replayEvents` is unchanged; its property test already covers `photo_captured`.

## 8. Data the piece owns

- `kit`, `session.kit_id`, `app.checkin_context` (replaced), `app.file_setup_photo` and the one-column exception in the close guard: migration 306, `-- Needs: 301, 302`.
- `drive_estimate`: migration 204 (scheduling's range, `-- Needs: 030`), policy `db/policies/scheduling/drive_estimate.sql`: read by the four office roles and by a practitioner; inserted and updated only by the routing route, which runs as the practitioner it serves, so the policy admits a practitioner's own writes within their tenant and nobody's delete.
- `scheduling_setting.drive_road_factor`, `drive_peak_multiplier`: the same migration 204.
- The device: a second IndexedDB object store for photograph blobs in `app/therapist/session/outbox/store.ts`, both implementations.

## 9. Routes

| Route | Who | Notes |
|---|---|---|
| `PUT /api/sessions/:id/photo` | the visit's practitioner | 4.3; raw body, 1 MB cap |
| `GET /api/sessions/photo/:documentId/link` | practitioner for a client visible to them (`app.client_visible_to_practitioner`), office roles | 4.5; audited signed link |
| `GET /api/routing/day?date=` | practitioner, own day | 5.2, 5.4; cached by the worker |
| `GET /api/routing/day-picture?date=&v=` | practitioner, own day | 5.3; PNG or 404 under the fallback |
| `GET /api/kit`, `POST /api/kit`, `PATCH /api/kit/:id` | 6.2 | a calibration is a PATCH of two dates |

Every route sets the audit context as every route does; every refusal is written before the answer.

## 10. Audit

`session.photo_filed` (document id only); `kit` rows through the audit trigger with sentences in `domain/shared/audit-narrative.ts`; `drive_estimate` writes are not sentences anybody reads and take the generic fallback; every signed link through `auditDocumentRead`. No coordinate enters the trail: `checked_in_point` and `checked_out_point` are already dropped by `app.audit_redact`, and the routing route writes nothing that carries one.

## 11. Deliberately left out

Live location, an ETA sent to the household, the motion lock, the lone-worker alerts and the panic control of `navigation.md` section 5 (the plan's own omission: each is a decision about what the practice sends and when). A route solver and a dispatch board. Any tile, script or style loaded from a third party in the browser. Arabic copy for the practitioner face, which has none today and is English throughout under the RTL-safe layout rule; the practitioner is the practice's own person. Offline check-in. A second photograph per visit. Chain of custody, consumables and hygiene logs for the kit.

## 12. Decisions, with the defaults taken

1. *The worker.* Change request 02 drafted a thirty-line hand-written worker with runtime caching and no dependency, and said the plugin would be "a better answer" if the trunk took it. Default (Claude's): `vite-plugin-pwa` in `injectManifest` mode, keeping that draft's rules and messages inside a source file of our own. The difference is the precache: a runtime cache holds only what was opened while online, so a chunk or a font subset never seen online is missing in the lift; a precache holds the whole build by construction. One development dependency, audited weekly by `pnpm audit:deps`.
2. *The map's form.* Default (Claude's): a static picture fetched by the server and cached with the day, as section 5.3. The alternative, an interactive map in the browser, puts the key in the bundle, widens the content security policy to Google's script and tile hosts, sends the viewport to Google from every phone as it pans, and shows nothing in a lift. The practitioner already has Google Maps for the driving; the day picture is for orientation, and the deep link does the rest. The same route can serve an interactive map later without a schema change.
3. *Which Google products.* Default (Claude's): the Routes API's compute route matrix, not the Distance Matrix API the plan named, which Google marked legacy in 2025; and the Maps Static API for the picture. Both under one server key restricted to the two.
4. *The photograph's timing.* The bytes travel after their event and may arrive after the visit has closed. Default (Claude's): the close does not wait for them, and the closed visit admits that one link, once, through a named function, so an offline day still ends with a complete record rather than a photograph nobody can file.
5. *The kit rule.* Default (Claude's): no item assigned is no block; any assigned active item overdue is a block; the rule lives at check-in and not at booking (6.3).
6. *The previous photograph.* Default (Claude's): fetched on the practitioner's tap at pre-flight, one audited read, not pre-cached with the day.
7. *Checking on a real iPhone.* A service worker and the camera need a secure origin, and the laptop's demo on port 3100 is plain HTTP over the LAN. Default (Claude's): this piece is checked on the laptop's own browsers at `localhost`, which is a secure context, with the network switched off in the developer tools, and the iPhone check is walked on piece nine's first HTTPS deploy at `app.mcwellnessuae.com`; the operator may ask for a local HTTPS tunnel earlier.

## 13. Done when

- `pnpm verify`, `pnpm test:db` and `pnpm build` green; the built app served by `pnpm start` installs from Chrome and Safari on the laptop and, with the network switched off in developer tools, opens to Today with the day it last showed, the estimates and the picture included, and the check-in page loads.
- The forced-fallback test passes with `ROUTING_PROVIDER=straight-line`: Today renders every stop, every leg says "straight-line estimate", and the picture's place says the map needs the practice's key.
- The photograph drill on the laptop: a household with `photo_video` consent, a visit run with the API stopped, a photograph taken, check-out and close on the device, the API started, the events and then the bytes flushed within sixty seconds, the `document` row and `session.setup_photo_document_id` present, the picture opened from the next check-in's pre-flight through one audited link; the same drill for a household without the consent ends with no camera offered, and the server refuses a forged `PUT` with 403.
- Withdrawal and erasure database tests with a photograph filed first.
- `canCheckIn` blocks on an overdue assigned amplifier and passes with none assigned; the kit policies have a deny test per grant; the seeded register carries an amplifier per practitioner in date and one unassigned overdue item.
- Migration 204 and 306 apply on a fresh database and on one carrying every stream's range; the audit trigger and the classification comment are present on both new tables.
- One combined review and one re-check under `docs/HANDOVER.md` section 6, the record posted, the pull request merged in order, and a staging pass recorded in `docs/STAGING.md` with `ROUTING_PROVIDER=straight-line` until the operator supplies the key.
