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

---

## Documents (the storage seam)

**The interface** — `domain/shared/storage.ts`, browser-safe, four calls:

```
put(key, bytes, mimeType) -> { sha256, size }
getSignedUrl(key, ttlSeconds) -> url
delete(key)
exists(key)
```

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
way row security fences the database.

**The fallback** — `app/api/_middleware/storage/local-disk.ts`. A folder,
`STORAGE_DIR`, `.storage/` by default and git-ignored. Same semantics: bytes
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

**The forced-fallback test** — `app/api/storage-seam.test.ts`. With the real
implementation disabled, the whole document path runs: put a document, sign a
link, fetch exactly those bytes back. With the real implementation selected
but unreachable, the API starts, answers its health check, and refuses a
document call with a clean 503. `app/api/_middleware/storage/seam.test.ts`
covers the choice itself, including every way of choosing wrong.

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
