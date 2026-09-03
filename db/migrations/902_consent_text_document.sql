-- 902_consent_text_document.sql
-- Needs: 020 (locale), 060 (document, consent_purpose)
--
-- The consent wording as documents (docs/SPEC/client-record.md section 7:
-- "Consent wording is a versioned document per purpose and locale. Recording
-- consent stores the exact document version shown"; docs/CONSENT/README.md).
--
-- `consent.text_document_id` already points at the exact wording a person was
-- shown, but nothing on `document` said which wording a row IS: purpose,
-- language, version and whether the lawyer has approved it lived only in the
-- markdown file's front matter. Four nullable columns close that, and they
-- are nullable because they mean something for one kind of document only —
-- a referral letter has no consent purpose, and a certificate no locale.
--
--   purpose     consent_purpose  which consent this is the wording for
--   locale      locale           'en' or 'ar'; the Arabic text is the text an
--                                Arabic-speaking person signs, not a summary
--   version     text             from the file's own front matter, e.g. 0.1-draft
--   status      consent_text_status  'draft' until the practice's lawyer approves it
--   retired_at  timestamptz      when a newer approved wording replaced this one
--
-- Constraints keep them honest. No other kind of document may carry any of
-- them, so the columns can never drift into meaning something else; within a
-- consent_text row the first four are all present or all absent, so there is
-- no such thing as a wording that names a purpose but not the language it is
-- in; retired_at may only sit on a row that is a complete wording; and a
-- wording belongs to no client, because it is the practice's own words shown
-- to everyone rather than a file about one person (the check on client_id).
-- One unique index then makes (tenant, purpose, locale, version) the identity
-- of a wording: the same version of the same text in the same language exists
-- once, which is what lets a consent row point at "the wording that was shown"
-- and mean it. A new wording is a new version and a new row; a file already
-- used is never edited in place (docs/CONSENT/README.md).
--
-- That index is `nulls not distinct`, so the incomplete rows the note below
-- tolerates cannot multiply either: a tenant may hold at most one bare
-- consent_text row while the completeness constraint is still deferred.
--
-- **Superseding.** A wording is never edited and never deleted, so replacing
-- one is two writes in one transaction, in this order: set retired_at = now()
-- on the version being replaced, then insert the new version with status
-- 'approved'. The order is not a style: document_consent_text_current_idx is
-- an ordinary unique index, checked as each statement finishes, so filing the
-- replacement first collides with the wording still standing. Which version
-- is current is then a fact rather than a convention — at most one approved,
-- unretired wording per tenant, purpose and language — so the transaction
-- that forgets the retirement fails instead of leaving two current wordings.
-- Only the owner or an admin may write any of these five columns, or file a
-- consent_text row at all: that is 903_document_write_guard.sql, because it
-- is a question about who is acting and a check constraint cannot ask one.
-- That migration also makes retirement the single change an immutable
-- document admits, so a wording can be superseded without ever being edited.
-- A consent already given keeps pointing at the retired row, which is the
-- whole point: it records what that person was actually shown.
--
-- Not yet enforced, deliberately: that EVERY consent_text row carries the
-- four. Two scheduling fixtures insert a bare consent_text document today
-- (tests/scheduling/db), with no client id either, and a constraint the trunk
-- cannot fix on the other side of the ownership line is a broken stream, not
-- a stronger schema. Gating that completeness check on `client_id is null`
-- does not help: those fixtures are exactly the rows it would catch. The
-- change request asks scheduling for the one-word fix — those fixtures want
-- kind 'referral', since what they stand in for is any document a consent can
-- point at, not the practice's wording — and the constraint lands the round
-- after. See docs/CHANGE-REQUESTS/trunk-notes.md.
--
-- The index is partial, on kind = 'consent_text', so it constrains nothing
-- else and costs nothing on the documents that make up the rest of the table.
--
-- `document` is already audited (080_audit_triggers.sql) and already carries
-- its grants and row security (090). Columns added to an audited table are
-- audited with it: no table changes classification here, and no grant moves.

create type consent_text_status as enum ('draft', 'approved');

alter table document
  add column purpose    consent_purpose,
  add column locale     locale,
  add column version    text,
  add column status     consent_text_status,
  add column retired_at timestamptz;

alter table document
  add constraint document_consent_text_columns_only check (
    kind = 'consent_text'
    or (purpose is null and locale is null and version is null and status is null
        and retired_at is null)
  ),
  add constraint document_consent_text_all_or_none check (
    num_nonnulls(purpose, locale, version, status) in (0, 4)
  ),
  add constraint document_consent_text_retired_is_a_wording check (
    retired_at is null or num_nonnulls(purpose, locale, version, status) = 4
  ),
  add constraint document_consent_text_has_no_client check (
    kind <> 'consent_text' or client_id is null
  );

create unique index document_consent_text_version_idx
  on document (tenant_id, purpose, locale, version)
  nulls not distinct
  where kind = 'consent_text';

-- One current wording per purpose and language: approved, not yet retired.
-- Drafts are outside it, so the practice may hold several drafts of the next
-- version at once, and retired versions are outside it, so history keeps.
create unique index document_consent_text_current_idx
  on document (tenant_id, purpose, locale)
  where kind = 'consent_text' and status = 'approved' and retired_at is null;

comment on column document.purpose is
  'For kind = consent_text only: which consent this document is the wording for.';
comment on column document.locale is
  'For kind = consent_text only: the language of this wording. One row per language.';
comment on column document.version is
  'For kind = consent_text only: the version in the wording file''s own front matter. Never edited in place.';
comment on column document.status is
  'For kind = consent_text only: draft until the practice''s lawyer approves that version.';
comment on column document.retired_at is
  'For kind = consent_text only: when a newer approved version replaced this one. Null is the current wording; a consent given under it keeps pointing here.';

-- rollback:
--   drop index if exists document_consent_text_current_idx;
--   drop index if exists document_consent_text_version_idx;
--   alter table document drop constraint if exists document_consent_text_has_no_client;
--   alter table document drop constraint if exists document_consent_text_retired_is_a_wording;
--   alter table document drop constraint if exists document_consent_text_all_or_none;
--   alter table document drop constraint if exists document_consent_text_columns_only;
--   alter table document drop column if exists retired_at;
--   alter table document drop column if exists status;
--   alter table document drop column if exists version;
--   alter table document drop column if exists locale;
--   alter table document drop column if exists purpose;
--   drop type if exists consent_text_status;
