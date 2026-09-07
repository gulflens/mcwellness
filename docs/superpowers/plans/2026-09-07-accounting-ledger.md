# The Books: Ledger (Piece Eleven) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the practice its own general ledger inside the platform — a chart of accounts, an append-only journal that every existing money event posts itself into, financial years with a lock and a lock date, four computed statements, and exports — exactly as `docs/SPEC/accounting.md` specifies.

**Architecture:** A new `accounting` stream (worktree, migrations 450–454, `domain/accounting`, `app/api/accounting`, `app/admin/accounting`). Billing's tables are never touched: a security-definer function (454) hands the poster every unposted money event with amounts and dates and no household, and a pure function turns each event into a balanced journal draft that is inserted under a unique idempotency key. Statements are pure functions over the posted lines. Every rule is a pure function with a test; every rule about what may be written is enforced again by a database trigger.

**Tech Stack:** TypeScript, React + Vite (admin console), Hono routes, PostgreSQL 17 (Supabase image) with plpgsql triggers and RLS, zod, vitest (unit, jsdom screen tests, and `pnpm test:db` against the worktree's own Postgres), pnpm.

**Spec:** `docs/SPEC/accounting.md` (approved 2026-09-07 14:18). Read it first, whole. Then `docs/CHANGE-REQUESTS/accounting-01.md` (the shared-zone edits this plan applies in Tasks 1 and 16), `docs/PLAN/piece-eleven.md` (the operator's plan), `docs/SPEC/OWNERSHIP.md`, `.claude/rules/*.md`, `CLAUDE.md`.

## Global Constraints

- **Money is integer fils**, `Fils` from `domain/shared`; never a float, never `numeric` for currency. `formatFils` is the only formatter (CLAUDE.md).
- **Business rules are pure functions in `domain/accounting/`** with a test file named after each function; no `Date.now()`, no randomness — `now` and every date are arguments (`.claude/rules/testing.md`). Routes call domain functions and never restate a rule.
- **Every new table**: `id uuid pk`, `tenant_id uuid not null`, `created_at`, `updated_at`, `created_by`; `unique (tenant_id, id)`; `audit_row` trigger `enable always`; `set_updated_at` where updates are allowed; `comment on table … 'audited: no client - …'`; RLS enabled, all default privileges revoked, exactly the grants the spec names; a `-- Needs:` line and a `-- rollback:` block (`.claude/rules/data-model.md`). **No table here carries `client_id`.**
- **Migrations `450–454` only**, filename `NNN_description.sql`; `-- Needs:` may name only lower numbers; never edit a merged migration. The trunk's `958` is the one exception this plan writes outside the range (change request item 3).
- **The books name nobody**: no route, function, statement, memo default, CSV or screen carries a client id, a name, an invoice number, a payment reference or a phone number. Memos are ≤ 200 characters.
- **Written once**: `journal_entry` and `journal_line` are never updated or deleted, for any role.
- **Reads are reads**: no `GET` writes. The Books page calls `POST /api/accounting/post` when it opens.
- **Every write route** requires a non-blank `X-Reason` header (the practice routes' pattern, `app/api/practice/routes.ts`) and answers `400 { error: 'reason_required' }` without it. Responses are parsed through zod before they leave. Refusals: `403 { error: 'forbidden', requestId }`, `400 { error: 'bad_request', code, requestId }`, `404 { error: 'not_found', requestId }`, `409 { error: 'conflict', code, requestId }`.
- **Edit only accounting's paths** plus the exact shared-zone files the change request names; nothing in `app/api/billing`, `domain/billing`, `db/policies/billing` changes.
- **Synthetic data only** in tests and fixtures: ids of the form `0000000K-0000-4000-8000-…` (K one hex digit) or `000000KK-…`; names from `db/seed/names.ts` or plainly synthetic ("Synthetic Bookkeeper").
- **Copy words**: no ALL-CAPS labels, no arrows on buttons, "AED" named once per table (the column header), tabular figures via the `numeric` column flag, right-side drawers not modals, colours only from tokens (`.claude/rules/ui.md`, `docs/DESIGN-BRIEF.md`).
- **Commands, always with an explicit timeout when run by an agent** (a silent ten-minute command stalled a builder before): `pnpm test <file>` for one file while iterating, `pnpm test:db` for the database suite, `pnpm verify` and `pnpm build` before declaring done. Conventional commits, small.

---

## Task 0: Open the worktree

**Files:** none edited. The integrator has already added the `accounting` row to `docs/SPEC/OWNERSHIP.md` and `scripts/worktree.mjs` on branch `accounting-spec-1`.

- [ ] **Step 1: From the trunk checkout on branch `accounting-spec-1`, open the worktree from that branch**

```bash
cd /Volumes/Storage/McWellness/mcwellness
git branch --show-current            # must print accounting-spec-1
pnpm worktree:add accounting accounting-spec-1
```

Expected: `../mcwellness-accounting` exists on new branch `accounting`, its `.env` has `DB_PORT=5441`, `PORT=3009`, `WEB_PORT=5182`, `COMPOSE_PROJECT_NAME=mcwellness-accounting`; its database is up, migrated and seeded. Docker must be running.

- [ ] **Step 2: Prove the worktree is healthy before touching it**

```bash
cd /Volumes/Storage/McWellness/mcwellness-accounting
pnpm -s typecheck && pnpm test 2>&1 | tail -3
```

Expected: typecheck clean; the unit suite green.

Every later step runs in `/Volumes/Storage/McWellness/mcwellness-accounting`.

---

## Task 1: The four actions, the access wrappers, and the screen rule

**Files:**
- Modify: `domain/shared/actor.ts` (shared zone — change request item 4; add the four actions and their cases)
- Modify: `domain/shared/actor.test.ts` (add the four actions' role rows to whatever table it pins)
- Create: `app/api/accounting/access.ts`
- Create: `tests/accounting/access.test.ts`
- Modify: `app/shell/adminAccess.ts` (add `canOpenBooks`)
- Modify: `app/shell/adminAccess.test.ts` if one exists (`ls app/shell/*.test.ts`)

**Interfaces:**
- Produces: `Action` gains `{ type: 'accounting.read' } | { type: 'accounting.write' } | { type: 'accounting.year.close' } | { type: 'accounting.settings.write' }`.
- Produces: `mayReadBooks(actor, now)`, `mayWriteBooks(actor, now)`, `mayCloseYear(actor, now)`, `mayChangeBooksSettings(actor, now)` — all `(actor: Actor, now: Date) => boolean`.
- Produces: `canOpenBooks(actor: Actor, now: Date): boolean`.

- [ ] **Step 1: Write the failing access test**

`tests/accounting/access.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Actor, Role } from '../../domain/shared';
import {
  mayChangeBooksSettings,
  mayCloseYear,
  mayReadBooks,
  mayWriteBooks,
} from '../../app/api/accounting/access';

/**
 * Every books permission against every role, pinned (docs/SPEC/accounting.md
 * section 3): the owner and finance read and post; only the owner closes a
 * year, locks a date or changes the settings; nobody else touches the books.
 */
const NOW = new Date('2026-09-07T09:00:00+04:00');

function actorWith(...roles: Role[]): Actor {
  return {
    userId: '00000002-0000-4000-8000-000000000001',
    tenantId: '00000001-0000-4000-8000-000000000001',
    roles,
    capabilities: [],
  };
}

const ROLES: Role[] = [
  'owner',
  'admin',
  'finance',
  'lead_practitioner',
  'practitioner',
  'client_contact',
];

const TABLE: Record<Role, { read: boolean; write: boolean; owner: boolean }> = {
  owner: { read: true, write: true, owner: true },
  finance: { read: true, write: true, owner: false },
  admin: { read: false, write: false, owner: false },
  lead_practitioner: { read: false, write: false, owner: false },
  practitioner: { read: false, write: false, owner: false },
  client_contact: { read: false, write: false, owner: false },
};

describe('who may keep the books', () => {
  for (const role of ROLES) {
    const expected = TABLE[role];
    it(`${role}: read ${expected.read}, write ${expected.write}, owner acts ${expected.owner}`, () => {
      const actor = actorWith(role);
      expect(mayReadBooks(actor, NOW)).toBe(expected.read);
      expect(mayWriteBooks(actor, NOW)).toBe(expected.write);
      expect(mayCloseYear(actor, NOW)).toBe(expected.owner);
      expect(mayChangeBooksSettings(actor, NOW)).toBe(expected.owner);
    });
  }

  it('an admin who is also finance reads and posts through the finance role', () => {
    const actor = actorWith('admin', 'finance');
    expect(mayReadBooks(actor, NOW)).toBe(true);
    expect(mayCloseYear(actor, NOW)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm test tests/accounting/access.test.ts`
Expected: FAIL — cannot resolve `../../app/api/accounting/access`.

- [ ] **Step 3: Add the four actions to `domain/shared/actor.ts`**

In the `Action` union, after `| { type: 'billing.balance.read'; clientId: string }`:

```ts
  | { type: 'accounting.read' }
  | { type: 'accounting.write' }
  | { type: 'accounting.year.close' }
  | { type: 'accounting.settings.write' }
```

In `canActor`'s switch, after the `billing.balance.read` case's block:

```ts
    case 'accounting.read':
    case 'accounting.write':
      // The books (docs/SPEC/accounting.md section 3): the owner and finance.
      // An admin records a household's money (billing.payment.write) but does
      // not keep the practice's books; piece twelve admits an admin to
      // expenses and to nothing else.
      return hasRole(actor, 'owner', 'finance');
    case 'accounting.year.close':
    case 'accounting.settings.write':
      // Closing a year, locking a date and the books' own settings are the
      // owner's alone.
      return hasRole(actor, 'owner');
```

Open `domain/shared/actor.test.ts`; find how it pins actions against roles and add the four actions with the audiences above in the same shape (the file's own table or `it` blocks — follow it exactly).

- [ ] **Step 4: Write `app/api/accounting/access.ts`**

```ts
import type { Actor } from '../../../domain/shared';
import { canActor } from '../../../domain/shared';

/**
 * Who may do each of the books' actions (docs/SPEC/accounting.md sections 3
 * and 10). Each wrapper names what a route is doing and asks `canActor` for
 * the action of that name; the audiences live once, in domain/shared/actor.ts.
 * tests/accounting/access.test.ts pins every wrapper against every role.
 */

/** Reading the journal, the chart, the years, the settings and every statement. */
export function mayReadBooks(actor: Actor, now: Date): boolean {
  return canActor(actor, { type: 'accounting.read' }, {}, now);
}

/** Running the poster, posting a manual or opening entry, reversing, adding or amending an account. */
export function mayWriteBooks(actor: Actor, now: Date): boolean {
  return canActor(actor, { type: 'accounting.write' }, {}, now);
}

/** Closing or reopening a financial year. */
export function mayCloseYear(actor: Actor, now: Date): boolean {
  return canActor(actor, { type: 'accounting.year.close' }, {}, now);
}

/** The books' settings and the lock date. */
export function mayChangeBooksSettings(actor: Actor, now: Date): boolean {
  return canActor(actor, { type: 'accounting.settings.write' }, {}, now);
}
```

- [ ] **Step 5: Add `canOpenBooks` to `app/shell/adminAccess.ts`**

After `canOpenBilling`:

```ts
/** Matches `accounting.read` (app/api/accounting) — who may open the Books. */
export function canOpenBooks(actor: Actor, now: Date): boolean {
  return canActor(actor, { type: 'accounting.read' }, {}, now);
}
```

If `app/shell/adminAccess.test.ts` exists, add: owner and finance may open Books; admin, lead practitioner, practitioner may not.

- [ ] **Step 6: Run the tests**

Run: `pnpm test tests/accounting/access.test.ts domain/shared/actor.test.ts app/shell`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add domain/shared/actor.ts domain/shared/actor.test.ts app/api/accounting/access.ts tests/accounting/access.test.ts app/shell/adminAccess.ts app/shell/adminAccess.test.ts
git commit -m "feat(accounting): the four accounting actions, their access wrappers and canOpenBooks"
```

---

## Task 2: Domain types, dates, and the journal rules

**Files:**
- Create: `domain/accounting/types.ts`
- Create: `domain/accounting/dates.ts`, `domain/accounting/dates.test.ts`
- Create: `domain/accounting/journal.ts`, `domain/accounting/journal.test.ts`

**Interfaces (Produces — every later task uses these names exactly):**

```ts
// types.ts
export const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'income', 'expense'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];
export const ACCOUNT_ROLES = [
  'bank', 'cash', 'link_clearing', 'receivable', 'refunds_payable', 'contract_liability',
  'vat_payable', 'opening_balance', 'income_sessions', 'income_assessments', 'income_fees',
  'income_expired',
] as const;
export type AccountRole = (typeof ACCOUNT_ROLES)[number];
export const CASH_ROLES: readonly AccountRole[] = ['bank', 'cash', 'link_clearing'];
export type ChartAccount = {
  id: string; code: string; name: string; nameAr: string | null;
  type: AccountType; role: AccountRole | null; archivedAt: string | null;
};
export const JOURNAL_KINDS = ['opening', 'automatic', 'manual', 'reversal'] as const;
export type JournalKind = (typeof JOURNAL_KINDS)[number];
export type DraftLine = { accountId: string; debitFils: Fils; creditFils: Fils };
export type JournalSource = { table: string; id: string; event: string };
export type JournalDraft = {
  enteredOn: IsoDate; occurredOn: IsoDate | null; kind: JournalKind; memo: string;
  lines: readonly DraftLine[]; source: JournalSource | null;
};
export type PostedLine = {
  entryId: string; entryReference: string; enteredOn: IsoDate; kind: JournalKind; memo: string;
  accountId: string; accountCode: string; accountName: string; accountType: AccountType;
  accountRole: AccountRole | null; debitFils: Fils; creditFils: Fils;
};
export type FiscalYearStatus = 'open' | 'closed';
export type FiscalYear = { id: string; startsOn: IsoDate; endsOn: IsoDate; status: FiscalYearStatus };
export type BooksSetting = {
  booksStartOn: IsoDate; yearEndMonth: number; yearEndDay: number; lockedThrough: IsoDate | null;
  corporateTaxRateBasisPoints: number; corporateTaxThresholdFils: Fils;
  smallBusinessReliefElected: boolean; smallBusinessReliefThresholdFils: Fils;
};
```

```ts
// dates.ts
export function addDays(day: IsoDate, days: number): IsoDate;
export function isoDateOf(year: number, month: number, dayOfMonth: number): IsoDate;
export function yearOf(day: IsoDate): number;
export function isWithin(day: IsoDate, startsOn: IsoDate, endsOn: IsoDate): boolean; // inclusive
export function yearBoundsContaining(day: IsoDate, yearEndMonth: number, yearEndDay: number): { startsOn: IsoDate; endsOn: IsoDate };
// journal.ts
export class UnbalancedEntryError extends Error {}
export class MissingRoleError extends Error {}
export function assertBalanced(lines: readonly DraftLine[]): void;
export function reversalOf(lines: readonly DraftLine[]): DraftLine[];
export function accountByRole(chart: readonly ChartAccount[], role: AccountRole): ChartAccount;
export function codeMatchesType(code: string, type: AccountType): boolean;
export function mayArchive(account: ChartAccount, balanceFils: Fils): boolean;
export function balanceWithOpeningEquity(lines: readonly DraftLine[], chart: readonly ChartAccount[]): DraftLine[];
export function dr(accountId: string, amount: Fils): DraftLine;
export function cr(accountId: string, amount: Fils): DraftLine;
```

- [ ] **Step 1: Write `domain/accounting/types.ts`** with exactly the block above, importing `import type { Fils, IsoDate } from '../shared';`.

- [ ] **Step 2: Write the failing dates test**

`domain/accounting/dates.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { addDays, isWithin, isoDateOf, yearBoundsContaining, yearOf } from './dates';

describe('addDays', () => {
  it('crosses a month and a year end', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });
});

describe('yearBoundsContaining', () => {
  it('gives the calendar year for a 31 December year end', () => {
    expect(yearBoundsContaining('2026-09-07', 12, 31)).toEqual({
      startsOn: '2026-01-01',
      endsOn: '2026-12-31',
    });
    expect(yearBoundsContaining('2026-12-31', 12, 31).endsOn).toBe('2026-12-31');
    expect(yearBoundsContaining('2027-01-01', 12, 31).startsOn).toBe('2027-01-01');
  });
  it('gives a year that straddles two calendar years for a 30 June year end', () => {
    expect(yearBoundsContaining('2026-09-07', 6, 30)).toEqual({
      startsOn: '2026-07-01',
      endsOn: '2027-06-30',
    });
    expect(yearBoundsContaining('2026-06-30', 6, 30)).toEqual({
      startsOn: '2025-07-01',
      endsOn: '2026-06-30',
    });
  });
});

describe('isWithin', () => {
  it('is inclusive at both ends', () => {
    expect(isWithin('2026-01-01', '2026-01-01', '2026-12-31')).toBe(true);
    expect(isWithin('2026-12-31', '2026-01-01', '2026-12-31')).toBe(true);
    expect(isWithin('2027-01-01', '2026-01-01', '2026-12-31')).toBe(false);
  });
});

describe('isoDateOf and yearOf', () => {
  it('pad and read back', () => {
    expect(isoDateOf(2026, 2, 3)).toBe('2026-02-03');
    expect(yearOf('2026-02-03')).toBe(2026);
  });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `pnpm test domain/accounting/dates.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Write `domain/accounting/dates.ts`**

```ts
import type { IsoDate } from '../shared';

/**
 * Calendar arithmetic on YYYY-MM-DD strings. Every function is pure and reads
 * no clock. ISO dates compare correctly as strings, which the statements rely
 * on throughout; nothing here ever constructs a local-time Date.
 */

function parts(day: IsoDate): [number, number, number] {
  const [y, m, d] = day.split('-').map(Number);
  if (y === undefined || m === undefined || d === undefined || Number.isNaN(y + m + d)) {
    throw new RangeError(`Not a YYYY-MM-DD date: ${day}`);
  }
  return [y, m, d];
}

export function isoDateOf(year: number, month: number, dayOfMonth: number): IsoDate {
  return new Date(Date.UTC(year, month - 1, dayOfMonth)).toISOString().slice(0, 10);
}

export function addDays(day: IsoDate, days: number): IsoDate {
  const [y, m, d] = parts(day);
  return isoDateOf(y, m, d + days);
}

export function yearOf(day: IsoDate): number {
  return parts(day)[0];
}

/** Inclusive at both ends. */
export function isWithin(day: IsoDate, startsOn: IsoDate, endsOn: IsoDate): boolean {
  return day >= startsOn && day <= endsOn;
}

/**
 * The financial year containing `day` for a practice whose year ends on
 * `yearEndMonth`/`yearEndDay` (docs/SPEC/accounting.md section 4.4): the end
 * is the first such month-day on or after `day`; the start is the day after
 * the previous year end.
 */
export function yearBoundsContaining(
  day: IsoDate,
  yearEndMonth: number,
  yearEndDay: number,
): { startsOn: IsoDate; endsOn: IsoDate } {
  let endsOn = isoDateOf(yearOf(day), yearEndMonth, yearEndDay);
  if (endsOn < day) {
    endsOn = isoDateOf(yearOf(day) + 1, yearEndMonth, yearEndDay);
  }
  const startsOn = addDays(isoDateOf(yearOf(endsOn) - 1, yearEndMonth, yearEndDay), 1);
  return { startsOn, endsOn };
}
```

- [ ] **Step 5: Run the dates test** — Expected: PASS.

- [ ] **Step 6: Write the failing journal test**

`domain/accounting/journal.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { fils } from '../shared';
import {
  MissingRoleError,
  UnbalancedEntryError,
  accountByRole,
  assertBalanced,
  balanceWithOpeningEquity,
  codeMatchesType,
  cr,
  dr,
  mayArchive,
  reversalOf,
} from './journal';
import type { ChartAccount } from './types';

const BANK: ChartAccount = {
  id: '0000000e-0000-4000-8000-000000001010', code: '1010', name: 'Bank, operating', nameAr: null,
  type: 'asset', role: 'bank', archivedAt: null,
};
const OPENING: ChartAccount = {
  id: '0000000e-0000-4000-8000-000000003100', code: '3100', name: 'Opening balance equity', nameAr: null,
  type: 'equity', role: 'opening_balance', archivedAt: null,
};
const GENERAL: ChartAccount = {
  id: '0000000e-0000-4000-8000-000000006000', code: '6000', name: 'General expenses', nameAr: null,
  type: 'expense', role: null, archivedAt: null,
};
const CHART = [BANK, OPENING, GENERAL];

describe('assertBalanced', () => {
  it('accepts an entry whose debits equal its credits', () => {
    expect(() => assertBalanced([dr(BANK.id, fils(500)), cr(OPENING.id, fils(500))])).not.toThrow();
  });
  it('refuses fewer than two lines', () => {
    expect(() => assertBalanced([dr(BANK.id, fils(500))])).toThrow(UnbalancedEntryError);
  });
  it('refuses unequal sides', () => {
    expect(() => assertBalanced([dr(BANK.id, fils(500)), cr(OPENING.id, fils(400))])).toThrow(
      UnbalancedEntryError,
    );
  });
  it('refuses a line with both sides or neither side', () => {
    expect(() =>
      assertBalanced([
        { accountId: BANK.id, debitFils: fils(5), creditFils: fils(5) },
        cr(OPENING.id, fils(0)),
      ]),
    ).toThrow(UnbalancedEntryError);
  });
});

describe('reversalOf', () => {
  it('swaps every line and keeps the order', () => {
    expect(reversalOf([dr(BANK.id, fils(500)), cr(OPENING.id, fils(500))])).toEqual([
      cr(BANK.id, fils(500)),
      dr(OPENING.id, fils(500)),
    ]);
  });
});

describe('accountByRole', () => {
  it('finds the account with the role and throws when it is missing', () => {
    expect(accountByRole(CHART, 'bank')).toBe(BANK);
    expect(() => accountByRole(CHART, 'receivable')).toThrow(MissingRoleError);
  });
});

describe('codeMatchesType', () => {
  it('matches the first digit to the type', () => {
    expect(codeMatchesType('1010', 'asset')).toBe(true);
    expect(codeMatchesType('2400', 'liability')).toBe(true);
    expect(codeMatchesType('3000', 'equity')).toBe(true);
    expect(codeMatchesType('4000', 'income')).toBe(true);
    expect(codeMatchesType('5000', 'expense')).toBe(true);
    expect(codeMatchesType('6200', 'expense')).toBe(true);
    expect(codeMatchesType('4000', 'expense')).toBe(false);
    expect(codeMatchesType('101', 'asset')).toBe(false);
    expect(codeMatchesType('7000', 'expense')).toBe(false);
  });
});

describe('mayArchive', () => {
  it('allows a roleless account with a zero balance and nothing else', () => {
    expect(mayArchive(GENERAL, fils(0))).toBe(true);
    expect(mayArchive(GENERAL, fils(1))).toBe(false);
    expect(mayArchive(BANK, fils(0))).toBe(false);
    expect(mayArchive({ ...GENERAL, archivedAt: '2026-09-07T00:00:00Z' }, fils(0))).toBe(false);
  });
});

describe('balanceWithOpeningEquity', () => {
  it('adds one credit line on the opening-balance account for a debit-heavy draft', () => {
    const out = balanceWithOpeningEquity([dr(BANK.id, fils(10_000))], CHART);
    expect(out).toEqual([dr(BANK.id, fils(10_000)), cr(OPENING.id, fils(10_000))]);
  });
  it('adds one debit line when credits exceed debits', () => {
    const out = balanceWithOpeningEquity([cr(GENERAL.id, fils(300))], CHART);
    expect(out.at(-1)).toEqual(dr(OPENING.id, fils(300)));
  });
  it('returns the lines unchanged when they already balance', () => {
    const lines = [dr(BANK.id, fils(5)), cr(OPENING.id, fils(5))];
    expect(balanceWithOpeningEquity(lines, CHART)).toEqual(lines);
  });
});
```

- [ ] **Step 7: Run it to see it fail** — Expected: FAIL, module not found.

- [ ] **Step 8: Write `domain/accounting/journal.ts`**

```ts
import { addFils, fils, type Fils } from '../shared';
import type { AccountRole, AccountType, ChartAccount, DraftLine } from './types';

/**
 * The journal's own rules (docs/SPEC/accounting.md section 6, rules 1, 6, 7,
 * 8, 9): balanced or refused, roles found never assumed, a code matches its
 * type, an account with a role or a balance is not archived, and the opening
 * entry can be levelled with one line on the opening-balance account. The
 * database enforces rules 1, 2, 3 and 7 again (migration 453); this file is
 * what refuses a bad request before it ever reaches the database.
 */

export class UnbalancedEntryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnbalancedEntryError';
  }
}

export class MissingRoleError extends Error {
  constructor(role: AccountRole) {
    super(`The chart has no account with the role "${role}".`);
    this.name = 'MissingRoleError';
  }
}

const ZERO = fils(0);

export function dr(accountId: string, amount: Fils): DraftLine {
  return { accountId, debitFils: amount, creditFils: ZERO };
}

export function cr(accountId: string, amount: Fils): DraftLine {
  return { accountId, debitFils: ZERO, creditFils: amount };
}

function sides(lines: readonly DraftLine[]): { debits: Fils; credits: Fils } {
  let debits = ZERO;
  let credits = ZERO;
  for (const line of lines) {
    debits = addFils(debits, line.debitFils);
    credits = addFils(credits, line.creditFils);
  }
  return { debits, credits };
}

/** Rule 1. Throws `UnbalancedEntryError` naming the fault; returns nothing. */
export function assertBalanced(lines: readonly DraftLine[]): void {
  if (lines.length < 2) {
    throw new UnbalancedEntryError('An entry needs at least two lines.');
  }
  for (const line of lines) {
    const hasDebit = line.debitFils > 0;
    const hasCredit = line.creditFils > 0;
    if (hasDebit === hasCredit) {
      throw new UnbalancedEntryError('Each line carries exactly one side, greater than zero.');
    }
  }
  const { debits, credits } = sides(lines);
  if (debits !== credits) {
    throw new UnbalancedEntryError(`Debits ${debits} do not equal credits ${credits}.`);
  }
}

/** The reversing entry's lines: each side exchanged, order kept (section 4.2). */
export function reversalOf(lines: readonly DraftLine[]): DraftLine[] {
  return lines.map((line) => ({
    accountId: line.accountId,
    debitFils: line.creditFils,
    creditFils: line.debitFils,
  }));
}

/** Rule 6. */
export function accountByRole(chart: readonly ChartAccount[], role: AccountRole): ChartAccount {
  const found = chart.find((account) => account.role === role && account.archivedAt === null);
  if (!found) {
    throw new MissingRoleError(role);
  }
  return found;
}

/** Rule 7: four digits, first digit by type (5 or 6 for an expense). */
export function codeMatchesType(code: string, type: AccountType): boolean {
  if (!/^[1-6][0-9]{3}$/.test(code)) {
    return false;
  }
  const first = code[0];
  switch (type) {
    case 'asset':
      return first === '1';
    case 'liability':
      return first === '2';
    case 'equity':
      return first === '3';
    case 'income':
      return first === '4';
    case 'expense':
      return first === '5' || first === '6';
  }
}

/** Rule 8. */
export function mayArchive(account: ChartAccount, balanceFils: Fils): boolean {
  return account.role === null && account.archivedAt === null && balanceFils === 0;
}

/** Rule 9: the lines plus one on the opening-balance account for the difference, or unchanged. */
export function balanceWithOpeningEquity(
  lines: readonly DraftLine[],
  chart: readonly ChartAccount[],
): DraftLine[] {
  const { debits, credits } = sides(lines);
  if (debits === credits) {
    return [...lines];
  }
  const opening = accountByRole(chart, 'opening_balance');
  return debits > credits
    ? [...lines, cr(opening.id, fils(debits - credits))]
    : [...lines, dr(opening.id, fils(credits - debits))];
}
```

- [ ] **Step 9: Run both tests** — `pnpm test domain/accounting` — Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add domain/accounting/types.ts domain/accounting/dates.ts domain/accounting/dates.test.ts domain/accounting/journal.ts domain/accounting/journal.test.ts
git commit -m "feat(accounting): domain types, date arithmetic and the journal's rules"
```

---

## Task 3: Years, the lock, and the lock date

**Files:**
- Create: `domain/accounting/years.ts`, `domain/accounting/years.test.ts`

**Interfaces (Produces):**

```ts
export function mayPostOn(day: IsoDate, years: readonly FiscalYear[], lockedThrough: IsoDate | null): boolean;
export function landingDayFor(occurredOn: IsoDate, years: readonly FiscalYear[], lockedThrough: IsoDate | null): IsoDate;
export function mayCloseYear(year: FiscalYear, today: IsoDate, unpostedInYear: number): boolean;
export function mayChangeYearEnd(entryCount: number): boolean;
export function mayLockThrough(date: IsoDate, today: IsoDate): boolean;
export type LockMove = 'forward' | 'backward' | 'unchanged';
export function lockMove(current: IsoDate | null, next: IsoDate): LockMove;
export function yearContaining(day: IsoDate, years: readonly FiscalYear[]): FiscalYear | undefined;
```

- [ ] **Step 1: Write the failing test**

`domain/accounting/years.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { FiscalYear } from './types';
import {
  landingDayFor,
  lockMove,
  mayChangeYearEnd,
  mayCloseYear,
  mayLockThrough,
  mayPostOn,
  yearContaining,
} from './years';

const Y2025: FiscalYear = {
  id: '0000000e-0000-4000-8000-000000002025', startsOn: '2025-01-01', endsOn: '2025-12-31', status: 'closed',
};
const Y2026: FiscalYear = {
  id: '0000000e-0000-4000-8000-000000002026', startsOn: '2026-01-01', endsOn: '2026-12-31', status: 'open',
};
const YEARS = [Y2025, Y2026];

describe('mayPostOn (rule 3)', () => {
  it('refuses a day in a closed year', () => {
    expect(mayPostOn('2025-06-01', YEARS, null)).toBe(false);
  });
  it('refuses a day on or before the lock date, even in an open year', () => {
    expect(mayPostOn('2026-03-31', YEARS, '2026-03-31')).toBe(false);
    expect(mayPostOn('2026-04-01', YEARS, '2026-03-31')).toBe(true);
  });
  it('accepts a day in an open year, and a day no year row exists for yet', () => {
    expect(mayPostOn('2026-09-07', YEARS, null)).toBe(true);
    expect(mayPostOn('2027-02-01', YEARS, null)).toBe(true);
  });
});

describe('landingDayFor (rule 4)', () => {
  it('leaves an open, unlocked day alone', () => {
    expect(landingDayFor('2026-09-07', YEARS, null)).toBe('2026-09-07');
  });
  it('moves a closed-year day to the first day of the next open year', () => {
    expect(landingDayFor('2025-06-01', YEARS, null)).toBe('2026-01-01');
  });
  it('moves a locked day to the day after the lock', () => {
    expect(landingDayFor('2026-02-10', YEARS, '2026-03-31')).toBe('2026-04-01');
  });
  it('applies both when the day after the lock is still in a closed year', () => {
    const closed2026 = { ...Y2026, status: 'closed' as const };
    expect(landingDayFor('2025-06-01', [Y2025, closed2026], '2026-03-31')).toBe('2027-01-01');
  });
});

describe('mayCloseYear (rule 11)', () => {
  it('closes an open year whose last day has passed and nothing is unposted', () => {
    expect(mayCloseYear(Y2026, '2027-01-01', 0)).toBe(true);
    expect(mayCloseYear(Y2026, '2026-12-31', 0)).toBe(true);
  });
  it('refuses a year still running, an unposted event, or a closed year', () => {
    expect(mayCloseYear(Y2026, '2026-12-30', 0)).toBe(false);
    expect(mayCloseYear(Y2026, '2027-01-01', 1)).toBe(false);
    expect(mayCloseYear(Y2025, '2027-01-01', 0)).toBe(false);
  });
});

describe('mayChangeYearEnd (rule 10)', () => {
  it('only while the journal is empty', () => {
    expect(mayChangeYearEnd(0)).toBe(true);
    expect(mayChangeYearEnd(1)).toBe(false);
  });
});

describe('the lock date (rule 14)', () => {
  it('is never in the future', () => {
    expect(mayLockThrough('2026-09-07', '2026-09-07')).toBe(true);
    expect(mayLockThrough('2026-09-08', '2026-09-07')).toBe(false);
  });
  it('names the direction of a move', () => {
    expect(lockMove(null, '2026-03-31')).toBe('forward');
    expect(lockMove('2026-03-31', '2026-06-30')).toBe('forward');
    expect(lockMove('2026-06-30', '2026-03-31')).toBe('backward');
    expect(lockMove('2026-06-30', '2026-06-30')).toBe('unchanged');
  });
});

describe('yearContaining', () => {
  it('finds the row or nothing', () => {
    expect(yearContaining('2026-05-05', YEARS)).toBe(Y2026);
    expect(yearContaining('2028-05-05', YEARS)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to see it fail** — Expected: FAIL, module not found.

- [ ] **Step 3: Write `domain/accounting/years.ts`**

```ts
import type { IsoDate } from '../shared';
import { addDays, isWithin } from './dates';
import type { FiscalYear } from './types';

/**
 * Financial years, the close and the lock date (docs/SPEC/accounting.md
 * section 4.4; rules 3, 4, 10, 11, 14). A year that has no row yet is open:
 * rows are created on demand by app.fiscal_year_for (migration 452), so their
 * absence says only that nothing has been posted there.
 */

export function yearContaining(day: IsoDate, years: readonly FiscalYear[]): FiscalYear | undefined {
  return years.find((year) => isWithin(day, year.startsOn, year.endsOn));
}

/** Rule 3. */
export function mayPostOn(
  day: IsoDate,
  years: readonly FiscalYear[],
  lockedThrough: IsoDate | null,
): boolean {
  if (lockedThrough !== null && day <= lockedThrough) {
    return false;
  }
  return yearContaining(day, years)?.status !== 'closed';
}

/**
 * Rule 4: the day itself when it may be posted on; otherwise the first day
 * after the lock that falls in an open year. Each step forward is either the
 * day after the lock or the day after a closed year's end, so it terminates.
 */
export function landingDayFor(
  occurredOn: IsoDate,
  years: readonly FiscalYear[],
  lockedThrough: IsoDate | null,
): IsoDate {
  let candidate = occurredOn;
  if (lockedThrough !== null && candidate <= lockedThrough) {
    candidate = addDays(lockedThrough, 1);
  }
  for (;;) {
    const year = yearContaining(candidate, years);
    if (year === undefined || year.status !== 'closed') {
      return candidate;
    }
    candidate = addDays(year.endsOn, 1);
  }
}

/** Rule 11. */
export function mayCloseYear(year: FiscalYear, today: IsoDate, unpostedInYear: number): boolean {
  return year.status === 'open' && year.endsOn <= today && unpostedInYear === 0;
}

/** Rule 10. */
export function mayChangeYearEnd(entryCount: number): boolean {
  return entryCount === 0;
}

/** Rule 14, first half. */
export function mayLockThrough(date: IsoDate, today: IsoDate): boolean {
  return date <= today;
}

export type LockMove = 'forward' | 'backward' | 'unchanged';

/** Rule 14, second half: which way the lock moved, so the route asks why and the feed says which. */
export function lockMove(current: IsoDate | null, next: IsoDate): LockMove {
  if (current === null || next > current) {
    return 'forward';
  }
  return next < current ? 'backward' : 'unchanged';
}
```

- [ ] **Step 4: Run the test** — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add domain/accounting/years.ts domain/accounting/years.test.ts
git commit -m "feat(accounting): years, the close, the lock date and where a late event lands"
```

---

## Task 4: The posting rules

**Files:**
- Create: `domain/accounting/posting.ts`, `domain/accounting/posting.test.ts`

**Interfaces (Produces):**

```ts
export type MoneyEvent =
  | { event: 'invoice.issued'; sourceId: string; occurredOn: IsoDate; invoiceKind: 'session' | 'package' | 'call_out_fee' | 'statement'; netFils: Fils; vatFils: Fils; grossFils: Fils }
  | { event: 'fee.waived'; sourceId: string; occurredOn: IsoDate; netFils: Fils; vatFils: Fils; grossFils: Fils }
  | { event: 'payment.received'; sourceId: string; occurredOn: IsoDate; method: 'cash' | 'transfer' | 'link'; amountFils: Fils }
  | { event: 'credit.consumed'; sourceId: string; occurredOn: IsoDate; allocatedNetFils: Fils; serviceCode: string }
  | { event: 'credit.waived'; sourceId: string; occurredOn: IsoDate; allocatedNetFils: Fils; serviceCode: string; hasReplacement: boolean }
  | { event: 'credit.expired'; sourceId: string; occurredOn: IsoDate; allocatedNetFils: Fils }
  | { event: 'credit.refunded'; sourceId: string; occurredOn: IsoDate; allocatedNetFils: Fils };
export const SOURCE_TABLE: Record<MoneyEvent['event'], 'invoice' | 'payment' | 'entitlement'>;
export function postingsFor(event: MoneyEvent, chart: readonly ChartAccount[]): JournalDraft | null;
```

The draft's `enteredOn` is the event's `occurredOn` (the poster moves it with `landingDayFor` and sets `occurredOn` on the draft only when it moved — Task 11). Memos are fixed words, never an id: `'Invoice issued'`, `'Call-out fee charged'`, `'Call-out fee waived'`, `'Payment received'`, `'Credit used up'`, `'Credit restored'`, `'Credit expired'`, `'Credit refunded'`.

- [ ] **Step 1: Write the failing test**

`domain/accounting/posting.test.ts` — build a `CHART` of twelve role accounts (ids `0000000e-0000-4000-8000-0000000010NN`), then:

```ts
describe('postingsFor', () => {
  it('posts a package invoice to receivable, contract liability and VAT payable', () => {
    const draft = postingsFor(
      { event: 'invoice.issued', sourceId: INV, occurredOn: '2026-09-01', invoiceKind: 'package',
        netFils: fils(1_032_500), vatFils: fils(51_625), grossFils: fils(1_084_125) },
      CHART,
    );
    expect(draft?.kind).toBe('automatic');
    expect(draft?.source).toEqual({ table: 'invoice', id: INV, event: 'invoice.issued' });
    expect(draft?.lines).toEqual([
      dr(RECEIVABLE.id, fils(1_084_125)),
      cr(CONTRACT.id, fils(1_032_500)),
      cr(VAT.id, fils(51_625)),
    ]);
    expect(() => assertBalanced(draft!.lines)).not.toThrow();
  });
  it('omits the VAT line when VAT is zero', () => { /* session invoice vat 0 → two lines */ });
  it('posts a call-out fee to fee income', () => { /* Dr receivable gross, Cr income_fees net, Cr vat */ });
  it('posts nothing for a statement invoice', () => { expect(postingsFor({...invoiceKind:'statement'...}, CHART)).toBeNull(); });
  it('posts a payment to the account its method names', () => {
    // transfer → bank, cash → cash, link → link_clearing; Cr receivable
  });
  it('recognises a consumed credit as session or brain-map income by service code', () => {
    // 'brain-map' → income_assessments; 'nf-session' → income_sessions
  });
  it('restores the liability for a waived credit that has a replacement, and nothing otherwise', () => {
    // hasReplacement true → Dr income (by code) / Cr contract_liability; false → null
  });
  it('posts an expired credit to expired-credit income and a refunded one to refunds payable', () => {});
  it('throws MissingRoleError when the chart lacks a role the event needs', () => {
    expect(() => postingsFor(paymentEvent, CHART.filter((a) => a.role !== 'bank'))).toThrow(MissingRoleError);
  });
  it('every draft balances', () => { /* loop over one of each event, assertBalanced */ });
});
```

Write every case out in full with concrete figures; each `expect` names the exact lines.

- [ ] **Step 2: Run it to see it fail** — Expected: FAIL, module not found.

- [ ] **Step 3: Write `domain/accounting/posting.ts`**

```ts
import type { Fils, IsoDate } from '../shared';
import { accountByRole, assertBalanced, cr, dr } from './journal';
import type { ChartAccount, DraftLine, JournalDraft } from './types';

/**
 * docs/SPEC/accounting.md section 7, the posting rules: one money event in,
 * one balanced journal draft out, or null when the event posts nothing. The
 * chart is known only by roles (rule 6); amounts are the source row's own and
 * nothing is recomputed. Memos are fixed words: the books name nobody.
 */

export type MoneyEvent =
  | { event: 'invoice.issued'; sourceId: string; occurredOn: IsoDate; invoiceKind: 'session' | 'package' | 'call_out_fee' | 'statement'; netFils: Fils; vatFils: Fils; grossFils: Fils }
  | { event: 'fee.waived'; sourceId: string; occurredOn: IsoDate; netFils: Fils; vatFils: Fils; grossFils: Fils }
  | { event: 'payment.received'; sourceId: string; occurredOn: IsoDate; method: 'cash' | 'transfer' | 'link'; amountFils: Fils }
  | { event: 'credit.consumed'; sourceId: string; occurredOn: IsoDate; allocatedNetFils: Fils; serviceCode: string }
  | { event: 'credit.waived'; sourceId: string; occurredOn: IsoDate; allocatedNetFils: Fils; serviceCode: string; hasReplacement: boolean }
  | { event: 'credit.expired'; sourceId: string; occurredOn: IsoDate; allocatedNetFils: Fils }
  | { event: 'credit.refunded'; sourceId: string; occurredOn: IsoDate; allocatedNetFils: Fils };

export const SOURCE_TABLE: Record<MoneyEvent['event'], 'invoice' | 'payment' | 'entitlement'> = {
  'invoice.issued': 'invoice',
  'fee.waived': 'invoice',
  'payment.received': 'payment',
  'credit.consumed': 'entitlement',
  'credit.waived': 'entitlement',
  'credit.expired': 'entitlement',
  'credit.refunded': 'entitlement',
};

/** The brain map is the one service whose income has its own account. */
const ASSESSMENT_CODE = 'brain-map';

function incomeAccountFor(chart: readonly ChartAccount[], serviceCode: string): ChartAccount {
  return accountByRole(chart, serviceCode === ASSESSMENT_CODE ? 'income_assessments' : 'income_sessions');
}

function draft(event: MoneyEvent, memo: string, lines: DraftLine[]): JournalDraft {
  assertBalanced(lines);
  return {
    enteredOn: event.occurredOn,
    occurredOn: null,
    kind: 'automatic',
    memo,
    lines,
    source: { table: SOURCE_TABLE[event.event], id: event.sourceId, event: event.event },
  };
}

/** Appends a VAT line only when there is VAT. */
function withVat(lines: DraftLine[], vatLine: DraftLine | null): DraftLine[] {
  return vatLine && (vatLine.creditFils > 0 || vatLine.debitFils > 0) ? [...lines, vatLine] : lines;
}

export function postingsFor(event: MoneyEvent, chart: readonly ChartAccount[]): JournalDraft | null {
  switch (event.event) {
    case 'invoice.issued': {
      if (event.invoiceKind === 'statement') {
        return null;
      }
      const receivable = accountByRole(chart, 'receivable');
      const vat = accountByRole(chart, 'vat_payable');
      const credited =
        event.invoiceKind === 'call_out_fee'
          ? accountByRole(chart, 'income_fees')
          : accountByRole(chart, 'contract_liability');
      return draft(
        event,
        event.invoiceKind === 'call_out_fee' ? 'Call-out fee charged' : 'Invoice issued',
        withVat(
          [dr(receivable.id, event.grossFils), cr(credited.id, event.netFils)],
          cr(vat.id, event.vatFils),
        ),
      );
    }
    case 'fee.waived': {
      const receivable = accountByRole(chart, 'receivable');
      const fees = accountByRole(chart, 'income_fees');
      const vat = accountByRole(chart, 'vat_payable');
      return draft(
        event,
        'Call-out fee waived',
        [
          dr(fees.id, event.netFils),
          ...(event.vatFils > 0 ? [dr(vat.id, event.vatFils)] : []),
          cr(receivable.id, event.grossFils),
        ],
      );
    }
    case 'payment.received': {
      const role = event.method === 'transfer' ? 'bank' : event.method === 'cash' ? 'cash' : 'link_clearing';
      return draft(event, 'Payment received', [
        dr(accountByRole(chart, role).id, event.amountFils),
        cr(accountByRole(chart, 'receivable').id, event.amountFils),
      ]);
    }
    case 'credit.consumed':
      return draft(event, 'Credit used up', [
        dr(accountByRole(chart, 'contract_liability').id, event.allocatedNetFils),
        cr(incomeAccountFor(chart, event.serviceCode).id, event.allocatedNetFils),
      ]);
    case 'credit.waived':
      if (!event.hasReplacement) {
        return null;
      }
      return draft(event, 'Credit restored', [
        dr(incomeAccountFor(chart, event.serviceCode).id, event.allocatedNetFils),
        cr(accountByRole(chart, 'contract_liability').id, event.allocatedNetFils),
      ]);
    case 'credit.expired':
      return draft(event, 'Credit expired', [
        dr(accountByRole(chart, 'contract_liability').id, event.allocatedNetFils),
        cr(accountByRole(chart, 'income_expired').id, event.allocatedNetFils),
      ]);
    case 'credit.refunded':
      return draft(event, 'Credit refunded', [
        dr(accountByRole(chart, 'contract_liability').id, event.allocatedNetFils),
        cr(accountByRole(chart, 'refunds_payable').id, event.allocatedNetFils),
      ]);
  }
}
```

- [ ] **Step 4: Run the test** — Expected: PASS. (If `withVat`'s zero check reads awkwardly, simplify: pass `event.vatFils > 0 ? cr(vat.id, event.vatFils) : null`.)

- [ ] **Step 5: Commit**

```bash
git add domain/accounting/posting.ts domain/accounting/posting.test.ts
git commit -m "feat(accounting): the posting rules, one balanced draft per money event"
```

---

## Task 5: The statements

**Files:**
- Create: `domain/accounting/statements.ts`, `domain/accounting/statements.test.ts`

**Interfaces (Produces):**

```ts
export function balanceOf(type: AccountType, debitFils: Fils, creditFils: Fils): Fils; // natural direction
export type StatementRow = { accountCode: string; accountName: string; accountType: AccountType; balanceFils: Fils };
export type TrialBalanceRow = StatementRow & { debitFils: Fils; creditFils: Fils };
export function trialBalance(lines: readonly PostedLine[], asOf: IsoDate): { asOf: IsoDate; rows: TrialBalanceRow[]; totalDebitFils: Fils; totalCreditFils: Fils };
export function profitAndLoss(lines: readonly PostedLine[], from: IsoDate, to: IsoDate): { from: IsoDate; to: IsoDate; income: StatementRow[]; expenses: StatementRow[]; incomeFils: Fils; expenseFils: Fils; resultFils: Fils };
export function balanceSheet(lines: readonly PostedLine[], asOf: IsoDate, currentYearStartsOn: IsoDate): { asOf: IsoDate; assets: StatementRow[]; liabilities: StatementRow[]; equity: StatementRow[]; resultYearToDateFils: Fils; retainedEarningsFils: Fils; totalAssetsFils: Fils; totalLiabilitiesAndEquityFils: Fils };
export type CashFlowCategory = 'fromHouseholds' | 'forExpenses' | 'toOwners' | 'tax' | 'other' | 'transfers';
export function cashFlow(lines: readonly PostedLine[], from: IsoDate, to: IsoDate): { from: IsoDate; to: IsoDate; byCategory: Record<CashFlowCategory, Fils>; openingCashFils: Fils; netChangeFils: Fils; closingCashFils: Fils };
export type LedgerRow = { entryReference: string; enteredOn: IsoDate; memo: string; debitFils: Fils; creditFils: Fils; runningBalanceFils: Fils };
export function accountLedger(lines: readonly PostedLine[], accountCode: string, from: IsoDate, to: IsoDate): { openingBalanceFils: Fils; rows: LedgerRow[]; closingBalanceFils: Fils };
export function cashPosition(lines: readonly PostedLine[], asOf: IsoDate): { accounts: StatementRow[]; totalFils: Fils };
export class UnbalancedBooksError extends Error {}
```

Rules to encode: `balanceOf` is debit − credit for asset and expense, credit − debit for liability, equity and income; a signed `Fils` (negative allowed — `fils()` accepts negative integers). Trial balance rows are accounts with any movement up to `asOf`, sorted by code; totals are sums of debits and credits. Balance sheet: equity accounts plus `resultYearToDateFils` (= `profitAndLoss(currentYearStartsOn, asOf).resultFils`) plus `retainedEarningsFils` (= P&L over everything before `currentYearStartsOn`); throws `UnbalancedBooksError` if `totalAssetsFils !== totalLiabilitiesAndEquityFils`. Cash flow: for each entry (group lines by `entryId`) in the period that has at least one cash-role line: if every line is cash-role → `transfers` (net inflow, which is 0); else inflow = Σ cash debits − Σ cash credits, category by the non-cash lines: all `receivable` → `fromHouseholds`; all expense-type → `forExpenses`; all equity-type → `toOwners`; all `vat_payable` → `tax`; anything else or mixed → `other`. `openingCashFils` = cash position the day before `from`; `closingCashFils` = opening + net change; throws `UnbalancedBooksError` if closing ≠ `cashPosition(lines, to).totalFils`. Ledger: opening = balance before `from`, rows in the period sorted by `enteredOn` then `entryReference`, running balance in the account's natural direction.

- [ ] **Step 1: Write the failing test** — `domain/accounting/statements.test.ts` with a small fixture of `PostedLine`s: an opening entry (bank 10,000 / opening equity 10,000, 2026-01-01), a package invoice (receivable 1,050 / contract liability 1,000 / VAT 50, 2026-02-01), a payment (bank 1,050 / receivable 1,050, 2026-02-02), a credit used (contract liability 400 / session income 400, 2026-02-10), an expense entry (general expenses 200 / bank 200, 2026-02-15), all in fils ×100. Assert:
  - `trialBalance(...,'2026-02-28')` totals agree and equal 12,700.00 both sides (compute by hand and write the figure); the bank row balance is 10,850.00.
  - `profitAndLoss('2026-02-01','2026-02-28')` income 400.00, expenses 200.00, result 200.00.
  - `balanceSheet('2026-02-28','2026-01-01')` totals equal; `resultYearToDateFils` 200.00; `retainedEarningsFils` 0; and with the opening entry dated 2025-12-31 and `currentYearStartsOn` 2026-01-01, retained earnings are still 0 (an equity entry is not a result).
  - `balanceSheet` throws `UnbalancedBooksError` when a line is removed from the fixture.
  - `cashFlow('2026-02-01','2026-02-28')`: fromHouseholds 1,050.00, forExpenses −200.00, opening 10,000.00, closing 10,850.00.
  - `accountLedger('1010', ...)` running balances 10,000 → 11,050 → 10,850.
  - `cashPosition` sums the three cash roles.

- [ ] **Step 2: Run it to see it fail** — Expected: FAIL.

- [ ] **Step 3: Write `domain/accounting/statements.ts`** implementing the interfaces above. Skeleton:

```ts
import { addFils, fils, type Fils, type IsoDate } from '../shared';
import { addDays, isWithin } from './dates';
import { CASH_ROLES, type AccountType, type PostedLine } from './types';

export class UnbalancedBooksError extends Error { /* name = 'UnbalancedBooksError' */ }

const DEBIT_NATURAL: readonly AccountType[] = ['asset', 'expense'];

export function balanceOf(type: AccountType, debitFils: Fils, creditFils: Fils): Fils {
  return DEBIT_NATURAL.includes(type) ? fils(debitFils - creditFils) : fils(creditFils - debitFils);
}

type Totals = { code: string; name: string; type: AccountType; debit: Fils; credit: Fils };

function totalsByAccount(lines: readonly PostedLine[]): Map<string, Totals> { /* sum debit/credit per accountCode */ }
function inPeriod(lines, from, to) { return lines.filter((l) => isWithin(l.enteredOn, from, to)); }
function upTo(lines, asOf) { return lines.filter((l) => l.enteredOn <= asOf); }
function rowsOf(totals: Map<string, Totals>, types: readonly AccountType[]): StatementRow[] { /* filter by type, map to StatementRow with balanceOf, sort by code */ }
function sum(rows: readonly StatementRow[]): Fils { /* addFils over balanceFils */ }

export function trialBalance(lines, asOf) { /* totalsByAccount(upTo(lines, asOf)) → rows with debit, credit, balanceOf; totals */ }
export function profitAndLoss(lines, from, to) { /* totalsByAccount(inPeriod) → income rows, expense rows, resultFils = incomeFils - expenseFils */ }
export function balanceSheet(lines, asOf, currentYearStartsOn) {
  const totals = totalsByAccount(upTo(lines, asOf));
  const assets = rowsOf(totals, ['asset']); const liabilities = rowsOf(totals, ['liability']); const equity = rowsOf(totals, ['equity']);
  const resultYearToDateFils = profitAndLoss(lines, currentYearStartsOn, asOf).resultFils;
  const retainedEarningsFils = currentYearStartsOn > '0000-01-01'
    ? profitAndLoss(lines, '0000-01-01', addDays(currentYearStartsOn, -1)).resultFils : fils(0);
  const totalAssetsFils = sum(assets);
  const totalLiabilitiesAndEquityFils = fils(sum(liabilities) + sum(equity) + resultYearToDateFils + retainedEarningsFils);
  if (totalAssetsFils !== totalLiabilitiesAndEquityFils) throw new UnbalancedBooksError(`Assets ${totalAssetsFils} do not equal liabilities and equity ${totalLiabilitiesAndEquityFils}.`);
  return { asOf, assets, liabilities, equity, resultYearToDateFils, retainedEarningsFils, totalAssetsFils, totalLiabilitiesAndEquityFils };
}
export function cashPosition(lines, asOf) { /* rows of accounts whose accountRole is in CASH_ROLES, from upTo */ }
export function cashFlow(lines, from, to) { /* group inPeriod by entryId; classify as described; opening = cashPosition(day before from); closing check */ }
export function accountLedger(lines, accountCode, from, to) { /* as described */ }
```

Write every function out in full; the skeleton shows the shape, not placeholders. Use `'0000-01-01'` as "the beginning of time" for retained earnings.

- [ ] **Step 4: Run the test** — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add domain/accounting/statements.ts domain/accounting/statements.test.ts
git commit -m "feat(accounting): trial balance, profit and loss, balance sheet, cash flow, ledgers"
```

---

## Task 6: Tax estimate, relief watch, CSV, and the barrel

**Files:**
- Create: `domain/accounting/tax.ts`, `domain/accounting/tax.test.ts`
- Create: `domain/accounting/csv.ts`, `domain/accounting/csv.test.ts`
- Create: `domain/accounting/index.ts`
- Check: `tests/lint/no-node-imports-in-browser-bundle.test.ts` — if it lists the domain barrels by name, add `domain/accounting/index.ts` and record it as item 11 of `docs/CHANGE-REQUESTS/accounting-01.md`.

**Interfaces (Produces):**

```ts
export function corporateTaxEstimate(resultYtdFils: Fils, revenueYtdFils: Fils, setting: Pick<BooksSetting, 'corporateTaxRateBasisPoints' | 'corporateTaxThresholdFils' | 'smallBusinessReliefElected' | 'smallBusinessReliefThresholdFils'>): Fils;
export type ReliefWatch = 'clear' | 'approaching' | 'exceeded';
export function reliefWatch(revenueYtdFils: Fils, thresholdFils: Fils): ReliefWatch; // approaching from 80 percent
export function toCsv(rows: readonly (readonly string[])[]): string; // RFC 4180: quote fields containing , " or a newline; CRLF; trailing CRLF
export function filsToDecimal(amount: number): string; // "1234.56", "-0.05", no grouping — for files, never screens
export const ZOHO_JOURNAL_HEADINGS: readonly string[]; // ['Journal Date','Reference Number','Notes','Account','Debit','Credit']
export function zohoJournalRows(lines: readonly PostedLine[]): string[][]; // headings first, date YYYY-MM-DD
export const ZOHO_ACCOUNT_HEADINGS: readonly string[]; // ['Account Code','Account Name','Account Type']
export function zohoAccountRows(chart: readonly ChartAccount[]): string[][]; // asset bank→'Bank', cash→'Cash', other asset→'Other Current Asset', liability→'Other Current Liability', equity→'Equity', income→'Income', expense→'Expense'
```

- [ ] **Step 1: Write the failing tax test** — cases: elected and revenue ≤ threshold → 0; elected and revenue > threshold → rate above taxable threshold; not elected → rate above threshold; result below threshold → 0 never negative; `reliefWatch` at 79.99%, 80%, 100%, 100.01%.

- [ ] **Step 2: Write `tax.ts`**

```ts
export function corporateTaxEstimate(resultYtdFils, revenueYtdFils, setting): Fils {
  if (setting.smallBusinessReliefElected && revenueYtdFils <= setting.smallBusinessReliefThresholdFils) return fils(0);
  const taxable = resultYtdFils - setting.corporateTaxThresholdFils;
  if (taxable <= 0) return fils(0);
  return fils(Math.floor((taxable * setting.corporateTaxRateBasisPoints) / 10_000));
}
export function reliefWatch(revenueYtdFils, thresholdFils): ReliefWatch {
  if (revenueYtdFils > thresholdFils) return 'exceeded';
  return revenueYtdFils * 10 >= thresholdFils * 8 ? 'approaching' : 'clear';
}
```

- [ ] **Step 3: Write the failing CSV test** — quoting of a memo with a comma and a quote; CRLF; `filsToDecimal(123456)` → `1234.56`, `(-5)` → `-0.05`; `zohoJournalRows` produces one row per line with the headings first; `zohoAccountRows` maps types as listed. **Before writing the headings, fetch Zoho Books' current import templates** (Zoho Books help: "Import journals", "Import chart of accounts") with WebFetch, copy the exact column names into the constants, and put the URL and date in a comment above each constant. If the fetched template differs from the defaults above, the template wins.

- [ ] **Step 4: Write `csv.ts`** to the interfaces; `toCsv` escapes `"` as `""`.

- [ ] **Step 5: Write `domain/accounting/index.ts`** exporting everything public from `types`, `dates`, `journal`, `years`, `posting`, `statements`, `tax`, `csv` (values and `export type` for types), browser-safe (no node imports anywhere under `domain/accounting`).

- [ ] **Step 6: Run** `pnpm test domain/accounting tests/lint` — Expected: PASS (fix the lint test's list if it enumerates barrels, and note the change request item).

- [ ] **Step 7: Commit**

```bash
git add domain/accounting docs/CHANGE-REQUESTS/accounting-01.md tests/lint
git commit -m "feat(accounting): tax estimate with the relief, CSV and Zoho-shaped rows, the barrel"
```

---

## Task 7: Migrations 450 and 451, policies, the trunk's 958, the bootstrap list

**Files:**
- Create: `db/migrations/450_accounting_setting.sql`
- Create: `db/migrations/451_account.sql`
- Create: `db/migrations/958_bootstrap_knows_the_books.sql` (trunk range; change request item 3)
- Create: `db/policies/accounting/tenant_isolation.sql`, `db/policies/accounting/access.sql`
- Modify: `tests/db/bootstrap-practice.test.ts` (the hard-coded list; change request item 10)
- Create: `tests/accounting/db/support.ts`, `tests/accounting/db/schema.test.ts`

**Interfaces (Produces):** tables `accounting_setting`, `account`; enums `account_type`, `account_role`; functions `app.default_accounting_setting()`, `app.next_journal_entry_number()`, `app.default_chart_rows()`, `app.default_chart_of_accounts()`; `app.bootstrap_practice` recreated with the two new rows.

- [ ] **Step 1: Write the failing database test**

`tests/accounting/db/support.ts` — copy `tests/billing/db/support.ts` wholesale (it is the harness: `startHarness`, `SEEDED`, `Harness`, `mint`), change the temp-dir prefix to `mcwellness-accounting-`, and **add** one helper:

```ts
/** A finance-only user for the positive role tests; the seed has none (its owner also holds finance). */
export const FINANCE = {
  userId: '0000000e-0000-4000-8000-0000000000f1',
  authId: '0000000e-0000-4000-8000-0000000000f2',
} as const;

export async function seedFinanceUser(h: Harness): Promise<void> {
  const { seedUser } = await import('../../db/helpers');
  await seedUser(h.owner, {
    id: FINANCE.userId,
    tenantId: SEED_TENANT_ID,
    authId: FINANCE.authId,
    displayName: 'Synthetic Bookkeeper',
    roles: ['finance'],
  });
}
```

(`SEED_TENANT_ID` from `db/seed/generate`.) Then `tests/accounting/db/schema.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED_TENANT_ID } from '../../../db/seed/generate';
import { startHarness, type Harness } from './support';

const NOW = () => new Date('2026-09-07T08:00:00.000Z');
let h: Harness;
beforeAll(async () => { h = await startHarness(NOW); });
afterAll(async () => { await h.close(); });

describe('the books settings and the chart, per practice', () => {
  it('gives the seeded practice one settings row with the defaults of section 8', async () => {
    const { rows } = await h.owner.query(
      'select books_start_on, year_end_month, year_end_day, locked_through, corporate_tax_rate_basis_points, ' +
        'corporate_tax_threshold_fils::text, small_business_relief_elected, small_business_relief_threshold_fils::text, next_entry_number ' +
        'from accounting_setting where tenant_id = $1', [SEED_TENANT_ID]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      year_end_month: 12, year_end_day: 31, locked_through: null,
      corporate_tax_rate_basis_points: 900, corporate_tax_threshold_fils: '37500000',
      small_business_relief_elected: true, small_business_relief_threshold_fils: '300000000',
      next_entry_number: 1,
    });
  });
  it('gives the seeded practice the sixteen default accounts with twelve roles', async () => {
    const { rows } = await h.owner.query<{ code: string; role: string | null }>(
      'select code, role from account where tenant_id = $1 order by code', [SEED_TENANT_ID]);
    expect(rows.map((r) => r.code)).toEqual(['1010','1020','1030','1200','1500','2100','2400','2500','3000','3100','4000','4100','4300','4400','6000','6200']);
    expect(rows.filter((r) => r.role !== null)).toHaveLength(12);
  });
  it('refuses an account whose code does not match its type, or a duplicate role', async () => {
    const { rejectsWith } = await import('../../db/helpers');
    await rejectsWith(h.owner, '23514', "insert into account (tenant_id, code, name, type) values ($1, '4999', 'Wrong', 'expense')", [SEED_TENANT_ID]);
    await rejectsWith(h.owner, '23505', "insert into account (tenant_id, code, name, type, role) values ($1, '1011', 'Second bank', 'asset', 'bank')", [SEED_TENANT_ID]);
  });
  it('hands out journal numbers one at a time from the settings row', async () => {
    const { asApiRole, rolledBack } = await import('../../db/helpers');
    await rolledBack(h.owner, () => asApiRole(h.owner, SEED_TENANT_ID, async () => {
      const a = await h.owner.query<{ n: number }>('select app.next_journal_entry_number() as n');
      const b = await h.owner.query<{ n: number }>('select app.next_journal_entry_number() as n');
      expect(b.rows[0]!.n).toBe(a.rows[0]!.n + 1);
    }, 'owner'));
  });
  it('lets a finance actor read the settings and the chart, and nobody outside the office', async () => {
    const { asApiRole, rolledBack } = await import('../../db/helpers');
    const count = (roles: string) => rolledBack(h.owner, () => asApiRole(h.owner, SEED_TENANT_ID, async () => {
      const { rows } = await h.owner.query<{ n: string }>('select count(*)::text as n from account');
      return Number(rows[0]!.n);
    }, roles));
    expect(await count('finance')).toBe(16);
    expect(await count('owner')).toBe(16);
    expect(await count('admin')).toBe(0);
    expect(await count('practitioner')).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to see it fail** — `pnpm test:db tests/accounting/db/schema.test.ts` — Expected: FAIL, relation `accounting_setting` does not exist.

- [ ] **Step 3: Write `db/migrations/450_accounting_setting.sql`**

Follow `202_scheduling_setting.sql`'s shape exactly (header comment explaining why; table; comments; index on `created_by`; `set_updated_at` and `audit_row` triggers with `enable always`; the default trigger; the grants block; the data step; the rollback). Header: `-- Needs: 000 (schema app, app_role, app.set_updated_at, app.current_tenant_id), 010 (tenant), 020 (app_user), 080 (app.audit_row), 097 (audit_client_id looks for the column)`. Table:

```sql
create table accounting_setting (
  id                                    uuid primary key default gen_random_uuid(),
  tenant_id                             uuid not null references tenant (id),
  books_start_on                        date not null default current_date,
  year_end_month                        smallint not null default 12 check (year_end_month between 1 and 12),
  year_end_day                          smallint not null default 31 check (year_end_day between 1 and 31),
  locked_through                        date,
  corporate_tax_rate_basis_points       integer not null default 900
                                          check (corporate_tax_rate_basis_points between 0 and 10000),
  corporate_tax_threshold_fils          bigint not null default 37500000 check (corporate_tax_threshold_fils >= 0),
  small_business_relief_elected         boolean not null default true,
  small_business_relief_threshold_fils  bigint not null default 300000000
                                          check (small_business_relief_threshold_fils >= 0),
  next_entry_number                     integer not null default 1 check (next_entry_number >= 1),
  created_at                            timestamptz not null default now(),
  updated_at                            timestamptz not null default now(),
  created_by                            uuid references app_user (id),
  constraint accounting_setting_year_end_is_a_day check (
    year_end_day <= case year_end_month
      when 2 then 28 when 4 then 30 when 6 then 30 when 9 then 30 when 11 then 30 else 31 end),
  unique (tenant_id),
  unique (tenant_id, id)
);
comment on table public.accounting_setting is
  'audited: no client - the practice''s books: start day, year end, lock date, tax estimate settings and the journal counter';
```

Then the counter, in `app.next_invoice_number()`'s shape (402): security definer, tenant from context, `insert … on conflict (tenant_id) do nothing` then `update … set next_entry_number = next_entry_number + 1 … returning next_entry_number - 1`; revoke from public, grant execute to `app_role`. Then `app.default_accounting_setting()` and its after-insert trigger on `tenant`; grants `select, update` to `app_role`; data step `insert into accounting_setting (tenant_id) select id from tenant on conflict (tenant_id) do nothing;`; rollback block dropping the policies, trigger, functions, table.

- [ ] **Step 4: Write `db/migrations/451_account.sql`**

`-- Needs: 000, 010, 020, 080, 097` (same list). Enums:

```sql
create type account_type as enum ('asset', 'liability', 'equity', 'income', 'expense');
create type account_role as enum (
  'bank', 'cash', 'link_clearing', 'receivable', 'refunds_payable', 'contract_liability',
  'vat_payable', 'opening_balance', 'income_sessions', 'income_assessments', 'income_fees',
  'income_expired'
);
```

Table:

```sql
create table account (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenant (id),
  code            text not null check (code ~ '^[1-6][0-9]{3}$'),
  name            text not null check (length(btrim(name)) between 1 and 80),
  name_ar         text check (name_ar is null or length(btrim(name_ar)) between 1 and 80),
  type            account_type not null,
  role            account_role,
  archived_at     timestamptz,
  archive_reason  text check (archive_reason is null or length(btrim(archive_reason)) between 1 and 200),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references app_user (id),
  constraint account_code_matches_type check (
    case type
      when 'asset' then left(code, 1) = '1'
      when 'liability' then left(code, 1) = '2'
      when 'equity' then left(code, 1) = '3'
      when 'income' then left(code, 1) = '4'
      else left(code, 1) in ('5', '6')
    end),
  constraint account_archive_is_reasoned check ((archived_at is null) = (archive_reason is null)),
  constraint account_with_a_role_stays check (role is null or archived_at is null),
  unique (tenant_id, code),
  unique (tenant_id, role),
  unique (tenant_id, id)
);
comment on table public.account is 'audited: no client - the practice''s chart of accounts';
```

The chart, written once and used twice:

```sql
create function app.default_chart_rows()
returns table (code text, name text, type account_type, role account_role)
language sql immutable
set search_path = pg_catalog, pg_temp
as $$
  values
    ('1010', 'Bank, operating',                   'asset'::account_type,     'bank'::account_role),
    ('1020', 'Cash box',                          'asset',                   'cash'),
    ('1030', 'Payment link clearing',             'asset',                   'link_clearing'),
    ('1200', 'Accounts receivable',               'asset',                   'receivable'),
    ('1500', 'Equipment, at cost',                'asset',                   null),
    ('2100', 'Refunds payable',                   'liability',               'refunds_payable'),
    ('2400', 'Contract liability, sessions owed', 'liability',               'contract_liability'),
    ('2500', 'VAT payable',                       'liability',               'vat_payable'),
    ('3000', 'Share capital',                     'equity',                  null),
    ('3100', 'Opening balance equity',            'equity',                  'opening_balance'),
    ('4000', 'Session income',                    'income',                  'income_sessions'),
    ('4100', 'Brain map income',                  'income',                  'income_assessments'),
    ('4300', 'Call-out fee income',               'income',                  'income_fees'),
    ('4400', 'Income from expired credits',       'income',                  'income_expired'),
    ('6000', 'General expenses',                  'expense',                 null),
    ('6200', 'Bank and payment fees',             'expense',                 null)
$$;
revoke execute on function app.default_chart_rows() from public;

create function app.default_chart_of_accounts() returns trigger
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  insert into public.account (tenant_id, code, name, type, role)
    select new.id, r.code, r.name, r.type, r.role from app.default_chart_rows() r
  on conflict (tenant_id, code) do nothing;
  return new;
end
$$;
revoke execute on function app.default_chart_of_accounts() from public;
create trigger default_chart_of_accounts after insert on public.tenant
  for each row execute function app.default_chart_of_accounts();
```

Indexes (`created_by`), triggers (`set_updated_at`, `audit_row` enable always), the grants block granting `select, insert, update` to `app_role`, then the data step — it must literally read `from tenant` for `tests/db/bootstrap-practice.test.ts`'s scanner:

```sql
insert into account (tenant_id, code, name, type, role)
  select t.id, r.code, r.name, r.type, r.role
    from tenant t cross join app.default_chart_rows() r
on conflict (tenant_id, code) do nothing;
```

Rollback block: drop trigger, functions, table, types.

- [ ] **Step 5: Write `db/policies/accounting/tenant_isolation.sql`** — the loop from `db/policies/billing/ledger.sql` section 1 over `['accounting_setting', 'account', 'fiscal_year', 'journal_entry', 'journal_line']` — **but 452 and 453 do not exist yet**, and the runner applies every policy file after every migrate on every database. Guard each table with `to_regclass`: wrap the loop body in `if to_regclass('public.' || t) is not null then … end if;` so the file is valid on a database that has only 450 and 451 (the same guard 956 uses). Do the same in `access.sql`:

```sql
-- Readers: the owner and finance, on all five (docs/SPEC/accounting.md section 10).
do $$
declare t text;
begin
  foreach t in array array['accounting_setting', 'account', 'fiscal_year', 'journal_entry', 'journal_line'] loop
    continue when to_regclass('public.' || t) is null;
    execute format('drop policy if exists books_readers on public.%I', t);
    execute format(
      'create policy books_readers on public.%I as restrictive for select to app_role '
      'using (app.actor_has_role(''owner'') or app.actor_has_role(''finance''))', t);
  end loop;
end $$;
-- Writers: inserting a journal entry, its lines, or an account: the owner and finance.
do $$ … foreach t in array array['journal_entry', 'journal_line', 'account'] … create policy books_writers … as restrictive for insert to app_role with check (owner or finance) … $$;
-- Amending an account (rename, archive): the owner and finance.
drop policy if exists account_amenders on public.account;
create policy account_amenders on public.account as restrictive for update to app_role
  using (app.actor_has_role('owner') or app.actor_has_role('finance'))
  with check (app.actor_has_role('owner') or app.actor_has_role('finance'));
-- The settings row and the years: the owner alone.
do $$ … foreach t in array array['accounting_setting', 'fiscal_year'] … continue when to_regclass … create policy books_owner_settings on public.%I as restrictive for update to app_role using (app.actor_has_role(''owner'')) with check (app.actor_has_role(''owner'')) … $$;
```

- [ ] **Step 6: Write `db/migrations/958_bootstrap_knows_the_books.sql`**

Header explaining item 3 of the change request and why 958 (957 is round 34's). `-- Needs: 450, 451, 956`. Body: `create or replace function app.bootstrap_practice(…)` — copy 956's function **verbatim** (`sed -n '/^create function app.bootstrap_practice/,/^\$\$;/p' db/migrations/956_bootstrap_practice.sql`), change `create function` to `create or replace function`, and in the `values` block add, after `('report_number_series', '600_report.sql')`:

```sql
        ('report_number_series',   '600_report.sql'),
        ('accounting_setting',     '450_accounting_setting.sql'),
        ('account',                '451_account.sql')
```

Re-state the revokes and the conditional `service_role` grant exactly as 956 does after the function, and update the `comment on function` to mention the two new defaults. Rollback: the 956 body verbatim as `create or replace`.

- [ ] **Step 7: Update `tests/db/bootstrap-practice.test.ts`'s hard-coded list** to

```ts
    expect(Object.keys(actual.counts).sort()).toEqual([
      'account',
      'accounting_setting',
      'goal_category',
      'invoice_number_series',
      'payment_receipt_series',
      'report_number_series',
      'scheduling_setting',
      'vat_setting',
    ]);
```

and its comment to name 450 and 451.

- [ ] **Step 8: Migrate and run the database tests**

```bash
pnpm db:migrate
pnpm test:db tests/accounting/db/schema.test.ts tests/db/bootstrap-practice.test.ts tests/db/schema.test.ts tests/db/constraints.test.ts tests/db/rls.test.ts tests/db/audit.test.ts
```

Expected: PASS. `tests/db/audit.test.ts` proves every public table is audited and classified; `constraints.test.ts` proves `unique (tenant_id, id)`; `schema.test.ts` proves RLS on every table.

- [ ] **Step 9: Commit**

```bash
git add db/migrations/450_accounting_setting.sql db/migrations/451_account.sql db/migrations/958_bootstrap_knows_the_books.sql db/policies/accounting tests/db/bootstrap-practice.test.ts tests/accounting/db/support.ts tests/accounting/db/schema.test.ts
git commit -m "feat(accounting): the books settings and the chart of accounts, per practice by trigger (450, 451, 958)"
```

---

## Task 8: Migrations 452 and 453 — years, the journal, the guards

**Files:**
- Create: `db/migrations/452_fiscal_year.sql`
- Create: `db/migrations/453_journal.sql`
- Create: `tests/accounting/db/journal_guards.test.ts`

**Interfaces (Produces):** tables `fiscal_year`, `journal_entry`, `journal_line`; enums `fiscal_year_status`, `journal_kind`; functions `app.fiscal_year_for(date) returns uuid`, `app.guard_fiscal_year_overlap()`, `app.guard_journal_entry()`, `app.guard_journal_immutable()`, `app.check_journal_balanced()`.

- [ ] **Step 1: Write the failing test** — `tests/accounting/db/journal_guards.test.ts`, using `rolledBack`, `asApiRole`, `rejectsWith` from `tests/db/helpers.ts` and `setAuditContext`; in each test look up the seeded chart's account ids by code. Cases (one `it` each, names as requirements):
  1. `app.fiscal_year_for('2026-09-07')` creates `2026-01-01 … 2026-12-31` open, and a second call returns the same id.
  2. An entry with two balanced lines commits, gets `number` 1 and `reference` `JE-000001`; a second entry gets `JE-000002`.
  3. An entry whose lines do not balance is refused **at commit** (insert the entry and lines inside a transaction, then `commit` → expect SQLSTATE `23514`; use a savepoint-free explicit `begin`/`commit` in this one test).
  4. An entry with one line is refused at commit.
  5. `update journal_entry set memo = 'x'` and `delete from journal_line` are refused with `42501` **on the owner's connection** (no `asApiRole`).
  6. An entry dated in a closed year is refused with `23514`: close 2025 by `update fiscal_year set status='closed', closed_at=now(), close_reason='test' where …` as owner, then insert an entry dated 2025-06-01 as the API role with owner roles.
  7. An entry dated on or before `locked_through` is refused with `23514`.
  8. An `opening` entry not dated `books_start_on` is refused; one dated `books_start_on` commits.
  9. A second fiscal year overlapping the first is refused with `23P01`.
  10. Finance may insert an entry; admin may not (`42501`).

- [ ] **Step 2: Run it to see it fail** — Expected: FAIL, relation `fiscal_year` does not exist.

- [ ] **Step 3: Write `db/migrations/452_fiscal_year.sql`**

`-- Needs: 000, 010, 020, 080, 095 (app.actor_has_role, app.current_actor_id), 097, 450 (accounting_setting)`.

```sql
create type fiscal_year_status as enum ('open', 'closed');

create table fiscal_year (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenant (id),
  starts_on      date not null,
  ends_on        date not null,
  status         fiscal_year_status not null default 'open',
  closed_at      timestamptz,
  closed_by      uuid references app_user (id),
  close_reason   text check (close_reason is null or length(btrim(close_reason)) between 1 and 200),
  reopened_at    timestamptz,
  reopened_by    uuid references app_user (id),
  reopen_reason  text check (reopen_reason is null or length(btrim(reopen_reason)) between 1 and 200),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid references app_user (id),
  check (ends_on > starts_on),
  constraint fiscal_year_closed_is_dated check (status <> 'closed' or closed_at is not null),
  constraint fiscal_year_close_is_reasoned check ((closed_at is null) = (close_reason is null)),
  constraint fiscal_year_reopen_is_reasoned check ((reopened_at is null) = (reopen_reason is null)),
  unique (tenant_id, starts_on),
  unique (tenant_id, id)
);
comment on table public.fiscal_year is 'audited: no client - the practice''s financial years and whether each is closed';
```

Overlap guard (btree_gist belongs to another stream's migration and may be absent, so a trigger rather than an exclusion constraint):

```sql
create function app.guard_fiscal_year_overlap() returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  if exists (
    select 1 from public.fiscal_year f
     where f.tenant_id = new.tenant_id and f.id <> new.id
       and f.starts_on <= new.ends_on and f.ends_on >= new.starts_on
  ) then
    raise exception 'financial years may not overlap' using errcode = 'exclusion_violation';
  end if;
  return new;
end
$$;
create trigger guard_fiscal_year_overlap before insert or update of starts_on, ends_on on public.fiscal_year
  for each row execute function app.guard_fiscal_year_overlap();
```

The on-demand row:

```sql
create function app.fiscal_year_for(p_on date) returns uuid
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_tenant_id uuid := app.current_tenant_id();
  v_id        uuid;
  v_month     smallint;
  v_day       smallint;
  v_end       date;
  v_start     date;
begin
  if v_tenant_id is null or p_on is null then
    raise exception 'No practice in context, or no day; a financial year cannot be found.'
      using errcode = 'invalid_parameter_value';
  end if;
  if not (app.actor_has_role('owner') or app.actor_has_role('finance')) then
    raise exception 'the practice''s financial years are not yours to read'
      using errcode = 'insufficient_privilege';
  end if;
  select id into v_id from public.fiscal_year
   where tenant_id = v_tenant_id and p_on between starts_on and ends_on;
  if v_id is not null then
    return v_id;
  end if;
  select year_end_month, year_end_day into v_month, v_day
    from public.accounting_setting where tenant_id = v_tenant_id;
  v_end := make_date(extract(year from p_on)::int, v_month, v_day);
  if v_end < p_on then
    v_end := make_date(extract(year from p_on)::int + 1, v_month, v_day);
  end if;
  v_start := make_date(extract(year from v_end)::int - 1, v_month, v_day) + 1;
  insert into public.fiscal_year (tenant_id, starts_on, ends_on, created_by)
    values (v_tenant_id, v_start, v_end, app.current_actor_id())
  on conflict (tenant_id, starts_on) do nothing;
  select id into v_id from public.fiscal_year
   where tenant_id = v_tenant_id and p_on between starts_on and ends_on;
  return v_id;
end
$$;
revoke execute on function app.fiscal_year_for(date) from public;
grant execute on function app.fiscal_year_for(date) to app_role;
```

Indexes, `set_updated_at`, `audit_row` enable always, grants `select, update` to `app_role` (insert only through the function), rollback.

- [ ] **Step 4: Write `db/migrations/453_journal.sql`**

`-- Needs: 000, 010, 020, 080, 095, 097, 450 (accounting_setting, app.next_journal_entry_number), 451 (account), 452 (fiscal_year)`.

```sql
create type journal_kind as enum ('opening', 'automatic', 'manual', 'reversal');

create table journal_entry (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenant (id),
  number             integer not null check (number >= 1),
  reference          text generated always as ('JE-' || lpad(number::text, 6, '0')) stored,
  entered_on         date not null,
  occurred_on        date,
  fiscal_year_id     uuid not null,
  kind               journal_kind not null,
  memo               text not null check (length(btrim(memo)) between 1 and 200),
  source_table       text check (source_table in ('invoice', 'payment', 'entitlement')),
  source_id          uuid,
  source_event       text check (source_event ~ '^[a-z_]+\.[a-z_]+$'),
  reverses_entry_id  uuid,
  reversal_reason    text check (reversal_reason is null or length(btrim(reversal_reason)) between 1 and 200),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid references app_user (id),
  constraint journal_entry_source_is_whole check (
    (source_table is null) = (source_id is null) and (source_table is null) = (source_event is null)),
  constraint journal_entry_automatic_has_source check ((kind = 'automatic') = (source_table is not null)),
  constraint journal_entry_reversal_is_reasoned check (
    (kind = 'reversal') = (reverses_entry_id is not null) and (reverses_entry_id is null) = (reversal_reason is null)),
  constraint journal_entry_occurred_differs check (occurred_on is null or occurred_on <> entered_on),
  unique (tenant_id, number),
  unique (tenant_id, source_table, source_id, source_event),
  unique (tenant_id, reverses_entry_id),
  unique (tenant_id, id),
  foreign key (tenant_id, fiscal_year_id) references fiscal_year (tenant_id, id),
  foreign key (tenant_id, reverses_entry_id) references journal_entry (tenant_id, id)
);
comment on table public.journal_entry is 'audited: no client - the general journal: one balanced, append-only entry per money event; names no household';

create table journal_line (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenant (id),
  entry_id     uuid not null,
  line_no      integer not null check (line_no >= 1),
  account_id   uuid not null,
  debit_fils   bigint not null default 0 check (debit_fils >= 0),
  credit_fils  bigint not null default 0 check (credit_fils >= 0),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references app_user (id),
  constraint journal_line_has_one_side check ((debit_fils > 0) <> (credit_fils > 0)),
  unique (tenant_id, entry_id, line_no),
  unique (tenant_id, id),
  foreign key (tenant_id, entry_id) references journal_entry (tenant_id, id),
  foreign key (tenant_id, account_id) references account (tenant_id, id)
);
comment on table public.journal_line is 'audited: no client - one side of one journal entry';
```

Guards:

```sql
-- Before an entry is written: the year is the practice's, open, contains the
-- day; the day is after the lock; an opening entry is dated the books' start;
-- and the number is taken from the counter when none was given.
create function app.guard_journal_entry() returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
declare
  v_year     public.fiscal_year%rowtype;
  v_setting  public.accounting_setting%rowtype;
begin
  select * into v_year from public.fiscal_year where id = new.fiscal_year_id and tenant_id = new.tenant_id;
  if v_year.id is null then
    raise exception 'the entry names a financial year the practice does not have' using errcode = 'foreign_key_violation';
  end if;
  if new.entered_on < v_year.starts_on or new.entered_on > v_year.ends_on then
    raise exception 'the entry''s day is outside its financial year' using errcode = 'check_violation';
  end if;
  if v_year.status = 'closed' then
    raise exception 'the financial year is closed; the books take no entry dated inside it' using errcode = 'check_violation';
  end if;
  select * into v_setting from public.accounting_setting where tenant_id = new.tenant_id;
  if v_setting.locked_through is not null and new.entered_on <= v_setting.locked_through then
    raise exception 'the books are locked through %; the entry''s day is not open', v_setting.locked_through using errcode = 'check_violation';
  end if;
  if new.kind = 'opening' and new.entered_on <> v_setting.books_start_on then
    raise exception 'an opening entry is dated the books'' start day, %', v_setting.books_start_on using errcode = 'check_violation';
  end if;
  if new.number is null then
    new.number := app.next_journal_entry_number();
  end if;
  return new;
end
$$;
create trigger aa_guard_journal_entry before insert on public.journal_entry
  for each row execute function app.guard_journal_entry();
```

`number` must be nullable at insert time for that to work: declare it `integer` without `not null`, then add `alter table journal_entry alter column number set not null` **after** the trigger? A `before insert` trigger runs before not-null checks, so `number integer not null` is fine as written — the trigger fills it first. Keep `not null`.

```sql
create function app.guard_journal_immutable() returns trigger
language plpgsql
set search_path = pa_catalog, pg_temp
as $$
begin
  raise exception 'a journal entry is never edited or deleted; post a reversing entry' using errcode = 'insufficient_privilege';
end
$$;
create trigger guard_journal_immutable before update or delete on public.journal_entry
  for each row execute function app.guard_journal_immutable();
create trigger guard_journal_immutable before update or delete on public.journal_line
  for each row execute function app.guard_journal_immutable();
```

(Type `pg_catalog` correctly; the typo above is a reminder to read what you paste.)

```sql
-- At commit: at least two lines, debits equal credits, and every line's
-- account belongs to the entry's practice and is not archived.
create function app.check_journal_balanced() returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
declare
  v_entry_id uuid := case tg_table_name when 'journal_entry' then new.id else new.entry_id end;
  v_lines    integer;
  v_debit    bigint;
  v_credit   bigint;
begin
  select count(*), coalesce(sum(l.debit_fils), 0), coalesce(sum(l.credit_fils), 0)
    into v_lines, v_debit, v_credit
    from public.journal_line l where l.entry_id = v_entry_id;
  if v_lines < 2 then
    raise exception 'a journal entry needs at least two lines' using errcode = 'check_violation';
  end if;
  if v_debit <> v_credit then
    raise exception 'the entry does not balance: debits % against credits %', v_debit, v_credit using errcode = 'check_violation';
  end if;
  if exists (
    select 1 from public.journal_line l join public.account a on a.id = l.account_id
     where l.entry_id = v_entry_id and a.archived_at is not null
  ) then
    raise exception 'an archived account takes no new line' using errcode = 'check_violation';
  end if;
  return null;
end
$$;
create constraint trigger check_journal_balanced after insert on public.journal_entry
  deferrable initially deferred for each row execute function app.check_journal_balanced();
create constraint trigger check_journal_balanced after insert on public.journal_line
  deferrable initially deferred for each row execute function app.check_journal_balanced();
```

Indexes: `journal_entry (tenant_id, entered_on)`, `(tenant_id, fiscal_year_id)`, `(created_by)`, `(reverses_entry_id)`; `journal_line (tenant_id, account_id)`, `(entry_id)`, `(created_by)`. Triggers `set_updated_at` (present for the standard-column test, though the immutable guard fires first) and `audit_row` enable always on both. Grants: `select, insert` on both to `app_role`. Rollback block.

- [ ] **Step 5: Migrate, run the guard tests and the trunk's schema tests**

```bash
pnpm db:migrate && pnpm test:db tests/accounting/db tests/db/schema.test.ts tests/db/audit.test.ts tests/db/constraints.test.ts tests/db/rls.test.ts
```

Expected: PASS. (`tests/db/rls.test.ts` "never lets the API role delete" walks tables — the journal's deny comes from the guard trigger before any grant question, which is fine.)

- [ ] **Step 6: Commit**

```bash
git add db/migrations/452_fiscal_year.sql db/migrations/453_journal.sql tests/accounting/db/journal_guards.test.ts
git commit -m "feat(accounting): financial years and the append-only journal, guarded in the database (452, 453)"
```

---

## Task 9: Migration 454 — the events not yet in the books

**Files:**
- Create: `db/migrations/454_unposted_money_events.sql`
- Create: `tests/accounting/db/unposted_events.test.ts`

**Interfaces (Produces):** `app.unposted_money_events()` returning `(source_table text, source_id uuid, source_event text, occurred_on date, invoice_kind text, net_fils bigint, vat_fils bigint, gross_fils bigint, amount_fils bigint, method text, service_code text, has_replacement boolean)`.

- [ ] **Step 1: Write the failing test** — model it on `tests/db/practice-takings.test.ts`'s fixture, but on the seeded harness: as `h.owner`, insert for seeded client 0 a `payment` (`transfer`, 105,000 fils, `2026-04-14T09:00:00+04:00`), an `entitlement` (`complimentary`, allocated 90,000, status `available`, VAT version from `vat_setting`), then `update entitlement set status='consumed', consumption_kind='session', consumed_at='2026-04-20T10:00:00+04:00', consumed_by_appointment_id = <a seeded appointment id for that client, or insert one via the seed's own shape — if none is easy, use consumed_by_session_id from a seeded session; read `db/seed/generate.ts` for what exists>`; and for seeded client 1 the same payment, then `update client set status='erased'` for client 1. Assert, via `asApiRole` in `rolledBack`:
  1. As `finance` and as `owner`, `select * from app.unposted_money_events() order by 1,3,2` returns identical JSON, three or more rows, including both payments (the erased household's too).
  2. No row's text contains a client id, `clientId`, or `receipt`.
  3. `payment.received` rows carry `method` and `amount_fils`; the `credit.consumed` row carries `service_code` and `net_fils` 90000; `occurred_on` is `2026-04-14` for the payments (Dubai day).
  4. `practitioner` and `admin` get `42501`.
  5. After inserting a `journal_entry` with `source_table='payment', source_id=<payment 0>, source_event='payment.received'` (plus two lines) as owner, that payment no longer appears.

If a consumed entitlement cannot be built without a session row, keep the consumption assertion to `status = 'available'` (which returns nothing) and test consumption in Task 11's identity test instead, where the fixture is bigger; say so in a comment.

- [ ] **Step 2: Run it to see it fail** — Expected: FAIL, function does not exist.

- [ ] **Step 3: Write `db/migrations/454_unposted_money_events.sql`**

Header in 952's voice: why definer, why it names nobody, why the anti-join is the idempotency read back. Find `service_type`'s migration number with `grep -l 'create table service_type' db/migrations/0*.sql` and put it in the Needs line. `-- Needs: 010 (tenant, its timezone), 0NN (service_type), 095 (app.actor_has_role, app.current_tenant_id), 402 (invoice, payment), 403 (entitlement), 408 (invoice.waived_at, kind call_out_fee), 453 (journal_entry)`.

```sql
create function app.unposted_money_events()
returns table (
  source_table text, source_id uuid, source_event text, occurred_on date,
  invoice_kind text, net_fils bigint, vat_fils bigint, gross_fils bigint,
  amount_fils bigint, method text, service_code text, has_replacement boolean
)
language plpgsql stable security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_tenant_id uuid := app.current_tenant_id();
  v_tz        text;
begin
  if v_tenant_id is null then
    raise exception 'No practice in context; the unposted events cannot be read.'
      using errcode = 'invalid_parameter_value';
  end if;
  if not (app.actor_has_role('owner') or app.actor_has_role('finance')) then
    raise exception 'the practice''s books are not yours to keep'
      using errcode = 'insufficient_privilege';
  end if;
  select t.timezone into v_tz from public.tenant t where t.id = v_tenant_id;

  return query
  with posted as (
    select je.source_table, je.source_id, je.source_event
      from public.journal_entry je
     where je.tenant_id = v_tenant_id and je.source_table is not null
  )
  select 'invoice'::text, i.id, 'invoice.issued'::text, i.issued_on, i.kind::text,
         i.net_fils::bigint, i.vat_fils::bigint, i.gross_fils::bigint,
         null::bigint, null::text, null::text, null::boolean
    from public.invoice i
   where i.tenant_id = v_tenant_id
     and not exists (select 1 from posted p where p.source_table = 'invoice' and p.source_id = i.id and p.source_event = 'invoice.issued')
  union all
  select 'invoice', i.id, 'fee.waived', (i.waived_at at time zone v_tz)::date, i.kind::text,
         i.net_fils, i.vat_fils, i.gross_fils, null, null, null, null
    from public.invoice i
   where i.tenant_id = v_tenant_id and i.waived_at is not null
     and not exists (select 1 from posted p where p.source_table = 'invoice' and p.source_id = i.id and p.source_event = 'fee.waived')
  union all
  select 'payment', pm.id, 'payment.received', (pm.received_at at time zone v_tz)::date, null,
         null, null, null, pm.amount_fils::bigint, pm.method::text, null, null
    from public.payment pm
   where pm.tenant_id = v_tenant_id
     and not exists (select 1 from posted p where p.source_table = 'payment' and p.source_id = pm.id and p.source_event = 'payment.received')
  union all
  -- A waived credit was consumed first (403's constraint), so its consumption
  -- posts too, and the waiver's own row below unwinds it.
  select 'entitlement', e.id, 'credit.consumed', (e.consumed_at at time zone v_tz)::date, null,
         e.allocated_net_fils::bigint, null, null, null, null, st.code, null
    from public.entitlement e join public.service_type st on st.id = e.service_type_id
   where e.tenant_id = v_tenant_id and e.status in ('consumed', 'waived') and e.consumed_at is not null
     and not exists (select 1 from posted p where p.source_table = 'entitlement' and p.source_id = e.id and p.source_event = 'credit.consumed')
  union all
  select 'entitlement', e.id, 'credit.waived', (e.waived_at at time zone v_tz)::date, null,
         e.allocated_net_fils::bigint, null, null, null, null, st.code,
         exists (select 1 from public.entitlement r where r.tenant_id = e.tenant_id and r.replaces_entitlement_id = e.id)
    from public.entitlement e join public.service_type st on st.id = e.service_type_id
   where e.tenant_id = v_tenant_id and e.status = 'waived'
     and not exists (select 1 from posted p where p.source_table = 'entitlement' and p.source_id = e.id and p.source_event = 'credit.waived')
  union all
  select 'entitlement', e.id, 'credit.expired', e.expires_on, null,
         e.allocated_net_fils::bigint, null, null, null, null, null, null
    from public.entitlement e
   where e.tenant_id = v_tenant_id and e.status = 'expired'
     and not exists (select 1 from posted p where p.source_table = 'entitlement' and p.source_id = e.id and p.source_event = 'credit.expired')
  union all
  select 'entitlement', e.id, 'credit.refunded', (e.updated_at at time zone v_tz)::date, null,
         e.allocated_net_fils::bigint, null, null, null, null, null, null
    from public.entitlement e
   where e.tenant_id = v_tenant_id and e.status = 'refunded'
     and not exists (select 1 from posted p where p.source_table = 'entitlement' and p.source_id = e.id and p.source_event = 'credit.refunded')
  order by 4, 1, 3, 2;
end
$$;
comment on function app.unposted_money_events() is
  'Every billing row not yet in the journal, as amounts, days and kinds and nothing that names anybody; '
  'steps past the erasure gate on purpose and checks the caller''s role itself (docs/SPEC/accounting.md 4.3).';
revoke execute on function app.unposted_money_events() from public;
grant execute on function app.unposted_money_events() to app_role;
-- rollback:
--   drop function if exists app.unposted_money_events();
```

If `waived_at` is null on a waived credit in your database (403's constraint may allow it), fall back to `coalesce(e.waived_at, e.updated_at)`.

- [ ] **Step 4: Migrate and test** — `pnpm db:migrate && pnpm test:db tests/accounting/db/unposted_events.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add db/migrations/454_unposted_money_events.sql tests/accounting/db/unposted_events.test.ts
git commit -m "feat(accounting): app.unposted_money_events, the poster's read that names nobody (454)"
```

---

## Task 10: API schema, row readers, the read routes, the mount

**Files:**
- Create: `app/api/accounting/schema.ts`, `app/api/accounting/rows.ts`, `app/api/accounting/reason.ts`
- Create: `app/api/accounting/settings.ts` (GET), `app/api/accounting/accounts.ts` (GET list, GET ledger), `app/api/accounting/years.ts` (GET), `app/api/accounting/entries.ts` (GET list, GET one)
- Create: `app/api/accounting/routes.ts` (`mountAccounting`)
- Modify: `app/api/create-api.ts` (change request item 5: import and `mountAccounting(api, deps.now);` beside `mountBilling`)
- Create: `tests/accounting/db/reads.test.ts`

**Interfaces (Produces):**

```ts
// schema.ts (zod; copy IsoDate and its real-date refine from app/api/billing/schema.ts)
export const AccountRow = z.object({ id: z.uuid(), code: z.string(), name: z.string(), nameAr: z.string().nullable(), type: z.enum(ACCOUNT_TYPES), role: z.enum(ACCOUNT_ROLES).nullable(), archivedAt: z.string().nullable(), balanceFils: z.number().int() });
export const AccountsResponse = z.object({ accounts: z.array(AccountRow) });
export const LineRow = z.object({ lineNo: z.number().int(), accountId: z.uuid(), accountCode: z.string(), accountName: z.string(), debitFils: z.number().int().nonnegative(), creditFils: z.number().int().nonnegative() });
export const EntryRow = z.object({ id: z.uuid(), reference: z.string(), enteredOn: IsoDate, occurredOn: IsoDate.nullable(), kind: z.enum(JOURNAL_KINDS), memo: z.string(), sourceEvent: z.string().nullable(), reversesEntryId: z.uuid().nullable(), reversedByEntryId: z.uuid().nullable(), debitTotalFils: z.number().int().nonnegative() });
export const EntriesResponse = z.object({ entries: z.array(EntryRow), truncated: z.boolean() });
export const EntryResponse = z.object({ entry: EntryRow, lines: z.array(LineRow) });
export const YearRow = z.object({ id: z.uuid(), startsOn: IsoDate, endsOn: IsoDate, status: z.enum(['open', 'closed']), closedAt: z.string().nullable(), closeReason: z.string().nullable(), reopenedAt: z.string().nullable(), reopenReason: z.string().nullable() });
export const YearsResponse = z.object({ years: z.array(YearRow) });
export const SettingsResponse = z.object({ booksStartOn: IsoDate, yearEndMonth: z.number().int(), yearEndDay: z.number().int(), lockedThrough: IsoDate.nullable(), corporateTaxRateBasisPoints: z.number().int(), corporateTaxThresholdFils: z.number().int(), smallBusinessReliefElected: z.boolean(), smallBusinessReliefThresholdFils: z.number().int(), entryCount: z.number().int() });
export const LedgerResponse = z.object({ account: AccountRow, from: IsoDate, to: IsoDate, openingBalanceFils: z.number().int(), rows: z.array(z.object({ entryReference: z.string(), enteredOn: IsoDate, memo: z.string(), debitFils: z.number().int(), creditFils: z.number().int(), runningBalanceFils: z.number().int() })), closingBalanceFils: z.number().int() });
// rows.ts
export async function readChart(db: Db): Promise<ChartAccount[]>;
export async function readSetting(db: Db): Promise<BooksSetting & { entryCount: number }>;
export async function readYears(db: Db): Promise<(FiscalYear & { closedAt: string | null; closeReason: string | null; reopenedAt: string | null; reopenReason: string | null })[]>;
export async function readPostedLines(db: Db): Promise<PostedLine[]>; // the whole journal, for the statements (a position needs everything)
export async function readEntries(db: Db, filter: { from?: IsoDate; to?: IsoDate; accountId?: string; limit: number }): Promise<{ entries: EntryRow[]; truncated: boolean }>;
export async function readEntry(db: Db, id: string): Promise<{ entry: EntryRow; lines: LineRow[] } | null>;
// reason.ts
export function requiredReason(c: Context): string | null; // trimmed X-Reason, or null → caller answers 400 reason_required
```

`Db` is the type `c.get('db')` has (`app/api/_middleware/request-context.ts` exports it or its source; import from there).

- [ ] **Step 1: Write the failing test** — `tests/accounting/db/reads.test.ts`: mounts through `createApi` (the harness already does); `GET /api/accounting/settings` as owner → 200 with defaults and `entryCount: 0`; as finance (`seedFinanceUser`, `h.callAs(..., FINANCE.authId)`) → 200; as admin (`SEEDED.admin`) → 403; as practitioner → 403. `GET /api/accounting/accounts` → 16 rows, each `balanceFils: 0`, sorted by code. `GET /api/accounting/years` → `[]`. `GET /api/accounting/entries` → `{ entries: [], truncated: false }`. `GET /api/accounting/entries/<random uuid>` → 404. `GET /api/accounting/accounts/<id of 1010>/ledger?from=2026-01-01&to=2026-12-31` → opening 0, rows [], closing 0. Every response parses through the schema.

- [ ] **Step 2: Run it to see it fail** — Expected: FAIL, 404 on every route (unmounted).

- [ ] **Step 3: Write `schema.ts`, `rows.ts`, `reason.ts`** to the interfaces. `readPostedLines` SQL:

```sql
select l.entry_id, e.reference, e.entered_on::text as entered_on, e.kind::text as kind, e.memo,
       a.id as account_id, a.code, a.name, a.type::text as type, a.role::text as role,
       l.debit_fils::text as debit_fils, l.credit_fils::text as credit_fils
  from journal_line l
  join journal_entry e on e.tenant_id = l.tenant_id and e.id = l.entry_id
  join account a on a.tenant_id = l.tenant_id and a.id = l.account_id
 where l.tenant_id = app.current_tenant_id()
 order by e.entered_on, e.number, l.line_no
```

Map `bigint` text to `fils(Number(...))`. `readEntries`: newest first (`order by e.entered_on desc, e.number desc limit $n + 1`), `truncated = rows.length > limit`; `debitTotalFils` from a lateral sum; `reversedByEntryId` from a left join on `reverses_entry_id`; `accountId` filter via `exists (select 1 from journal_line …)`.

- [ ] **Step 4: Write the four read route files and `routes.ts`**

Every read route: `if (!mayReadBooks(actor, now())) return c.json({ error: 'forbidden', requestId }, 403);` then read and `Response.parse`. Query parameters through zod (`IsoDate`, `limit` default 200 max 500 → else `400 invalid_request`). `routes.ts`:

```ts
export function mountAccounting(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  mountSettings(api, now);
  mountAccounts(api, now);
  mountYears(api, now);
  mountEntries(api, now);
}
```

(Tasks 11–13 append `mountPosting`, `mountOverview`, `mountStatements`, `mountExports` here.) In `create-api.ts`, import `mountAccounting` from `./accounting/routes` and call it right after `mountBilling(api, deps.now);`.

- [ ] **Step 5: Run** `pnpm test:db tests/accounting/db/reads.test.ts tests/db/route-mounts.test.ts` — Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/api/accounting app/api/create-api.ts tests/accounting/db/reads.test.ts
git commit -m "feat(accounting): the books' read routes, schemas and row readers, mounted"
```

---

## Task 11: The poster, `POST /api/accounting/post`, the nightly job, and the identities

**Files:**
- Create: `app/api/accounting/poster.ts`, `app/api/accounting/post.ts`
- Create: `jobs/accounting/post-books.ts`
- Modify: `package.json` (change request item 7: `"job:post-books": "node --env-file-if-exists=.env --import tsx jobs/accounting/post-books.ts"`), `CLAUDE.md` Commands line (add `pnpm job:post-books`)
- Modify: `app/api/accounting/routes.ts` (add `mountPosting`)
- Create: `tests/accounting/db/posting.test.ts`

**Interfaces (Produces):**

```ts
// poster.ts
export type PostingReport = { posted: number; unknown: number };
export async function postPendingEvents(db: Db, now: () => Date): Promise<PostingReport>;
// post.ts → POST /api/accounting/post → 200 PostResponse { posted, unknown }
export const PostResponse = z.object({ posted: z.number().int(), unknown: z.number().int() }); // in schema.ts
```

- [ ] **Step 1: Write the failing identity test** — `tests/accounting/db/posting.test.ts`. Fixture as `h.owner` on the seeded practice (read `db/seed/generate.ts` and `tests/billing/db/support.ts` for what the seed provides: the price list via `setPracticePrices`, package inputs via `silverInput`). Build real activity **through billing's own API** where it exists, so the identities are proved against the platform's own rows:
  - `await setPracticePrices(h, SEED_TODAY)`; create the Silver package (`POST /api/billing/packages`, `silverInput(h, SEED_TODAY)`); sell it to seeded client 0 with a `transfer` payment for the gross (`POST /api/billing/sales` — read `app/api/billing/sales.ts` for the input shape) on `SEED_TODAY`.
  - Record a second payment of 50,000 fils in `cash` for client 0 (`POST /api/billing/payments`).
  - Consume one credit: as owner in SQL, `update entitlement set status='consumed', consumption_kind='session', consumed_at=$1, consumed_by_appointment_id=$2 where id = (select id from entitlement where client_id=$3 and status='available' order by created_at limit 1)` with an appointment you insert in the seed's own shape (or the seeded client's existing confirmed appointment if the seed has one — read `generate.ts`). If the constraint trigger `check_allocation` complains, read 403's function and adjust; a consumed credit keeps its allocation, so it should not.
  - Waive a call-out fee: insert a `call_out_fee` invoice for client 0 as owner (mirror 408's columns; `appointment_id` the same appointment), then `select app.waive_call_out_fee(id, 'test waiver — not needed')` as the API role with owner roles.
  - Erase seeded client 1 after giving it a payment (`update client set status='erased'`).

  Then:
  1. `POST /api/accounting/post` as finance → 200, `posted` ≥ 6, `unknown` 0; a second call → `posted` 0.
  2. Identities, comparing `GET /api/accounting/statements/trial-balance?asOf=<SEED_TODAY>` rows to figures read as `h.owner`:
     - 2400 balance = `deferredNetFils` from `GET /api/billing/summary?month=<SEED month>` as owner **and** as finance (same figure).
     - 1200 balance = Σ invoice gross − Σ payments − Σ waived gross.
     - 2500 balance = Σ invoice vat − Σ waived vat.
     - 1010 + 1020 + 1030 = Σ payments by method, each matching.
     - 4000 + 4100 for the month = `revenueRecognisedFils`; 4300 = 0 after the waiver (charged then waived).
     - totals agree.
  3. The erased household's payment is in 1010.
  4. Statements as owner and as finance are identical JSON.
  5. No response body from any accounting route contains a seeded client id, `INV-`, `RCP-`, or `clientId`.

- [ ] **Step 2: Run it to see it fail** — Expected: FAIL (404 on `/post`, then failing identities).

- [ ] **Step 3: Write `poster.ts`**

```ts
import { fils, isoDateIn } from '../../../domain/shared';
import { landingDayFor, postingsFor, type MoneyEvent } from '../../../domain/accounting';
import { readChart, readSetting, readYears } from './rows';

const PRACTICE_TIME_ZONE = 'Asia/Dubai';
const EVENTS_SQL = 'select * from app.unposted_money_events()';
const YEAR_SQL = 'select app.fiscal_year_for($1) as id';
const ENTRY_SQL =
  'insert into journal_entry (tenant_id, entered_on, occurred_on, fiscal_year_id, kind, memo, ' +
  'source_table, source_id, source_event, created_by) ' +
  "values (app.current_tenant_id(), $1, $2, $3, 'automatic', $4, $5, $6, $7, app.current_actor_id()) " +
  'on conflict (tenant_id, source_table, source_id, source_event) do nothing returning id';
const LINE_SQL =
  'insert into journal_line (tenant_id, entry_id, line_no, account_id, debit_fils, credit_fils, created_by) ' +
  'values (app.current_tenant_id(), $1, $2, $3, $4, $5, app.current_actor_id())';

type EventRow = { source_table: 'invoice' | 'payment' | 'entitlement'; source_id: string; source_event: string; occurred_on: string; invoice_kind: string | null; net_fils: string | null; vat_fils: string | null; gross_fils: string | null; amount_fils: string | null; method: string | null; service_code: string | null; has_replacement: boolean | null };

function toEvent(row: EventRow): MoneyEvent | null { /* switch on row.source_event; build the union member with fils(Number(...)); unknown event → null */ }

export async function postPendingEvents(db: Db, now: () => Date): Promise<PostingReport> {
  const chart = await readChart(db);
  const setting = await readSetting(db);
  let years = await readYears(db);
  const { rows } = await db.query<EventRow>(EVENTS_SQL);
  let posted = 0; let unknown = 0;
  for (const row of rows) {
    const event = toEvent(row);
    const draft = event ? postingsFor(event, chart) : null;
    if (!draft) { unknown += event ? 0 : 1; continue; }   // a null draft for a known event (statement, waiver without replacement) is neither posted nor unknown
    const enteredOn = landingDayFor(draft.enteredOn, years, setting.lockedThrough);
    const occurredOn = enteredOn === draft.enteredOn ? null : draft.enteredOn;
    const memo = occurredOn ? `${draft.memo} (occurred ${occurredOn})` : draft.memo;
    const year = await db.query<{ id: string }>(YEAR_SQL, [enteredOn]);
    const yearId = year.rows[0]!.id;
    if (!years.some((y) => y.id === yearId)) years = await readYears(db);
    const header = await db.query<{ id: string }>(ENTRY_SQL, [enteredOn, occurredOn, yearId, memo, draft.source!.table, draft.source!.id, draft.source!.event]);
    const entryId = header.rows[0]?.id;
    if (!entryId) continue;                                 // already posted by a concurrent run
    let lineNo = 1;
    for (const line of draft.lines) {
      await db.query(LINE_SQL, [entryId, lineNo, line.accountId, line.debitFils, line.creditFils]);
      lineNo += 1;
    }
    posted += 1;
  }
  return { posted, unknown };
}
```

Count `unknown` as: rows whose `source_event` `toEvent` does not know, plus `invoice.issued` rows of kind `statement` (the spec's "unknown" on the overview). Write `toEvent` fully.

- [ ] **Step 4: Write `post.ts`** — `POST /api/accounting/post`: `mayWriteBooks` or 403; `requiredReason` or 400 `reason_required`; `PostResponse.parse(await postPendingEvents(db, now))`; add `mountPosting` to `routes.ts`.

- [ ] **Step 5: Write `jobs/accounting/post-books.ts`** in the shape of `jobs/client/retry-erasure-deletions.ts`: connect with `DATABASE_URL` (the owner), `select id from tenant`, for each tenant: `begin`; `select set_config('app.tenant_id', $1, true), set_config('app.actor_roles', 'owner', true), set_config('app.actor_id', '', true), set_config('app.request_id', $2, true), set_config('app.reason', 'nightly posting', true)` with a fresh `randomUUID()`; `await postPendingEvents(client, () => new Date())`; `commit`; print `Practice N: posted X, unknown Y` (counts only, never an id). Exit code 1 on any failure, message only.

- [ ] **Step 6: Add the script to `package.json` and `CLAUDE.md`'s Commands line.**

- [ ] **Step 7: Run** `pnpm test:db tests/accounting/db/posting.test.ts` — Expected: PASS. Then run the job once against the worktree database: `pnpm job:post-books` — Expected: one line per practice, `posted 0` after the test's own run (the test database is reset per file; against the seeded worktree database, expect 0 unless you added activity).

- [ ] **Step 8: Commit**

```bash
git add app/api/accounting jobs/accounting package.json CLAUDE.md tests/accounting/db/posting.test.ts
git commit -m "feat(accounting): the poster, POST /api/accounting/post, the nightly job, and the identities proved"
```

---

## Task 12: The write routes — entries, reversals, accounts, settings, lock, years

**Files:**
- Modify: `app/api/accounting/entries.ts` (add POST, POST reversal), `accounts.ts` (POST, PATCH), `settings.ts` (PATCH, POST lock), `years.ts` (POST close, POST reopen)
- Modify: `app/api/accounting/schema.ts` (inputs below)
- Create: `tests/accounting/db/writes.test.ts`

**Interfaces (Produces, in `schema.ts`):**

```ts
export const CreateEntryInput = z.object({ kind: z.enum(['manual', 'opening']), enteredOn: IsoDate, memo: Memo, lines: z.array(z.object({ accountId: z.uuid(), debitFils: z.number().int().nonnegative(), creditFils: z.number().int().nonnegative() })).min(2).max(50), balanceWithOpeningEquity: z.boolean().default(false) });
export const ReversalInput = z.object({ reason: Reason });
export const CreateAccountInput = z.object({ code: z.string().regex(/^[1-6][0-9]{3}$/), name: Name80, nameAr: Name80.nullable().default(null), type: z.enum(ACCOUNT_TYPES) });
export const PatchAccountInput = z.object({ name: Name80.optional(), nameAr: Name80.nullable().optional(), archive: z.boolean().optional() });
export const PatchSettingsInput = z.object({ booksStartOn: IsoDate.optional(), yearEndMonth: z.number().int().min(1).max(12).optional(), yearEndDay: z.number().int().min(1).max(31).optional(), corporateTaxRateBasisPoints: z.number().int().min(0).max(10_000).optional(), corporateTaxThresholdFils: z.number().int().nonnegative().optional(), smallBusinessReliefElected: z.boolean().optional(), smallBusinessReliefThresholdFils: z.number().int().nonnegative().optional() });
export const LockInput = z.object({ lockedThrough: IsoDate });
// Memo, Reason, Name80: cleanText to 200/200/80 and isRealText (copy MINIMUM_REASON = 8 and isRealText from app/api/billing/schema.ts into this file — do not import across streams)
```

Behaviour (each a route; each checks `mayWriteBooks`/`mayChangeBooksSettings`/`mayCloseYear` first, then `requiredReason`):
- `POST /api/accounting/entries`: chart + setting + years read; `balanceWithOpeningEquity` applied when asked (kind `opening` only, else 400 `not_an_opening_entry`); `assertBalanced` → 400 `unbalanced`; `mayPostOn` false → 409 `period_locked`; opening entry not on `booksStartOn` → 400 `opening_day`; any line on an archived or unknown account → 400 `unknown_account`; `app.fiscal_year_for`, insert header (kind, no source) and lines; 201 `EntryResponse`.
- `POST /api/accounting/entries/:id/reversal`: 404 if missing; 409 `already_reversed` if `reversedByEntryId`; lines via `reversalOf`; `enteredOn` = `landingDayFor(today, years, lockedThrough)` where today = `isoDateIn(now(), 'Asia/Dubai')`; header with `kind: 'reversal'`, `reverses_entry_id`, `reversal_reason` = the X-Reason; 201.
- `POST /api/accounting/accounts`: `codeMatchesType` false → 400 `code_type_mismatch`; duplicate code → 409 `duplicate_code` (catch SQLSTATE 23505); 201 `AccountRow`.
- `PATCH /api/accounting/accounts/:id`: rename; `archive: true` → `mayArchive(account, balance)` false → 409 `cannot_archive`; sets `archived_at = now()`, `archive_reason` = reason; 200.
- `PATCH /api/accounting/settings`: owner only; `yearEndMonth`/`yearEndDay` present and `mayChangeYearEnd(entryCount)` false → 409 `journal_not_empty`; 200 `SettingsResponse`.
- `POST /api/accounting/lock`: owner only; `mayLockThrough(date, today)` false → 400 `lock_in_future`; `lockMove` computed; update `locked_through`; 200 `{ lockedThrough, move }`.
- `POST /api/accounting/years/:id/close`: owner only; runs `postPendingEvents` first; `unpostedInYear` = count of `app.unposted_money_events()` rows with `occurred_on` inside the year after that run; `mayCloseYear` false → 409 `year_not_closable`; update status/closed_at/closed_by/close_reason; 200 `YearRow`.
- `POST /api/accounting/years/:id/reopen`: owner only; 409 `year_not_closed` if open; update status open, `reopened_at`, `reopened_by`, `reopen_reason`; 200.

- [ ] **Step 1: Write the failing test** — `tests/accounting/db/writes.test.ts`, one `it` per behaviour above, positive and negative, plus: finance may post an entry and add an account but gets 403 on settings, lock, close; admin gets 403 everywhere; a write without `X-Reason` gets 400 `reason_required`; a reversal's lines are the original's swapped; after `POST /lock` with `2026-06-30`, a manual entry dated `2026-06-30` is 409 and one dated `2026-07-01` is 201; closing the current year (ends in the future) is 409; closing 2025 after posting an entry there succeeds and then an entry dated 2025 is 409; the audit trail (`select action, table_name from audit_log where table_name in ('journal_entry','fiscal_year','accounting_setting','account') order by occurred_at`) has a row for each write.

- [ ] **Step 2: Run it to see it fail** — Expected: FAIL, 404s.

- [ ] **Step 3: Implement the routes** as described, in the shape of `app/api/billing/payments.ts` (parse body with `safeParse`, `savepoint` around inserts that may hit a unique index, map SQLSTATE 23505 to 409). Write every route out; no route restates a rule — each calls the domain function named.

- [ ] **Step 4: Run** `pnpm test:db tests/accounting/db/writes.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/accounting tests/accounting/db/writes.test.ts
git commit -m "feat(accounting): manual and opening entries, reversals, accounts, settings, the lock date and the years"
```

---

## Task 13: Statements, the overview, and the exports

**Files:**
- Create: `app/api/accounting/statements.ts`, `app/api/accounting/overview.ts`, `app/api/accounting/exports.ts`, `app/api/accounting/csv-response.ts`
- Modify: `app/api/accounting/schema.ts` (responses below), `routes.ts` (mount the three)
- Create: `tests/accounting/db/statements.test.ts`

**Interfaces (Produces):**

```ts
export const StatementRowSchema = z.object({ accountCode: z.string(), accountName: z.string(), accountType: z.enum(ACCOUNT_TYPES), balanceFils: z.number().int() });
export const TrialBalanceResponse = z.object({ asOf: IsoDate, rows: z.array(StatementRowSchema.extend({ debitFils: z.number().int(), creditFils: z.number().int() })), totalDebitFils: z.number().int(), totalCreditFils: z.number().int() });
export const ProfitAndLossResponse = z.object({ from: IsoDate, to: IsoDate, income: z.array(StatementRowSchema), expenses: z.array(StatementRowSchema), incomeFils: z.number().int(), expenseFils: z.number().int(), resultFils: z.number().int() });
export const BalanceSheetResponse = z.object({ asOf: IsoDate, assets: z.array(StatementRowSchema), liabilities: z.array(StatementRowSchema), equity: z.array(StatementRowSchema), resultYearToDateFils: z.number().int(), retainedEarningsFils: z.number().int(), totalAssetsFils: z.number().int(), totalLiabilitiesAndEquityFils: z.number().int() });
export const CashFlowResponse = z.object({ from: IsoDate, to: IsoDate, byCategory: z.object({ fromHouseholds: z.number().int(), forExpenses: z.number().int(), toOwners: z.number().int(), tax: z.number().int(), other: z.number().int(), transfers: z.number().int() }), openingCashFils: z.number().int(), netChangeFils: z.number().int(), closingCashFils: z.number().int() });
export const OverviewResponse = z.object({ month: z.string(), asOf: IsoDate, fiscalYearStartsOn: IsoDate, resultYearToDateFils: z.number().int(), revenueYearToDateFils: z.number().int(), cashPositionFils: z.number().int(), cashAccounts: z.array(StatementRowSchema), receivableFils: z.number().int(), corporateTaxEstimateFils: z.number().int(), reliefWatch: z.enum(['clear', 'approaching', 'exceeded']), reliefThresholdFils: z.number().int(), reliefElected: z.boolean(), unpostedCount: z.number().int(), unknownCount: z.number().int(), recentEntries: z.array(EntryRow) });
```

Routes (all `mayReadBooks`):
- `GET /api/accounting/statements/trial-balance?asOf=` (default today), `profit-and-loss?from&to` (default the current financial year to today), `balance-sheet?asOf=`, `cash-flow?from&to`; each with a `.csv` twin (`…/trial-balance.csv?asOf=`) answering `text/csv; charset=utf-8` with `content-disposition: attachment; filename="trial-balance-<asOf>.csv"`, rows built by a small `statementCsv` per statement (headings then rows, amounts via `filsToDecimal`). `currentYearStartsOn` for the balance sheet = `yearBoundsContaining(asOf, setting.yearEndMonth, setting.yearEndDay).startsOn`.
- `GET /api/accounting/overview?month=` — reads lines once; `asOf` = today (Dubai); result YTD via `profitAndLoss(yearStart, asOf)`; `revenueYearToDateFils` = that P&L's `incomeFils`; `cashPosition`; receivable = balance of the `receivable` role account; `corporateTaxEstimate`; `reliefWatch`; unposted and unknown counts by reading `app.unposted_money_events()` and classifying with `toEvent`/`postingsFor` **without inserting** (export a `classifyPending(db)` from `poster.ts` that returns `{ pending, unknown }` counts); `recentEntries` = `readEntries` for the month, limit 50.
- `GET /api/accounting/exports/zoho-journal.csv?from&to` and `GET /api/accounting/exports/zoho-accounts.csv` — `toCsv(zohoJournalRows(...))`, `toCsv(zohoAccountRows(chart))`, attachment filenames `zoho-journal-<from>-<to>.csv`, `zoho-accounts.csv`.

- [ ] **Step 1: Write the failing test** — `tests/accounting/db/statements.test.ts`: reuse Task 11's fixture (factor it into `tests/accounting/db/fixture.ts` exporting `buildActivity(h)` and call it from both files); post; then: trial balance totals agree; balance sheet balances at `SEED_TODAY` and at the month's last day; cash flow closing equals `cashPositionFils` on the overview; each `.csv` twin's rows equal the JSON's rows (parse the CSV back with a tiny splitter in the test); `zoho-journal.csv`'s first line equals `ZOHO_JOURNAL_HEADINGS.join(',')`; overview: `unpostedCount` 0 after posting, `reliefWatch` `'clear'`, `corporateTaxEstimateFils` 0 while elected; after `PATCH /settings { smallBusinessReliefElected: false }` as owner the estimate equals `corporateTaxEstimate(resultYtd, revenueYtd, setting)` computed in the test from the same figures (0 if the result is under the threshold — assert the arithmetic, not a constant); finance gets identical statement bodies to the owner; admin 403.

- [ ] **Step 2: Run it to see it fail** — Expected: FAIL.

- [ ] **Step 3: Implement** the three route files, `csv-response.ts` (`return c.body(csv, 200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': \`attachment; filename="${name}"\` })`) and `classifyPending`; mount them.

- [ ] **Step 4: Run** `pnpm test:db tests/accounting/db` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/accounting tests/accounting/db
git commit -m "feat(accounting): the four statements, the overview, CSV twins and the Zoho-shaped exports"
```

---

## Task 14: The Books page — shell, Overview, Journal, the entry and reversal drawers

**Files:**
- Create: `app/admin/accounting/BooksPage.tsx`, `OverviewSection.tsx`, `JournalSection.tsx`, `EntryDrawer.tsx`, `ReverseDrawer.tsx`, `money.ts` (`export { formatFils } from '@domain/shared'; export { parseAedToFils } …` — copy `parseAedToFils`, `AED_INPUT`, `readAedFils`, `isAedAmountTooLarge` from `app/admin/billing/money.ts`; do not import across streams), `useDrawer.ts` (copy `app/admin/billing/useDrawer.ts` verbatim), `refusal.ts` (copy `focusFirstInvalid` from `app/admin/billing/refusal.ts`), `books.css`
- Create: `tests/accounting/BooksPage.test.tsx`

**Interfaces (Produces):** `export function BooksPage(): JSX.Element` with sections `overview | journal | accounts | statements | settings` named in the hash, exactly as `BillingPage.tsx` does with `SECTIONS`, `sectionFromHash`, `setSection`.

- [ ] **Step 1: Write the failing screen test** — copy the fake-auth scaffolding from `tests/billing/BillingPage.test.tsx` (`AuthProviderBoundary`, a fake `AuthProvider` whose `fetch` answers by path). Fixtures: `OVERVIEW` (an `OverviewResponse` with `unpostedCount: 0`, `reliefWatch: 'clear'`, one recent entry), `ENTRIES`, `ENTRY`, `ACCOUNTS` (16 rows), `SETTINGS`. Tests:
  1. On open as owner the page calls `POST /api/accounting/post` **before** `GET /api/accounting/overview` (record call order), shows "Result, year to date", "In the bank", "Corporate tax to set aside (estimate)", and "Everything is in the books" when `unpostedCount` is 0.
  2. With `unpostedCount: 3` it shows "3 events not yet in the books" and a "Bring the books up to date" button that posts again.
  3. The Journal section lists entries with reference, day, memo, and words for the event ("Payment received").
  4. "Post an entry" opens the drawer; adding two lines that do not balance shows the running difference and keeps Save disabled; balanced lines enable it; Save sends `POST /api/accounting/entries` with `X-Reason`.
  5. A finance actor sees "Post an entry"; the section tabs render; no figure on the page is unformatted (every amount matches `/^-?\d{1,3}(,\d{3})*\.\d{2}$/`).
  6. A 403 on the overview shows the fixed sentence "You don't have permission to see the books." and nothing else.

- [ ] **Step 2: Run it to see it fail** — `pnpm test tests/accounting/BooksPage.test.tsx` — Expected: FAIL.

- [ ] **Step 3: Write `BooksPage.tsx`** in `BillingPage.tsx`'s exact shape (read it whole first): `SECTIONS` = overview, journal, accounts, statements, settings; the hash; `PageHeader` titled "Books" with the header-action span holding "Post an entry" on the journal section when `canWrite` (`canActor(actor, { type: 'accounting.write' }, {}, new Date())`) and "Bring the books up to date" on the overview; each section a component that fetches only when shown. On first render, if `canWrite`, `apiFetch('/api/accounting/post', { method: 'POST', headers: { 'x-reason': 'Opening the books' } })` then load the overview; if not, load the overview directly.

- [ ] **Step 4: Write `OverviewSection.tsx`** — three rows of figures as a definition list (`<dl class="figures">`), each `<dt>` a label and `<dd class="numeric">` the `formatFils` figure; the month's three billing figures from `GET /api/billing/summary?month=` (finance may read it); the relief watch as a `Note` (`muted` clear, `attention` approaching, `critical` exceeded) with the sentence "Revenue this year AED X against the relief line of AED Y"; the unposted count with the button; beneath, `Table` of `recentEntries` (reference, day, memo, event in words, debit total).

- [ ] **Step 5: Write `JournalSection.tsx`** — period filter (two `Field type="date"`), `Table` of entries; a row click loads `GET /api/accounting/entries/:id` and renders its lines beneath (account code and name, debit, credit); a "Reverse" `Button` per entry that has no `reversedByEntryId`, opening `ReverseDrawer`.

- [ ] **Step 6: Write `EntryDrawer.tsx`** — `PriceDrawer.tsx`'s skeleton (`aside.drawer`, header, close button, `useDrawer`, `focusFirstInvalid`, fixed refusal sentences keyed by code): fields day (`type="date"`, fixed to `booksStartOn` and disabled when kind is opening), memo, kind (`Select`: manual, opening — opening only offered when the journal has no opening entry yet, which the page learns from `SettingsResponse.entryCount === 0`), then a lines editor: rows of account `Select` (from `GET /api/accounting/accounts`, archived hidden), side `Select` (Debit/Credit), amount `Field` parsed by `parseAedToFils`; "Add a line" button; a running "Difference" figure (debits − credits) shown as `numeric`; Save disabled until difference reads 0.00 and at least two lines carry amounts; for an opening entry a "Balance with opening equity" button that sends `balanceWithOpeningEquity: true` instead; a reason `Field` (`X-Reason`, minimum 8 characters, the same `isRealText` rule copied into `schema.ts`). Codes to sentences: `unbalanced`, `period_locked`, `opening_day`, `unknown_account`, `reason_required`, `invalid_request`, and 403.

- [ ] **Step 7: Write `ReverseDrawer.tsx`** — the entry's reference and memo shown, a reason field, Save → `POST /api/accounting/entries/:id/reversal` with `X-Reason`; 409 `already_reversed` → "This entry has already been reversed."

- [ ] **Step 8: Write `books.css`** — only what the shell lacks: `.figures` grid (three columns, `gap: var(--s-4)`), `.lines-editor` row layout, `.difference` — tokens only, logical properties only.

- [ ] **Step 9: Run** `pnpm test tests/accounting/BooksPage.test.tsx` — Expected: PASS. Then `pnpm -s lint` — Expected: clean (react-hooks rules: no synchronous setState in effects; follow `BillingPage.tsx`'s comments).

- [ ] **Step 10: Commit**

```bash
git add app/admin/accounting tests/accounting/BooksPage.test.tsx
git commit -m "feat(accounting): the Books page with its overview, journal, entry and reversal drawers"
```

---

## Task 15: Accounts, Statements and Settings sections

**Files:**
- Create: `app/admin/accounting/AccountsSection.tsx`, `AccountDrawer.tsx`, `StatementsSection.tsx`, `SettingsSection.tsx`, `SettingsDrawer.tsx`, `LockDrawer.tsx`
- Modify: `app/admin/accounting/BooksPage.tsx` (wire the sections), `books.css`
- Modify: `tests/accounting/BooksPage.test.tsx` (add cases)

- [ ] **Step 1: Add the failing cases** to the screen test:
  1. Accounts lists 16 rows with code, name, type in words ("Asset"), role in words ("Bank"), balance; "Add account" opens a drawer; a code whose first digit disagrees with the type shows "An asset's code starts with 1" (per type) before any request; Save sends `POST /api/accounting/accounts` with `X-Reason`.
  2. Opening an account row shows its ledger table with a running balance column.
  3. Statements shows four tables under a period picker and four "Download CSV" links whose `href`s are the `.csv` twins with the chosen dates (a link, not a fetch — the browser downloads); the balance sheet's two computed lines carry the word "computed".
  4. Settings, as owner, shows the start day, year end, tax settings, relief switch, lock date, and the years table; "Lock through" opens `LockDrawer`; a future date shows "The lock cannot be in the future."; "Close" on a year sends `POST /years/:id/close`; year end fields are disabled with "The year end can change only while the journal is empty." once `entryCount > 0`.
  5. As finance, Settings shows the values and no buttons.

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement** the six components in the same drawer and table shapes; `AccountDrawer` validates with `codeMatchesType` from `@domain/accounting` before sending; `SettingsDrawer` sends `PATCH /api/accounting/settings`; `LockDrawer` validates with `mayLockThrough(date, isoDateIn(new Date(), 'Asia/Dubai'))`; the "Close year" button asks for a reason in a small drawer too (reuse `ReverseDrawer`'s shape as `ReasonDrawer` if that is cleaner — one component, three uses).

- [ ] **Step 4: Run** `pnpm test tests/accounting` and `pnpm -s lint` — Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add app/admin/accounting tests/accounting/BooksPage.test.tsx
git commit -m "feat(accounting): accounts with ledgers, the four statements with CSV, and the books' settings"
```

---

## Task 16: The rail, the route, the feed's sentences, the documents, and the gates

**Files:**
- Modify: `app/shell/components/Icons.tsx` (`BooksIcon`, in `BillingIcon`'s shape — a ledger: two vertical lines and three horizontal rules, 24×24, `currentColor`), `app/shell/components/Rail.tsx` (`{ key: 'books', label: 'Books', to: '/admin/books', icon: <BooksIcon /> }` after `billing`), `app/shell/AdminLayout.tsx` (`if (section.key === 'books') return canOpenBooks(actor, now);`), `app/shell/App.tsx` (route `books` guarded by `canOpenBooks`, rendering `BooksPage`, in `billing`'s shape)
- Modify: `app/shell/App.test.tsx` / any rail test that enumerates sections (add Books: visible to owner and finance, hidden from admin, lead practitioner, practitioner)
- Modify: `domain/shared/audit-narrative.ts` and `audit-narrative.test.ts` (change request item 6: the sentences, including "locked the books through a date" / "moved the books' lock back" when `locked_through` changed forward or backward, read from the audit row's before/after the way the file reads other columns)
- Modify: `docs/SPEC/00-data-model.md` section 6 (change request item 2's text, verbatim) and section 11 (one line for this round in the shape of the existing lines: what joined the shared zone and why)
- Modify: `docs/CHANGE-REQUESTS/accounting-01.md` — mark each item applied with the date; add item 11 if Task 6 needed the lint list
- Modify: `docs/SPEC/accounting.md` — nothing unless a rule changed in the build; if one did, amend the spec and say so at the top ("amended in the build, 2026-09-0N") as `assessment.md` does
- Create: the pull request record as a comment/body later; for now `docs/CHANGE-REQUESTS/accounting-01.md`'s "every file this round touched outside accounting's own paths" list

- [ ] **Step 1: Wire the shell** (icon, rail, layout, route) and run `pnpm test app/shell` — Expected: PASS with the Books cases added.

- [ ] **Step 2: The feed's sentences** — read `domain/shared/audit-narrative.ts` whole, add the five tables' sentences in its shape, with tests beside the existing ones.

- [ ] **Step 3: Documents** — the data-model amendment, the section 11 line, the change request's applied marks and file list, CLAUDE.md's Commands line (Task 11 did it — confirm).

- [ ] **Step 4: The gates, each with a timeout**

```bash
pnpm verify          # format, lint, typecheck, secrets, migrations audit, unit tests
pnpm test:db         # the whole database suite: trunk's and every stream's
pnpm build
```

Expected: all three green. Fix anything red in the task it belongs to (a new commit per fix, named for the fault).

- [ ] **Step 5: Walk the screen once in a browser** — `pnpm dev`, sign in as the seeded owner (`docs/PARALLEL-SESSIONS.md` / the dev sign-in), open Books: the overview posts and shows zeros on a fresh seed; add a manual expense entry of AED 200 against General expenses and Bank with a reason; see it in the Journal; reverse it; see the Statements balance; lock through yesterday and see today's entry allowed and yesterday's refused; download one CSV. Note anything off as a follow-up in the change request, not a silent fix outside your paths.

- [ ] **Step 6: Commit and push the branch; open the pull request**

```bash
git add -A app/shell domain/shared/audit-narrative.ts domain/shared/audit-narrative.test.ts docs
git commit -m "feat(accounting): the Books in the rail and the route, the feed's sentences, and the documents"
git push -u origin accounting
```

PR title: "Piece eleven: the books' ledger". Body: outcome first in plain language (three sentences), then the section 12 "done when" list ticked, then "every file this round touched outside accounting's own paths" (the change request's list), then the agents used and their approximate token use (HANDOVER section 6 rule 7). End with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

---

## Self-review against the spec

- **Section 4.1 chart**: Task 7 (451, `default_chart_rows`), add/rename/archive Task 12, screens Task 15. ✓
- **4.2 journal, written once, reversal**: Tasks 8 (453 guards), 12 (routes), 14 (drawers). ✓
- **4.3 poster, definer read, late events**: Tasks 9 (454), 11 (poster, job, `POST /post`), 3 (`landingDayFor`). ✓ Reads stay reads: the page posts on open (Task 14); no GET writes. ✓
- **4.4 years, close, reopen, lock date**: Tasks 3, 8 (452, `guard_journal_entry`), 12 (routes), 15 (settings screen). ✓
- **4.5 statements, cash flow, tax estimate, relief watch**: Tasks 5, 6, 13, 14 (overview). ✓
- **4.6 Zoho exports**: Tasks 6, 13, 15. ✓
- **5 screens**: Tasks 14, 15; rail and route Task 16. ✓
- **6 rules 1–17**: 1, 6–9 Task 2; 3, 4, 10, 11, 14 Task 3; 5 Task 11 (unique key + `on conflict`); 2 Task 8; 12, 17 Task 5; 13 Task 9 and every read route; 15, 16 Task 6. ✓
- **7 posting rules**: Task 4; the statement kind and the waiver-without-replacement post nothing; the tax-point note needs no code. ✓
- **8 data**: Tasks 7, 8, 9; `audited: no client` on all five; standard columns; RLS and grants; 958 Task 7. ✓
- **9 API**: Tasks 10–13; `?limit` not cursor per the spec's amended line. ✓
- **10 permissions**: Task 1; policies Task 7. ✓
- **11 audit, erasure**: Task 11's erased-household assertion; Task 16's sentences; no erasure step by design. ✓
- **12 done-when 1–12**: 1–3 Task 11; 4, 5 Tasks 8 and 12; 6, 7 Task 13; 8 Tasks 10–13; 9 Task 7; 10 Tasks 8 and 12; 11 Task 13; 12 Task 16. ✓
- **Change request items 1–10**: 1 applied by the integrator; 2, 6 Task 16; 3, 10 Task 7; 4 Tasks 1 and 16; 5 Task 10; 7 Task 11; 8 — check `tests/db/seed.test.ts` in Task 7 (it reads "at least", so likely no edit); 9 nothing; 11 conditional in Task 6. ✓
- **Type consistency**: `PostedLine`, `ChartAccount`, `FiscalYear`, `BooksSetting`, `JournalDraft`, `MoneyEvent` defined in Tasks 2 and 4 and used by name in 5, 6, 10–13. `postPendingEvents(db, now)` in Tasks 11 and 12. `mayReadBooks` etc. in Tasks 1 and 10–13. `landingDayFor(occurredOn, years, lockedThrough)` in Tasks 3, 11, 12. ✓
- **Placeholders**: none of the forbidden placeholder words or "similar to" appear. The skeleton in Task 5 step 3 names every function to write; write them in full.
