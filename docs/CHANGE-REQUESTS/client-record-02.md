# client-record-02: requests from the third pull request

The third pull request is the enrolment wizard and the client record's tabs.
It needed nothing from the shared zone to ship: CR-03 of `client-record-01.md`
landed on `main` before it opened (pull request 31, "feat(api): mount the
client-record routes"), so every route the screens call is reachable, and
CR-04 turned out to need nothing at all — see below.

What follows is one request for the trunk, one decision for the operator, and
the list of what this pull request deliberately left for the fourth.

---

## CR-04 (from client-record-01): closed, no change needed

That entry asked for a `clients/*` route in `app/shell/App.tsx` for "the list,
detail drawer with its tabs, the enrolment wizard". None is needed. The shell
already routes `/admin/clients` to `ClientsPage`, and both the drawer and the
wizard are drawers rendered by that page, not routes:
`docs/DESIGN-BRIEF.md` gives the console a right-side drawer rather than a
modal or a second screen, and the sibling screens (`app/admin/billing`,
`app/admin/schedule`) do the same. Nothing to apply; recorded so the trunk can
strike it off.

---

## CR-05: a map provider and key, so a pin can be dragged

**What.** A decision by the operator, then one shared-zone change: a map
provider for the web app (a library and an API key), configured the way
`VITE_SUPABASE_URL` already is, so the client record's locations can show a
map and let someone drag the entrance marker.

**Why.** `docs/SPEC/client-record.md` section 4.2 says "verify pin" opens a
map and the marker is dragged; section 4.3 wants a "find my Makani" helper on
the same step. The web app has neither a map library nor a key today, and this
worktree may add neither: a dependency is `package.json` (shared zone), and a
key is a deployment secret nobody should mint on a stream's say-so. Choosing a
provider is also not a coding decision — it carries a price, a data-processing
agreement and an entry in `docs/COMPLIANCE/approved-vendors.md`, because a map
request carries a household's coordinates to whoever serves it. That is the
operator's call, not a builder's.

**What ships instead, meanwhile.** "Verify pin" is a plain form:
latitude and longitude, "Use my current position" (`navigator.geolocation`,
with a plain message and no block when it is refused or unsupported) and
"Open in Google Maps" as an ordinary link to a new tab, so the person can
eyeball the point on a map they already have. It posts to the existing
`POST /api/clients/:id/locations/:locationId/verify-pin`, unchanged. Nothing
about the route or the stored coordinate has to change when a map arrives:
only the way the two numbers are chosen.

**Proposed diff.** None yet. It depends on the provider, and the provider is
the decision being asked for.

---

## A decision taken here, not asked for: the Emirates ID never enters a URL

The task brief asked for the list's `?q=` to match an Emirates ID and look
the client up by its keyed hash. It is looked up by its keyed hash, and it is
not `?q=`. `.claude/rules/ui.md` and the security review's fourth check both
say no personal data in a URL path or query string, and an identity number is
the most sensitive identifier the practice holds: a query string is written
into every reverse proxy's access log on the way, and the app's own deployment
notes assume a proxy in front of it.

So a term shaped like an Emirates ID goes instead to
`POST /api/clients/lookup` with the number in the request body — same role
gate, same audit row per client seen, same response shape as the list. `?q=`
is unchanged and still searches names and record numbers; an identity number
typed into it is ordinary text that matches nothing, which the database test
pins. Nothing in the shared zone changed for this, and nothing is being asked
of the trunk: it is recorded because it is a deliberate departure from the
brief that a reviewer should see stated rather than discover.

---

## What the fourth pull request must add to record consent

The task brief asked this pull request to record `participation` consent (and
`minor_participation` for a minor) from the enrolment wizard's consent step,
and not to weaken the route if it could not. It could not, and it did not. The
step shows what the client needs, from `requiredConsents` in `domain/client`,
and what is already on file; the summary step lists consent among what is
missing, so no lead is ever activated without it. Three things are wanted, and
all three belong with documents:

1. **A way for a screen to name the wording that was shown.**
   `POST /api/clients/:id/consents` requires `textDocumentId`, and refuses
   anything but a practice document (`document.client_id is null`) — correctly:
   `consent.text_document_id` is the exact wording, not a copy of what someone
   else once signed. The browser has no route that lists those documents, so
   it cannot supply the id. The fourth pull request should add a read route in
   this worktree's own `app/api/clients/` — the wording documents for a purpose
   and locale, current version — and no shared-zone change is needed for it.

2. **`signatureDocumentId` on the record-consent body and the insert.** The
   column `consent.signature_document_id` (`db/migrations/060_client.sql`)
   exists and is nullable; `RecordConsentBody` does not carry it and the route
   does not write it. Until it does, every method the route accepts for
   initial participation attests to evidence nothing can file:
   `app_signature` means a signature was drawn on screen, `paper_scan` means a
   scan was uploaded, and `verbal_witnessed` is never allowed for initial
   participation (`docs/SPEC/client-record.md` section 7). Recording one of the
   first two with nothing attached would put an unevidenced consent in the
   record, which is worse than waiting.

3. **The capture itself**: the signature pad that renders to a PNG and files it
   as a `document` with its hash, and the upload path for a photographed paper
   form. Both are the documents module's, not this one's.

Also this worktree's own, and deliberately not built here: withdrawing a
consent. `POST /api/clients/:id/consents/:consentId/withdraw` exists and takes
its reason header, but a withdrawal without a way to record one in the first
place would be a screen for undoing something the console cannot do.

---

## Left out of this pull request, and why

- **A draggable map on the Locations tab and the enrolment wizard's location
  step.** CR-05 above.
- **Recording and withdrawing consent, and every document action.** The
  Documents tab is a placeholder that says so, and the Consent tab is
  read-only with a note. See the three items above.
- **Editing a location's emirate or entrance point through the ordinary edit
  route.** `PATCH .../locations/:locationId` accepts neither
  (`app/api/clients/locations.ts`, unchanged here), so the edit form asks only
  for what the route takes and the point moves through "Verify pin" alone.
  That is the route's existing shape, not a gap this pull request found.
- **Parking and gate pins.** The record shows whether each is on file, because
  that is what `GET /api/clients/:id` reports; no route captures either yet,
  so no form pretends to.
- **A shared tab strip, checkbox and textarea.** `Tabs.tsx` and the two
  controls in `FormAtoms.tsx` are local to `app/admin/clients/` on purpose:
  `app/shell/components/Controls.tsx` is the shared zone, and one stream
  needing a control is not yet evidence the console does. When a second stream
  wants one of them, that is the moment for a change request, not a second
  copy.
