# Seams — the capabilities that live outside this codebase

Anything the platform cannot do by itself — hold files, send a message, work
out a drive time — sits behind one interface with two implementations: the
real one, and a deterministic fallback that needs no vendor and no network.
A test proves the platform still works with the real one switched off.

This is not a preference. It is what lets the practice keep working when a
vendor is down, what lets the whole suite run on a laptop with no accounts,
and what keeps a vendor swap a change in one folder rather than a rewrite.

Every seam here is also a row in `docs/COMPLIANCE/approved-vendors.md`: a
capability that sends personal data anywhere is approved before it exists.

| Seam | Interface | Real | Fallback | Chosen by |
|---|---|---|---|---|
| Documents | `domain/shared/storage.ts` | Supabase Storage, private bucket `documents` | a folder on this machine | `STORAGE_PROVIDER` |
| Documents out | `domain/shared/sending.ts` | an email vendor, once one is approved | the message composed and the link handed back for the share sheet | `DOCUMENT_EMAIL_VENDOR` |
| Drive estimates | `domain/shared/routing.ts` | Google Maps Platform: the Routes API's compute route matrix (one leg at a time, or a whole grid), and the Maps Static API for the day's picture | straight-line distance times a road factor and an hour multiplier, for a leg or a grid, and no picture | `ROUTING_PROVIDER` |

---

## Documents (the storage seam)

**The interface** — `domain/shared/storage.ts`, browser-safe, five calls:

```
put(key, bytes, mimeType, { overwrite? }) -> { sha256, size }
get(key) -> bytes | null
getSignedUrl(key, ttlSeconds) -> url
delete(key)
exists(key)
```

**`get` is the server reading bytes back for itself, and writes no trail.** It
is the one call that hands a document's bytes to this API process rather than
to a person: the practice's logo, read out of its own `document` row and drawn
onto every invoice it renders (`docs/SPEC/billing.md` section 5.6). Handing
somebody a file is `getSignedUrl`, and that is the act the audit rule below
records; nothing is handed to anybody here, so there is no read to attribute
and no actor to name. A key that holds nothing answers null, which is an
answer and not a fault, and a store that cannot be reached raises
`StorageUnavailableError` exactly as every other call here does.

**A document is written once.** `overwrite` is **false by default on both
implementations**, and a second write to a key that already holds an object is
refused with `StorageConflictError`, which the API answers as **409
`document_exists`** — the store answered, and its answer was no, which is not
an outage. The bytes behind a filed consent, a signed report or a piece of
consent wording are the evidence of what a person was shown and agreed to, and
a store that quietly accepts a second write over the first is a store where
that evidence can be changed after the fact. Neither implementation checks and
then writes: the bucket is asked with `x-upsert: false` and answers 409, the
folder opens with `O_EXCL`, so there is no window between the two. A caller
that genuinely means to replace an object — a retry that knows the first
attempt half-finished — passes `overwrite: true` and means it.

**How long the bytes are kept.** `documentRetentionUntil(kind, uploadedAt)`,
next to the seam in `domain/shared/storage.ts`, is the one piece of
arithmetic: five years from upload for a practice document, written to
`document.retention_until` at upload. It answers **null for two kinds**, both
exempt from that clock: a `consent_text` document, kept until no `consent`
references it and the last referencing client's own retention has expired
(`docs/SPEC/00-data-model.md` section 3, migration 903); and a `practice_logo`,
which there is one of at a time and which is replaced rather than expired, so a
five-year clock would mark the practice's current logo for deletion while it is
still the logo (migration 909). So **a deletion job must check what still
references a document before it calls `storage.delete`**: deleting on
`retention_until` alone would take a wording out from under a consent that is
still live, or the mark off the practice's own paperwork, and null there means
"not on an upload clock", never "keep forever".

**Every route that signs a link calls `auditDocumentRead(db, document)` first**
(`app/api/_middleware/storage/audit.ts`). A signed link is a read whether or
not the bytes are ever fetched: handing someone the means to open a client's
file is the act worth recording. Signing is the only place the trail can be
written — the folder implementation serves its own bytes from ahead of the
authentication fence, where there is no actor to name, and the bucket's bytes
never reach this API at all — so the rule belongs to the seam rather than to
any one route. The helper takes the document and nothing else: the actor, the
roles, the reason and the request id all come off the transaction's own
settings inside the SQL, so no caller can attribute a read to someone else.

Every file the practice holds is a `document` row (`docs/SPEC/00-data-model.md`
section 3) whose `storage_key` names the bytes. Nothing else knows how those
bytes are stored: no route, no job and no seed talks to a vendor directly.

**Keys** are opaque paths, built by the two helpers in the same file and never
by hand:

```
tenant/<tenantId>/client/<clientId>/<documentId>    anything filed against a client
tenant/<tenantId>/practice/<documentId>             a document with no client
```

A key is made of ids and nothing else. It never carries a name, a record
number or what the document says, so a key that leaks says nothing about
whose file it is. `isValidStorageKey` refuses a leading slash, an empty
segment, `.`, `..`, a backslash, a control character and percent-encoding,
and the local implementation resolves the path and checks it again — a key
cannot climb out of the folder even if that check is ever loosened.

**The real implementation** — `app/api/_middleware/storage/supabase.ts`.
One private bucket named `documents` in the project `SUPABASE_URL` names.
Private always: nothing is ever served from a public URL, every fetch goes
through a signed URL good for five minutes by default and an hour at the very
most. The credential is `SUPABASE_STORAGE_KEY`, a service credential — never
the anon key, which the browser holds and which storage does not fence the
way row security fences the database. **One variable, with no fallback**: the
API does not stand `SUPABASE_SERVICE_ROLE_KEY` in when it is absent, because a
variable whose whole purpose is to say "this credential may write documents"
means nothing if another one is used instead, and the old fallback silently
handed storage the widest credential in the project to a deployment that had
only ever configured the database. A blank or whitespace-only value is read as
absent. When the value is a JWT it names its own role, and one claiming `anon`
is refused by name at startup rather than on the first upload someone attempts
weeks later; the newer key formats are not JWTs and claim nothing, so nothing
is guessed from them.

**The fallback** — `app/api/_middleware/storage/local-disk.ts`. A folder,
`STORAGE_DIR`, `.storage/` by default and git-ignored. **It must sit outside
the repository, or be git-ignored inside it**: the default is both, and a
`STORAGE_DIR` pointed somewhere tracked is how a practice's documents end up
in a commit. Every read and every write also asks the filesystem where the
path really leads (`realpath`), not only where its name says it does, so a
symlink planted in the folder by anything sharing the machine cannot make the
store read `/etc` or write over something it does not own. Same semantics: bytes
in, sha256 out, a signed URL that expires, delete, exists. Its signed URLs
point back at the API's own `GET /api/storage/:key`, mounted only when this
implementation is the one chosen. That route sits ahead of the authentication
fence because the signature in the link is its authorisation: an unsigned,
tampered, expired or unknown link is a flat 404, never a hint that the key
exists. The signing secret is fresh random at startup, so a link never
outlives the process that issued it and no new secret enters the environment.

**Choosing one** — `STORAGE_PROVIDER=local|supabase`.

- On a laptop and in the tests (`APP_ENV=development` or `test`) the fallback
  is the default and needs no setting.
- Anywhere else the choice is explicit or the API refuses to start, with a
  message saying so. Silently writing a practice's documents to a server's
  own disk is how documents go missing.

Nothing reaches the network until a call is made, so a project that is down
or misconfigured cannot stop the API from starting. A call against it fails
as `StorageUnavailableError`, which the API answers as **503
`storage_unavailable`** — an outage in the store, plainly, rather than an
internal error in the record it belongs to.

**Using it from a route**: `c.get('storage')`, the way `c.get('db')` and
`c.get('identityKeys')` work. `createApi` publishes it when it is given one.
`put`, `getSignedUrl` and `exists` are called where the route stands;
`delete` is called from `c.get('afterCommit')` and nowhere else, for the
reason the next section gives.

**The forced-fallback test** — `app/api/storage-seam.test.ts`. With the real
implementation disabled, the whole document path runs: put a document, sign a
link, fetch exactly those bytes back. With the real implementation selected
but unreachable, the API starts, answers its health check, and refuses a
document call with a clean 503. `app/api/_middleware/storage/seam.test.ts`
covers the choice itself, including every way of choosing wrong.

---

## Documents out (the sending seam)

**The interface** — `domain/shared/sending.ts`, browser-safe, one call:

```
sendDocument({ to, message }) -> { delivered: true, channel }
                               | { delivered: false, channel, handoffUrl }
```

Beside it, the pure helpers that compose what is sent: `draftMessage` writes
the sentence in English with the Arabic beneath it, and `whatsAppHandoff` turns
a number and that message into a `wa.me` link. Both decide nothing about the
network. The implementations are `app/api/_middleware/sending/`:
`share-sheet.ts` is the fallback and `index.ts` chooses from the environment.
(_Amended in the build, 2026-09-06:_ interface and implementations both moved
out of billing, because the reports stream sends documents through this same
seam and `docs/SPEC/OWNERSHIP.md` rule 3 forbids it importing billing's
`domain/`.)

**Today the fallback is the whole of it, and that is an answer rather than a
stub.** No email vendor is on `docs/COMPLIANCE/approved-vendors.md`, and
nothing unapproved receives a family's address. So `shareSheetSender` composes
the message, sends nothing, and hands the link back for a person to share —
which is how the practice already works.

**WhatsApp is a hand-off, not an integration**, and the distinction is the
whole of why the Business API is not needed here. The platform composes a
`wa.me` link carrying the drafted message; the person opens it and presses send
in their own WhatsApp, on their own account. Nothing reaches Meta from this
server, and the only number involved is the household's own, which is already
in the record. Approval is needed to send *on the practice's behalf*, which
nothing does. If the Business API is ever approved it is a second
implementation behind this same seam, not a rewrite.

**The real one is unreachable until a vendor exists.** `DOCUMENT_EMAIL_VENDOR`
names it and nothing names one today; a name the platform has no implementation
for is refused at startup rather than on the first send weeks later. The branch
was left unreachable rather than half-written, because the rule is that a
vendor is approved in `docs/COMPLIANCE/approved-vendors.md` before it exists
here.

**What the trail records.** Sending is neither a read nor a row change, so
neither the middleware's read helpers nor the row triggers write it; the route
calls `logAction` (`app/api/_middleware/audit.ts`) instead. The details it
carries are **the contact's id and the channel, and nothing else** — never the
telephone number, never the address. The trail is kept five years and read by
people who have no business knowing how to reach a family
(`docs/SPEC/audit.md` section 8); an id answers "who was it sent to" for
anyone entitled to ask, and the contact record answers the rest to whoever may
read that.

**What travels in the message.** The document's reference — "INV-000001" —
never an id out of a URL, and a short-lived signed link to the bytes. Nothing
in it says what the visit was for.

**The forced-fallback test** — `app/api/_middleware/sending/seam.test.ts`, beside the
implementations as the other two seams keep theirs; the pure half of the seam is
tested in `domain/shared/sending.test.ts`.

---

## After the commit — how bytes are deleted

**A delete cannot be rolled back and a transaction can.** Every request runs
inside one transaction (`app/api/_middleware/request-context.ts`), and that
transaction is rolled back on anything the route raised rather than returned,
and on any 5xx. A route that removes a client's photograph in the middle of
its own transaction has therefore already destroyed the bytes when the
withdrawal that justified them going is rolled back a moment later: the
consent comes back to life and the file does not.

So the store is never called from inside the transaction. The route hands the
deletion back to the fence instead:

```ts
c.get('afterCommit')(async () => {
  await storage.delete(document.storage_key);
});
```

Read it exactly as it is written: **this is the only correct way to delete
bytes from the store after a database change**, and it is what the erasure
deletion job and a withdrawal of `photo_video` consent use (a retention job
was named here too until 2026-09-10; nothing deletes on a timer, CLAUDE.md
rule 8). Nothing else in this codebase may call `storage.delete` from a route.

What the fence guarantees:

- **Only on a commit.** Work registered by a request that rolled back is
  discarded, unrun. A 5xx runs nothing; a refusal a route *raised* runs
  nothing; a refusal a route *returned* has committed, like every other
  request below 500, and so does run what it registered — which is right, and
  is why a route that means to change nothing should register nothing.
- **In the order it was registered**, one piece at a time, after `commit` has
  returned and the connection is back in the pool.
- **A failure stays inside.** A piece that throws is logged with the request
  id and the shape of the failure — never its message, which can carry a key
  or a row value — and the pieces after it still run. The caller is told
  nothing: the response is already decided and the row is already committed,
  so a store that would not answer is an operational fact, not this request's
  refusal.

What it does not give you: a database. By the time the work runs, the
connection is back in the pool and may already be serving another request, so
**the handle published as `c.get('db')` stops working the moment the request
ends** — a query through it rejects with a plain error rather than quietly
running inside somebody else's transaction. Anything that must be written
belongs in the transaction; anything that cannot be unwritten belongs here.

`c.get('afterCommit')` is published by the request-context middleware, so it
exists for every route below the authentication fence and — like `c.get('db')`
— for none above it. `storage` and `identityKeys` sit beside it on the same
context.

---

## Adding a seam

1. Write the interface in `domain/shared/`, browser-safe: types and pure
   helpers, no Node built-in, no vendor SDK.
2. Write both implementations under `app/api/_middleware/<seam>/`, server-only.
   The real one reaches nothing at construction time.
3. Choose between them from one environment variable, with the fallback as the
   default on a laptop and an explicit choice required everywhere else.
4. Give the failure of the real one its own error type and one clean status
   code. A vendor's message never reaches a caller: it can name a document or
   a person.
5. Write the forced-fallback test before the seam is used anywhere.
6. Add the row to the table above, and the vendor to
   `docs/COMPLIANCE/approved-vendors.md`.

---

## Drive estimates (the routing seam)

**The interface** — `domain/shared/routing.ts`, browser-safe, three calls
(`docs/SPEC/practitioner-phone.md` section 5;
`docs/SPEC/route-planning.md` section 7):

```
driveMatrix(legs: { from, to, departAt }[])            -> { seconds, metres, source }[]
driveGrid(origins, destinations, departAt, factors)    -> { seconds, metres, source }[][]
dayPicture(points: GeoPoint[])                         -> Uint8Array | null
```

`driveGrid` answers every origin against every destination in one call, rows
in origin order and columns in destination order, so the day optimiser can
price a whole day's places at one hour without one request per pair. At most
`GRID_MAX_ELEMENTS` (625, the vendor's own ceiling) elements, refused above
it before anything is sent.

**What leaves the server is coordinates and a departure time.** Never a name,
a record number, an address, a Makani number or an id: the request is built
from `location.entrance_point` or `parking_point` and nothing else, and the
vendor row in `docs/COMPLIANCE/approved-vendors.md` approves exactly that.
The key is a server key held in `GOOGLE_MAPS_API_KEY`, never shipped to a
browser; the content security policy is untouched because every picture
reaches the phone from the app's own origin.

**Every answer is an estimate and is labelled as one**, on the screen and in
the `source` field: `traffic` from the real implementation, `straight-line`
from the fallback. The fallback's road factor and peak multiplier are rows in
`scheduling_setting`, data the owner edits, not constants.

**Cached per pair.** A leg's estimate is written to `drive_estimate` keyed by
the two locations and the hour bucket and read back for thirty days, so a day
is looked up once; the picture is held in process memory until the day ends
and cached on the device by the worker, and is written to no table.

**The map in the coordinator's browser is not this seam.** From piece
seventeen the day map (`docs/SPEC/route-planning.md` section 8) loads Google's
Maps JavaScript API in the browser under a separate **browser** key,
`VITE_GOOGLE_MAPS_BROWSER_KEY`, restricted to that one product and to the
practice's own address. It draws a basemap and nothing else: the pins and the
lines are the app's own DOM, and no household coordinate is sent to Google by
the map. The server key above never reaches a browser, and neither key is
ever in this repository.

**Chosen by `ROUTING_PROVIDER`**, `google` or `straight-line`, explicit
outside development or the API refuses to start, exactly as `STORAGE_PROVIDER`
is. The forced-fallback test in `app/api/_middleware/routing/seam.test.ts`
proves Today renders whole with the real one switched off.
