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

## CR-11: `consent.version` no longer means anything

**What.** Either drop `consent.version`, or say what it counts.

**Why.** The column is `integer not null check (version >= 1)` and its comment
reads "of the consent wording" (`db/migrations/060_client.sql`). But a
wording's version is a string from the file's own front matter — `0.1-draft`
today — and migration 902 put it on `document.version` where it belongs, with
`consent.text_document_id` naming the exact row. So the integer cannot hold the
thing it claims to hold, and every route writes `1`.

That is not a bug this pull request introduced and it is not one it should fix
on its own initiative: an always-1 column is harmless, and inventing a meaning
for it — the client's own nth consent for this purpose, say — would put a
second, disagreeing answer next to `text_document_id`.

**Preferred:** drop it, and let `text_document_id` be the answer. If it is
wanted for an export or a document template, say what it counts and this stream
will write it.

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
- **The client's own view of a consent they signed.** The read policy now
  admits it (round 14's trunk note 6) but `app/client/**` is the client-portal
  worktree's. The door is open for them.
