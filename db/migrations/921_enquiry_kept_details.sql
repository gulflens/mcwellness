-- 921_enquiry_kept_details.sql
--
-- A dismissed enquiry may keep its person, where that person was told it
-- would (the operator's decision of 19 September 2026,
-- docs/superpowers/plans/2026-09-19-enquiries-keep-details.md). This reverses
-- the scrub of 9 September for one case and leaves it standing for every
-- other.
--
-- Why it is not simply switched off. The expo's form says, under its tick,
-- "if not, once we have replied the enquiry keeps nothing personal". Every
-- row lodged to date was lodged under that sentence, and it is kept: such a
-- row is scrubbed on dismissal exactly as before, and the table refuses
-- anything else. What changes is that a row now remembers which wording its
-- person read, and only the second wording — "we keep them so we can follow
-- up with you later" — lets a dismissal keep them.
--
-- Trunk core range (900–949).

-- Which wording the person read, set by the door as the row is lodged and
-- never afterwards. 1 is every form to date, and any form that does not say.
alter table enquiry
  add column notice_version smallint not null default 1
    constraint enquiry_notice_version_known check (notice_version in (1, 2));

-- The second wording's own optional tick: news and offers, including through
-- social platforms. Three-valued like `consent`: a form that never asked
-- sends nothing, and that is "never asked", not a refusal.
alter table enquiry add column marketing_opt_in boolean;

-- The earlier wording had no such tick, so a row under it cannot claim one.
alter table enquiry add constraint enquiry_marketing_asked_only_under_second_notice
  check (notice_version = 2 or marketing_opt_in is null);

-- An actioned row keeps only what its person was promised it would.
--
-- Either it is scrubbed entire, which is what every actioned row was until
-- now; or it is a dismissed row under the second wording that still names its
-- person. A converted row is always scrubbed: from that moment the person is
-- on the client record. The address hash goes either way: it is there for the
-- door's budget and has no follow-up purpose.
alter table enquiry drop constraint enquiry_actioned_is_scrubbed;
alter table enquiry add constraint enquiry_actioned_keeps_only_what_was_promised check (
  status = 'new' or (
    actioned_at is not null and actioned_by is not null and ip_hash is null
    and (
      (
        name is null and whatsapp_e164 is null and email is null and area is null
        and message is null and concern is null and preferred_time is null
        and contact_method is null and consent is null
        and enquiring_for is null and interest is null and marketing_opt_in is null
      )
      or (
        status = 'dismissed' and notice_version = 2
        and name is not null and whatsapp_e164 is not null
      )
    )
  )
);

-- What may happen to a row after it is lodged. A check constraint sees one
-- row at a time and a policy's `with check` sees only the new one, so the
-- rules that compare a row with what it was live here, and hold for every
-- role, the table's owner included.
--
--   * The wording a person read does not change.
--   * A dismissed row stays dismissed, by the same person, for the same
--     reason: it is never brought back to life or turned into a client.
--   * Its details are never edited. They may be erased, whole, and once
--     erased nobody writes a person back onto the row.
create function app.enquiry_guard_actioned() returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  if new.notice_version is distinct from old.notice_version then
    raise exception 'the wording an enquiry was lodged under does not change'
      using errcode = 'check_violation';
  end if;

  if old.status = 'dismissed' then
    if new.status <> 'dismissed'
       or new.dismiss_reason is distinct from old.dismiss_reason
       or new.actioned_at is distinct from old.actioned_at
       or new.actioned_by is distinct from old.actioned_by
       or new.client_id is not null then
      raise exception 'a dismissed enquiry stays dismissed, by the same person, for the same reason'
        using errcode = 'check_violation';
    end if;

    if new.name is not null then
      -- Still carrying a person: then it is carrying exactly who it carried.
      if old.name is null
         or new.name is distinct from old.name
         or new.whatsapp_e164 is distinct from old.whatsapp_e164
         or new.email is distinct from old.email
         or new.area is distinct from old.area
         or new.message is distinct from old.message
         or new.concern is distinct from old.concern
         or new.preferred_time is distinct from old.preferred_time
         or new.contact_method is distinct from old.contact_method
         or new.consent is distinct from old.consent
         or new.enquiring_for is distinct from old.enquiring_for
         or new.interest is distinct from old.interest
         or new.marketing_opt_in is distinct from old.marketing_opt_in then
        raise exception 'a dismissed enquiry''s details are erased whole or left alone, never edited'
          using errcode = 'check_violation';
      end if;
    end if;
  end if;

  return new;
end
$$;

create trigger enquiry_guard_actioned
  before update on enquiry
  for each row execute function app.enquiry_guard_actioned();

comment on column enquiry.notice_version is
  'Which wording the person read when they lodged: 1 promised "keeps nothing personal" once replied; 2 said the details are kept for follow-up. Set by app.lodge_enquiry and never changed.';
comment on column enquiry.marketing_opt_in is
  'The second wording''s optional tick for news and offers, including through social platforms. Null is never asked.';

-- The door, as 919 wrote it, with the wording and its tick. Same signature,
-- same grants. Anything but a plain 2 is the earlier wording, which is the
-- safe reading of a form this database does not know; and the earlier wording
-- had no tick, so under it the tick is never asked whatever the payload says.
create or replace function app.lodge_enquiry(p jsonb) returns uuid
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_tenant uuid;
  v_hour   integer;
  v_recent integer;
  v_budget integer;
  v_notice smallint;
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

  v_notice := case when p->>'notice_version' = '2' then 2 else 1 end;

  insert into public.enquiry (
    tenant_id, source, name, whatsapp_e164, email, area, message,
    concern, preferred_time, contact_method, consent, ip_hash,
    enquiring_for, interest, notice_version, marketing_opt_in
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
    nullif(p->>'interest', ''),
    v_notice,
    -- Asked only under the second wording; there, anything but a plain true
    -- is a tick not given.
    case when v_notice = 2 then coalesce(p->>'marketing_opt_in', '') = 'true' else null end
  )
  returning id into v_id;
  return v_id;
end
$$;
revoke execute on function app.lodge_enquiry(jsonb) from public;
grant execute on function app.lodge_enquiry(jsonb) to app_role;

-- rollback:
--   Only while no dismissed row carries a person; otherwise scrub those rows
--   first, or the old constraint cannot be put back.
--     update enquiry set name = null, whatsapp_e164 = null, email = null,
--       area = null, message = null, concern = null, preferred_time = null,
--       contact_method = null, consent = null, enquiring_for = null,
--       interest = null, marketing_opt_in = null
--      where status = 'dismissed' and name is not null;
--   drop trigger enquiry_guard_actioned on enquiry;
--   drop function app.enquiry_guard_actioned();
--   alter table enquiry drop constraint enquiry_actioned_keeps_only_what_was_promised;
--   alter table enquiry drop constraint enquiry_marketing_asked_only_under_second_notice;
--   alter table enquiry drop column marketing_opt_in;
--   alter table enquiry drop column notice_version;
--   alter table enquiry add constraint enquiry_actioned_is_scrubbed check (
--     status = 'new' or (
--       name is null and whatsapp_e164 is null and email is null and area is null
--       and message is null and concern is null and preferred_time is null
--       and contact_method is null and consent is null and ip_hash is null
--       and enquiring_for is null and interest is null
--       and actioned_at is not null and actioned_by is not null
--     )
--   );
--   and re-run 919_expo_enquiry.sql's `create or replace function app.lodge_enquiry`.
