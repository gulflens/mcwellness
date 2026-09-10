# The walk's fixes: what a non-programmer ran into, and the four pieces that mend it

**Date:** 10 September 2026, 13:50 on the operator's clock (05:50 UTC). **Status:** design approved by the operator; spec for review.

## Why

On 10 September the console was driven in a browser on main `58f08b6`, against the synthetic
practice, through the ten jobs an office does every day: enrol a client, edit one, change an
address, set the home pin, navigate to the door, book, confirm, move and call off a visit,
charge and waive a no-show, take a payment, sell a package or a session, extend a package.
The day-to-day jobs were easy. The client record was not: the home pin is two number boxes,
the client's name and date of birth cannot be changed after the first wizard step, three
consents each need a scroll and a signature, the list's Emirate column is empty for every
client the app enrolled, and a single session cannot be sold before the visit. This round
mends all of it.

## Decisions already taken

| Decision | Choice | By |
|---|---|---|
| The home pin | A Google map with a draggable marker **and an address search box** | operator, 13:45 |
| A session outside a package | Can be **sold up front** ("Sell a session"), one credit at the single-session price | operator, 13:45 |
| The three consents | **One signature** covers everything the client needs, in one sitting | operator, 13:45 |
| Where the work lands | One trunk round (43), four pull requests, on branch `trunk-round-43` | Claude, agreed |
| Lawyers | None; the client's own approval is final (9 September) | operator |

## The design calls this spec makes

**One signature needs no new wording.** Each consent row still points at its own purpose's
current wording, which is the exact text the household read; the page shows those texts in
full, one after another, and the household signs once beneath them all. What changes is the
evidence: one signature image, filed once, referenced by every consent row it covers, with a
footer naming the purposes it was signed for. The 9 September wordings are untouched and keep
their versions.

**The address search is a register amendment, not a wording change.** The search box sends
the typed address to Google's Places service as it is typed, restricted to the UAE, only
when the coordinator uses the box. The vendor register's Google entry says an address must
never go to Google; this round amends that sentence to say exactly this. The four consent
wordings do not mention Google at all, so no wording changes. The website's privacy policy
names Google Maps already; whether its sentence needs the word "address" is the operator's
call outside this repository.

**The pin is the verification.** The location table stores one entrance point and no separate
"verified" flag, and the activation rule already reads it that way. So the screen stops
implying a second step: "Verify pin" becomes "Check the pin", saving it says "Pin saved", and
the checklist item reads "a location with its pin set".

**A sold session runs for twelve months.** A credit sold on its own has no package behind it,
so it takes a fixed term, twelve months from the day it was bought, written once as a
constant in `domain/billing`. It cannot be extended in this round; a household that needs
longer is refunded and sold again, which the existing refund path already supports.

## Shape

### Pull request 1: the plain fixes

- **Identity edit.** `app/admin/clients/IdentityForm.tsx`: given and family name in English and
  Arabic, date of birth, sex at birth, referral. Sent to `PATCH /api/clients/:id`, which
  already accepts every field and refuses anyone but owner and admin. Rendered from an Edit
  button on `OverviewTab.tsx` and from the wizard's Identity tab, which becomes a button once
  the record exists. Preferred language stays read-only: the client table has no such column
  and the screen's "English" is a placeholder the round removes.
- **Primary location.** `app/api/clients/locations.ts` sets `client.primary_location_id` when a
  location is created or patched with `isPrimary`, and demotes the other locations' flag in the
  same statement so one client has one primary. Migration `963_backfill_primary_location.sql`
  fills the column for every client from its primary location, or its only location when none
  is flagged. `list.ts` is unchanged and the Emirate column fills itself.
- **Booking date.** `NewAppointmentDrawer.tsx` gains a date field defaulting to the page's day;
  changing it refetches the practitioner list, which is filtered by date server-side.
- **Moved to.** `app/api/appointments/list.ts` adds `movedTo: { date, windowStart } | null` to a
  rescheduled row by a lateral join on `rescheduled_from_id`; `SchedulePage.tsx` renders
  "Moved to Fri 11 Sept 10:00" as a link to that day's schedule.
- **Timeline.** `domain/shared/audit-narrative.ts`: a `list` action on an appointment narrates as
  "saw the appointment in the schedule"; the reason is attached only when the narration's kind is
  not `read`. `app/api/audit/timeline.ts` collapses consecutive entries with the same sentence,
  actor and minute into one entry carrying a count; `RecordTimeline.tsx` prints the count.
- **Small things.** `contactName` returns the client's own name for a `self` contact. Example
  values in `ContactForm.tsx`, `EnrolmentWizard.tsx` and `LocationForm.tsx` move from
  `placeholder` into the hint. `ClientsPage.tsx` announces "<name> is now active" in its status
  region when the wizard's Activate succeeds, and reloads the table when the wizard creates the
  record (a new `onCreated` callback). `PaymentDrawer.tsx`'s reference error is announced with
  `role="alert"`. The pin wording changes named above.
- **Tests.** Domain: narrative list sentence and reason rule. API: `primary_location_id` on
  create, on patch, on demotion; `movedTo` present and null. DB: migration 963 against a client
  with a flagged primary, with only unflagged locations, with none. Component: identity form
  submits the changed fields only; booking date defaults and refetches; timeline count.

### Pull request 2: the map

- `app/admin/schedule/map/googleMaps.ts` moves to `app/shell/maps/googleMaps.ts` unchanged, and
  the loader accepts a list of libraries so the picker can ask for `places` while the day map
  asks for none. The day map's import line changes and nothing else. Trunk note records the
  move under the rule for a thing two modules share.
- `app/shell/components/MapPinPicker.tsx`: a map centred on the point in the boxes, or the
  emirate's centre, or Dubai; a marker that drags and that a tap places; a search box bound to
  `google.maps.places.Autocomplete` restricted to `ae`, which on a chosen place moves the
  marker and fills the address line if empty. Every move writes back through the same
  `onChange` the boxes use, so the numbers and the map never disagree.
- `CoordinateFields.tsx` renders the picker above the boxes when `browserMapKey()` is set and
  the caller passes `map: true`; otherwise the boxes as today plus the line "The map needs the
  practice's browser key". All three callers pass `map: true`.
- The CSP already admits `maps.googleapis.com` scripts and connections; the test in
  `tests/security/headers.test.ts` pins that nothing new is needed.
- `docs/COMPLIANCE/approved-vendors.md`: the Google Maps Platform row's data column adds the
  address search sentence stated above, dated, attributed to the operator's decision of
  10 September. `docs/SEAMS.md` names the picker beside the day map.
- **Outside the repo, for the operator:** enable the Places API on the browser key's project;
  confirm `VITE_GOOGLE_MAPS_BROWSER_KEY` is set for the production build.
- **Tests.** Component: picker absent without a key and the fallback line present; with a fake
  loader, a marker drag calls `onChange` with the new point; a chosen place fills an empty
  address and leaves a filled one alone. The loader test covers the libraries parameter.

### Pull request 3: sell a session

- `POST /api/billing/session-purchases` in `app/api/billing/session-sales.ts`, body
  `{ clientId, serviceTypeId, purchasedOn, discount?, payment? }` shaped like
  `SellPackageInput`. In one transaction: the service's price row in force on `purchasedOn`;
  the VAT resolution the package sale uses; one invoice of kind `session` with one line; one
  entitlement with `source_type = 'single'`, `invoice_id` set, `expires_on` twelve months on
  (`SINGLE_SESSION_MONTHS` in `domain/billing/expiry.ts`); the payment and its receipt when
  `payment` is present. Refusals mirror the package sale's: unknown client, no price on the day,
  a discount from a role that may not give one.
- `app/admin/billing/SellSessionDrawer.tsx` opened from a "Sell a session" button on the
  Packages tab: client search, service (the priced ones), bought-on, the figures, discount,
  "Money has changed hands". Toast: "Neurofeedback session sold to <name> for AED 700.00,
  invoice INV-000004."
- Balances already lists single credits; the "Packages bought" section is unchanged.
- **Tests.** Domain: the expiry constant. API: sale with and without payment, refusals,
  idempotency key reuse, the credit's expiry and invoice link, consumption on check-in takes
  the sold credit. Component: drawer figures and the toast.

### Pull request 4: one signature

- `POST /api/clients/:id/consents/bundle` in `app/api/clients/consents.ts`, body
  `{ purposes: [{ purpose, textDocumentId }], givenByContactId, method: 'app_signature' |
  'paper_scan', evidence }`. In one transaction: every purpose checked as the single route
  checks it (current wording, right locale, giver may consent, guardian rules for a minor);
  the evidence filed once; one consent row per purpose sharing `signature_document_id`; one
  audit row per consent. Refuses an empty list, a repeated purpose, `verbal_witnessed`, and a
  purpose the client does not need (`requiredConsents`) so the bundle never records more than
  the household was asked for.
- `app/admin/clients/SignAllForm.tsx`: the wordings from `requiredConsents`, each under its
  heading, one scroll-to-end gate over the whole stack, one pad, one name, one giver. The
  wizard's Consent step and the Consent tab offer "Sign everything at once" above the per-consent
  list, which stays for re-consents, withdrawals and paper forms.
- The signature image's footer lists the purposes, in the same words the headings use, so the
  filed image says what it was signed for.
- **Tests.** Domain: none new (`requiredConsents` is already covered). API: happy path writes N
  rows and one document; each refusal; the audit rows. Component: gate opens only after the last
  wording; the request carries every purpose once.

## Not in this round

- Places on the practitioner's phone: the home-base drawer gets the picker, the Today page does
  not change.
- Extending a sold single session.
- WhatsApp or any notification when a visit is moved or called off; the panels keep saying the
  household has to be told.
- A preferred-language field on the client.
- Anything on the public website, including its privacy policy sentence.

## Risks stated

- **Address text leaves the practice.** Places receives what the coordinator types, keystroke by
  keystroke, before a place is chosen. The register says so; the button is the coordinator's
  deliberate act; nothing sends a name or record number.
- **One image, several rows.** A withdrawal of one purpose leaves the shared image referenced by
  the others; the document is immutable and the withdrawal row records which purpose ended, so
  the trail stays true.
- **A sold session with no visit.** Twelve months on it expires like any credit; the balance
  screen shows it running out, and the refund path returns it.
- **The backfill picks a primary where none was flagged.** Only when a client has exactly one
  location; a client with several unflagged locations is left null and the list shows no emirate,
  as today, until the office marks one.
