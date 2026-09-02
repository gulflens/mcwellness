# client-record-01: requests from the second pull request

Two things that were still open when this pull request began were resolved
by the trunk while it was being built (shared-zone-round-2 and round-3, pull
requests 18 and 19). Recorded here so the history is clear, not as live
requests:

- **Narrative sentences for goal, erasure_request and a refused read.**
  Landed in `domain/shared/audit-narrative.ts` (commit "feat(shared):
  sentences for a goal, an erasure request, and a refused read"). The
  timeline reads in plain language for every action this pull request's
  routes write, with no further change needed here.
- **The audit trail's erasure mode, honoured under an assumed role.**
  `app.begin_erasure()` and `app.end_erasure()` (`db/migrations/098_erasure_guard.sql`)
  mark the current transaction so `app.audit_redact` withholds values
  regardless of which role called it — exactly the gap this pull request
  would otherwise have needed to ask for. `app.erase_client`
  (`db/migrations/100_client_record.sql`) calls both, wrapping the section 8
  work so a failure reaches `app.end_erasure()` too.
- **Identity keys reaching every route.** `createApi` now carries
  `identityKeys` through to `c.get('identityKeys')` (commit "feat(shared):
  createApi carries the identity keys to any route that needs them"). Sealing
  or hashing a contact's Emirates ID is still not built in this pull request
  — deliberately kept for the third pull request alongside the search it
  exists for (see "left out" below) — but the blocker that would once have
  required a change request here is gone.

What follows are the requests still open.

---

## CR-03: mount `mountClientRecord` in `app/api/create-api.ts`

**Applied** on the trunk in shared-zone round 8 (2026-09-03): the mount call sits between `mountClients` and `mountTimeline`, and `tests/db/route-mounts.test.ts` proves `GET /api/clients/:id` answers through `createApi` unassisted.

**What.** One call, alongside the two already there:

```ts
import { mountClientRecord } from './clients/mount';
// ...
mountClients(api, deps.now);
mountTimeline(api, deps.now);
mountClientRecord(api, deps.now);
```

**Why.** `app/api/create-api.ts` is the shared zone
(`docs/SPEC/OWNERSHIP.md`); this worktree does not edit it. Every route this
pull request adds — `app/api/clients/{record,contacts,locations,goals,
consents,erasure}.ts`, mounted together by `app/api/clients/mount.ts`'s
`mountClientRecord` — is fully built, typed, tested (mounted directly onto
the `api` `createApi` returns, in `tests/client/db/*.test.ts`) and otherwise
ready, but unreachable from a real request until this one line lands. Every
route in this pull request waits on it; nothing else does.

**Proposed diff** (`app/api/create-api.ts`):

```diff
 import { mountTimeline } from './audit/timeline';
+import { mountClientRecord } from './clients/mount';
 import { mountClients } from './clients/list';
 import { mountDevSession, type DevSessionOptions } from './dev-session';
@@
   mountClients(api, deps.now);
   mountTimeline(api, deps.now);
+  mountClientRecord(api, deps.now);
```

---

## CR-04: the `clients/*` route in `app/shell/App.tsx`

**What.** A route (or route group) under `app/shell/App.tsx` mounting the
admin client screens — list, detail drawer with its tabs, the intake wizard —
against the routes this pull request and the next build.

**Why.** `app/shell/**` is the shared zone. No screen exists yet for any of
this: this pull request is deliberately routes and data only (the task
brief's own "leave out … any screen"). The third pull request is where the
client-record worktree's screens land, and they need somewhere in the shell
to be routed to. Nothing in this pull request waits on it; the third pull
request's screens do.

**Proposed diff.** Not written yet — the third pull request's screen
structure decides what routes it needs. This entry is a placeholder so the
trunk knows one is coming, per the task brief.

---

## Left out of this pull request, and why

- **Search by phone and by Emirates ID.** Named out of scope in the task
  brief. Now that identity keys reach every route (see above), the blocker
  is gone; it is still the third pull request's, alongside the Emirates ID
  capture it depends on.
- **Emirates ID capture on a contact.** `app/api/clients/contacts.ts`'s
  create and update bodies deliberately carry no Emirates ID field. Nothing
  reads a captured identifier yet — the search above is what it is for — so
  adding a seal-and-hash path here would be unused surface, not a fix for a
  gap. Comes with the third pull request.
- **The practitioner's `verbal_witnessed` re-confirmation on `home_visit`
  consent** (`docs/SPEC/client-record.md` section 7: "practitioner records,
  second staff member confirms"). `db/policies/client/writers.sql` gives
  consent-writing to the owner, an admin and the lead practitioner only, on
  purpose: a practitioner's narrower path needs a second-confirmation
  workflow this schema does not yet model, and the safer default until it
  exists is no path at all rather than a half-built one.
