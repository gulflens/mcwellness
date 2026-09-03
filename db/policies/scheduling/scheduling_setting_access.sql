-- Who may read and who may change the practice's notice period and its
-- unfit-to-attend fee (db/migrations/202_scheduling_setting.sql). Declarative
-- and idempotent: the runner re-applies this file on every migrate.

-- Tenant isolation, as every table in this schema carries it
-- (docs/SPEC/00-data-model.md section 1). Core's own tenant_isolation.sql
-- loops over the tables core created; this is this stream's table, so this
-- stream carries the policy for it.
drop policy if exists tenant_isolation on public.scheduling_setting;
create policy tenant_isolation on public.scheduling_setting for all to app_role
  using (tenant_id = app.current_tenant_id())
  with check (tenant_id = app.current_tenant_id());

-- Reading is open to everyone in the practice, and deliberately: a notice
-- period is a promise made to households, not a secret. The practitioner's
-- own cancel path reads it (app/api/appointments/cancel.ts) as themselves, so
-- narrowing the read would mean a practitioner could call a visit off without
-- the app being able to tell them what it costs.
--
-- Changing it is the owner's and an admin's. It is the same class of decision
-- as the practice's own identity, which app.guard_tenant_identity (migration
-- 905) holds to the same two roles: a coordinator who may take a payment is
-- not thereby someone who may rewrite the cancellation policy the payment was
-- charged under. Restrictive, so it combines with tenant_isolation above
-- rather than replacing it; insert and delete need no policy at all, because
-- 202 grants app_role neither.
drop policy if exists scheduling_setting_write on public.scheduling_setting;
create policy scheduling_setting_write on public.scheduling_setting as restrictive for update to app_role
  using (app.actor_has_role('owner') or app.actor_has_role('admin'));
