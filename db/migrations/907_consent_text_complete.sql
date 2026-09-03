-- 907_consent_text_complete.sql
-- Needs: 060 (document), 902 (the consent wording columns and their three
--        weaker constraints)
--
-- The completeness check migration 902 deferred, now that the fixtures that
-- stood in its way are gone.
--
-- **What it says.** Every `consent_text` document names a purpose, a
-- language, a version and a status. Not some of them: all four. That is what
-- docs/SPEC/client-record.md section 7 asks for — "consent wording is a
-- versioned document per purpose and locale, and recording consent stores the
-- exact document version shown" — and until now the database would accept a
-- wording that named none of them, which is a row that cannot honestly be
-- "the exact version shown" to anybody.
--
-- **Why it waited a round.** 902 shipped the weaker pair instead: no other
-- kind of document may carry any of the four, and within a row they are all
-- present or all absent. The reason was ownership rather than caution. Two
-- fixtures in `tests/scheduling/db` filed a bare `consent_text` row, and a
-- constraint the trunk cannot fix on the other side of the ownership line is
-- a broken stream rather than a stronger schema, so the trunk asked
-- (docs/CHANGE-REQUESTS/trunk-notes.md round 14 item 1) instead of adding it.
-- The scheduling stream made the change and says so in
-- docs/CHANGE-REQUESTS/scheduling-04.md section 10: both fixtures now file a
-- `referral`, which is the honest stand-in for "any document a consent can
-- point at", and the third fixture that pull request added files one too.
--
-- **What was checked before this landed.** `grep -rn "'consent_text'" tests
-- db/seed` — every remaining writer names all four. The seed's wording
-- documents carry purpose, locale, version and status (db/seed/apply.ts);
-- `tests/db/document-guard.test.ts` files its two wordings complete and its
-- one bare row inside a refusal that the guard trigger raises before any
-- check constraint is reached; `tests/db/consent-text.test.ts` and
-- `tests/client/db/consent_documents.test.ts` are complete throughout.
-- Nothing in a stream's path had to change for this.
--
-- **What 902's own constraints now mean beside it.**
-- `document_consent_text_all_or_none` allowed 0 or 4 and is subsumed here for
-- `consent_text` rows; it still stands, because a merged migration is never
-- edited, and it still does work for every other kind — 0 is the only count
-- `document_consent_text_columns_only` allows there anyway, so the two say
-- the same thing from opposite sides. Postgres evaluates a table's check
-- constraints in name order, and `all_or_none` sorts before `is_complete`, so
-- a row that names a purpose and no language still fails with the older
-- constraint's name and `tests/db/consent-text.test.ts` keeps its message.
--
-- 902's `document_consent_text_version_idx` is `nulls not distinct` so that a
-- tenant could hold at most one bare wording "while the completeness
-- constraint is still deferred". It is no longer deferred, so that clause now
-- guards nothing and costs nothing; it stays where it is for the same reason.
--
-- `retired_at` is deliberately outside this: a wording that has never been
-- retired is the current one, and null there is the answer rather than a gap.
-- `document_consent_text_retired_is_a_wording` (902) already refuses a
-- retirement date on a row that is not a complete wording.

alter table document
  add constraint document_consent_text_is_complete check (
    kind <> 'consent_text'
    or num_nonnulls(purpose, locale, version, status) = 4
  );

comment on constraint document_consent_text_is_complete on document is
  'A consent_text document names a purpose, a language, a version and a status. '
  'All four or it is not a wording anybody was shown (migration 907).';

-- rollback:
--   alter table document drop constraint if exists document_consent_text_is_complete;
