# client-record-03: requests from the fourth pull request

The fourth pull request is recording consent — the wording, the signature pad,
the paper scan — and the Documents tab. It shipped everything the task brief
asked for except where a shared-zone rule stood in the way; those are the
requests below.

Two things it was owed arrived first and are recorded as met, not asked for:
the storage seam with `auditDocumentRead` and the retention helper (pull
request 40), and migration 903's write floor under `document`. Round 14's
trunk note 6 — "a client contact cannot read the wording they signed" — was
addressed to this stream and is **done**, in `db/policies/client/readers.sql`,
with its deny case in `tests/client/db/consent_documents.test.ts`.

CR-06's placement question from `client-record-02.md` is still open and still
costs nothing: say whether `app/api/clients/emirates-id-shape.ts`'s shape rule
should move to `domain/shared/emirates-id.ts` beside the normaliser, and it is
a one-line change here.

---

## CR-08: a document upload cannot fit through the body cap

**What.** Raise `BODY_LIMIT_BYTES` in `app/api/create-api.ts`, or give the two
document routes a cap of their own.

**Why.** Every body on this API is JSON (`jsonOnly`) and capped at 64 KiB. A
document therefore travels base64, which costs four bytes for every three, so
the largest file this practice can file today is about 45 KiB. That is
comfortable for a signature drawn on screen — the pad's PNG is a few kilobytes
— and it is tight to the point of awkward for the thing the same screen exists
to accept: a photograph of a signed paper form.

The console does what it can. `app/admin/clients/fileUpload.ts` scales a
photograph down and re-encodes it, trying five widths and three qualities until
it fits, and says so on screen. What it cannot do is compress a PDF, so a
scanned form that arrives as a PDF over 45 KiB — which is most of them — is
refused with a sentence asking the person to photograph the form instead. That
is honest, and it is not good enough for a practice whose paper route is one of
two ways a consent is ever recorded.

**Proposed diff** (`app/api/create-api.ts`):

```diff
-export const BODY_LIMIT_BYTES = 64 * 1024;
+export const BODY_LIMIT_BYTES = 64 * 1024;
+/**
+ * A document arrives base64 in a JSON body, so its route needs room the rest
+ * of the API does not. Eight megabytes is a photographed A4 page at a
+ * legible resolution with the envelope around it.
+ */
+export const DOCUMENT_BODY_LIMIT_BYTES = 8 * 1024 * 1024;
```

and, where the body limit is applied:

```diff
+  // The document routes carry a file; everything else carries a form.
+  api.use(
+    '/api/clients/:id/documents',
+    bodyLimit({ maxSize: DOCUMENT_BODY_LIMIT_BYTES, onError: payloadTooLarge }),
+  );
+  api.use(
+    '/api/clients/:id/consents',
+    bodyLimit({ maxSize: DOCUMENT_BODY_LIMIT_BYTES, onError: payloadTooLarge }),
+  );
   api.use('/api/*', bodyLimit({ maxSize: BODY_LIMIT_BYTES, onError: payloadTooLarge }));
```

A per-route cap rather than a global one, deliberately: raising the cap on
every route widens what an unauthenticated flood can push through the rate
limiter, and the two routes that need it are the two routes that need it.

**What changes here when it lands.** One number:
`MAX_DOCUMENT_BYTES` in `app/api/clients/record-schema.ts`.
`app/api/clients/document-limits.test.ts` imports both constants and pins the
arithmetic, so the two cannot drift apart in either direction. Nothing else
moves — the compression, the sniff, the store and the row are all unchanged.

**Nothing in this pull request waits on it.** A signature fits today.

---

## CR-09: a document has no way to say its bytes are gone

**What.** A nullable column on `document` — `bytes_removed_at timestamptz`,
or the same fact under whatever name the trunk prefers — and permission for the
API role to set it.

**Why.** Two places already need it, and a third is coming.

1. **Withdrawing `photo_video`.** `docs/SPEC/client-record.md` section 7 says a
   withdrawal takes effect immediately, and a setup photo exists only because a
   household said it could (`00-data-model.md` section 4). So
   `app/api/clients/withdrawal.ts` deletes the bytes through the seam and
   writes an audit row for each. What it cannot do is delete the row: the API
   role holds no delete grant on `document` (090_grants_and_rls.sql), and
   `retired_at` — the one column that could carry this meaning — is constrained
   to consent wording (migration 902's
   `document_consent_text_retired_is_a_wording`). The row therefore goes on
   naming a key with nothing behind it. That is detectable rather than silent —
   `exists` answers false, a signed link 404s — but it is not the record saying
   what happened, and a person reading the Documents tab still sees the
   photograph listed.
2. **The erasure deletion job** (round 14's trunk note 2, addressed to this
   stream). `app.erase_client` records `storage_keys_to_delete` and leaves the
   bytes; the job that removes them has the same problem in the same shape.
   That job is the **fifth** pull request's, with the rest of erasure, and it
   wants this column before it is written rather than after.
3. **Retention.** When a document ages out, whatever removes it will want to
   say so on the row for the same reason.

**Proposed migration** (the trunk's own range; nullable, no default, so nothing
is backfilled and no existing row changes meaning):

```sql
-- 9NN_document_bytes_removed.sql
-- Needs: 060 (document), 903 (the write guard)
alter table document add column bytes_removed_at timestamptz;

comment on column document.bytes_removed_at is
  'When the bytes behind storage_key were deleted, leaving the row for the '
  'trail. Null: the file is still in the store. Set by a withdrawal, an '
  'erasure or the retention job; never unset.';
```

**And the guard needs one clause with it**, because migration 903 refuses any
change to an immutable row and a signed consent is immutable: the same
narrow exception `retired_at` already has — an owner or an admin may set
`bytes_removed_at` from null, once, with every other column standing still.
Without that clause a withdrawal cannot mark the very rows it most needs to.

**Who may set it.** The API role, for the withdrawal path, which runs as the
acting person rather than as the owner. If the trunk would rather this stayed
the owner's, say so and the withdrawal becomes a call into a security-definer
function instead — that is a fine answer, it just has to be the trunk's.

**Meanwhile** the behaviour is as described above and written down in
`app/api/clients/withdrawal.ts` rather than glossed.

---

## CR-10: withdrawing a consent does not cancel what is booked

**Who.** `scheduling`, with a decision from the operator first.

**What.** `docs/SPEC/client-record.md` section 7: "existing sessions in
progress complete, future appointments cancelled with notification (Stage 2)".
This pull request records the withdrawal, immediately, and touches no
appointment: `appointment` is the scheduling worktree's table
(docs/SPEC/OWNERSHIP.md) and cancelling somebody's visits is not a thing to do
across an ownership line on a stream's own judgement.

The Consent tab says so plainly rather than leaving it to be discovered —
"Appointments already in the diary are not cancelled by this; tell whoever
keeps the schedule" — which is the honest interim, not the destination.

**The decision the operator owes first**, because it is not a coding question:
withdrawing `participation` stops sessions, and withdrawing `photo_video` or
`marketing` plainly does not. Which purposes cancel a booking, and is a
cancellation a cancellation or a request to the practice to ring the household?
`docs/SPEC/client-record.md` says "cancelled with notification", which reads
like the first; a practice that turns up to a locked door because an automatic
cancellation went out at 11pm reads like the second.

**The shape, once that is settled.** A consent withdrawal is an event
scheduling can subscribe to, not a foreign key: the client-record route knows a
consent went, and the scheduling module knows what that means for a diary.
Neither module reaching into the other's tables is what the ownership map is
for.

---

## CR-11: withdrawn — `consent.version` does mean something

**Struck on 2026-09-03, in the fourth pull request's fix round.** This asked
the trunk to drop `consent.version` or say what it counts, on the reading that
a wording's version is a string on `document` and the integer could therefore
hold nothing. That reading was wrong: the data model already defines the
column, and asking the trunk to remove a column this stream had simply not
found a use for is not a change request. Nothing was done to it and nothing
should be. Left here rather than deleted because a request that was answered
by reading the specification more carefully is worth showing once.

---

## CR-12: a route cannot do anything after its transaction commits

**What.** A way for a route to hand `app/api/_middleware/request-context.ts` a
piece of work to run **after** the commit — a list of callbacks on the context,
run once `commit` has returned, before the response goes back.

**Why.** Deleting bytes cannot be rolled back and a transaction can be.
Withdrawing `photo_video` consent removes the household's setup photographs
(`app/api/clients/withdrawal.ts`), and until this fix round it did so in the
middle of the request's own transaction: any failure afterwards rolled the
withdrawal back, and the consent came back to life with the photographs
already gone. That has been narrowed as far as this worktree can narrow it —
every database statement finishes first, the removal is the handler's last act,
and it never throws — but the commit itself belongs to the shared middleware,
so a connection that dies between the last statement and `commit` still leaves
the same mismatch.

The erasure deletion job (CR-09's second case) will want the same hook for the
same reason, and so will anything else that touches a store.

**Shape.** `c.get('afterCommit')(fn)`, or a `c.set('afterCommit', [...])` the
middleware drains — the trunk's call. What matters is that it runs after the
commit and that a throw inside it cannot turn a committed request into a
rollback, because there is nothing left to roll back.

**Nothing in this pull request waits on it.** The ordering above is honest and
tested; the hook makes the last few milliseconds honest too.

---

## CR-13: a retention job must ask what still references a file

**Who.** Whoever writes retention and the erasure deletion job (the fifth pull
request, and later).

**What.** Do not delete a document on `retention_until` alone.

**Why.** Two kinds of document now carry `retention_until` null, meaning "not
on an upload clock" and never "nobody computed it":

1. **Consent wording** (`consent_text`), which migration 903 already records:
   it is kept until no `consent` references it and the last referencing
   client's own retention has expired.
2. **Consent evidence** — the signature image and the photographed paper form
   — which this fix round moved onto the same rule. It used to be filed with
   five years on it *and* immutable, and migration 903 freezes an immutable row
   the moment it exists, `retention_until` included. So the date could never be
   moved on, and a consent still live in year six would have been evidenced by
   a file already marked for deletion in year five: the record deleting the
   proof of the agreement it is still acting on.

Both are in `domain/client/documentKinds.ts` (`CONSENT_EVIDENCE_KINDS`) and in
`app/api/clients/document-store.ts`, which is the one place either is written.

---

## CR-14: the seed writes no contact names

**Who.** Whoever owns `db/seed` (not this worktree).

**What.** Give the seeded contacts a given name and a family name, from
`db/seed/names.ts` like every other synthetic person.

**Why.** Migration 101 gave `contact` its four name columns and every screen
that lists a contact now shows one — the Contacts tab, the Overview's key
contacts, the consent giver, "Given by" on a recorded consent. The seed
predates the column, so on a seeded database every one of those reads
"Unnamed contact, mother", which makes a screen built to identify a person
look broken. Nothing in the application is wrong; the fixtures are simply
older than the field.

The consent screens do not fall over without it — a contact known only by its
relationship is a real case (101: "a contact known only by relationship
predates this column") — so this is a fixture fix, not a defect.

---

## Two things decided here rather than asked for

### The `document` write floor is inserts only

`db/policies/client/writers.sql` now says who may **file** a document. Until
this pull request the table had no row-level write floor at all: row security
fenced which practice's rows an actor could reach and nothing said who among
them might file one, so any role the practice had admitted — finance included,
which section 2 gives demographics and contacts and nothing else — could put a
document on a client's record.

There is deliberately **no matching update policy**, and the reason is worth
stating because a reviewer will look for one. Migration 903 is `document`'s
update floor by design, and it works by raising, with a sentence naming the
rule that was met. A restrictive update policy would filter those rows out
instead, and row security filters an `UPDATE` rather than raising: every one of
903's refusals would become a silent no-op, and
`tests/db/document-guard.test.ts` would start passing for the wrong reason —
which is exactly what happened when this stream tried it, and is how the
decision was made.

What that leaves open is narrow: a practitioner editing `kind` or
`retention_until` on a mutable client document. No route offers it, and no
route will. If the trunk wants it closed anyway, the fix belongs in 903's
trigger — where the message can still be said — rather than in a policy.

### A typed name is not a signature, and the route does not try to prove it

`POST /api/clients/:id/consents` accepts **any** PNG as `app_signature`
evidence. It checks the media type and that the bytes are what they claim to
be, and it does not — cannot — ask whether somebody drew them.

The rule itself is real and it is enforced, on the screen:
`app/admin/clients/SignaturePad.tsx` keeps the button disabled until an actual
stroke exists, says under the pad that a typed name on its own is not a
signature, and points at the paper form for anyone who cannot draw one. That
is where the rule belongs, because the screen is the only place in this system
where a person draws anything.

Putting it in the route as well would mean inventing a test — ink coverage,
stroke count, some statistic over pixels — that no specification asks for and
that would eventually refuse a real signature from somebody with an unsteady
hand or a small screen. What the route holds is the image, and the image is
the evidence. Stated here rather than left as a gap a later reviewer finds and
files.

### Recording a consent supersedes the one it replaces

`POST /api/clients/:id/consents` marks the active consent for that purpose
`superseded` before inserting the new one, so a purpose has one live answer.
`superseded` is in the status enum for this and nothing else was using it;
`canActivate` and every session-start check read "active" without asking which.
Withdrawn rows are left alone: a withdrawal is a thing a person did, not
housekeeping for the next signature to tidy away.

---

## Left out of this pull request, and why

- **The storage-deletion job for an erasure** (round 14's trunk note 2). It
  belongs with erasure, which is the fifth pull request, and it wants CR-09
  above before it is written rather than after.
- **A shared file-input control.** Both new file fields are plain inputs
  wearing the shell's own field classes. `app/shell/components/Controls.tsx` is
  the shared zone and one stream needing a control is not yet evidence the
  console does — the same reasoning `client-record-02.md` recorded for the tab
  strip and the checkbox. When a second stream wants one, that is the change
  request.
- **Rendering a PDF inline.** A filed PDF opens in a new tab through its signed
  link. An inline viewer is a dependency and a decision about what the console
  shows without asking, and neither is this pull request's to take.
- **Saying that a photograph is part of an issued report.** Withdrawing
  `photo_video` removes the setup photographs, and the Documents tab now says
  a photograph was removed rather than offering a link that cannot open. What
  it does not say is whether that photograph had already gone out in a report,
  which is the thing a household would most want to know and the practice
  would most need to answer. Reports are not this worktree's
  (docs/SPEC/OWNERSHIP.md) and nothing here can see what one contains, so it is
  named as unbuilt rather than approximated. When reports exist, "this
  photograph appears in a report issued on ..." is a line on the same row.

- **The client's own view of a consent they signed.** The read policy now
  admits it (round 14's trunk note 6) but `app/client/**` is the client-portal
  worktree's. The door is open for them.
