# Security

How the platform defends itself, what each layer does, and what the hosting
layer and the Supabase projects must add. Written 2026-09-02 with the
hardening pass; amend it whenever a layer changes.

## What is protected

Client records and the audit trail. The data lives in Postgres under row
security; the API is the only path to it (the browser holds no database
credential); every read and write of a record is logged, hash-chained.

## The layers, outermost first

1. **Hosting** (not yet chosen). Must terminate TLS, forward the caller's
   address in `X-Forwarded-For`, and absorb volumetric denial of service.
   Set `TRUSTED_PROXY_HOPS` to exactly the number of proxies in front of the
   API so the rate limiter keys on the real caller: with 0 the header is
   ignored and every caller behind a proxy shares one budget; with too many,
   the address is attacker-chosen (a forwarded value that is not an IP falls
   back to the socket). The origin must accept connections from that proxy
   only. Set `HOST` to what the proxy reaches; the laptop door refuses to open
   on any host that is not loopback. Strip query strings from
   `/api/*` access logs (a search term is typed by staff about a client).
   **Amended in the build, 2026-09-06**: the edge under consideration very
   likely cannot do that — Hostinger terminates TLS, fronts the sites with its
   own content delivery network and keeps its own access logs, which
   `docs/SPEC/hosting.md` 2.3 records as a limitation to note rather than a
   thing to fix — so this stays the requirement and is confirmed one way or the
   other when decision 1 settles where the API runs.
2. **Protective headers** on every answer (`app/api/_middleware/security.ts`):
   a content security policy allowing only the app's own scripts, styles,
   fonts and connections (`'self'`, images also `data:` and `blob:`, and the
   Supabase project's origin as the one outside connection, for sign-in), no
   framing (`frame-ancestors 'none'`, `X-Frame-Options: DENY`), no sniffing,
   no referrer, no camera or microphone, and location only for the app's own
   origin (the check-in and enrolment ask for it on a tap; no embedded
   third party may), `Cross-Origin-Resource-
   Policy: same-origin`, and in production `Strict-Transport-Security` for a
   year with subdomains. API answers are `Cache-Control: no-store`. In
   production the API serves the built app itself (`SERVE_APP=true`), so the
   same headers cover the screens.

   **One document is served with a wider policy, and only one**
   (`docs/SPEC/route-planning.md` section 8, from piece seventeen):
   `/admin/schedule/map`, the coordinator's day map. Google's Maps JavaScript
   API needs directives the policy above refuses and should go on refusing, so
   that document alone gets `script-src 'nonce-N' 'strict-dynamic' https:
   'unsafe-eval' blob:`, Google's four hosts for images, fonts, connections
   and frames, and `worker-src 'self' blob:`. The nonce is minted per response
   (`randomBytes(16)`) and stamped on the shell's own script and preload tags,
   which is what makes `'strict-dynamic'` safe: only those tags are trusted,
   and only what they load is trusted onwards. `'unsafe-eval'` is on Google's
   own documented list and is the one grant the practice would rather not
   make; it reaches this page and no other. That document's `Referrer-Policy`
   is `strict-origin-when-cross-origin` rather than `no-referrer`, because the
   browser key is restricted by HTTP referrer and Google refuses a request
   carrying none; only the origin crosses, and no address of this app names a
   person.

   **The widened document renders the day map and nothing else, and every way
   out of it is a fresh document load.** Four things make that true, and no
   three of them were enough. The widening is chosen by an exact path match on
   a GET, so no neighbouring path can widen itself into it — but that only
   settles which *document* is widened, and a console screen is not a
   document.

   1. **No rail.** The day map is mounted **outside the `/admin` layout
      route** (`app/shell/App.tsx`), so the widened document carries none: the
      rail navigates with `NavLink`, and Clients, Billing, Books, Audit and
      Settings were otherwise each one client-side click from rendering under
      `'unsafe-eval'` for the rest of that browsing session.
   2. **No redirect.** Its own two ways out — no session, and a signed-in
      person who may not open the schedule — are **plain anchors and not
      `<Navigate>`** (`RequireAuthDocument`), because a redirect renders the
      next screen inside the document already loaded and an anchor makes the
      browser fetch a new one with the strict policy on it. Anyone can hand
      anyone the map's address; what they get is the map, a sentence and a
      link out.
   3. **No link out that stays in place.** `DayMapPage` wraps its whole tree,
      drawers included, in the `DocumentBoundary` of
      `app/admin/schedule/map/documentBoundary.tsx`, where a `BoundaryLink`
      renders a plain `<a href>` instead of a router `Link`. The rule is a
      property of the tree and not of each link, so a link added later by
      somebody who has never read this page is safe too. The one that made
      this necessary is the call-off drawer's **Open Billing**, shared with
      the Schedule page — where it is still a client-side link, because there
      the strict policy is already on the document.
   4. **The worker never caches it.** The shell cache is keyed on `/` alone,
      so whatever document was last fetched successfully answers every later
      navigation with no signal. `app/shell/sw.ts` reads that cache for the
      map's address and never writes to it, or one visit to the map would have
      made the widened document this device's offline shell for Clients, for
      the practitioner's Today and for the sign-in form.

   (The review of piece seventeen's pull request, finding B2, 2026-09-08, and
   the re-check of its fix round the same day: before the first round the
   sign-in form itself and a practitioner's Today could be rendered under the
   wider policy; after it, Billing and the rail behind it were still one click
   away inside the call-off drawer, and the worker still replayed the widened
   document offline.)

   `tests/security/headers.test.ts` pins **both** policies — the map
   document's, and every other document's and every API answer's unchanged —
   together with the near misses (a query string, a trailing slash, a letter
   more, a change of case, and a percent-encoded spelling, which Hono decodes
   before matching); `app/shell/App.test.tsx` pins that the map route renders
   no rail and that both ways out are anchors;
   `tests/scheduling/DayMapPage.test.tsx` calls a visit off from the map and
   presses Open Billing, asserting the router did not move, while
   `tests/scheduling/MoveAndCancelDrawers.test.tsx` asserts the same press from
   the Schedule still navigates in place; and `app/shell/sw.test.ts` asserts
   the shell cache is untouched by a successful navigation to the map and still
   updated by one to any other screen.
3. **Rate limits** (`app/api/_middleware/rate-limit.ts`), per minute, from
   the environment: `RATE_LIMIT_PER_MINUTE` per address (300),
   `RATE_LIMIT_ACTOR_PER_MINUTE` per signed-in person (600),
   `RATE_LIMIT_AUTH_FAILURES_PER_MINUTE` refused sign-ins per address (20),
   `RATE_LIMIT_DEV_DOOR_PER_MINUTE` on the laptop door (30). Over budget the
   API answers 429 with `Retry-After`. The address budgets cost nothing beyond
   the check; the per-person budget is judged after sign-in, so a refusal there
   still costs the token check and one short transaction. The counters hold
   the caller's address or the signed-in person's id with timestamps, in this
   process's memory only: never written to disk or a log, dropped when the
   window empties, swept on request arrival once per window, and capped at
   50,000 keys (past that, new callers are refused rather than stored). Right
   for one instance; several instances need a shared store behind the same
   interface, and a hosted store then enters the vendor register first. The
   failure budget counts refused sign-ins (401) only, not a signed-in person's
   own forbidden screens.
4. **Input hygiene.** Bodies are capped at 64 KB and must be JSON; every
   request has a 10 second timeout on top of the database's own; every
   input passes a zod schema; free text (the search box, the reason line) is
   normalised, stripped of control, invisible and bidirectional-override
   characters, collapsed and capped (`cleanText`), and a reason with a
   token-shaped run is scrubbed before it is stored. The timeline's
   sentences are composed on the server from a fixed catalogue; the browser
   never receives a raw audit row.
5. **Sign-in.** Supabase access tokens verified with the project's keys
   (issuer, audience, expiry, role), a bearer header only, never a cookie,
   so cross-site request forgery has nothing to ride on and no CORS
   allowance exists. The laptop door mints tokens only with
   `APP_ENV=development`, a local database, a local Supabase URL and a
   loopback host, and answers a foreign host with nothing.
6. **Authorisation** in code (`canActor`) and in the database (row level
   security, restrictive role policies on users, roles, credentials and the
   audit log). The UI hiding a screen is a courtesy; the database refusing
   the row is the boundary.
7. **The audit trail**: append-only, hash-chained, immutable by trigger,
   redacted at write time (identity columns dropped, long text marked).
8. **Screens**: React escapes everything it renders; no raw HTML sinks exist
   (lint and a test keep it so); the policy above blocks any script that is
   not the app's own.

## Who may read what

*Written 2026-09-06 (trunk round 34), answering `docs/CHANGE-REQUESTS/reports-01.md` R4.*

Every cell below is read off `db/policies/**` and `domain/shared/actor.ts`, not
off memory. **The database is the boundary and the API rule is the courtesy**
(layer 6 above), so where the two disagree the row says so rather than choosing
between them; a screen that hides a button the server would have allowed is a
smaller fault than a screen that offers one the server refuses.

Read the columns as: **O** owner, **A** admin, **L** lead practitioner,
**P** practitioner, **F** finance, **C** client contact (a household's own
login). And the cells as:

- **all** — every row of the practice.
- **own schedule** — only clients that practitioner is booked to see, from
  ninety days back to thirty-one days ahead (`app.client_visible_to_practitioner`,
  migration 201).
- **own rows** — only rows naming that person's own practitioner row.
- **own record** — only the client they are a contact of
  (`app.actor_is_contact_of`), unless the row narrows it further.
- **—** — nothing at all: the query returns no rows, which is why a household
  and a finance account meet an empty screen rather than a refusal.

**The erasure gate sits over most of this.** Where a row says so, an erased
client's rows are readable by the owner and the lead practitioner alone,
whatever else the cell allows (`app.client_erasure_gate`, migration 100).

| What | O | A | L | P | F | C | Policy, and where the API rule differs |
|---|---|---|---|---|---|---|---|
| **The record**, and its contacts, consents, locations and documents | all | all | all | own schedule | client and contacts only; **—** for consents, goals, client documents | own record, and the consent wording it was shown | `db/policies/client/readers.sql` (`client_record_readers`), erasure-gated. A practice-level document — a certificate, a purpose's consent text — is the four staff roles', and a household reads only the consent wording a consent of its own actually names. **The API is wider**: `client.read` admits a practitioner unconditionally and knows nothing of the erasure gate, so a practitioner off their window passes the route and reads no row. A session's setup photograph is a `document` and is read by this row (`kind = 'setup_photo'`, migration 306), which is why finance cannot see one. |
| **Visits** | all | all | all | own rows | — | own record | `db/policies/scheduling/appointment_access.sql` (`scheduling_read_scope`). No erasure gate; erasure empties the row instead (migration 105). **The API is narrower**: no `appointment.list` scope admits a client contact at all, and a household reaches its visits through the portal's household gate instead. The policy's practitioner arm is an identity test on the practitioner row rather than a role test, so it is the practitioner row and not the role that decides. |
| **Sessions** and what was recorded in them | all | all | all | own rows | — | — | `db/policies/session/practitioner_scope.sql` (`practitioner_scope`, `for all`). **The API has no session-read rule to compare**: there is no session action in `canActor`, so the routes use `hasRole` directly, and `app/api/sessions/photo-link.ts` lists finance among its readers where the `document` policy does not — a finance account passes that route and the query answers nothing. |
| **Money**: purchases, entitlements, invoices and their lines, payments, refunds, rendered invoice files | all | all | all | own schedule | all | own record, and not a minor's own login | `db/policies/billing/ledger.sql` (`ledger_readers`, `catalogue_readers`, `exception_readers`) and `db/policies/portal/money.sql` (`portal_money_adults`), erasure-gated. A billing exception is the office's: `db/policies/billing/ledger.sql` gives it to O, A, L and F only. **The catalogue itself is not in the cells above**: `package`, `package_component` and `package_price` carry `catalogue_readers`, which is the four office roles — O, A, L and F — and neither a practitioner nor a household, whatever their cell says about their own money. A price list is a sales instrument and neither of them sells. **The API is narrower**: `billing.invoice.read` is the four office roles, and `actor.ts` says in the file that this is deliberate for now. |
| **Measurements** and their files | all | all | all | own schedule | — | — | `db/policies/assessment/access.sql` (`assessment_read`, `assessment_document_read`). The role lists agree with `assessment.read` exactly; the policy narrows the practitioner further. No erasure gate on the policy — erasure empties the payload (migration 106). |
| **Reports** | all | all | all | own schedule | — | issued reports about a client they are the legal guardian of, or about themselves once they are an adult, and a superseded version the household was actually sent | `db/policies/reports/reports.sql` (`report_readers`); a delivery record is the practice's own and no household reads it (`report_delivery_readers`). Erasure-gated. The superseded half is `status = 'superseded' and app.report_was_delivered(id)` in `report_readers`: section 7.3's "never a superseded version they were not sent", which means a version the practice did send stays readable, because the household may already be holding the paper. **The API is wider**: `report.list` and `report.read` admit any contact of the record and any practitioner, so a non-guardian contact passes the route and the row refuses. A draft is nobody's but the practice's. |
| **Portal invitations and requests** | all | all | requests only; **—** for invitations | — | — | its own record's requests; **—** for invitations | `db/policies/portal/access.sql` (`portal_access_readers`, `portal_request_readers`), erasure-gated. An invitation is the owner's and an admin's alone — not the lead practitioner's, and above all not a household's, even its own: handing out access to a record is the practice's act, and a household that could read the table could read the state of every invitation the practice has ever issued. A request is the household's own sentence, so a contact reads and writes its own client's and the three office roles read and handle; **a household may ask and may see that the practice has the ask, and may not mark it handled** (`portal_request_handlers`). A practitioner and a finance account read neither table at all. |
| **The audit trail**, the activity feed and the access report | all | all | all | — | — | — | `db/policies/core/audit_log.sql` (`audit_log_readers`). The role lists agree with `audit.read` and `audit.activity` exactly. **Everything else about the trail lives in the routes and not in the policy**: the erasure gate, the reason a sensitive read must carry, and the 404 for a record the caller may not name are all in `app/api/audit/activity.ts` and `app/api/audit/timeline.ts`, so a query issued outside those routes has only the role test above. Writing to the trail is a different matter: every role inserts its own read rows, which is what makes the access report possible. |

Two more things are true of the whole table. `app_user`, `user_role`,
`practitioner`, `credential` and `service_type` carry tenant isolation and no
read narrowing at all, so anybody signed in to the practice — a household
included — can read who works there and what they are certified for; that is
the practice's own staff list rather than a household's data, and it is written
down here so it reads as a fact somebody checked. And every read of personal
data is itself logged (layer 7), so this table says who may look, not who has.

### The two absences, which are decisions

**Finance reads no report.** `docs/SPEC/reports-v1.md` section 7.1 — "finance
gets nothing, because a report is not money" — and
`db/policies/reports/reports.sql`, which has no finance arm to remove. Finance
reads every other client-scoped group above except the measurements, so this
one is worth stating as a decision rather than leaving to be read as a policy
somebody forgot to widen.

**Finance reads no audit trail.** `domain/shared/actor.ts`, where `audit.read`
and `audit.activity` are one case admitting the owner, an admin and the lead
practitioner, with the reason beside them: reading who did what is oversight,
and finance reads money and not who did what. `db/policies/core/audit_log.sql`
says the same in SQL.

**This section is rewritten in the same pull request as any policy that changes
it.** A page describing row level security that is updated a round later is a
page that has been wrong for a round, and the only way to know it is wrong is
to read every policy file again — which is the work this section exists to save.

## What runs on every change

`pnpm verify` runs format, lint (including the design and colour rules),
types, the secrets scan (`scripts/audit-secrets.mjs`: private keys, tokens,
API keys including Supabase's, connection strings with passwords, assigned
secrets; the only allowances are local-host strings, documented `<slot>`
shapes, and the tests' fakes by exact value; it reads the tracked files as
they are, not the history) and every test, including `tests/security/`. CI adds `pnpm audit --prod` failing on a
high or critical dependency vulnerability, and the database suite.

## Supabase settings to switch on when the projects exist

Password strength and leaked-password protection; multi-factor sign-in for
the owner and every admin; refresh token rotation with reuse detection; a
session lifetime that matches a working day; the anon and service keys kept
out of the browser bundle (only the anon key is public, and the API never
uses it); the database's connection pooler with the `mcwellness_api` role
only.

## If a secret leaks

Rotate it at the source (Supabase dashboard, the deployment's secret store),
restart the API, and record the event in the audit trail with a reason.
Never commit a value to fix a leak; `.env` is ignored and `.env.example`
holds placeholders only.
