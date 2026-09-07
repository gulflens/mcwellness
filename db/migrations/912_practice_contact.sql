-- 912_practice_contact.sql
-- The three facts the practice's own documents put in their footer: a
-- telephone number, an email address and a website
-- (docs/SPEC/billing.md section 5.6, the operator's design of 8 September
-- 2026).
--
-- The design the operator supplied ends every page with two centred grey
-- lines — the legal name and the address on the first, and on the second
-- `P: … E: … W: …`. The practice had nowhere to record any of the three:
-- `tenant` carries the legal name, the licence, the registrations and, since
-- 910, the WhatsApp number a household messages, and none of those is the
-- number printed on an invoice. They are different facts and they may
-- genuinely differ — the WhatsApp number is where a family writes, and the
-- telephone on a document is where an accountant rings.
--
-- All three are nullable, deliberately. A practice that has recorded none
-- gets a footer with one line in it rather than a line of empty labels
-- (`domain/billing/document/render.ts`), and a document renders exactly as it
-- did before this migration.
--
-- **The checks are light on purpose.** They catch a value in the wrong field
-- — an address typed into the website, a name typed into the telephone — and
-- they do not attempt to decide what a valid address or a reachable site is.
-- A constraint that refuses a real telephone number because of a country's
-- own punctuation would stop the practice printing its own footer, which is a
-- worse fault than a typo somebody can see on the page.
--
-- Who may write them is already settled: `app.guard_tenant_identity` (905) is
-- a before-update trigger on the whole row, so an owner or an admin may
-- change these columns and nobody else can, without another line of policy.
--
-- **Not here, deliberately.** No settings screen. `app/admin/settings` and
-- `app/api/practice` are the trunk's, and until a trunk round puts these three
-- fields on that page the way to set them is `scripts/practice-brand.mjs`
-- (docs/RUNBOOK/go-live.md, and item 6 of docs/CHANGE-REQUESTS/billing-09.md).
--
-- Trunk range, first half (900-949): it alters `tenant`, a core table, so it
-- must sort after every stream's range and may be built on by none of them
-- (docs/SPEC/OWNERSHIP.md).
--
-- Needs: 010 (tenant), 905 (app.guard_tenant_identity, which already governs
-- every column of this row).

alter table tenant
  add column contact_phone text,
  add column contact_email text,
  add column website       text;

-- Digits and the punctuation a telephone number is written with, nothing else:
-- deliberately looser than `tenant_whatsapp_number_e164`, because that number
-- is handed to wa.me and has to be machine-readable, while this one is set in
-- type on a page for a person to read and may well be a local landline written
-- the way the practice writes it.
alter table tenant add constraint tenant_contact_phone_is_a_number
  check (contact_phone is null or contact_phone ~ '^[0-9+()\- ]{4,32}$');

-- One at-sign, something either side of it, and no whitespace anywhere. Enough
-- to refuse a sentence, a name or a second address pasted in beside the first.
alter table tenant add constraint tenant_contact_email_is_an_address
  check (contact_email is null or contact_email ~ '^[^[:space:]@]+@[^[:space:]@]+$');

-- A website is a URL a reader can type back in, so it says its scheme.
alter table tenant add constraint tenant_website_is_a_url
  check (website is null or website ~ '^https?://[^[:space:]]+$');

comment on column public.tenant.contact_phone is
  'The telephone number printed in the footer of the practice''s own documents '
  '(docs/SPEC/billing.md section 5.6). Not tenant.whatsapp_number, which is where a '
  'household writes: this is where a reader of an invoice rings. Snapshotted onto '
  'every invoice at numbering time (migration 959).';
comment on column public.tenant.contact_email is
  'The email address printed in the footer of the practice''s own documents. '
  'Snapshotted onto every invoice at numbering time (migration 959).';
comment on column public.tenant.website is
  'The practice''s website, with its scheme, printed in the footer of its own '
  'documents. Snapshotted onto every invoice at numbering time (migration 959).';

-- rollback:
--   alter table tenant drop constraint if exists tenant_website_is_a_url;
--   alter table tenant drop constraint if exists tenant_contact_email_is_an_address;
--   alter table tenant drop constraint if exists tenant_contact_phone_is_a_number;
--   alter table tenant
--     drop column if exists website,
--     drop column if exists contact_email,
--     drop column if exists contact_phone;
