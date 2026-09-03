# Trunk notes — gaps the streams will hit

The reverse of the other files in this folder: things the trunk noticed while
laying shared ground, written down instead of built, either because a stream
owns the path or because the work is a stage of its own. Each is addressed to
whoever owns it.

---

## Round 14, 2026-09-03 (the storage seam, session settings, consent wording)

### 1. Two scheduling fixtures file a bare consent wording document

**Who.** `scheduling`.

**What.** `tests/scheduling/db/appointments.test.ts` (about line 129) and
`tests/scheduling/db/client_visibility.test.ts` (about line 231) both insert

```sql
insert into document (id, tenant_id, kind, storage_key, mime_type, sha256)
values ($1, $2, 'consent_text', 'consent-text-v1', 'text/plain', ...)
```

**The ask, and it is one word.** Change `kind` in both fixtures from
`'consent_text'` to `'referral'`. What those fixtures stand in for is any
document a consent can point at — `consent.text_document_id` is a plain
foreign key to `document` — not the practice's own published wording, and a
referral letter is the honest stand-in. Nothing else in either test changes.

Migration 902 gives a consent wording document five columns of its own —
`purpose`, `locale`, `version`, `status`, `retired_at` — because that is what
`SPEC/client-record.md` section 7 asks for: the wording is versioned per
purpose and per language, and a consent row records the exact version shown.
The alternative to the one-word fix is adding `'participation', 'en', '1',
'draft'` to both fixtures, which makes them describe a real wording; that
works too, but it makes two scheduling tests carry the practice's consent
wording, which is not what they are about.

**Why it matters beyond tidiness.** The trunk wanted a check constraint
saying every `consent_text` document carries all four, and did not add it,
because a constraint the trunk cannot fix on the other side of the ownership
line is a broken stream rather than a stronger schema. What shipped instead
is the weaker pair: no other kind of document may carry any of the four, and
within a row they are all present or all absent. Once both fixtures are off
`consent_text`, the trunk adds the completeness constraint in its next round.
Until then the database will accept a wording that names no purpose, and the
streams should not rely on that.

Gating that completeness check on `client_id is null` was considered and does
not help: migration 902 now requires a `consent_text` row to have no client at
all, and both fixtures already set none, so the gate would catch exactly the
rows it was meant to spare. The fixtures are the fix.

Note also that these two fixtures write as the raw owner connection with no
role stamped, which is why migration 903's write floor does not refuse them:
that guard stands aside when `app.actor_roles` is unset, the same way
`app.guard_location_notes()` does. A fixture that starts stamping a role will
need `'owner'` or `'admin'` to file a `consent_text` row — another reason the
one-word fix is the better one.

### 2. The storage-deletion job an erasure already asks for

**Who.** `client-record`, or a job stage.

**What.** `app.erase_client` (migration 100) records
`storage_keys_to_delete` on the erasure request and deliberately leaves the
bytes alone, noting that "a storage-deletion job to remove them ... is a
later pull request". That job now has something to call:
`storage.delete(key)` through the seam (`docs/SEAMS.md`), which is the same
call against a bucket or a folder and needs no vendor on a laptop.

**Why it matters.** Until it exists, an erasure removes the row and leaves
the file. CLAUDE.md rule 8 and `SPEC/00-data-model.md` section 7 both promise
the file goes.

**And one rule it must carry.** A deletion job must check what still
references a document before it calls `storage.delete`, never work from
`retention_until` alone. A `consent_text` document is exempt from the
five-year upload clock and its `retention_until` is deliberately null — it is
kept while any `consent` still points at it and the last of those clients is
still within their own retention — so null there means "not on an upload
clock", never "keep forever" and never "nobody computed it"
(`domain/shared/storage.ts`, migration 903, docs/SEAMS.md).

### 3. Nothing yet uploads or fetches a document

**Who.** Whichever stream needs documents first — `client-record` for
consent signatures, `session-capture` for setup photos, `reports` for PDFs.

**What.** The seam is laid and `c.get('storage')` is published on the request
context, but no route puts a file in or hands one out. When one is written:

- Build the key with `clientDocumentKey` or `practiceDocumentKey`; never
  compose one by hand, and never put a name or a record number in it.
- Write the `document` row and the bytes in the same unit of work, bytes
  first, so a row never points at nothing.
- Hand out `getSignedUrl`, never a permanent URL, and never the bytes through
  a route of your own.
- `c.get('storage')` is typed `| undefined`: a deployment without a store
  configured must be refused cleanly by the route, not assumed away.
- **Call `auditDocumentRead(db, document)` before you sign a link**, every
  time (`app/api/_middleware/storage/audit.ts`, docs/SEAMS.md). Signing is the
  only moment the trail can be written — the folder implementation serves its
  own bytes from ahead of the authentication fence, where there is no actor to
  name, and the bucket's bytes never reach this API at all — so it is the
  seam's rule rather than each route's to decide. A signed link that is never
  fetched is a read that did not complete, not a read that did not happen.
- **`put` refuses a key that already holds an object.** That is the default
  and it is the right one; pass `overwrite: true` only for a retry that knows
  its first attempt half-finished, and expect **409 `document_exists`**
  otherwise.
- **Compute `retention_until` at upload** with `documentRetentionUntil`
  (`domain/shared/storage.ts`). Do not invent the arithmetic, and do not write
  a date for a `consent_text` row: it answers null there on purpose.

### 4. The shape of a checklist item is nobody's yet

**Who.** `session-capture`.

**What.** Migration 901 checks only that `service_type.preflight_checklist`
and `rating_questions` hold JSON arrays. The shape of an item —
`{ key, label_en, label_ar }` and `{ key, label_en, label_ar, min, max }` —
is deliberately validated at the edge rather than by a constraint, so a bad
item can be refused with a sentence instead of a constraint violation. That
parser belongs in `domain/session`, and the seed's neurofeedback defaults are
drafts the practice will edit, not a fixed list to code against.

### 5. `pnpm seed:sql` is a command that does not exist

**Who.** The trunk, in a later round.

**What.** `docs/STAGING.md` refers to `pnpm seed:sql` in two places, but
`package.json` has no such script; the working command is the one the same
document also gives, `node --env-file=.env.staging --import tsx
db/seed/render-cli.ts`. Left alone this round on purpose — it is not this
round's work and a one-line script is the sort of thing that quietly widens a
pull request — but the two should be made to agree.

### 6. A client contact cannot read the wording they signed

**Who.** `client-record`.

**What.** `db/policies/client/readers.sql` gives a client contact their own
client's documents, and gives a practice document (`client_id` null) to the
four staff roles only. Consent wording is a practice document, so the one
person with the strongest claim to read it — the contact who signed under it —
cannot. The policy wants a fifth arm on the `client_id is null` branch: a
`client_contact` may select a `consent_text` document that a `consent` of
their own client points at.

**Why it is not done here.** `db/policies/client/**` is the client-record
stream's, not the trunk's (docs/SPEC/OWNERSHIP.md), and a read policy about
which contact may see which wording is a client-record judgement. The trunk
laid the column that makes it expressible (`document.kind = 'consent_text'`)
and the write floor that keeps the row honest (migration 903), and stops
there.

**Why it matters.** A person is entitled to a copy of what they agreed to.
Until this exists, the client app can show a consent but not the words behind
it.

### 7. The comment in 080_audit_triggers.sql about nested jsonb is now false

**Who.** The trunk, in a later round.

**What.** `080_audit_triggers.sql` carries a note to the effect that the core
tables have no nested jsonb, which is why the redaction only looked at
top-level values. That stopped being true when `service_type.preflight_checklist`
and `rating_questions` arrived (migration 901) and again with
`session_event.payload`. Migration 904 fixed the behaviour — the dropping and
the truncation now reach inside any jsonb object value, at any depth — but 080
is a merged migration and its text may never be edited, so the false comment
stands in the file and is corrected here instead.

**What is still not covered.** jsonb **arrays** are not descended into. The
arrays in this schema hold settings, not personal data. A stream that means to
put free text or a coordinate inside a jsonb array must raise it as a change
request first (`docs/SPEC/audit.md` section 8).
