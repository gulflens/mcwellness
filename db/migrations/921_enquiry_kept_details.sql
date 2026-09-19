-- 921_enquiry_kept_details.sql
-- Needs: 000 (schema app, app_role), 916 (enquiry, app.lodge_enquiry), 919
--   (enquiring_for, interest, the scrub constraint and the door this replaces)
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
-- social platforms. Null is "never asked", which is every row under the first
-- wording. Under the second the question was on the form, so a tick that did
-- not arrive is a tick not given, and the door files false.
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
--
-- What a kept row keeps is how to reach somebody, and not what they wrote
-- (the operator's decision of 19 September 2026, put after the compliance
-- review of this round). `message` and `concern` are free text, and they are
-- where a person writes about themselves or their child; held without limit
-- about somebody who never became a client, they are more than a follow-up
-- needs. The form says "we keep your contact details", and that is what is
-- kept.
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
        and message is null and concern is null
      )
    )
  )
);

-- What may happen to a row after it is lodged. A check constraint sees one
-- row at a time and a policy's `with check` sees only the new one, so the
-- rules that compare a row with what it was live here, and hold for every
-- role, the table's owner included.
--
--   * The wording a person read does not change, nor where the row came from
--     or when.
--   * What the form gave is never edited, at any status: not while the row
--     waits, not in the statement that dismisses it, not afterwards. The one
--     thing that may go while the person stays is what they wrote. A tick
--     slipped in on the way to `dismissed` would pass every check constraint,
--     which is why this is here and not only under "dismissed" below (the
--     security review of this round). It may be erased, whole; and once
--     erased nobody writes a person back onto the row.
--   * An actioned row stays what it became, by the same person, for the same
--     reason and the same client: a dismissal is never brought back to life
--     or turned into a lead, and a lead is never turned into a dismissal with
--     a person written back onto it. Until this migration a constraint made a
--     person on any actioned row impossible for every role; this holds the
--     same for a converted row, which the API role cannot reach and the
--     table's owner can (the schema review of this round).
--
-- `enable always`, like the repository's other guards: without it a session
-- under `session_replication_role = replica` skips the trigger, and "the
-- table's owner included" would not be true.
create function app.enquiry_guard_actioned() returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  if new.notice_version is distinct from old.notice_version
     or new.source is distinct from old.source
     or new.received_at is distinct from old.received_at
     or new.created_at is distinct from old.created_at then
    raise exception 'the wording an enquiry was lodged under, where it came from and when do not change'
      using errcode = 'check_violation';
  end if;

  if new.name is not null then
    -- Still carrying a person: then it is carrying exactly who the form gave.
    -- `old.name is null` is a scrubbed row being written on again.
    if old.name is null
       or new.name is distinct from old.name
       or new.whatsapp_e164 is distinct from old.whatsapp_e164
       or new.email is distinct from old.email
       or new.area is distinct from old.area
       -- The two free-text answers may go while the person stays, which is
       -- what a kept dismissal does; they are never rewritten.
       or (new.message is not null and new.message is distinct from old.message)
       or (new.concern is not null and new.concern is distinct from old.concern)
       or new.preferred_time is distinct from old.preferred_time
       or new.contact_method is distinct from old.contact_method
       or new.consent is distinct from old.consent
       or new.enquiring_for is distinct from old.enquiring_for
       or new.interest is distinct from old.interest
       or new.marketing_opt_in is distinct from old.marketing_opt_in then
      raise exception 'an enquiry''s details are erased whole or left alone, never edited'
        using errcode = 'check_violation';
    end if;
  end if;

  if old.status <> 'new' then
    if new.status is distinct from old.status
       or new.dismiss_reason is distinct from old.dismiss_reason
       or new.actioned_at is distinct from old.actioned_at
       or new.actioned_by is distinct from old.actioned_by
       or new.client_id is distinct from old.client_id then
      raise exception 'an actioned enquiry stays what it became, by the same person, for the same reason'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end
$$;

revoke execute on function app.enquiry_guard_actioned() from public;

create trigger enquiry_guard_actioned
  before update on enquiry
  for each row execute function app.enquiry_guard_actioned();
alter table enquiry enable always trigger enquiry_guard_actioned;

-- Why the table is still outside the audit trigger, now that it can hold a
-- person for years and not only until somebody rings them back. Option B of 9
-- September rested on there being no actor to name at lodging. That still
-- holds, and there is now a second reason that is stronger: the generic
-- trigger copies a row's contents into `audit_log`, which is append-only, so
-- a dismissed person's name and number would live on in the log after "Erase
-- details" had taken them off the row, and erasing would not be erasing. So
-- the route logs who read, dismissed, erased and exported, by id and never by
-- content, and the row stays the only place the person is. The comment keeps
-- the words `tests/db/schema.test.ts` looks for.
comment on table enquiry is
  'unaudited by decision: a public write with no actor (Option B, 2026-09-09); '
  'reads and actions are logged by the route, and the client a conversion creates is audited. '
  'Since migration 921 a dismissed row may keep its person: the audit trigger stays off so that '
  'erasing them from the row erases them, the log holding ids and never contents';

-- 919 said of these two "Null once actioned". A kept dismissal now carries
-- both, so: null once scrubbed.
comment on column enquiry.enquiring_for is
  'Who the expo visitor is asking about: themselves, a child, another family member, or someone else, so the office opens the call the right way. Asked only by the expo form; a word from a fixed list, never free text. Null once scrubbed.';
comment on column enquiry.interest is
  'Which of the practice''s two services the expo visitor asked about: a brain map, neurofeedback, or both, so the call answers the right question. Asked only by the expo form; a word from a fixed list. Null once scrubbed.';

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
--   In ONE transaction, or lodging fails between the columns going and the
--   door coming back. The scrub below cannot be undone: download the kept rows
--   first (the news list, and the Dismissed table) if they are wanted.
--
--   1. Put 919's door back first: re-run its
--      `create or replace function app.lodge_enquiry`, with its revoke and grant.
--   2. Scrub every dismissed row that still names somebody, or the old
--      constraint cannot be put back. The trigger allows it: the person goes
--      whole, and the status, the reason and who dismissed it do not change.
--        update enquiry set name = null, whatsapp_e164 = null, email = null,
--          area = null, message = null, concern = null, preferred_time = null,
--          contact_method = null, consent = null, enquiring_for = null,
--          interest = null, marketing_opt_in = null
--         where status = 'dismissed' and name is not null;
--   3. drop trigger enquiry_guard_actioned on enquiry;
--      drop function app.enquiry_guard_actioned();
--      alter table enquiry drop constraint enquiry_actioned_keeps_only_what_was_promised;
--      alter table enquiry drop constraint enquiry_marketing_asked_only_under_second_notice;
--      alter table enquiry drop column marketing_opt_in;
--      alter table enquiry drop column notice_version;
--      alter table enquiry add constraint enquiry_actioned_is_scrubbed check (
--        status = 'new' or (
--          name is null and whatsapp_e164 is null and email is null and area is null
--          and message is null and concern is null and preferred_time is null
--          and contact_method is null and consent is null and ip_hash is null
--          and enquiring_for is null and interest is null
--          and actioned_at is not null and actioned_by is not null
--        )
--      );
--   4. Re-issue 919's two column comments ("Null once actioned").
--   5. Put `db/policies/enquiry/writers.sql` back as it was before this
--      migration (`using (status = 'new' and …)`) and re-apply it. Left as it
--      is, it is inert — no dismissed row names anybody — but it is wrong.
