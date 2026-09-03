# client-record-02: requests from the third pull request

The third pull request is the enrolment wizard and the client record's tabs.
It needed nothing from the shared zone to ship: CR-03 of `client-record-01.md`
landed on `main` before it opened (pull request 31, "feat(api): mount the
client-record routes"), so every route the screens call is reachable, and
CR-04 turned out to need nothing at all — see below.

What follows is one decision for the operator, one request for the trunk, the
one place this pull request departed from its brief, and the list of what it
deliberately left for the fourth.

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

## CR-06: fold Arabic-Indic digits inside `normaliseEmiratesId`

**What.** Two lines in `domain/shared/emirates-id.ts`, so the normaliser reads
an Emirates ID typed in Arabic-Indic (U+0660-0669) or Extended Arabic-Indic
(U+06F0-06F9) digits as readily as one typed in Latin.

**Why.** Arabic is a first-class layout here (CLAUDE.md), and an Arabic
keyboard is an ordinary way to type a number in this practice. Today
`normaliseEmiratesId` strips those code points as "not a digit", so a number
typed that way comes up short and throws.

This pull request folds them in its own browser-safe file
(`app/api/clients/emirates-id-shape.ts`) before anything reaches the
normaliser, on both sides of the search and on both capture forms, so the
console searches and captures correctly today and nothing is asked of the
trunk for correctness. The security review confirmed the unfolded case fails
closed rather than wrong — the normaliser throws, so one physical number can
never produce two fingerprints or be stored twice.

What it leaves is a **drift trap**, which is what this request is for: the
console folds, and the routes do not. The next caller to post a contact — the
practitioner app, an import, anything — must remember to fold or it gets an
opaque `invalid_emirates_id` for a number that is perfectly valid. The rule
belongs where the normalising already happens.

**Proposed diff** (`domain/shared/emirates-id.ts`):

```diff
+const ARABIC_INDIC = 0x0660; // ٠ to ٩
+const EXTENDED_ARABIC_INDIC = 0x06f0; // ۰ to ۹
+
+/** Arabic-Indic and Extended Arabic-Indic digits as their Latin counterparts. */
+function toLatinDigits(input: string): string {
+  return Array.from(input)
+    .map((character) => {
+      const code = character.codePointAt(0) ?? 0;
+      if (code >= ARABIC_INDIC && code <= ARABIC_INDIC + 9) return String(code - ARABIC_INDIC);
+      if (code >= EXTENDED_ARABIC_INDIC && code <= EXTENDED_ARABIC_INDIC + 9)
+        return String(code - EXTENDED_ARABIC_INDIC);
+      return character;
+    })
+    .join('');
+}
+
 export function normaliseEmiratesId(input: string): string {
-  const digits = input.replace(/[^0-9]/g, '');
+  const digits = toLatinDigits(input).replace(/[^0-9]/g, '');
   if (digits.length !== EMIRATES_ID_DIGITS || !digits.startsWith('784')) {
     throw new Error('An Emirates ID is fifteen digits starting 784.');
   }
   return digits;
 }
```

Applying it makes this stream's own fold redundant but harmless, and that
file's fold can be dropped in a later pull request rather than in the same
commit. Nothing here waits on it.

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
gate, same audit row per client seen, same response shape as the list.

Three things make that hold rather than merely intend it:

- The search box sends **nothing at all** while the number is half typed. A
  person types slower than the 150 ms debounce, so without this the box would
  have emitted `?q=784`, `?q=7841900`, … up to fourteen of the fifteen digits
  before the last keystroke switched transport — the leak the route exists to
  prevent, arriving one keystroke early. A line under the box says so.
- `GET /api/clients` **refuses** a `q` that is an identity number, whole or
  half-typed, rather than searching it: the floor under the browser's rule, so
  a hand-written request cannot put one in a query string either. A record
  number is never mistaken for one (MRNs read `MW-000001`).
- A lookup that finds **nobody** is audited too. `logReads` writes one row per
  client returned and nothing when there are none, so without this a search by
  identity number that found nothing left no trace at all. The row records
  **who searched and when, never what for** — the number must not enter the
  trail, and does not.

The shape rule itself lives in one browser-safe file both sides import
(`app/api/clients/emirates-id-shape.ts`), because two copies of a rule this
one enforces would drift. It reads the digits through any separator — hyphen,
space, non-breaking space, bracket, dot, a zero-width joiner `cleanText`
deliberately keeps for Persian and Urdu — and folds Arabic-Indic and Extended
Arabic-Indic digits to Latin first, so an Emirates ID typed on an Arabic
keyboard is both refused from the URL and accepted by the lookup and the
capture fields.

Nothing in the shared zone changed for any of it, and nothing is being asked
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

## Three smaller notes for the trunk

- **An audit row for a search that found nobody has `client_id` null.**
  `POST /api/clients/lookup` writes one `list` row with the request id as its
  entity and a null `client_id` when it matches no one, so the trail records
  the search itself. The discriminator for those rows is therefore
  `action = 'list' and client_id is null`, which holds only because
  `logReads`'s other caller always sets `clientId` to the client's own id. A
  later "reads per client" aggregation that assumes every `list` row names a
  client would bucket them as null. Worth a sentence in `docs/SPEC/audit.md`
  (audit-ui's file, not this stream's) so the assumption is written down
  rather than inferred.
- **The vendor register names the Platform, not the consumer map.**
  `docs/COMPLIANCE/approved-vendors.md` lists "Google Maps Platform …
  coordinates only, never names". The "Open in Google Maps" link this pull
  request ships is `www.google.com/maps`, a person-clicked link carrying a
  household's coordinates (`rel="noreferrer noopener"`, so no referrer and no
  automatic request). Covered in substance, not in wording: widen that line
  before v1, or fold it into whatever CR-05 settles.
- **Neither `POST /api/clients` nor `POST /api/clients/:id/contacts` takes an
  idempotency key.** A retried create whose first attempt succeeded now
  answers `409` with "This Emirates ID is already on file" — true, but the
  caller's own row is what it collided with. Harmless today (the console is
  online-only and the wizard does not retry), and it becomes real when the
  practitioner app's outbox replays a create. The right fix is an idempotency
  key on the write routes, which is a shape decision wider than this stream.

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
