# Audit Log & Change History — Spec

*Who did what, to what, when, and why. Non-negotiable in a system that holds families' data.*

---

## 1. Three different things, often confused

Build all three. They answer different questions and they have different shapes.

| | Question it answers | Shape | Retention |
|---|---|---|---|
| **Audit log** | "Who accessed or changed client data?" | Append-only, immutable, one row per action | 5 years |
| **Version history** | "What did this record look like before?" | Full snapshots per version of an entity | Same as the entity |
| **Domain events** | "What happened in the business?" | Semantic events feeding analytics and workflow | 5 years, aggregated after |

The audit log is a compliance artefact — you write it, you almost never read it, and the day you do read it matters enormously. Version history is an operational tool. Domain events drive dashboards.

**The audit log is not an undo mechanism.** Reverting a change is a function of version history. Conflating them produces an audit log that people are tempted to mutate, which destroys the only property that makes it valuable.

---

## 2. What the business commits to

McWellness is a wellness business (founder's determination, 2026-09-02), so no health regulator inspects this log. The commitments come from the UAE personal-data law and from the trust the product asks of families:

- Client data lives with the rest of the record, encrypted, under the same access controls, in the Supabase project the owner designates, and is kept **5 years** after the last activity.
- A family may ask who has seen their child's record, and the answer must be complete and fast; unauthorised use must be demonstrable, not just forbidden.
- Consent and access control are auditable.

**The consequence most systems get wrong: you must log reads, not just writes.** "Who opened a child's file on 14 October?" is the classic question, and a write-only audit log cannot answer it. A curious coordinator looking up a neighbour's child leaves no trace unless you log the view.

---

## 3. Schema

```sql
create table audit_log (
  id              bigserial primary key,
  occurred_at     timestamptz not null default now(),

  -- actor
  actor_id        uuid,                    -- null for system actions
  actor_type      text not null,           -- user | system | integration | anonymous
  actor_role      text,                    -- role at time of action, denormalised
  on_behalf_of    uuid,                    -- support impersonation

  -- action
  action          text not null,           -- read | create | update | delete
                                           -- sign | export | login | permission_change
  entity_type     text not null,           -- client | session | report | invoice
  entity_id       uuid not null,
  client_id       uuid,                    -- the client this touches, if any

  -- change
  changed_fields  text[],                  -- column names only
  old_values      jsonb,                   -- null for reads
  new_values      jsonb,

  -- context
  reason          text,                    -- required for sensitive actions
  request_id      uuid,                    -- ties a whole request together
  session_id      uuid,
  ip_address      inet,
  user_agent      text,
  app_version     text,

  -- integrity
  prev_hash       bytea,
  row_hash        bytea not null
);

create index on audit_log (client_id, occurred_at desc);
create index on audit_log (actor_id, occurred_at desc);
create index on audit_log (entity_type, entity_id, occurred_at desc);
create index on audit_log (occurred_at desc);
```

`client_id` denormalised onto every row is the single most useful index you'll have. "Show me everything that has ever touched this client" must be one fast query, not a join across fourteen tables.

---

## 4. Immutability

An audit log the application can edit is not an audit log.

```sql
-- the app role can insert and read. Nothing else.
revoke update, delete, truncate on audit_log from app_role;
grant insert, select on audit_log to app_role;

-- belt and braces at the row level
create rule audit_no_update as on update to audit_log do instead nothing;
create rule audit_no_delete as on delete to audit_log do instead nothing;
```

**Hash chaining makes tampering detectable** even by someone with database superuser access:

```
row_hash = sha256(prev_hash || id || occurred_at || actor_id || action
                  || entity_type || entity_id || old_values || new_values)
```

Anyone deleting or altering a row breaks the chain from that point forward. A nightly verification job walks the chain and alerts on a break. Publish the daily terminal hash somewhere outside the database — an S3 object with Object Lock, or an email to yourself — and you have a timestamped anchor.

This is ten lines of code and it converts "we have logs" into "we can prove the logs are intact." Worth it.

---

## 5. How to capture it — two layers, both needed

### Layer 1: Postgres triggers (writes)

Cannot be bypassed. Catches the migration script, the manual `psql` fix, the ORM path someone forgot to instrument.

```sql
create or replace function audit_trigger() returns trigger as $$
declare
  v_actor uuid := nullif(current_setting('app.actor_id', true), '')::uuid;
  v_reason text := nullif(current_setting('app.reason', true), '');
  v_request uuid := nullif(current_setting('app.request_id', true), '')::uuid;
begin
  insert into audit_log (
    actor_id, actor_type, action, entity_type, entity_id, client_id,
    changed_fields, old_values, new_values, reason, request_id, row_hash
  ) values (
    coalesce(v_actor, auth.uid()),
    case when v_actor is null then 'system' else 'user' end,
    lower(tg_op),
    tg_table_name,
    coalesce(new.id, old.id),
    coalesce(new.client_id, old.client_id),
    case when tg_op = 'UPDATE' then akeys(hstore(new) - hstore(old)) end,
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end,
    v_reason, v_request,
    compute_row_hash(...)
  );
  return coalesce(new, old);
end $$ language plpgsql security definer;
```

**The session-context pattern is what makes this work.** With a pooled connection the database sees one user for everyone, so every request must stamp its identity before touching data:

```ts
await db.query(`
  select set_config('app.actor_id',   $1, true),
         set_config('app.request_id', $2, true),
         set_config('app.reason',     $3, true)
`, [actorId, requestId, reason ?? '']);
```

`true` makes it transaction-local, so it can't leak between requests sharing a connection. Put this in one middleware. A request that fails to set it should be rejected, not logged as anonymous.

Supabase makes this easier — `auth.uid()` is available inside Postgres, so the trigger has a fallback even if middleware is missed.

### Layer 2: Application layer (reads, intent, semantics)

Triggers can't see a `SELECT`, and they can't know *why*. The application logs:

- **Reads of personal data** — every client record, session, report or document opened. Log the access, not the payload.
- **Semantic actions** the schema doesn't express: report signed, protocol changed, refund issued, entitlement adjusted, consent withdrawn, data exported.
- **Reasons** for anything sensitive.

Read logging is cheap if you write it asynchronously to a queue rather than inline. It should never slow a page load.

---

## 6. The actions that deserve extra ceremony

Some changes should be hard, deliberate, and loudly logged. For each, require a typed reason before the action commits:

| Action | Why it matters |
|---|---|
| Signing a report | Attestation by the lead practitioner |
| Amending a signed report | Must create a new version, never edit — see §7 |
| Changing a training protocol | A practice decision, must be attributable and reversible |
| Issuing a refund or credit note | Financial control |
| Adjusting an entitlement balance | Direct revenue impact |
| Changing a user's role or credentials | Privilege escalation path |
| Exporting client data in bulk | Exfiltration path |
| Break-glass access to a record | See below |
| Deleting anything | Should be near-impossible |

**Break-glass.** Occasionally someone needs a record they're not normally authorised for — an emergency, a support escalation. Don't block it; make it expensive. Full-screen warning, mandatory reason, immediate notification to you, and a permanent highlighted entry in the log. Used correctly it's fine. Used casually, you'll see it in the log the same day.

---

## 7. Records are append-only

This is a design rule, not just an audit rule.

A signed report is immutable. A correction issues **version 2** with a visible amendment note explaining what changed and why, and version 1 remains retrievable for the retention period. Same for session records once the visit is closed, and for issued invoices — which get credit notes, never edits.

The regulatory logic: a record that can be silently changed after the fact has no evidentiary value. The practical logic: a parent, a school or a coach may be holding version 1, and you need to know exactly what they're holding.

```ts
type Versioned<T> = {
  entityId: string
  version: number
  supersedes: number | null
  supersededBy: number | null
  amendmentReason: string | null   // required when version > 1
  signedBy: string | null
  signedAt: Date | null
  payload: T                       // full snapshot, not a diff
}
```

Store full snapshots, not diffs. Storage is cheap; reconstructing a document from a diff chain in a dispute four years from now is not.

---

## 8. What the log must never contain

The audit log holds personal data. It lives with the rest of the client data, encrypted, with the same access controls — and it needs its own discipline about what goes in it.

- **No passwords, tokens, API keys or card numbers.** Redact by field name at write time, with a denylist.
- **No raw free text in `new_values`** for large text fields. Log that the field changed and its length; the content lives in version history where it belongs.
- **Never log personal data to your application logs, error tracker, or APM.** Sentry and equivalents are not in the vendor register. This is one of the top three ways client data leaks by accident — the other two are analytics SDKs and AI API calls containing client text.

Add a hook that fails the build on any `console.log`, `logger.info` or error-reporter call whose argument can contain a client entity. Enforce it mechanically.

---

## 9. The UI — your "overview of every change"

Four views. Build the first two in Phase 1.

**1. Record timeline.** On every client, session, report and invoice: a chronological feed of everything that touched it. Plain language, not JSON. *"The lead practitioner changed the training protocol from SMR-C3 to Alpha-Theta — reason: poor tolerance reported at session 9."*

**2. Activity feed.** A global reverse-chronological stream, filterable by actor, entity type, action, date range, and client. This is your daily glance.

**3. Sensitive-action digest.** A weekly email listing only the §6 actions. Solo, this is how you stay across your own system without reading logs. When you have staff, it's how you supervise.

**4. Access report per client.** "Everyone who has viewed this record, ever." Generate on demand. You will need this the first time a client asks who has seen their child's data, and having it ready in one click is a genuinely good moment.

**Rendering rule:** the log stores structured data; the UI renders it into sentences using a message catalogue keyed by `(entity_type, action)`. Never show a user a raw JSON diff. And translate the catalogue for Arabic alongside everything else.

---

## 10. Alerts worth having

Cheap queries over the log, run nightly:

- Bulk read — one actor accessing more than N client records in an hour
- Export of more than N records at once
- Access to a client the actor has no scheduled appointment with
- Access outside working hours by a field practitioner
- Repeated failed authorisation on the same record
- Any break-glass event — immediate, not nightly
- Hash chain verification failure — immediate, treat as an incident

Start with the last two. The others become useful when you have staff.

---

## 11. Volume and cost

A solo practice at 25 sessions a week generates roughly 300–600 audit rows a day, most of them reads. That's a few million rows a year — trivial for Postgres.

**Partition by month** from day one. Five years of retention is 60 partitions, and dropping a partition older than five years is the retention mechanism: no row-by-row deletion, no exception to immutability.

```sql
create table audit_log (...) partition by range (occurred_at);
```

If an archive beyond the retention period is ever wanted (it is not required), an object store with a retention lock is the place; the default is to drop.

---

## 12. Build order

**Phase 1** — schema with partitioning, triggers on every table holding personal data, session-context middleware, read logging on client and report access, hash chaining with nightly verification, record timeline UI, immutability grants.

**Phase 2** — activity feed with filters, reason prompts on sensitive actions, break-glass workflow, weekly digest, per-client access report.

**Phase 3** — anomaly alerting, the retention job that drops partitions older than 5 years, exportable access reports for a family's request.

---

## 13. The test that proves it works

Before you call this done, run this drill:

> Pick a client at random. In under two minutes, produce a complete list of every person who has viewed or modified any part of their record, what they changed, and why — and demonstrate that the list cannot have been altered.

If you can do that, you are ready for a family's question. If you can't, the gap you find is the thing to fix.

---

## 14. Implementation notes (PR 2, 2026-09-02)

Migrations `070_audit_log.sql` and `080_audit_triggers.sql` implement sections 3, 4, 5 (layer 1), 8 and 11. Where the sketches above are not valid Postgres 17 as written, or a stronger form was available, the SQL departs as follows:

1. `id` is a bigint assigned as `app.audit_chain.last_id + 1` inside the chain trigger, under the anchor row's lock, not a `bigserial`: a sequence value taken before the lock lets two writers link in the opposite order to their ids, which a verifier walking by id would report as a false break. Ids are gapless, so a removed row shows as a gap.
2. The hash is computed by a `before insert` trigger on `audit_log` itself (`app.audit_chain_link()`), so every insert path is chained, including the application's own read logging. Nobody can insert an unchained row. The canonical byte encoding is documented in `070_audit_log.sql`.
3. `changed_fields` is a sorted jsonb diff, not hstore, so the trigger has no dependency on which schema hstore lives in.
4. `action` for trigger rows is `insert`, `update` or `delete` (`lower(tg_op)`), not `create`.
5. `client_id` is resolved by `app.audit_client_id()`: the spec's `coalesce(new.client_id, old.client_id)` fails on tables without that column.
6. Immutability is triggers that raise (`update`, `delete`, and a statement-level `truncate` per partition), all `enable always`, plus revoked grants. A rule would silently swallow the statement.
7. `app.verify_audit_chain(from_id)` returns null when intact or the first failing id, and checks the anchor so a removed tail is caught.
8. The hash covers exactly the nine columns section 4 names. `tenant_id`, `client_id`, `changed_fields`, `reason` and the context columns are not chained; a `hash_version` column and a v2 that hashes the whole row is queued for PR 3 or later.
9. The nightly job (after PR 3) calls `app.ensure_audit_partitions(24)`, `app.verify_audit_chain()`, checks `audit_log_default` is empty, and publishes the anchor (`last_id`, `last_hash`) outside the database.
