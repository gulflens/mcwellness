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
--   purpose  consent_purpose  which consent this is the wording for
--   locale   locale           'en' or 'ar'; the Arabic text is the text an
--                             Arabic-speaking person signs, not a summary
--   version  text             from the file's own front matter, e.g. 0.1-draft
--   status   consent_text_status  'draft' until the practice's lawyer approves it
--
-- Two constraints keep them honest. No other kind of document may carry any of
-- the four, so the columns can never drift into meaning something else; and
-- within a consent_text row they are all present or all absent, so there is no
-- such thing as a wording that names a purpose but not the language it is in.
-- One unique index then makes (tenant, purpose, locale, version) the identity
-- of a wording: the same version of the same text in the same language exists
-- once, which is what lets a consent row point at "the wording that was shown"
-- and mean it. A new wording is a new version and a new row; a file already
-- used is never edited in place (docs/CONSENT/README.md).
--
-- Not yet enforced, deliberately: that EVERY consent_text row carries the
-- four. Two scheduling fixtures insert a bare consent_text document today
-- (tests/scheduling/db), and a constraint the trunk cannot fix on the other
-- side of the ownership line is a broken stream, not a stronger schema. The
-- follow-up is docs/CHANGE-REQUESTS/trunk-notes.md.
--
-- The index is partial, on kind = 'consent_text', so it constrains nothing
-- else and costs nothing on the documents that make up the rest of the table.
--
-- `document` is already audited (080_audit_triggers.sql) and already carries
-- its grants and row security (090). Columns added to an audited table are
-- audited with it: no table changes classification here, and no grant moves.

create type consent_text_status as enum ('draft', 'approved');

alter table document
  add column purpose consent_purpose,
  add column locale  locale,
  add column version text,
  add column status  consent_text_status;

alter table document
  add constraint document_consent_text_columns_only check (
    kind = 'consent_text'
    or (purpose is null and locale is null and version is null and status is null)
  ),
  add constraint document_consent_text_all_or_none check (
    num_nonnulls(purpose, locale, version, status) in (0, 4)
  );

create unique index document_consent_text_version_idx
  on document (tenant_id, purpose, locale, version)
  where kind = 'consent_text';

comment on column document.purpose is
  'For kind = consent_text only: which consent this document is the wording for.';
comment on column document.locale is
  'For kind = consent_text only: the language of this wording. One row per language.';
comment on column document.version is
  'For kind = consent_text only: the version in the wording file''s own front matter. Never edited in place.';
comment on column document.status is
  'For kind = consent_text only: draft until the practice''s lawyer approves that version.';

-- rollback:
--   drop index if exists document_consent_text_version_idx;
--   alter table document drop constraint if exists document_consent_text_all_or_none;
--   alter table document drop constraint if exists document_consent_text_columns_only;
--   alter table document drop column if exists status;
--   alter table document drop column if exists version;
--   alter table document drop column if exists locale;
--   alter table document drop column if exists purpose;
--   drop type if exists consent_text_status;
