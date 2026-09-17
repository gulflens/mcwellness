-- 920_practice_review_url.sql
-- The practice's public review page, opened from the household's portal home
-- after a brain map or a finished package (docs/SPEC/client-portal.md
-- section 3.1 as amended 2026-09-17; the owner's decision of 16 September
-- 2026; docs/superpowers/specs/2026-09-17-review-prompt-design.md).
--
-- One nullable column, the shape of 912's `website`. Null means the practice
-- has recorded no review page, and the portal then computes nothing and shows
-- nothing: clearing this column is how the feature is switched off, which is
-- why `PATCH /api/practice` writes it even when the value sent is null, unlike
-- the three footer fields beside it.
--
-- Opening the page is a hand-off in the sending seam's sense (docs/SEAMS.md):
-- nothing leaves this server, the household's own browser opens the practice's
-- public page on a deliberate press, and the anchor carries no referrer. The
-- vendor row is in docs/COMPLIANCE/approved-vendors.md.
--
-- **The check is light on purpose**, as 912's is: it refuses a sentence or an
-- address with no scheme, and does not attempt to decide what a reachable page
-- is. Who may write it is already settled: `app.guard_tenant_identity` (905)
-- is a before-update trigger on the whole row.
--
-- Trunk range, first half (900-949): it alters `tenant`, a core table, so it
-- must sort after every stream's range and may be built on by none of them
-- (docs/SPEC/OWNERSHIP.md).
--
-- Needs: 010 (tenant), 905 (app.guard_tenant_identity, which already governs
-- every column of this row).

alter table tenant add column review_url text;

-- A page a household's browser can open, so it says its scheme.
alter table tenant add constraint tenant_review_url_is_a_url
  check (review_url is null or review_url ~ '^https?://[^[:space:]]+$');

comment on column public.tenant.review_url is
  'The practice''s public review page, opened in a new tab from the household '
  'portal''s home after a brain map or a finished package (docs/SPEC/client-portal.md '
  'section 3.1, amended 2026-09-17). Nothing is sent to it from this server. Null '
  'switches the review line off for every household.';

-- rollback:
--   alter table tenant drop constraint if exists tenant_review_url_is_a_url;
--   alter table tenant drop column if exists review_url;
