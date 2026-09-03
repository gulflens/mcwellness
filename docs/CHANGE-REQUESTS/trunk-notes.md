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

Migration 902 gives a consent wording document four columns of its own —
`purpose`, `locale`, `version`, `status` — because that is what
`SPEC/client-record.md` section 7 asks for: the wording is versioned per
purpose and per language, and a consent row records the exact version shown.
Adding `'participation', 'en', '1', 'draft'` to both fixtures makes them
describe a real wording rather than a placeholder.

**Why it matters beyond tidiness.** The trunk wanted a check constraint
saying every `consent_text` document carries all four, and did not add it,
because a constraint the trunk cannot fix on the other side of the ownership
line is a broken stream rather than a stronger schema. What shipped instead
is the weaker pair: no other kind of document may carry any of the four, and
within a row they are all present or all absent. Once both fixtures carry
them, the trunk adds the completeness constraint in its next round. Until
then the database will accept a wording that names no purpose, and the
streams should not rely on that.

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
