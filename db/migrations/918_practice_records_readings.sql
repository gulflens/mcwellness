-- 918_practice_records_readings.sql
-- Needs: 010 (tenant), 905 (practice identity columns, and
-- app.guard_tenant_identity)
--
-- The practice runs its brain mapping and its neurofeedback on professional
-- software, on a Windows laptop the practitioner carries as part of the
-- equipment (the operator, 13 September 2026). This app never measured
-- anything — session-capture.md section 3.3 has always described its figures
-- as "manual entry of the vendor software's numbers" — so what stops is a
-- practitioner transcribing three numbers off that software's screen.
--
-- Default false, deliberately. A newly bootstrapped environment must behave
-- the way this practice works rather than inheriting a behaviour nobody wants
-- and having to be corrected later; docs/CHANGE-REQUESTS records what fresh
-- environments have silently lacked before, and this must not join that list.
--
-- Nothing is dropped. The reading columns, the event shapes and the domain
-- functions all stay, and this switch turns them back on.
--
-- Who may write it is already settled: app.guard_tenant_identity (905) is a
-- before-update trigger on the whole row, with no column list, so an owner or
-- an admin may change this column and nobody else can, without another line
-- of policy.
--
-- Trunk range, first half (900-949): it alters `tenant`, a core table, so it
-- must sort after every stream's range and may be built on by none of them
-- (docs/SPEC/OWNERSHIP.md line 109).

alter table tenant
  add column record_readings boolean not null default false;

comment on column public.tenant.record_readings is
  'Whether a visit asks the practitioner to enter signal, artefact and reward figures. '
  'Off since 2026-09-13: the practice uses its own professional software and attaches '
  'its export instead.';

-- rollback:
--   alter table tenant drop column if exists record_readings;
