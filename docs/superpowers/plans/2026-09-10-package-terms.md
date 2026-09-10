# Package Terms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A programme runs six months from purchase, may be extended twice by exactly three months each with a reason and never a third time, and says so at the point of sale and on the invoice line.

**Architecture:** Migration 410 changes the package term's default to six months and adds `package_extension`, one row per extension with an ordinal the database caps at two; `package_purchase.extended_to` and `extension_reason` stay as the readers' view and are kept in step by the route. The rule that fixes an extension's length and count lives in `domain/billing/extension.ts`; the route composes it; the drawers say what the rule decides.

**Tech Stack:** TypeScript, Hono, Postgres (local Docker, port 5436 in the `billing` worktree), zod 4, React, vitest (`vitest.db.config.ts` for database files).

**Spec:** `docs/PLAN/package-terms.md` (the operator's approved plan of 10 September 2026, with its four defaults — the binding authority for this build) and `docs/SPEC/billing.md` section 4.3 "Expiry" (to be amended by Task 7). Where the two disagree, the operator's plan wins.

## Global Constraints

- Migration range `400–449` (the billing stream's, `docs/SPEC/OWNERSHIP.md`); this round is `410_package_terms.sql`. Forward-only, a `-- rollback:` block, a `-- Needs:` line naming lower numbers only, every table with `id uuid pk`, `tenant_id uuid not null`, `created_at`, `updated_at`, `created_by`, RLS on `tenant_id`, `client_id` present for the audit trigger, `comment on table … 'audited: client'`.
- Business rules in `domain/billing` as pure functions with tests (`.claude/rules/testing.md`): no `Date.now()`, no I/O.
- Money untouched: no price, VAT or refund arithmetic changes in this round. An extension is free (the operator's answer).
- Every joined table repeats `app.current_tenant_id()`; every write route requires `X-Reason` where its neighbours do (`scrubReason` as `extensions.ts` does today).
- Console copy English only, British English, no emoji, no ALL-CAPS; sentences that state a problem and a recovery. Arabic only on client-facing surfaces (the invoice line, which is bilingual).
- Fixtures only from `db/seed/` generators; test ids in the billing tests' own reserved block (read `tests/billing/db/extension.test.ts` for the shape); names from `db/seed/names.ts`. Edit fixtures with the Edit tool so the identifier hook sees them.
- Commit messages conventional, each ending `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Gates before the pull request: `pnpm verify`, `pnpm test:db` (with `DATABASE_URL` from this worktree's `.env`), `pnpm build`.
- The trunk file this round touches is `db/seed/generate.ts` (the seed's term constant); it is recorded in `docs/CHANGE-REQUESTS/billing-10.md` (Task 7). Nothing else outside the billing stream's paths changes.

---

## File map

- Create `db/migrations/410_package_terms.sql` — the default and the extension table.
- Modify `db/policies/billing/ledger.sql` — the new table's two policies, beside `package_purchase`'s.
- Create `domain/billing/extension.ts` + `extension.test.ts` — the rule: three months, two at most, and the words for a term.
- Modify `domain/billing/expiry.ts` — `DEFAULT_EXPIRY_MONTHS` 12 → 6; `domain/billing/index.ts` exports.
- Modify `app/api/billing/ledger-schema.ts` — `ExtendPurchaseInput` takes a reason alone; `PurchaseRow` gains `extensionsUsed`, `extensionsAllowed`, `extendsTo`.
- Modify `app/api/billing/extensions.ts` — the route composes the rule, inserts the extension row, keeps `extended_to` in step, refuses the third.
- Modify `app/api/billing/sales.ts` — the purchase reads count extensions; the invoice's package line carries the term in both languages.
- Modify `app/admin/billing/ExtensionDrawer.tsx`, `BalancesSection.tsx`, `SellPackageDrawer.tsx`, `PackageDrawer.tsx` — the copy and the count.
- Modify `db/seed/generate.ts` — `PACKAGE_EXPIRY_MONTHS` 12 → 6.
- Modify `docs/SPEC/billing.md`, `docs/PLAN/package-terms.md`, `docs/HANDOVER.md`; create `docs/CHANGE-REQUESTS/billing-10.md`.
- Tests: `tests/billing/db/extension.test.ts` (rewritten cases), `tests/billing/db/packages.test.ts` (the default), `tests/billing/BalancesSection.test.tsx`, `tests/billing/SellPackageDrawer.test.tsx`, `app/admin/billing/PackageDrawer.test.tsx`, `db/seed/generate.test.ts`.

---

### Task 1: Migration 410 — six months by default, and the extension table

**Files:**
- Create: `db/migrations/410_package_terms.sql`
- Modify: `db/policies/billing/ledger.sql`
- Test: `tests/billing/db/extension.test.ts` (a new `describe` at the top for the migration; the rest of the file is Task 3's)

**Interfaces:**
- Produces table `package_extension (id, tenant_id, client_id, purchase_id, ordinal, from_on, to_on, reason, created_by, created_at, updated_at)` with `ordinal` in `(1, 2)` and `unique (purchase_id, ordinal)`; `package.expiry_months` default `6`.

- [ ] **Step 1: Write the failing migration test**

At the top of `tests/billing/db/extension.test.ts`, after the file's existing imports and `beforeAll`, add (read the file first: reuse its `db`/`client` handle and its fixture ids):

```ts
describe('migration 410: six months, and two extensions at most', () => {
  it('defaults a new package to six months', async () => {
    const { rows } = await db.query<{ column_default: string }>(
      "select column_default from information_schema.columns where table_name = 'package' and column_name = 'expiry_months'",
    );
    expect(rows[0]?.column_default).toBe('6');
  });

  it('holds at most two extensions for one purchase, numbered one and two', async () => {
    const { rows } = await db.query<{ conname: string }>(
      "select conname from pg_constraint where conrelid = 'public.package_extension'::regclass order by conname",
    );
    expect(rows.map((r) => r.conname)).toEqual(
      expect.arrayContaining([
        'package_extension_ordinal_is_one_or_two',
        'package_extension_purchase_id_ordinal_key',
        'package_extension_moves_forward',
      ]),
    );
  });

  it('is audited with the household named', async () => {
    const { rows } = await db.query<{ description: string }>(
      "select obj_description('public.package_extension'::regclass, 'pg_class') as description",
    );
    expect(rows[0]?.description?.startsWith('audited: client')).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run --config vitest.db.config.ts tests/billing/db/extension.test.ts -t "migration 410"`
Expected: FAIL — `column_default` is `'12'`, and `'public.package_extension'::regclass` raises `relation does not exist`.

- [ ] **Step 3: Write the migration**

Create `db/migrations/410_package_terms.sql`:

```sql
-- 410_package_terms.sql
-- A programme runs six months, and may be extended twice by three months each
-- (docs/PLAN/package-terms.md, the operator's decision 9 of 2026-09-10,
-- approved as written the same day at 15:49 on their clock).
--
-- **The term.** package.expiry_months keeps its meaning (403 reads it at the
-- sale) and changes its default from twelve to six. Programmes already sold
-- keep the term they were sold with: expires_on was written at the sale and
-- nothing here rewrites it. The three programmes on the live price list move
-- to six by a data step at the live pass, recorded in docs/PRODUCTION.md.
--
-- **The extension.** Until now an extension was one open-ended date typed by
-- the coordinator with a reason (403: extended_to, extension_reason). From
-- this round an extension is always exactly three months from the current
-- end and a programme may have two, so a programme runs twelve months at
-- most — the ceiling it had before, reached only by asking. Each extension is
-- its own row here, numbered 1 or 2, so the count is the database's to keep
-- and not a route's to remember. package_purchase.extended_to and
-- extension_reason stay: they are what app.billing_ledger and the balances
-- screen read (403 lines 341-352), and the route keeps them equal to the
-- latest extension's to_on and reason.
--
-- Needs: 401 (package.expiry_months), 403 (package_purchase, its extension
-- columns and its tenant-scoped key), 060 (client), 099 (tenant-scoped keys),
-- 080 (app.audit_row), 000 (app.set_updated_at, app_role).

alter table public.package
  alter column expiry_months set default 6;

comment on column public.package.expiry_months is
  'How many months a programme runs from purchase. Six by default (the operator, 2026-09-10); a programme keeps the term it was sold with.';

create table public.package_extension (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenant (id),
  client_id    uuid not null,
  purchase_id  uuid not null,
  -- The first or the second; the check and the unique key together are the
  -- two-per-programme guard.
  ordinal      integer not null,
  -- The end it extended from, and the end it extended to: always three months.
  from_on      date not null,
  to_on        date not null,
  reason       text not null check (length(btrim(reason)) between 1 and 200),
  created_by   uuid not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint package_extension_ordinal_is_one_or_two check (ordinal in (1, 2)),
  constraint package_extension_purchase_id_ordinal_key unique (purchase_id, ordinal),
  constraint package_extension_moves_forward check (to_on > from_on),
  constraint package_extension_tenant_id_id_key unique (tenant_id, id),
  constraint package_extension_purchase_id_fkey
    foreign key (tenant_id, purchase_id) references public.package_purchase (tenant_id, id),
  constraint package_extension_client_id_fkey
    foreign key (tenant_id, client_id) references public.client (tenant_id, id),
  constraint package_extension_created_by_fkey
    foreign key (tenant_id, created_by) references public.app_user (tenant_id, id)
);

comment on table public.package_extension is
  'audited: client — one row per extension of a programme; at most two, of three months each (docs/PLAN/package-terms.md)';

create index package_extension_purchase_idx on public.package_extension (purchase_id);
create index package_extension_client_idx on public.package_extension (client_id);

create trigger set_updated_at before update on public.package_extension
  for each row execute function app.set_updated_at();

create trigger audit_row after insert or update or delete on public.package_extension
  for each row execute function app.audit_row();
alter table public.package_extension enable always trigger audit_row;

alter table public.package_extension enable row level security;
revoke all on public.package_extension from public;
grant select, insert on public.package_extension to app_role;

-- rollback:
--   drop table if exists public.package_extension;
--   alter table public.package alter column expiry_months set default 12;
--   comment on column public.package.expiry_months is 'How many months a programme runs from purchase.';
--   -- and remove this table''s two policies from db/policies/billing/ledger.sql,
--   -- which the runner re-applies and which name the table.
```

Before committing, read `db/migrations/403_billing_entitlement.sql` and confirm three things, adjusting the SQL above to match the file rather than the plan where they differ: (a) the exact name of `package_purchase`'s tenant-scoped unique key (the composite foreign key needs it); (b) whether `app.audit_row` is the trigger function's name and whether 403 uses `enable always trigger`; (c) whether 403 grants `app_role` with `grant select, insert, update on … to app_role` — the extension table needs `select, insert` only (an extension is never edited). State any adjustment in the report.

- [ ] **Step 4: The two policies**

In `db/policies/billing/ledger.sql`, beside `package_purchase`'s policies (read them first and copy their shape exactly — they are declarative `drop policy if exists … create policy …`), add:

```sql
-- package_extension: read by whoever reads the purchase; written by whoever
-- may extend (the roles app/api/billing/access.ts's mayExtend admits, which
-- the route checks first; this is the floor beneath it).
drop policy if exists tenant_isolation on public.package_extension;
create policy tenant_isolation on public.package_extension for all to app_role
  using (tenant_id = app.current_tenant_id())
  with check (tenant_id = app.current_tenant_id());

drop policy if exists package_extension_writers on public.package_extension;
create policy package_extension_writers on public.package_extension as restrictive for insert to app_role
  with check (
    app.actor_has_role('owner') or app.actor_has_role('admin')
    or app.actor_has_role('lead_practitioner') or app.actor_has_role('finance')
  );
```

Read `access.ts`'s `mayExtend` → `may(actor, 'billing.waiver.write', PRICE_WRITE, now)` and `domain/shared/actor.ts` for which roles hold `billing.waiver.write`; make the policy's role list exactly that set (drop `finance` if it is not among them, add whatever is). State the set in the report.

- [ ] **Step 5: Run the migration test to verify it passes**

Run: `pnpm -s db:migrate` (this worktree's database, port 5436), then `pnpm exec vitest run --config vitest.db.config.ts tests/billing/db/extension.test.ts -t "migration 410"`
Expected: PASS, three cases. Then `node scripts/audit-migrations.mjs` (or `pnpm verify`'s migration audit) clean.

- [ ] **Step 6: Commit**

```bash
git add db/migrations/410_package_terms.sql db/policies/billing/ledger.sql tests/billing/db/extension.test.ts
git commit -m "feat(billing): six months by default, and at most two extensions of three months (migration 410)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: The rule — three months, two at most, and the words for a term

**Files:**
- Create: `domain/billing/extension.ts`, `domain/billing/extension.test.ts`
- Modify: `domain/billing/expiry.ts` (the default), `domain/billing/index.ts` (exports)

**Interfaces:**
- Produces `EXTENSION_MONTHS = 3`, `MAX_EXTENSIONS = 2`, `nextExtension(currentEnd: IsoDate, used: number): { ordinal: 1 | 2; fromOn: IsoDate; toOn: IsoDate } | null` (null when `used >= MAX_EXTENSIONS`), and `termWords(months: number): { en: string; ar: string }`.
- Consumes `expiryOn(purchasedOn, months)` from `domain/billing/expiry.ts`.

- [ ] **Step 1: Write the failing tests**

Create `domain/billing/extension.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { EXTENSION_MONTHS, MAX_EXTENSIONS, nextExtension, termWords } from './extension';
import { DEFAULT_EXPIRY_MONTHS } from './expiry';

describe('the term', () => {
  it('runs six months by default from this round', () => {
    expect(DEFAULT_EXPIRY_MONTHS).toBe(6);
  });
});

describe('nextExtension', () => {
  it('adds exactly three months to the current end, and numbers it one', () => {
    expect(nextExtension('2027-03-15', 0)).toEqual({ ordinal: 1, fromOn: '2027-03-15', toOn: '2027-06-15' });
  });

  it('adds three more from the extended end, and numbers it two', () => {
    expect(nextExtension('2027-06-15', 1)).toEqual({ ordinal: 2, fromOn: '2027-06-15', toOn: '2027-09-15' });
  });

  it('refuses a third: the programme has had its two', () => {
    expect(nextExtension('2027-09-15', 2)).toBeNull();
  });

  it('clamps to the shorter month, as the sale does', () => {
    expect(nextExtension('2026-11-30', 0)?.toOn).toBe('2027-02-28');
  });

  it('is three months and two at most, by name', () => {
    expect(EXTENSION_MONTHS).toBe(3);
    expect(MAX_EXTENSIONS).toBe(2);
  });
});

describe('termWords', () => {
  it('says six months in both languages', () => {
    expect(termWords(6)).toEqual({ en: '6 months', ar: '6 أشهر' });
  });

  it('knows Arabic counts one, two, a few and many', () => {
    expect(termWords(1)).toEqual({ en: '1 month', ar: 'شهر واحد' });
    expect(termWords(2)).toEqual({ en: '2 months', ar: 'شهران' });
    expect(termWords(12)).toEqual({ en: '12 months', ar: '12 شهرًا' });
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run domain/billing/extension.test.ts`
Expected: FAIL — `Cannot find module './extension'`, and `DEFAULT_EXPIRY_MONTHS` is `12`.

- [ ] **Step 3: Write the rule**

In `domain/billing/expiry.ts` change one line:

```ts
export const DEFAULT_EXPIRY_MONTHS = 6;
```

and above it replace the comment with: `/** Six months from purchase — the operator's decision 9 of 2026-09-10 (docs/PLAN/package-terms.md); twelve until then. The package row carries its own term; this is the default a new one takes. */`

Create `domain/billing/extension.ts`:

```ts
import type { IsoDate } from '../shared';
import { expiryOn } from './expiry';

/**
 * An extension is always exactly three months from the current end, and a
 * programme may have two — so it runs twelve months at most, the ceiling it
 * had before this round, reached only by asking (docs/PLAN/package-terms.md,
 * defaults 1 and 2). The count is the database's to keep (migration 410);
 * this is the arithmetic the route and the drawer both read.
 */
export const EXTENSION_MONTHS = 3;
export const MAX_EXTENSIONS = 2;

export type Extension = { ordinal: 1 | 2; fromOn: IsoDate; toOn: IsoDate };

/**
 * The extension a programme would get next, or null when it has had its two.
 * `currentEnd` is the end as it stands today (the last extension's end, or
 * the sale's); `used` is how many extensions it already has.
 */
export function nextExtension(currentEnd: IsoDate, used: number): Extension | null {
  if (!Number.isSafeInteger(used) || used < 0) {
    throw new RangeError(`A count of extensions is a whole number, received ${used}.`);
  }
  if (used >= MAX_EXTENSIONS) {
    return null;
  }
  return {
    ordinal: (used + 1) as 1 | 2,
    fromOn: currentEnd,
    toOn: expiryOn(currentEnd, EXTENSION_MONTHS),
  };
}

/**
 * A term's length in words, for the sale and the invoice line. Arabic counts
 * one, two, three to ten and eleven upwards differently; the practice's own
 * terms are six and, until this round, twelve.
 */
export function termWords(months: number): { en: string; ar: string } {
  if (!Number.isSafeInteger(months) || months < 1) {
    throw new RangeError(`A term is a whole number of months, received ${months}.`);
  }
  const en = months === 1 ? '1 month' : `${months} months`;
  const ar =
    months === 1 ? 'شهر واحد' : months === 2 ? 'شهران' : months <= 10 ? `${months} أشهر` : `${months} شهرًا`;
  return { en, ar };
}
```

Export the three names and the type from `domain/billing/index.ts` where `expiryOn` is exported.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run domain/billing/extension.test.ts domain/billing/expiry.test.ts`
Expected: PASS. If `expiry.test.ts` asserts the default of twelve, change that assertion to six and say so in the report.

- [ ] **Step 5: Commit**

```bash
git add domain/billing/extension.ts domain/billing/extension.test.ts domain/billing/expiry.ts domain/billing/expiry.test.ts domain/billing/index.ts
git commit -m "feat(billing): an extension is three months, two at most, and a term has its words

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: The extension route takes a reason alone

**Files:**
- Modify: `app/api/billing/ledger-schema.ts` (`ExtendPurchaseInput`, `PurchaseRow`), `app/api/billing/extensions.ts`, `app/api/billing/sales.ts` (the purchase reads)
- Test: `tests/billing/db/extension.test.ts`

**Interfaces:**
- `ExtendPurchaseInput = { reason: string }` (the date is gone).
- `PurchaseRow` gains `extensionsUsed: number` (0–2), `extensionsAllowed: number` (2), `extendsTo: string | null` — the end the *next* extension would reach, null when none is left. `extendedTo` and `extensionReason` stay as they are.
- Refusals: 403 (`mayExtend`), 400 `invalid_request` (bad id or body), 404, 409 `not_extendable` (refunded/cancelled), **409 `extension_limit_reached`** (the third).
- Consumes `nextExtension`, `MAX_EXTENSIONS` (Task 2).

- [ ] **Step 1: Rewrite the route's cases**

In `tests/billing/db/extension.test.ts`, the `describe('POST /api/billing/package-purchases/:id/extension')` block: keep "refuses somebody who does not record money", "refuses an id that is not one", "refuses an extension with no reason"; delete "refuses a date no later than the one it replaces"; replace "extends it, keeping the original date beside the new one" and add cases so the block reads:

```ts
  it('extends it by exactly three months, keeping the original date beside the new one', async () => {
    const res = await api.request(`/api/billing/package-purchases/${PURCHASE}/extension`, {
      method: 'POST',
      headers: { ...AUTH.owner, 'x-reason': 'Travelling for a month', 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'Travelling for a month' }),
    });
    expect(res.status).toBe(200);
    const body = ExtendPurchaseResponse.parse(await res.json());
    expect(body.purchase.expiresOn).toBe(EXPIRES_ON);
    expect(body.purchase.extendedTo).toBe(THREE_MONTHS_ON);
    expect(body.purchase.extensionsUsed).toBe(1);
    expect(body.purchase.extensionsAllowed).toBe(2);
    expect(body.purchase.extendsTo).toBe(SIX_MONTHS_ON);
    const rows = await db.query<{ ordinal: number; from_on: string; to_on: string; reason: string }>(
      'select ordinal, from_on::text, to_on::text, reason from package_extension where purchase_id = $1 order by ordinal',
      [PURCHASE],
    );
    expect(rows.rows).toEqual([{ ordinal: 1, from_on: EXPIRES_ON, to_on: THREE_MONTHS_ON, reason: 'Travelling for a month' }]);
  });

  it('extends it a second time from the extended end', async () => {
    const res = await api.request(`/api/billing/package-purchases/${PURCHASE}/extension`, {
      method: 'POST',
      headers: { ...AUTH.owner, 'x-reason': 'Still away', 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'Still away' }),
    });
    expect(res.status).toBe(200);
    const body = ExtendPurchaseResponse.parse(await res.json());
    expect(body.purchase.extendedTo).toBe(SIX_MONTHS_ON);
    expect(body.purchase.extensionsUsed).toBe(2);
    expect(body.purchase.extendsTo).toBeNull();
  });

  it('refuses a third: the programme has had its two, for the owner too', async () => {
    const res = await api.request(`/api/billing/package-purchases/${PURCHASE}/extension`, {
      method: 'POST',
      headers: { ...AUTH.owner, 'x-reason': 'One more', 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'One more' }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('extension_limit_reached');
    const count = await db.query('select count(*)::int as n from package_extension where purchase_id = $1', [PURCHASE]);
    expect(count.rows[0].n).toBe(2);
  });
```

Define `THREE_MONTHS_ON` and `SIX_MONTHS_ON` beside the file's `EXPIRES_ON` as `expiryOn(EXPIRES_ON, 3)` and `expiryOn(EXPIRES_ON, 6)` (import `expiryOn` from `domain/billing`). Keep "records why in the audit trail" and the whole "double charge" describe, adjusting them from the typed date to the three-month end where they name a date; watch each adjusted case fail before the route changes.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm exec vitest run --config vitest.db.config.ts tests/billing/db/extension.test.ts`
Expected: FAIL — the body without `extendedTo` is `invalid_request` (400), and `extensionsUsed` is undefined.

- [ ] **Step 3: The schema**

In `app/api/billing/ledger-schema.ts`:

```ts
export const ExtendPurchaseInput = z.object({
  reason: z.string().trim().min(1).max(200),
});
```

and in `PurchaseRow`, after `extensionReason`:

```ts
  /** How many of the two extensions this programme has had. */
  extensionsUsed: z.number().int().min(0).max(2),
  extensionsAllowed: z.literal(2),
  /** The end the next extension would reach; null once the programme has had its two. */
  extendsTo: z.string().nullable(),
```

- [ ] **Step 4: The route**

In `app/api/billing/extensions.ts`, replace the body after the 404/409 checks with the composition below (keep the file's imports and add `nextExtension`, `MAX_EXTENSIONS` from `../../../domain/billing`):

```ts
    const currentEnd = purchase.extended_to ?? purchase.expires_on;
    const used = await db.query<{ n: number }>(
      'select count(*)::int as n from package_extension where tenant_id = app.current_tenant_id() and purchase_id = $1',
      [purchaseId],
    );
    const next = nextExtension(currentEnd, used.rows[0]?.n ?? 0);
    if (next === null) {
      return c.json({ error: 'conflict', code: 'extension_limit_reached', requestId }, 409);
    }
    await db.query("select set_config('app.reason', $1, true)", [scrubReason(input.reason)]);
    await db.query(
      'insert into package_extension (tenant_id, client_id, purchase_id, ordinal, from_on, to_on, reason, created_by) ' +
        'values (app.current_tenant_id(), $1, $2, $3, $4, $5, $6, $7)',
      [purchase.client_id, purchaseId, next.ordinal, next.fromOn, next.toOn, input.reason, actor.userId],
    );
    const updated = await db.query<PurchaseDbRow>(EXTEND_SQL, [purchaseId, next.toOn, input.reason]);
```

`EXTEND_SQL` stays as it is (it already writes `extended_to` and `extension_reason`). The response is built by the same `purchaseRow(...)` mapping `sales.ts` uses (Step 5), so it carries the three new fields. The `not_later` and `date_in_past` refusals go with the date. If `actor.userId` is not the field's name on `Actor`, use the one `sales.ts` passes as `created_by`.

- [ ] **Step 5: The purchase reads count extensions**

In `app/api/billing/sales.ts`, the purchase `select` (the statement at line ~97 that lists `p.expires_on, p.extended_to, p.extension_reason`) gains a correlated count:

```sql
  (select count(*)::int from package_extension x
     where x.tenant_id = app.current_tenant_id() and x.purchase_id = p.id) as extensions_used,
```

and the row mapping (the function that builds `expiresOn`, `extendedTo`, `extensionReason` from a `PurchaseDbRow`) gains:

```ts
      extensionsUsed: row.extensions_used,
      extensionsAllowed: MAX_EXTENSIONS,
      extendsTo: nextExtension(row.extended_to ?? row.expires_on, row.extensions_used)?.toOn ?? null,
```

If the mapping is duplicated between `sales.ts` and `extensions.ts`, lift it into one exported `purchaseRow(row)` in `sales.ts` and call it from both; say so in the report. Any other statement that selects a `PurchaseDbRow` (search `extension_reason` under `app/api/billing`) gains the same count column.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm exec vitest run --config vitest.db.config.ts tests/billing/db/extension.test.ts tests/billing/db/packages.test.ts` and `pnpm -s typecheck`
Expected: PASS; typecheck clean (every consumer of `PurchaseRow` compiles — the drawers are Task 4's, but the type must build).

- [ ] **Step 7: Commit**

```bash
git add app/api/billing/ledger-schema.ts app/api/billing/extensions.ts app/api/billing/sales.ts tests/billing/db/extension.test.ts
git commit -m "feat(billing): an extension takes a reason alone, adds three months, and stops at two

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: The extension drawer says what the rule decides

**Files:**
- Modify: `app/admin/billing/ExtensionDrawer.tsx`, `app/admin/billing/BalancesSection.tsx`
- Test: `tests/billing/BalancesSection.test.tsx`

**Interfaces:**
- Consumes `PurchaseRow.extensionsUsed`, `extensionsAllowed`, `extendsTo` (Task 3); posts `{ reason }` only.

- [ ] **Step 1: Write the failing tests**

In `tests/billing/BalancesSection.test.tsx` (read its `mount` and fixtures first; give the fixture purchase `extensionsUsed: 0, extensionsAllowed: 2, extendsTo: '2027-06-15'`), add:

```ts
  it('offers an extension of three months, says how many are left, and sends the reason alone', async () => {
    const { posts } = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Extend' }));
    expect(screen.getByText('It runs to 15 March 2027 today. An extension adds three months, to 15 June 2027. None of the two used yet.')).toBeTruthy();
    expect(screen.queryByLabelText('Runs to')).toBeNull();
    fireEvent.change(screen.getByLabelText('Why'), { target: { value: 'Travelling for a month' } });
    fireEvent.click(screen.getByRole('button', { name: 'Extend by three months' }));
    expect(await screen.findByText(/Extended to 15 June 2027\./)).toBeTruthy();
    expect(posts).toEqual([{ url: `/api/billing/package-purchases/${PURCHASE.id}/extension`, body: { reason: 'Travelling for a month' } }]);
  });

  it('says one of the two is used after the first', async () => {
    mount({ purchase: { ...PURCHASE, extendedTo: '2027-06-15', extensionReason: 'Travelling', extensionsUsed: 1, extendsTo: '2027-09-15' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Extend' }));
    expect(screen.getByText(/1 of the two used\./)).toBeTruthy();
  });

  it('offers nothing once the programme has had its two, and says so', async () => {
    mount({ purchase: { ...PURCHASE, extendedTo: '2027-09-15', extensionReason: 'Still away', extensionsUsed: 2, extendsTo: null } });
    expect(await screen.findByText('This programme has had its two extensions.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Extend' })).toBeNull();
  });

  it('says so when the route refuses a third', async () => {
    const { posts } = mount({ purchase: { ...PURCHASE, extensionsUsed: 1, extendsTo: '2027-09-15' }, extensionStatus: 409, extensionCode: 'extension_limit_reached' });
    fireEvent.click(await screen.findByRole('button', { name: 'Extend' }));
    fireEvent.change(screen.getByLabelText('Why'), { target: { value: 'One more' } });
    fireEvent.click(screen.getByRole('button', { name: 'Extend by three months' }));
    expect(await screen.findByText('This programme has had its two extensions. A programme that needs longer is a refund and a new sale.')).toBeTruthy();
    expect(posts).toHaveLength(1);
  });
```

Adjust the exact date words to the file's `formatDate` output (read it); the sentences above are the copy to use verbatim.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/billing/BalancesSection.test.tsx`
Expected: FAIL — the drawer still asks for a date and posts `extendedTo`.

- [ ] **Step 3: The drawer**

In `app/admin/billing/ExtensionDrawer.tsx`: remove the `extendedTo` state, its `Field` ("Runs to") and its validation; the body posted is `{ reason: reason.trim() }`; above the "Why" field render one `<p>` (or the file's `Note`) with:

```ts
const runsTo = purchase.extendedTo ?? purchase.expiresOn;
const used = purchase.extensionsUsed;
const left =
  used === 0 ? 'None of the two used yet.' : used === 1 ? '1 of the two used.' : 'Both used.';
const sentence = purchase.extendsTo
  ? `It runs to ${formatDate(runsTo)} today. An extension adds three months, to ${formatDate(purchase.extendsTo)}. ${left}`
  : 'This programme has had its two extensions.';
```

The submit button reads "Extend by three months". `REFUSALS` (the file's map of codes to sentences) gains `extension_limit_reached: 'This programme has had its two extensions. A programme that needs longer is a refund and a new sale.'` and loses `not_later` / `date_in_past`. The `onExtended` summary reads `Extended to ${formatDate(body.purchase.extendedTo ?? body.purchase.expiresOn)}.`.

In `app/admin/billing/BalancesSection.tsx`: where the "Extend" button is rendered for a purchase (line ~276), render it only when `purchase.extendsTo !== null`; when `purchase.extensionsUsed === 2` render the text "This programme has had its two extensions." in its place; beneath the "Extended from …" line (line ~253) add `{purchase.extensionsUsed} of {purchase.extensionsAllowed} extensions used` only when `extensionsUsed > 0`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run tests/billing/BalancesSection.test.tsx app/admin/billing tests/lint/console-is-english.test.ts` and `pnpm -s typecheck && pnpm -s lint`
Expected: PASS, pristine.

- [ ] **Step 5: Commit**

```bash
git add app/admin/billing/ExtensionDrawer.tsx app/admin/billing/BalancesSection.tsx tests/billing/BalancesSection.test.tsx
git commit -m "feat(billing): the extension drawer adds three months, counts to two, and says so

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Said at the point of sale, and on the invoice line

**Files:**
- Modify: `app/admin/billing/SellPackageDrawer.tsx`, `app/admin/billing/PackageDrawer.tsx`, `app/api/billing/sales.ts` (the invoice line's description)
- Test: `tests/billing/SellPackageDrawer.test.tsx`, `app/admin/billing/PackageDrawer.test.tsx`, `tests/billing/db/packages.test.ts` (the sale's line)

**Interfaces:**
- Consumes `termWords(months)` (Task 2) and the bundle's `expiryMonths` (already on the catalogue's package row — confirm the name in `ledger-schema.ts`'s package row and `PackagesSection`'s fetch).

- [ ] **Step 1: Write the failing tests**

`tests/billing/SellPackageDrawer.test.tsx` (the fixture bundle carries `expiryMonths: 6`):

```ts
  it('says the term and the two extensions above the button', async () => {
    mount();
    expect(await screen.findByText('Runs 6 months from today. Two extensions of three months each on request.')).toBeTruthy();
  });
```

`app/admin/billing/PackageDrawer.test.tsx`:

```ts
  it('starts a new programme at six months', async () => {
    mount();
    expect((await screen.findByLabelText('Runs for (months)')).getAttribute('value')).toBe('6');
    expect(screen.getByText('How long a family has to use it. Six months unless the practice decides otherwise.')).toBeTruthy();
  });
```

`tests/billing/db/packages.test.ts`, in the case that sells a package and reads the invoice back (find it: search `invoice_line` in the file), add two assertions on the package line:

```ts
    expect(line.description).toBe(`${PACKAGE_NAME}, 6 months`);
    expect(line.description_ar).toBe(`${PACKAGE_NAME_AR}، 6 أشهر`);
```

using the fixture package's names (and its `expiry_months`, which the fixture must set to 6 or leave to the new default).

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/billing/SellPackageDrawer.test.tsx app/admin/billing/PackageDrawer.test.tsx` and `pnpm exec vitest run --config vitest.db.config.ts tests/billing/db/packages.test.ts`
Expected: FAIL — no sentence; the drawer starts at `'12'`; the line reads the bare name.

- [ ] **Step 3: The three changes**

`SellPackageDrawer.tsx`: directly above the actions row (the `<Button type="submit"` at line ~386), render

```tsx
<p className="sell__term">
  Runs {termWords(bundle.expiryMonths).en} from today. Two extensions of three months each on request.
</p>
```

(import `termWords` from `../../../domain/billing`; use the file's existing class for a plain sentence if one exists — read `billing.css` — else add `.sell__term` with `color: var(--ink-2); font-size: var(--t-small); line-height: var(--lh-small); margin-block: var(--s-3)` in the module's stylesheet; tokens only).

`PackageDrawer.tsx`: `useState('12')` → `useState('6')` (line 105) and the hint (line 461) → `"How long a family has to use it. Six months unless the practice decides otherwise."`.

`sales.ts`: where the invoice line's `description` and `description_ar` values are built for the package sale (the values array of the `insert into invoice_line` at line ~177 — read upward to where they are composed), make them

```ts
const term = termWords(bundle.expiry_months);
const description = `${bundle.name}, ${term.en}`;
const descriptionAr = bundle.name_ar ? `${bundle.name_ar}، ${term.ar}` : null;
```

(`bundle` being whatever the sale calls the package row it read — it already reads `expiry_months` to compute `expires_on`). The Arabic comma is `،` (U+060C).

- [ ] **Step 4: Run the tests to verify they pass**

Run: the three commands from Step 2, plus `pnpm vitest run tests/lint` and `pnpm -s typecheck && pnpm -s lint && pnpm -s format:check`
Expected: PASS. The console-English guard must stay green: the Arabic string lives in `sales.ts` (an API file writing a bilingual document), not in a console component.

- [ ] **Step 5: Commit**

```bash
git add app/admin/billing/SellPackageDrawer.tsx app/admin/billing/PackageDrawer.tsx app/admin/billing/*.css app/api/billing/sales.ts tests/billing/SellPackageDrawer.test.tsx app/admin/billing/PackageDrawer.test.tsx tests/billing/db/packages.test.ts
git commit -m "feat(billing): the term said at the sale, on the invoice line, and six by default in the drawer

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: The seed's programmes run six months

**Files:**
- Modify: `db/seed/generate.ts` (line ~544, `PACKAGE_EXPIRY_MONTHS`)
- Test: `db/seed/generate.test.ts`

- [ ] **Step 1: Write the failing test**

In `db/seed/generate.test.ts`, beside the case that reads the packages (search `packages`), add:

```ts
  it('sells six-month programmes from this round', () => {
    const data = generateSeed();
    expect(data.packages.map((p) => p.expiryMonths)).toEqual([6, 6, 6]);
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run db/seed/generate.test.ts`
Expected: FAIL — `[12, 12, 12]`.

- [ ] **Step 3: The constant**

In `db/seed/generate.ts` line ~544: `PACKAGE_EXPIRY_MONTHS = 6`, and the comment above it: `/** Six months, the operator's decision 9 of 2026-09-10 (docs/PLAN/package-terms.md); twelve from 2026-09-03 until then. package.expiry_months carries it per programme. */`

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run db/seed/generate.test.ts` and `pnpm exec vitest run --config vitest.db.config.ts tests/db/seed.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add db/seed/generate.ts db/seed/generate.test.ts
git commit -m "feat(seed): the programmes run six months

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: The record, the gates, and the data step written down

**Files:**
- Modify: `docs/SPEC/billing.md` (section 4.3 "Expiry"), `docs/PLAN/package-terms.md` (a closing "Built" line), `docs/HANDOVER.md` section 10 (step 15)
- Create: `docs/CHANGE-REQUESTS/billing-10.md` (read `billing-07.md` for the shape). This plan said `billing-08.md` when it was written and the number moved to `billing-10.md` before it was executed, because `billing-08.md` and `billing-09.md` were taken by the discount round and the document-design round in the meantime.
- Test: none new; the gates whole

- [ ] **Step 1: The spec**

In `docs/SPEC/billing.md` section 4.3, replace the paragraph beginning `**Expiry.** 12 months from purchase is reasonable and standard.` with:

```markdown
**Expiry.** _Amended 2026-09-10 on the operator's decision 9._ A programme
runs **six months** from purchase (`package.expiry_months`, six by default;
a programme keeps the term it was sold with). Up to **two extensions of three
months each**, at no charge, each with a reason written down — one row each in
`package_extension` (migration 410), numbered one and two, so a programme runs
twelve months at most and only by asking; a third is refused for everyone,
the owner included. The term is said at the point of sale (the Sell drawer)
and on the invoice's package line in both languages. Warnings at 60 and 30
days are a later round, once households are on programmes; the notice period
and the call-out fee are unchanged.
```

- [ ] **Step 2: The plan, the change request, the hand-over**

`docs/PLAN/package-terms.md`: append `## Built` with two sentences: built on 10 September 2026 as the billing round on this branch (migration 410; `domain/billing/extension.ts`; the extension route and drawer; the sale sentence and the invoice line; the seed) — and that the three live programmes move to six months by a data step at the live pass, on the operator's word, recorded in `docs/PRODUCTION.md`.

`docs/CHANGE-REQUESTS/billing-10.md`, in `billing-07.md`'s shape: item 1, `db/seed/generate.ts` — `PACKAGE_EXPIRY_MONTHS` 12 → 6 and its comment (trunk file, per OWNERSHIP); item 2, the data step the live pass owes: `update package set expiry_months = 6 where code in (<the three codes>)` on production, under the runner's audit context, on the operator's word — read the three codes from `db/seed/generate.ts` lines ~497–530 (`Silver`, `Gold`, `Platinum`) and say that production's codes are confirmed by a read before the update.

`docs/HANDOVER.md` section 10, after step 14: `15. **Package terms (decision 9, this pull request):** …` in the shape of 14 — migration 410, six months, two extensions of three; still owed: the staging pass with 410, the production data step for the three programmes, the live pass, all on the operator's word. Next: piece twelve's plan.

- [ ] **Step 3: The gates whole**

Run: `pnpm verify && pnpm test:db && pnpm build` (Bash timeout up to 600000 ms; `DATABASE_URL` from this worktree's `.env`).
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add docs/SPEC/billing.md docs/PLAN/package-terms.md docs/CHANGE-REQUESTS/billing-10.md docs/HANDOVER.md
git commit -m "docs(billing): the term and its two extensions in the spec, the change request, and the hand-over

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

The push and the pull request are the controller's, after the whole-branch review.

---

## Self-review

**Spec coverage** (`docs/PLAN/package-terms.md`): six months (Tasks 1, 2, 6; the drawer's default, Task 5); two extensions of three each, refused on the third, for the owner too (Tasks 1, 2, 3); said at the point of sale (Task 5); the invoice line in both languages (Task 5); notice period and fee untouched (nothing changes them); default 1, three months fixed not typed (Tasks 2, 3, 4); default 2, counted per programme for ever (Task 1's ordinal and unique key; no lever); default 3, the live programmes by a data step, no term edit added to the Packages screen (Task 7 records the step; Task 5 changes only the existing field's default and hint); default 4, the sentence is the app's own words (Task 5).

**Placeholders.** Three places tell the implementer to read a file before writing (403's key names and grants in Task 1; the roles behind `mayExtend` in Task 1; where `sales.ts` composes the line's description in Task 5) — each names the exact target and the exact text to produce, so they are look-ups, not gaps.

**Type consistency.** `nextExtension` returns `{ ordinal, fromOn, toOn }` (Task 2) and Task 3 reads exactly those; `PurchaseRow` gains `extensionsUsed`, `extensionsAllowed`, `extendsTo` (Task 3) and Task 4 reads exactly those; `termWords` returns `{ en, ar }` (Task 2) and Task 5 reads `.en` and `.ar`; `ExtendPurchaseInput` is `{ reason }` in Task 3 and the drawer posts `{ reason }` in Task 4.
