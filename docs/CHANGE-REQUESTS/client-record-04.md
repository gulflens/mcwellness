# client-record-04: requests from the fifth pull request

The fifth pull request is being forgotten: the erasure request becomes a
record of what was asked, the act becomes a separate press behind a
confirmation step, the confirmation letter is written and filed, and the bytes
behind every deleted document go through the storage seam after the commit.

It shipped everything the task brief asked for except three things that sit
in the shared zone. Each is small, each is written out below as the exact
change, and none of them blocks what has been built: the sweep runs today by
calling `sweepErasureFiles` directly, the letter templates work where they
are, and the audit trail says the right thing in a slightly clumsy sentence.

---

## CR-14: the erasure's file sweep has nowhere to live

**What.** Two things: a new file `jobs/client/retry-erasure-deletions.ts`, and
one line in `package.json`.

**Why.** When an erasure runs, the request removes each document's bytes from
the store through `c.get('afterCommit')` — the only correct place, because a
delete cannot be rolled back and a transaction can (docs/SEAMS.md). That hook
has no database by the time it runs, so it cannot record what it managed; it
does not need to, because what it could not remove is still in the store and
still on `erasure_request.storage_keys_pending` (migration 104). Something has
to come back for those, and `app/api/clients/erasure-file-sweep.ts` is the
whole of the rule that does: it asks the store about each key, deletes what is
still there, strikes off what is gone, and stamps `files_cleared_at` when the
list empties. It is tested end to end against a real store in
`tests/client/db/erasure_act.test.ts` ("records what the store would not take,
and sweeps it up afterwards").

What it has no home for is the twenty lines that open a connection and print
the result. `jobs/` belongs to no Stage 1 worktree in `docs/SPEC/OWNERSHIP.md`
— billing owns `jobs/billing/**` and reports will own `jobs/reports/**` — so
this stream cannot create `jobs/client/**` itself, and `package.json` is the
shared zone outright.

**Proposed new file** (`jobs/client/retry-erasure-deletions.ts`), written in
the shape `scripts/upload-consent-wording.mjs` already uses for a one-shot job:

```ts
import { connect, describeDatabase } from '../../db/runner/apply';
import { storageFromEnv } from '../../app/api/_middleware/storage';
import {
  describeSweep,
  sweepErasureFiles,
} from '../../app/api/clients/erasure-file-sweep';

// pnpm job:erasure-files — removes the document bytes an erasure could not
// remove at the time (docs/SPEC/client-record.md section 8 step 2). Safe to
// run as often as you like: it asks the store what is still there rather than
// trusting a flag, and an erasure with nothing pending is skipped.
//
// The owner's connection, not the API's: the sweep writes to
// erasure_request across every practice and answers to no request context.
// Nothing here prints a key, a person or a connection string.

const url = process.env.DATABASE_URL;
try {
  if (!url) throw new Error('DATABASE_URL is not set; there is nothing to sweep.');
  const storage = storageFromEnv(process.env);
  const client = await connect(url);
  try {
    console.log(`Sweeping the ${describeDatabase(url)} against the ${storage.describe()}.`);
    console.log(describeSweep(await sweepErasureFiles(client, storage)));
  } finally {
    await client.end();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'The sweep did not run.');
  process.exitCode = 1;
}
```

**Proposed diff** (`package.json`):

```diff
   "seed:wording": "node --env-file-if-exists=.env --import tsx scripts/upload-consent-wording.mjs",
+  "job:erasure-files": "node --env-file-if-exists=.env --import tsx jobs/client/retry-erasure-deletions.ts",
```

**If the answer is no**, the sweep still runs — it is an exported function
with a test — and a practice would call it from a console session. The job is
what makes it a thing an operator can be told to run.

---

## CR-15: the letter templates cannot sit where the brief put them

**What.** One line in `db/seed/consent-text.ts`, after which
`docs/CONSENT/erasure-letter/en.md` and `ar.md` move up to
`docs/CONSENT/erasure-letter.en.md` and `.ar.md`.

**Why.** The task brief named those flat paths and this stream owns them. They
cannot be used yet. `loadConsentTexts()` reads **every** `*.md` in
`docs/CONSENT` except `README.md` and files each as a piece of consent
wording, and `document.purpose` is the `consent_purpose` enum (migration 902),
so a file whose front matter says `purpose: erasure_letter` fails `pnpm seed`
outright and breaks `db/seed/consent-text.test.ts`, which asserts eight files
by name. Both are the shared zone.

So the templates went one directory deeper, where the loader does not see them
(a directory does not end in `.md`), and `app/api/clients/erasure-letter.ts`
reads them from there. Nothing about them is different: same front matter,
same version and status, same draft-pending-the-lawyer note, and
`domain/client/erasureLetter.test.ts` reads the real files exactly as
`db/seed/consent-text.test.ts` reads the real wording.

**Proposed diff** (`db/seed/consent-text.ts`):

```diff
   const files = readdirSync(dir)
-    .filter((name) => name.endsWith('.md') && name !== 'README.md')
+    // The consent wording, and only that. docs/CONSENT also holds the erasure
+    // confirmation letter, whose purpose is not a consent_purpose and which no
+    // consent ever points at (docs/SPEC/client-record.md section 8).
+    .filter(
+      (name) =>
+        name.endsWith('.md') && name !== 'README.md' && !name.startsWith('erasure-letter'),
+    )
     .sort();
```

With that in place, the two files move and one constant in
`app/api/clients/erasure-letter.ts` changes with them:

```diff
-const TEMPLATE_DIR = new URL('../../../docs/CONSENT/erasure-letter/', import.meta.url);
+const TEMPLATE_DIR = new URL('../../../docs/CONSENT/', import.meta.url);
```

```diff
-  const text = readFileSync(fileURLToPath(new URL(`${locale}.md`, TEMPLATE_DIR)), 'utf8');
+  const text = readFileSync(
+    fileURLToPath(new URL(`erasure-letter.${locale}.md`, TEMPLATE_DIR)),
+    'utf8',
+  );
```

This stream will make both of those changes in its own files once the seed's
line has landed. **If the answer is no**, nothing is lost: a subdirectory is
arguably the better home for a family of templates that is about to grow a
second member — the practice will want a "your request has been received"
letter eventually — and this request can be closed as declined.

---

## CR-16: the audit trail has no sentence for an erasure

**What.** One case in `domain/shared/audit-narrative.ts`.

**Why.** Performing an erasure writes one audit row that says what the
withheld trigger rows cannot: `action = 'erase'`, `entity_type = 'client'`,
with the typed reason on it. The catalogue has a sentence for
`erasure_request.insert` ("X requested erasure of this record") and none for
the act, so the timeline falls to the generic branch and renders "X recorded
erase on the client". Understandable, and not a sentence anybody wrote.

**Proposed diff** (`domain/shared/audit-narrative.ts`, beside the existing
`erasure_request.insert` case):

```diff
     case 'erasure_request.insert':
       return pick(
         t(`${actor} requested erasure of this record`, `${actor} طلب محو هذا السجل`),
         locale,
       );
+    case 'client.erase':
+      return pick(
+        t(`${actor} erased this record`, `${actor} محا هذا السجل`),
+        locale,
+      );
```

**If the answer is no**, the generic sentence stands and nothing is wrong,
only inelegant — which is worth saying plainly rather than working around by
renaming the action to one the catalogue already knows.

---

## CR-17: `requested_by_phone` is written to the trail in clear

**What.** Add `requested_by_phone` to the keys `app.audit_redact` drops
outright, beside `emirates_id_encrypted`, `emirates_id_hash`,
`checked_in_point` and `checked_out_point`.

**Why.** Recording an erasure request writes the number the confirmation will
be sent to onto `erasure_request` (migration 104). That insert is audited like
every other, and the insert is **not** inside erasure mode — the erasure has
not happened yet, and will not until somebody presses the second button — so
the number lands in `audit_log.new_values` in clear and stays there for the
trail's own five years, which is exactly the retention the column itself is
written to escape (migration 105 clears it as soon as the letter has been sent
and the files are confirmed gone).

It is a phone number on a row that says a household asked to be forgotten. The
redaction list is where the schema already keeps the things that must not
outlive their column, and this belongs on it.

**Proposed diff** (a trunk migration in the 9NN range, restating
`app.audit_redact` in full as 098 and 904 do):

```diff
-       from jsonb_each(p_row - array['emirates_id_encrypted', 'emirates_id_hash',
-                                     'checked_in_point', 'checked_out_point']) as e),
+       from jsonb_each(p_row - array['emirates_id_encrypted', 'emirates_id_hash',
+                                     'checked_in_point', 'checked_out_point',
+                                     'requested_by_phone']) as e),
```

(904 made the dropping reach inside a nested jsonb object, so the key is
dropped wherever it appears.)

**If the answer is no**, the alternative is to stop recording the number at
all and lose the confirmation letter with it, or to write the request row
inside erasure mode, which would withhold the reason and the requester too —
both worse than one key on a list.

---

## CR-18: the erasure reaches the visit record (for session-capture)

**Not a request for a change — a request to keep something in mind.**

`app.erase_client` now clears session-capture's own columns, because a letter
that says the record is gone while the household's door is still on file is a
letter that lies. Migration 105 nulls `session.checked_in_point`,
`checked_out_point`, `observations` and `setup_photo_document_id`, replaces
`amendment_reason` where the row's constraint allows it, nulls
`visit_actuals.access_issues`, and rewrites every `session_event.payload` of
that client's visits to keep only numbers and booleans.

What it deliberately keeps: `pre_rating`, `post_rating`, `telemetry`,
`preflight`, `signal_check` and `signal_quality_score` — measurements that
identify nobody once the record around them is anonymous, and the practice
needs them in aggregate. The letter says so to the household in as many words.

Three things this asks of session-capture:

1. **A new column holding words, a coordinate or free jsonb needs a line in
   that step.** The payload rule is safe by construction — nothing survives
   unless it is a number or a boolean — but a new *column* is not covered by
   anything, and the erasure is enumerated there because the alternative
   (a structural rewrite of the whole row) would take the measurements too.
2. **`setup_photo_document_id` was a live fault**, not tidiness: the foreign
   key to `document` has no `on delete`, so the first erasure of a household
   that had ever had a setup photograph taken would have raised on the
   document delete and rolled the whole erasure back. Any new reference from
   the 300-range to `document` needs the same unlinking.
3. **The immutability trigger's erasure exemption is now load-bearing.**
   `app.session_refuse_update_after_close` stands aside inside
   `app.erasure_active`, and `tests/client/db/erasure_act.test.ts` proves it
   against a completed visit. It was written that way from the start; this is
   the first thing that depends on it.

Nothing is asked of that stream today, and nothing in this pull request edits
its files.

---

## CR-19: one sentence for the spec (for the trunk)

**What.** Add to `docs/SPEC/client-record.md` section 8, as the second half of
step 1, exactly this:

> The visit record is anonymised with it: `session.checked_in_point`,
> `checked_out_point`, `observations` and `setup_photo_document_id` are
> nulled, `amendment_reason` is cleared where the row's own constraint allows
> it, `visit_actuals.access_issues` is nulled, and every `session_event.payload`
> of that client's visits keeps only its numbers and booleans, so a note, a
> timestamp or a coordinate inside one cannot survive. The measurements do
> survive, and deliberately: `pre_rating`, `post_rating`, `telemetry`,
> `preflight`, `signal_check` and `signal_quality_score` identify nobody once
> the record around them is anonymous, the practice uses them in aggregate,
> and the confirmation letter tells the household exactly that.

**Why.** The spec is the source of truth and currently says the erasure
touches the client, the contacts, the locations and the documents. It now
touches four more tables and keeps six columns on purpose, and the promise
made to a household in the letter should be the promise written in the spec.

---

## CR-20: this pull request depends on billing's `billing_document`

**Not a request — a note for the integrator, and a dependency worth naming.**

Billing's pull request 54 adds `billing_document`, linking every rendered
invoice and receipt PDF to its `document` row with a foreign key and no
`on delete`. Migration 105 holds those documents back from the erasure, for
both reasons at once: without it the delete would raise for any household that
ever had an invoice rendered, and deleting a rendered tax document would breach
the five-year financial-record rule.

The reference is guarded with `to_regclass`, so this migration is valid before
54 lands and correct after it, and the test that proves it
(`tests/client/db/erasure_act.test.ts`, "a rendered tax document") skips itself
while the table is absent. **When 54 is on main, that test stops skipping** —
if it then fails, this is the place to look first.

---

## Not asked for, recorded as noticed

**A receipt is not yet a document kind.** `db/migrations/104_erasure_the_act.sql`
holds back `invoice` and `credit_note` from an erasure, and
`domain/client/erasureKeeps.ts` says the same for the screens. A payment
receipt is deliberately absent from both, because billing has not named a kind
for one (`405_billing_receipt.sql`: the number exists, the rendered document is
a later piece of work). When that work lands, its kind belongs in both lists,
and the one that decides is the array inside the migration. This is a note for
whoever writes it, not a request.

**Two tests only failed in the small hours.** `EnrolmentWizard.test.tsx` and
`tests/client/db/identity.test.ts` each built "tomorrow" by adding a day to the
UTC clock and compared it against a rule judged in the practice's own day, so
both passed for twenty hours and failed for four. Fixed in this pull request,
in this stream's own files, and mentioned here only because the same shape of
mistake is easy to make in any stream that has a date bound.
