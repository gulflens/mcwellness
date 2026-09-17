-- 919_expo_enquiry.sql
-- Needs: 916 (enquiry, app.lodge_enquiry)
--
-- A third form. The practice takes a stand at the AccessAbilities Expo in
-- October 2026, and a code on the stand opens `/expo` on the app itself; what
-- that form sends lands here beside the website's enquiries, so the office
-- follows up from one list and turns each into a lead by the one path that
-- exists (docs/superpowers/specs/2026-09-09-enquiries-design.md, amended
-- 2026-09-16; docs/CHANGE-REQUESTS/trunk-round-50.md).
--
-- **Two answers the other forms never ask**, each one word from a fixed list
-- so the office reads a word and never free text: who the visitor is asking
-- about, and which of the practice's two services they are interested in. A
-- new expo row must carry both — an expo enquiry that does not say who or
-- what would not be one — and both go with the rest once actioned, because
-- they describe the person's situation and the row after action keeps only
-- what happened. The website's rows never carry them.
--
-- **A stand's budget.** The door refuses the sixth lodging from one address
-- in ten minutes, which is right for a website and wrong for a stand: a
-- venue's Wi-Fi is one address for everybody on it, and a tablet a member of
-- staff holds out to visitors is one address for every one of them. So the
-- expo's budget is thirty from one address in ten minutes; the website's five
-- stands. Still one lodging at a time per address, still no answer to a
-- refusal.
--
-- **The source is a word the caller sends**, so a script that says `expo`
-- and two list words gets the stand's budget from anywhere (schema and
-- security reviews of this round, 2026-09-16). What bounds it is a ceiling
-- of the practice's own: three hundred lodgings in an hour, from every
-- address together, and the three hundred and first answers null exactly as
-- an exhausted address does. No stand and no website comes near it; a flood
-- does, and stops there, so the office's list of two hundred is never wholly
-- junk. The route's own budget of ten a minute per address stands in front.
--
-- Trunk range, first half (900-949): it alters `enquiry`, a trunk table, and
-- a stream may build on what it adds.

-- 916 declared the source check inline, so it carries the name Postgres gives one.
alter table enquiry drop constraint enquiry_source_check;
alter table enquiry add constraint enquiry_source_check
  check (source in ('website', 'discovery_call', 'expo'));

alter table enquiry
  add column enquiring_for text
    constraint enquiry_enquiring_for_check
    check (enquiring_for in ('self', 'child', 'family_member', 'someone_else')),
  add column interest text
    constraint enquiry_interest_check
    check (interest in ('brain_map', 'neurofeedback', 'both'));

comment on column enquiry.enquiring_for is
  'Who the expo visitor is asking about: themselves, a child, another family member, or someone else, so the office opens the call the right way. Asked only by the expo form; a word from a fixed list, never free text. Null once actioned.';
comment on column enquiry.interest is
  'Which of the practice''s two services the expo visitor asked about: a brain map, neurofeedback, or both, so the call answers the right question. Asked only by the expo form; a word from a fixed list. Null once actioned.';

-- An expo enquiry that does not say who or what would not be one. Scoped to
-- a new row, because an actioned one has been scrubbed of both.
alter table enquiry add constraint enquiry_expo_says_who_and_what check (
  source <> 'expo' or status <> 'new' or (enquiring_for is not null and interest is not null)
);
-- And the website's rows never carry them: the forms there do not ask, so a
-- value that arrives anyway is not an answer to anything.
alter table enquiry add constraint enquiry_only_expo_says_who_and_what check (
  source = 'expo' or (enquiring_for is null and interest is null)
);

-- The scrub now covers the two answers too: 916's constraint, recreated with
-- two more names in its null list and nothing else changed.
alter table enquiry drop constraint enquiry_actioned_is_scrubbed;
alter table enquiry add constraint enquiry_actioned_is_scrubbed check (
  status = 'new' or (
    name is null and whatsapp_e164 is null and email is null and area is null
    and message is null and concern is null and preferred_time is null
    and contact_method is null and consent is null and ip_hash is null
    and enquiring_for is null and interest is null
    and actioned_at is not null and actioned_by is not null
  )
);

-- The door, as 916 wrote it, with the two answers inserted and the budget
-- decided by the form. Same signature, same grants.
create or replace function app.lodge_enquiry(p jsonb) returns uuid
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_tenant uuid;
  v_hour   integer;
  v_recent integer;
  v_budget integer;
  v_id     uuid;
begin
  -- The door clamps every field before it gets here; this makes the table's
  -- own guarantee hold whoever the caller is.
  if p is null or pg_column_size(p) > 16384 then
    return null;
  end if;
  if (select count(*) from public.tenant) <> 1 then
    return null;
  end if;
  select id into v_tenant from public.tenant limit 1;

  -- The practice's own ceiling, whatever the source and whoever the caller:
  -- three hundred lodgings in an hour from every address together.
  select count(*) into v_hour
    from public.enquiry
   where received_at > now() - interval '1 hour';
  if v_hour >= 300 then
    return null;
  end if;

  -- One lodging at a time per address, so a burst cannot all pass the count
  -- before any of them is written.
  perform pg_advisory_xact_lock(hashtext(p->>'ip_hash'));
  select count(*) into v_recent
    from public.enquiry
   where ip_hash = p->>'ip_hash'
     and received_at > now() - interval '10 minutes';
  -- A stand's tablet and a venue's Wi-Fi are one address for many people.
  v_budget := case when p->>'source' = 'expo' then 30 else 5 end;
  if v_recent >= v_budget then
    return null;
  end if;

  insert into public.enquiry (
    tenant_id, source, name, whatsapp_e164, email, area, message,
    concern, preferred_time, contact_method, consent, ip_hash,
    enquiring_for, interest
  ) values (
    v_tenant,
    p->>'source',
    p->>'name',
    p->>'whatsapp_e164',
    nullif(p->>'email', ''),
    nullif(p->>'area', ''),
    nullif(p->>'message', ''),
    nullif(p->>'concern', ''),
    nullif(p->>'preferred_time', ''),
    nullif(p->>'contact_method', ''),
    (p->>'consent')::boolean,
    p->>'ip_hash',
    nullif(p->>'enquiring_for', ''),
    nullif(p->>'interest', '')
  )
  returning id into v_id;
  return v_id;
end
$$;
revoke execute on function app.lodge_enquiry(jsonb) from public;
grant execute on function app.lodge_enquiry(jsonb) to app_role;

-- rollback:
--   -- First: the source check below refuses any row that says 'expo', actioned
--   -- or not. Download the waiting ones (GET /api/enquiries/expo.csv) and then
--   -- `delete from enquiry where source = 'expo'`; an actioned row carries
--   -- nothing personal, a waiting one is a lead the office has in the file.
--   -- Then restore app.lodge_enquiry as 916 wrote it (db/migrations/916_enquiry.sql,
--   -- the `create function app.lodge_enquiry` block: no hourly ceiling, no
--   -- v_budget, no two answers), and:
--   alter table enquiry drop constraint enquiry_only_expo_says_who_and_what;
--   alter table enquiry drop constraint enquiry_expo_says_who_and_what;
--   alter table enquiry drop constraint enquiry_actioned_is_scrubbed;
--   alter table enquiry add constraint enquiry_actioned_is_scrubbed check (
--     status = 'new' or (
--       name is null and whatsapp_e164 is null and email is null and area is null
--       and message is null and concern is null and preferred_time is null
--       and contact_method is null and consent is null and ip_hash is null
--       and actioned_at is not null and actioned_by is not null
--     )
--   );
--   alter table enquiry drop column interest, drop column enquiring_for;
--   alter table enquiry drop constraint enquiry_source_check;
--   alter table enquiry add constraint enquiry_source_check
--     check (source in ('website', 'discovery_call'));
