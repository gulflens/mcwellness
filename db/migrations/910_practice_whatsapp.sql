-- 910_practice_whatsapp.sql
-- The number a household messages the practice on
-- (docs/SPEC/client-portal.md section 6.4, applied by the portal piece under
-- docs/CHANGE-REQUESTS/client-portal-05.md item 5).
--
-- The portal does not book a visit and does not pretend to: asking for one is
-- a sentence and a WhatsApp button, which is how the practice already works
-- (docs/SEAMS.md — WhatsApp is a hand-off, not an integration; nothing leaves
-- this server). That button needs a number to open, and the practice's own
-- number is a fact about the practice, so it lives on the tenant row beside
-- its name and its licence.
--
-- It is nullable, deliberately. A practice that has not recorded one has not
-- recorded one, and the portal says "ask the practice" without a button
-- rather than opening WhatsApp on nothing.
--
-- Who may write it is already settled: app.guard_tenant_identity (905) is a
-- before-update trigger on the whole row, so an owner or an admin may change
-- this column and nobody else can, without another line of policy.
--
-- Trunk range, first half (900-949): it alters `tenant`, a core table, so it
-- must sort after every stream's range and may be built on by none of them
-- (docs/SPEC/OWNERSHIP.md).
--
-- Needs: 010 (tenant), 905 (app.guard_tenant_identity, which already governs
-- every column of this row).

alter table tenant add column whatsapp_number text;

-- E.164, the same shape app_user.phone and contact.phone already hold: a
-- plus, a country code that does not begin with zero, and seven to fifteen
-- digits in all. A number the portal will hand to wa.me has to be a number.
alter table tenant add constraint tenant_whatsapp_number_e164
  check (whatsapp_number is null or whatsapp_number ~ '^\+[1-9][0-9]{6,14}$');

comment on column public.tenant.whatsapp_number is
  'The practice''s own WhatsApp number, in E.164. Shown on the portal as the way to '
  'ask for a visit (docs/SPEC/client-portal.md section 3.1); the message is composed '
  'in the browser and opened in the person''s own WhatsApp, so nothing leaves this '
  'server (docs/SEAMS.md).';

-- rollback:
--   alter table tenant drop constraint if exists tenant_whatsapp_number_e164;
--   alter table tenant drop column if exists whatsapp_number;
