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
2. **Protective headers** on every answer (`app/api/_middleware/security.ts`):
   a content security policy allowing only the app's own scripts, styles,
   fonts and connections (`'self'`, images also `data:`, and the Supabase
   project's origin as the one outside connection, for sign-in), no framing
   (`frame-ancestors 'none'`, `X-Frame-Options: DENY`), no sniffing, no
   referrer, no camera or microphone, and location only for the app's own
   origin (the check-in and enrolment ask for it on a tap; no embedded
   third party may), `Cross-Origin-Resource-
   Policy: same-origin`, and in production `Strict-Transport-Security` for a
   year with subdomains. API answers are `Cache-Control: no-store`. In
   production the API serves the built app itself (`SERVE_APP=true`), so the
   same headers cover the screens.
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
