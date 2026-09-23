## Round 64 — the erasure letter tells a colleague the truth (2026-09-23)

The operator, 23 September 2026, 21:31 +04, to the one item round 59 left with
him: "do it". Round 59 (`docs/CHANGE-REQUESTS/trunk-round-59.md`, live since
the thirty-fifth pass earlier that evening) taught erasure to spare a member of
staff whose sign-in is linked as a contact of the erased household, and said in
its own note that the confirmation letter's clause about the portal account now
overstated for such a colleague — and that the wording was approved text and
therefore the operator's to change, not the round's.

### What was wrong

The letter a household receives after an erasure (`docs/CONSENT/erasure-letter/`,
one file per language, version 1.0 approved on 14 September) said "the account
that opened the client portal has been closed". Until migration 968 that was
true of every account an erasure reached. Since 968 it is true of a household's
own account and false of a colleague's, whose link to the record is ended and
whose account is left untouched. A letter that promises a closure it did not
make is the same kind of letter round 52 fixed, from the other side: that one
under-stated what an erasure removed; this one over-stated it.

### What it says now

One clause in each language, version **1.1**, `status: approved`, `approved:
2026-09-23`. The words were put to the operator in the same message that
carried them, and a different wording is one edit before the pass.

English: "and any account that opened your record in the client portal has
been closed — or, where that account belongs to one of the staff of
{{practice_legal_name}}, its link to your record has been ended and the account
itself is untouched."

Arabic: "وأُغلق أي حساب كان يفتح سجلك في بوابة العملاء — أو، إن كان ذلك الحساب
لأحد موظفي {{practice_legal_name}}، فقد أُنهي ارتباطه بسجلك ولم يُمسّ الحساب
نفسه."

Two things the round's review changed before this was merged. **"Any
account"**, not "the account": a household that never had a portal account
still receives this letter, and 1.0 told it that an account had been closed —
the same kind of overstatement this round exists to remove, from the other
side. And **"one of the staff of"** rather than "somebody who works at",
because the practice's Arabic consent texts already call its staff `موظفو
المركز` (`health-data.ar.md`, `notices/your-information.ar.md`), so the letter
now uses the household's own word for them. The practice is named in the clause
on purpose: "the staff of" needs a whose, and the letter already fills
`{{practice_legal_name}}` from the tenant row in its last paragraph. The Arabic
otherwise reuses the letter's own words — `بوابة العملاء`, `سجلك` — rather than
new ones. Both files' `written` and `approved` dates are this round's, because
the words are.

### Why a version and not an edit

The letter is read from the file at the moment it is sent
(`app/api/clients/erasure-letter.ts`) and filed with the version it was cut
from; the office's erasure screen names that version beside the filed letter.
A letter already filed under 1.0 therefore stays 1.0, and says what it said on
the day, and a letter sent from now on carries 1.1. Nothing is re-rendered,
nothing is edited in place, and no household that already received a letter is
sent another: for every erasure production has performed, no colleague was
linked, so 1.0 was true when it was sent.

### Proof

- `domain/client/erasureLetter.test.ts`: one case, on the practice's own
  templates and not a fixture, pinning version 1.1 in both languages and the
  two halves of the clause — "has been closed" and "its link to your record has
  been ended", `أُغلق الحساب` and `أُنهي ارتباطه بسجلك` — with the practice's
  name inside the clause and no placeholder left standing. Watched failing
  first against 1.0 (`expected '1.0' to be '1.1'`), then passing.
- The seed's wording tests (`db/seed/consent-text.test.ts`), which read the real
  consent texts, still pass: the letter is outside their filter and its move
  did not touch them.
- The whole gate, `pnpm verify`, green.

**No migration, no policy file, no route, no schema change, no database work.**

### Files

The templates and their README are the trunk's own (`docs/CONSENT/**`, since
round 52). One file outside the trunk's paths, by round 52's own precedent:
`domain/client/erasureLetter.test.ts` (the client-record stream's) gains one
case and changes nothing else. `docs/CHANGE-REQUESTS/trunk-round-59.md` gains a
pointer at the item this closes.

### Going live

Merged is not live. Nothing to apply by hand: a build and a restart, and the
proof is the new clause read out of `docs/CONSENT/erasure-letter/en.md` inside
the archive, since the letter is a file the server reads and not a chunk the
browser is sent. Until then production sends 1.0, which is true of every
household it could send it to today.
