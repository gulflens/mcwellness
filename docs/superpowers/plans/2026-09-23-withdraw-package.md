# Withdraw a package (round 62) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The office can withdraw a package it has finished offering, so Billing › Packages lists only what is on sale, and can reinstate one it withdrew by mistake.

**Architecture:** Nothing is deleted. `package.status` (`active` | `inactive`, migration 401) already exists, a sale already refuses an `inactive` package (`sales.ts`, 422 `not_sellable`), the database policy `catalogue_amenders` (`db/policies/billing/ledger.sql`) already lets owner, admin and finance update it, and the screen already prints "Withdrawn" for one. What is missing is the route that sets it, the row action, and a list that folds withdrawn packages away. No migration.

**Tech Stack:** Hono route + zod (`app/api/billing/`), React screen (`app/admin/billing/`), Vitest + real database tests (`tests/billing/db/`).

**Spec:** the owner's ask of 23 September 2026 ("the option to delete a particular package after we're finished with it … I want to limit the number of different packages we offer apart from our standard ones") and this round's design: withdraw, never delete; households who bought it keep their sessions.

## Global Constraints

- Word: **Withdraw** / **Withdrawn** / **Reinstate** (the screen and both SQL comments already say "withdrawn"; the kit screen says "Stood down" for its own things and that word is not reused here).
- Roles: `billing.package.write` — owner, admin, finance (`domain/shared/actor.ts` ~335-350). No new action is needed.
- `X-Reason` header required, as `PATCH /api/kit/:id` requires it (`app/api/kit/routes.ts` ~193-236, 400 `reason_required`); the reason lands on the audit row through `app.reason`.
- A withdrawn package keeps its `code`, its prices and its purchases; nothing on any purchase, credit, invoice or balance changes.
- Console copy English only; money and dates as the screen already formats them.
- `pnpm -s format` before `pnpm verify`; `pnpm test:db` needs the worktree's database (`docker compose up -d --wait`, `pnpm db:migrate`).

## Review Focus

1. Withdrawing a package that has been sold must succeed and change nothing for the households who bought it: Task 1 sells one, withdraws it, and reads the buyer's balance and credits unchanged.
2. A withdrawn package must refuse a new sale: Task 1 posts a sale after the withdrawal and expects 422 `not_sellable`.
3. Reinstating brings it back on sale only if it still has a current price: Task 1 reinstates and sells again.
4. A lead practitioner may read packages but not withdraw one: Task 1 expects 403.
5. The list must actually get shorter, which was the owner's point: Task 2 renders one active and one withdrawn package and asserts the withdrawn one is not in the main table but is under the "Withdrawn" disclosure.

---

### Task 1: The route that sets a package's status

**Files:**
- Modify: `app/api/billing/packages.ts` (add the route beside `POST /api/billing/packages/:id/price`, ~478-523)
- Modify: `app/api/billing/ledger-schema.ts` (add `SetPackageStatusInput`)
- Test: `tests/billing/db/packages.test.ts` (add a `describe('withdrawing a package')`)

**Interfaces:**
- Produces: `PATCH /api/billing/packages/:id` with body `{ status: 'active' | 'inactive' }`, header `X-Reason` (non-empty after trim; mirror kit's check exactly), gated by `mayWriteCatalogue`. Answers 200 `{ package: PackageRow }` (the same row shape `GET /api/billing/packages` returns, so the screen can replace the row in place), 400 `invalid_request` | `reason_required`, 403, 404 when the id is not the practice's. Idempotent: setting the status it already has answers 200 with the row unchanged.

- [ ] **Step 1: Write the failing tests**

In `tests/billing/db/packages.test.ts`, using the file's own helpers for a signed-in owner, admin, finance and lead practitioner, and its existing package + sale fixtures:

```ts
describe('withdrawing a package', () => {
  it('withdraws a package with a reason, and the list marks it withdrawn', async () => {
    // create a package as the owner (existing helper), then
    const res = await api.request(`/api/billing/packages/${id}`, {
      method: 'PATCH', headers: { ...owner, 'content-type': 'application/json', 'x-reason': 'no longer offered' },
      body: JSON.stringify({ status: 'inactive' }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).package).toMatchObject({ id, status: 'inactive', sellable: false });
    // GET /api/billing/packages still lists it, with status 'inactive'
  });
  it('refuses without a reason', …);                  // 400 reason_required
  it('refuses a lead practitioner', …);                // 403
  it('answers 404 for another practice\'s package', …); // use the second tenant the file already has
  it('refuses a sale of a withdrawn package', …);      // POST /api/billing/package-purchases → 422 not_sellable
  it('leaves a buyer\'s credits and balance untouched when a sold package is withdrawn', …); // sell, withdraw, read balance route before/after → equal
  it('reinstates a withdrawn package and it can be sold again', …); // PATCH active → 200 sellable true → sale 201
  it('writes the reason onto the audit row', …);       // select from audit_log where entity_type='package' and entity_id=$1 order by occurred_at desc limit 1 → reason
});
```

- [ ] **Step 2: Run red** — `pnpm test:db -- tests/billing/db/packages.test.ts -t withdrawing` → 404s (no route).

- [ ] **Step 3: The schema and the route**

```ts
// ledger-schema.ts
export const SetPackageStatusInput = z.object({ status: z.enum(['active', 'inactive']) }).strict();
```

```ts
// packages.ts — beside the price route
api.patch('/api/billing/packages/:id', async (c) => {
  const actor = c.get('actor'); const requestId = c.get('requestId');
  if (!mayWriteCatalogue(actor, now())) return c.json({ error: 'forbidden', requestId }, 403);
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'bad_request', code: 'invalid_request', requestId }, 400);
  const reason = (c.req.header('x-reason') ?? '').trim();
  if (!reason) return c.json({ error: 'bad_request', code: 'reason_required', requestId }, 400);
  const body = SetPackageStatusInput.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'bad_request', code: 'invalid_request', requestId }, 400);
  const db = c.get('db');
  const updated = await db.query('update package set status = $2 where id = $1 returning id', [id, body.data.status]);
  if (updated.rowCount === 0) return c.json({ error: 'not_found', requestId }, 404);
  const rows = await readPackages(db, /* the same args the GET uses */);
  const row = rows.find((p) => p.id === id);
  return c.json({ package: row }, 200);
});
```

Read how the GET builds `readPackages` and reuse it rather than re-deriving `sellable`. Check how kit's PATCH stamps the reason: if the request-context middleware already copies `x-reason` into `app.reason`, nothing more is needed; if the kit route sets it explicitly, do the same.

- [ ] **Step 4: Run green** — the new describe and the whole file.

- [ ] **Step 5: Commit**

```bash
git add app/api/billing/packages.ts app/api/billing/ledger-schema.ts tests/billing/db/packages.test.ts
git commit -m "feat(billing): a package can be withdrawn and reinstated, with a reason (round 62)"
```

### Task 2: The screen — Withdraw, a folded list, Reinstate

**Files:**
- Modify: `app/admin/billing/PackagesSection.tsx` (row action at 86-103; the table at 74-176)
- Create: `app/admin/billing/WithdrawPackageDrawer.tsx` (a small right-side drawer: the package's name, one sentence "Households who bought it keep their sessions; nobody can buy it after this.", a required "Why" field, a Withdraw button; follow `CancelAppointmentDrawer.tsx` or the kit stand-down drawer for the shape and the `x-reason` POST pattern; every fetch sends `content-type: application/json`)
- Test: `tests/billing/PackagesSection.test.tsx` (add cases), `app/admin/billing/WithdrawPackageDrawer.test.tsx` (new)

**Interfaces:**
- Consumes: `PATCH /api/billing/packages/:id` from Task 1.

- [ ] **Step 1: Failing tests**

```ts
it('shows Withdraw on an active package for the owner, and not for a lead practitioner', …);
it('lists a withdrawn package under a folded "Withdrawn (1)" disclosure, not in the table', …);
it('reinstates from the folded list', …); // click Reinstate → PATCH active with x-reason (a fixed reason "Reinstated" is fine; or reuse the drawer with its verb changed — choose one, test it)
// WithdrawPackageDrawer.test.tsx
it('refuses to submit without a reason and sends x-reason and JSON content-type when it does', …);
```

- [ ] **Step 2: Run red, build, run green**

Layout rules: the main table is unchanged for active rows. Below it, when any package is `inactive`, a `<details>` (the repo's disclosure pattern; see how `EnquiriesPage` or the accounting screens fold a group, or a plain `<details><summary>Withdrawn (n)</summary>` with the table's own classes) lists them with name, contents, and a Reinstate action. The row action for an active row becomes two: "Sell to a client" and "Withdraw" (owner/admin/finance only; use the same role check the "Add package" button uses). After either action the section refetches the list.

- [ ] **Step 3: Commit**

```bash
git commit -am "feat(billing): Withdraw folds a package away from the list; Reinstate brings it back"
```

### Task 3: Record and gate

**Files:**
- Modify: `docs/SPEC/billing.md` — add `### 2.5 Withdrawing a package (round 62, the owner's ask of 23 September 2026)`: a package is withdrawn by status, never deleted, because purchases and invoice lines name it and financial records keep five years; a withdrawn package cannot be sold, keeps its code and its price history, and changes nothing for households who bought it; reinstating is the same act the other way; the reason is on the audit row.
- Modify: `docs/SPEC/00-data-model.md` line ~221 (`package` — one clause: `status` is how a bundle is withdrawn).
- Create: `docs/CHANGE-REQUESTS/trunk-round-62.md` in the shape of `trunk-round-59.md`: the ask, the decision, what it does, tests, "Going live" (no migration, no policy file; front-end + API).

- [ ] **Step 1: `pnpm -s format && pnpm verify && pnpm test:db`** — all green.
- [ ] **Step 2: Commit.**

```bash
git add docs/SPEC/billing.md docs/SPEC/00-data-model.md docs/CHANGE-REQUESTS/trunk-round-62.md
git commit -m "docs: round 62 — a package is withdrawn, never deleted"
```
