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
