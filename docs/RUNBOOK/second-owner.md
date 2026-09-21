# Runbook — making the second owner

Ownership is granted by an audited data step and never by a screen. This file is
that step. It was written for the production pass of trunk round 58
(`docs/CHANGE-REQUESTS/trunk-round-58.md`), and it is the file to come back to
if the practice ever names a third owner.

**It names nobody.** The three ids it needs are read out of the live database at
the pass and are never written into this repository, which is public.

---

## 1. Why there is no screen for it

The design the operator settled on 21 September 2026
(`docs/superpowers/specs/2026-09-21-team-profiles-and-access-design.md`
section 3) is that an owner's access cannot be taken away by anybody — not by an
admin, not by the other owner, and not by themselves. The database enforces that
with two triggers that bind every caller and carry no bypass setting, so the
only act on an ownership row the platform admits at all is the **insert** that
creates one. A screen that could perform that insert would be a screen that can
hand out full access to the practice, and that is not a button anybody should
find while looking for something else.

So the insert is left where the practice's other irreversible acts are left: a
statement run by hand, under the founder's own id, with a reason, recorded
afterwards in `docs/PRODUCTION.md` as part of the pass. `owner_grants_owner` in
`db/policies/core/role_guard.sql` is the one policy of that round with nothing
beneath it, and the migration says so: ownership is granted by an insert, from
here.

## 2. Who decides, and what is recorded

The operator decides who becomes an owner, and says so in his own words. Nothing
in this file is run on anybody else's say-so, and nothing in it is run
"while we are in there".

Three things are recorded when it has been done: the section in
`docs/PRODUCTION.md` for that pass, naming the date and the operator's word; the
row itself, which is the practice's own record of who may do what; and the audit
trail, which will hold one `insert` on `user_role` under the founder's id
carrying the reason typed below. The trail is the part nobody can edit
afterwards, which is why the reason is worth writing as a sentence rather than a
word.

## 3. Before you start: read the three ids from the live database

Both queries are read-only. Run them on **production**, against the practice's
own project and not staging, and read the answers rather than assuming them.

**The practice, and the founder.** Today this answers exactly one row: the
platform holds one practice and one owner.

```sql
select t.id            as tenant_id,
       u.id            as founder_user_id,
       u.display_name,
       u.status
  from public.tenant t
  join public.user_role r on r.tenant_id = t.id and r.role = 'owner'
  join public.app_user  u on u.id = r.user_id and u.tenant_id = t.id
 order by u.display_name;
```

Two rows means a second owner already holds it and this step has been done
before; stop and find out when. No rows at all means something is wrong with the
practice's own identity, and nothing below is the fix.

**The person who is to become the second owner.** Find them by a fragment of the
name the operator gives, never by guessing:

```sql
select u.id,
       u.display_name,
       u.status,
       u.auth_id is not null as has_a_sign_in,
       (select array_agg(r.role::text order by r.role)
          from public.user_role r
         where r.user_id = u.id and r.tenant_id = u.tenant_id) as roles
  from public.app_user u
 where u.tenant_id = :tenant_id
   and u.display_name ilike :name_fragment      -- e.g. '%<part of the name>%'
 order by u.display_name;
```

Read four things off that row before going on.

1. **Exactly one row came back.** If two did, narrow the fragment. Never pick
   one of two.
2. **The roles are the ones the operator expects.** They keep every one of them:
   ownership is granted beside what a person already holds, and their existing
   Finance or Lead practitioner row is not replaced or removed.
3. **`status` is `active`.** An owner cannot afterwards be suspended or
   archived by anybody, so a suspended row must be reactivated *before* this
   step and not after it.
4. **Whether they have a sign-in.** They do not need one yet — an owner's
   `auth_id` may be linked for the first time at any point, because that is how
   an owner arrives — but once it is linked it can never be moved. Section 7 is
   what that means for getting back in.

## 4. The rehearsal

Run this first, on production itself. It is the whole step, and its last
statement raises, which rolls the block back: the rehearsal therefore runs
against the real rows, the real foreign keys and the real triggers, and keeps
nothing. That is the method the removal of the three test clients used on
19 September 2026 (`docs/PRODUCTION.md`), and the same caution applies — it is
safe for the trail only because `audit_log.id` is handed out by the chain's own
anchor inside the transaction and not by a sequence, so the rollback burns no
ids.

Replace the three placeholders with the ids read in section 3, keeping the
quotes, and write the reason as a sentence naming the date and the operator's
word.

```sql
do $$
declare
  v_tenant       uuid   := ':tenant_id';
  v_founder      uuid   := ':founder_user_id';
  v_second_owner uuid   := ':second_owner_user_id';
  v_reason       text   := 'The second owner, on the operator''s word of '
                           '<date>: ownership is granted by an audited data '
                           'step and never by a screen '
                           '(docs/RUNBOOK/second-owner.md).';
  v_roles        text[];
begin
  -- The audit context, in the shape every audited write on this platform
  -- carries; `app.audit_row` (080_audit_triggers.sql) reads the actor, the
  -- reason and the request id straight off these settings. `true` makes each
  -- one local to this transaction, so nothing leaks into the next statement on
  -- this connection.
  perform set_config('app.tenant_id',  v_tenant::text,          true);
  perform set_config('app.actor_id',   v_founder::text,         true);
  perform set_config('app.actor_roles', 'owner',                true);
  perform set_config('app.request_id', gen_random_uuid()::text, true);
  perform set_config('app.reason',     v_reason,                true);

  -- Three things read back rather than assumed. Each one is a reason to stop,
  -- and stopping here costs nothing.
  if not exists (select 1 from public.user_role r
                  where r.user_id = v_founder and r.tenant_id = v_tenant
                    and r.role = 'owner') then
    raise exception 'the id given as the founder does not hold ownership in this practice';
  end if;
  if not exists (select 1 from public.app_user u
                  where u.id = v_second_owner and u.tenant_id = v_tenant
                    and u.status = 'active') then
    raise exception 'the person named is not an active member of this practice';
  end if;
  if exists (select 1 from public.user_role r
              where r.user_id = v_second_owner and r.tenant_id = v_tenant
                and r.role = 'owner') then
    raise exception 'that person already holds ownership; nothing to do';
  end if;

  insert into public.user_role (tenant_id, user_id, role, granted_by, created_by)
  values (v_tenant, v_second_owner, 'owner', v_founder, v_founder);

  select array_agg(r.role::text order by r.role)
    into v_roles
    from public.user_role r
   where r.user_id = v_second_owner and r.tenant_id = v_tenant;
  raise notice 'roles now held: %', v_roles;

  -- REHEARSAL ONLY. An exception rolls the whole block back, so the notice
  -- above is read and nothing is kept. Remove this one statement to perform it.
  raise exception 'rehearsal: nothing is kept';
end
$$;
```

What a good rehearsal looks like: the notice lists `owner` beside every role the
person already held, and then the `rehearsal: nothing is kept` exception. If any
other exception comes back, read it — each of the three above says exactly what
it found — and do not remove the raise until it is understood.

## 5. The act

The act is the block above with **the last `raise exception` removed** and
nothing else changed. Not a different block, not a bare `insert`: the same
statements, the same guards, the same reason, so that what commits is what was
rehearsed.

Run it once. It commits on its own, because a `do` block outside an explicit
transaction is its own transaction.

## 6. The checks afterwards

Four, in this order.

**The person holds ownership beside what they had.** Re-run the second query of
section 3. `roles` names `owner` and every role it named before; nothing has
been replaced.

**The trail is intact and says who did it.**

```sql
select app.verify_audit_chain();
```

It answers **null**, which means the chain verifies from the first row to the
anchor. Then read the act itself:

```sql
select occurred_at, actor_id, actor_type, action, entity_type, reason
  from public.audit_log
 where entity_type = 'user_role'
 order by id desc
 limit 5;
```

The newest row is one `insert` on `user_role`, `actor_type` `user`, `actor_id`
the founder's, carrying the reason typed into the block. One row, not two: the
rehearsal kept nothing.

**Both owners read as locked on the screen.** Sign in as the founder, open
Settings › Team, and open each owner's profile in turn. Each shows **"Owner.
Full access. Cannot be changed."** with the four switches greyed beneath it and
no sign-in section at all. If only one of the two reads that way, the row was
written for one of you and not the other, and section 3's first query is where to
look.

**The other owner can still get in.** Have them sign in, if they have a sign-in.
If they do not yet, this is the moment to link one — see section 7 for why the
moment matters.

## 7. What this cannot be undone by

From the moment the row commits, **it is locked for every caller**. Not by an
admin, not by the other owner, not by the person themselves, not by a route, not
by anybody at a `psql` prompt: `guard_owner_role` (migration
`923_owner_lock_and_role_revoke.sql`) refuses every update and delete of a row
whose role is `owner`, it is `enable always` so a replication session cannot
switch it off, and it carries no bypass setting, because a setting the API role
could set is not a lock. The owner's `app_user` row cannot be deleted either,
because `user_role.user_id` references it and the ownership row will not go.

**A mistake here is corrected by a migration**, which means a pull request, a
schema review and a pass of its own — not by an evening's tidying. So read the
id twice. Read it in section 3's output, read it again in the block before the
raise comes out, and if the two readings are of different rows, stop.

## 8. Sign-in recovery for an owner

Two of this round's decisions narrow how an owner gets back in, and both are
worth knowing before the row is written rather than after.

**An owner's linked sign-in can no longer be moved by anybody.** Once
`app_user.auth_id` holds a value on a row that holds ownership, no update
changes it — the same trigger, the same reasons. A sign-in may still be linked
for the **first** time, null to a value, because that is how an owner arrives.

**So the way back in for a locked-out owner is the other owner.** One owner may
mint a temporary password for the other from Settings › Team, and that is
precisely why that one act was kept with the owners when everything else on the
screen was taken from admins: it revokes nothing, it changes no row, and the
trail records who did it as `password_reset`. With two owners there is always
somebody to ask, which is the whole argument for having two.

**If the sign-in account itself were deleted** at the sign-in service, the row
would need relinking to a new account, and relinking an owner's row is a
migration's act. `956_bootstrap_practice.sql` raises a hint that reads "if the
owner cannot sign in, relink the practice's existing `app_user` row to the new
Auth user id". **That sentence no longer applies to an owner.** It is a hint in
an exception rather than a code path, and it was written when the practice had
one owner and no lock; it is accurate for any other member of staff.
