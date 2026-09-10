# The Dispatcher's Board (piece twenty-two) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One console screen showing every practitioner's day with each visit's state read from what the system already records, a rule that works out which visits cannot be reached in time, and a reassignment that hands a visit from one practitioner to another as two rows with a reason.

**Architecture:** A pure rule `lateness` in `domain/scheduling`, walking forward from the last event that actually happened over the same drive matrix the optimiser uses. Two routes in `app/api/appointments`: `GET /api/appointments/board` reads the day for every practitioner (one `list` audit row per household shown, as the schedule does) and `POST /api/appointments/:id/reassign` composes `move-one.ts`'s pieces and raises rather than returns after its first write. One board page under `app/admin/schedule/board/` with a drawer for the reason; a drag opens the drawer prefilled and never commits on drop. One migration, `210`, adds the column that answers "who was it taken from".

**Tech Stack:** TypeScript, Hono, zod, React, PostgreSQL 17 (Supabase image), vitest with jsdom; the repository's own seams (`RoutingProvider`) and helpers.

**Spec:** `docs/SPEC/dispatch.md` (Part A, sections 4 to 14) and `docs/PLAN/dispatch.md`, both approved on 10 September 2026. Read both before Task 1.

## Global Constraints

- British English everywhere; no emoji; no ALL-CAPS labels; no hex colour in components — tokens from `app/shell/tokens.css` only (`CLAUDE.md`, `.claude/rules/ui.md`).
- The console is English only (`tests/lint/console-is-english.test.ts`): no Arabic display or input under `app/admin/**`.
- Hue on the board is the three status tones (`ok`, `attention`, `critical`) through `StatusChip` and nothing else (`docs/SPEC/dispatch.md` 4.4).
- Fixtures: names from `db/seed/names.ts` only; ids in the reserved shape `0000000K-0000-4000-8000-*`; phones `+971 50 000 xxxx`; emails at `example.com` (`.claude/rules/testing.md`). Edit fixtures with the Edit tool, never a heredoc, so `.claude/hooks/no-real-identifiers.sh` sees them.
- Business rules are pure functions in `domain/` with `now` injected; no `Date.now()` inside (`CLAUDE.md` rule 4).
- Every migration: forward-only, `-- Needs:` header naming only lower numbers, a `-- rollback:` block; never edit a merged migration (`.claude/rules/data-model.md`).
- Money and time: times in Asia/Dubai; a window is 45 minutes (`appointment_window_45min`).
- Worktree: `dispatch` (`git worktree add ../mcwellness-dispatch -b dispatch-1 origin/main`), its own `.env` on `DB_PORT=5444`, `PORT=3012`, `WEB_PORT=5185`, `COMPOSE_PROJECT_NAME=mcwellness-dispatch`; `pnpm db:up && pnpm db:migrate` before Task 1.
- Gates before every commit's push: `pnpm -s format:check && pnpm -s lint && pnpm -s typecheck`; the unit tests of the files touched; the database test file touched via `pnpm exec vitest run --config vitest.db.config.ts <file>`. Before the pull request: `pnpm verify` and `pnpm test:db` whole.
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

## File Structure

| File | Responsibility |
|---|---|
| `db/migrations/210_appointment_reassigned_from.sql` (new) | The one column: who a reassigned visit was taken from |
| `domain/shared/actor.ts` (+ `actor.test.ts`) | Two actions: `appointment.reassign`, `appointment.board.read` |
| `domain/scheduling/lateness.ts` (new, + test) | The lateness rule and the board-state mapping, pure |
| `domain/scheduling/index.ts` | Barrel exports for the above |
| `domain/shared/audit-narrative.ts` (+ test) | One sentence for a reassignment |
| `app/api/appointments/schema.ts` | `BoardResponse`, `ReassignAppointmentRequest`, `ReassignActionCode` |
| `app/api/appointments/board.ts` (new) | `GET /api/appointments/board?date=` |
| `app/api/appointments/reassign.ts` (new) | `POST /api/appointments/:id/reassign` |
| `app/api/appointments/move-one.ts` | `insertMoved` gains the new practitioner and the new column |
| `app/api/appointments/routes.ts` | Mounts the two routes |
| `app/api/routing/practice-day.ts` | Exports `readDay`, `readBases`, `toHomeBase`, `toPlanStop`, `bucketsFor`, `placesFor` for the board |
| `app/shell/adminAccess.ts` | `canOpenBoard` |
| `app/shell/App.tsx` | The `schedule/board` route |
| `app/admin/schedule/SchedulePage.tsx` | The link to the board |
| `app/admin/schedule/board/BoardPage.tsx`, `ReassignDrawer.tsx`, `board.css`, `columns.ts` (new) | The screen |
| `db/seed/generate.ts`, `db/seed/apply.ts`, `tests/db/seed.test.ts` | Three visits for the second practitioner on the planning day |
| `tests/dispatch/db/board.test.ts`, `tests/dispatch/db/reassign.test.ts`, `tests/dispatch/BoardPage.test.tsx` (new) | The proofs |
| `docs/SPEC/OWNERSHIP.md`, `docs/CHANGE-REQUESTS/dispatch-01.md` (new), `docs/SPEC/scheduling-manual.md`, `docs/SPEC/audit.md` | The record |

---

### Task 1: The stream, the migration, and the change request

**Files:**
- Create: `db/migrations/210_appointment_reassigned_from.sql`
- Create: `docs/CHANGE-REQUESTS/dispatch-01.md`
- Modify: `docs/SPEC/OWNERSHIP.md` (the Stage 2 stream table and the ports table)
- Test: `tests/dispatch/db/reassign.test.ts` (its first case; the rest arrive in Task 6)

**Interfaces:**
- Produces: column `appointment.reassigned_from_practitioner_id uuid null references practitioner (id)`, with the check that it is set only on a row that also carries `rescheduled_from_id`.

- [ ] **Step 1: Write the failing test**

Create `tests/dispatch/db/reassign.test.ts`:

```ts
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDatabase } from '../../db/helpers';

/**
 * Reassignment (docs/SPEC/dispatch.md section 6). This file grows in Task 6;
 * the first case proves migration 210 landed with its guard.
 */
let owner: pg.Client;

beforeAll(async () => {
  owner = await freshDatabase();
});

afterAll(async () => {
  await owner.end();
});

describe('migration 210', () => {
  it('adds who a reassigned visit was taken from, set only beside a reschedule link', async () => {
    const { rows } = await owner.query<{ is_nullable: string; data_type: string }>(
      "select is_nullable, data_type from information_schema.columns " +
        "where table_name = 'appointment' and column_name = 'reassigned_from_practitioner_id'",
    );
    expect(rows).toEqual([{ is_nullable: 'YES', data_type: 'uuid' }]);
    const guard = await owner.query<{ conname: string }>(
      "select conname from pg_constraint where conname = 'appointment_reassigned_implies_rescheduled'",
    );
    expect(guard.rows).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run --config vitest.db.config.ts tests/dispatch/db/reassign.test.ts`
Expected: FAIL — `expected [] to deeply equal [{ is_nullable: 'YES', … }]`.

- [ ] **Step 3: Write the migration**

Create `db/migrations/210_appointment_reassigned_from.sql`:

```sql
-- 210_appointment_reassigned_from.sql
-- Who a reassigned visit was taken from (docs/SPEC/dispatch.md section 6.3).
--
-- A reassignment is a move that also changes hands: the old row becomes
-- `rescheduled` and keeps the practitioner the household was promised, and a
-- new row stands beside it carrying `rescheduled_from_id` and the new
-- practitioner (203). Walking that link answers "who was it taken from", but
-- the trail should answer it without walking anything, so the new row also
-- names the practitioner it was taken from. Nullable: a plain move sets
-- nothing here. The check says a reassignment is always also a reschedule,
-- which is what makes the old row's promise recoverable.
--
-- Needs: 203 (rescheduled_from_id), 200 (appointment, practitioner)

alter table public.appointment
  add column reassigned_from_practitioner_id uuid references public.practitioner (id);

comment on column public.appointment.reassigned_from_practitioner_id is
  'The practitioner this visit was taken from by a reassignment; null on any other row (docs/SPEC/dispatch.md 6.3).';

alter table public.appointment
  add constraint appointment_reassigned_implies_rescheduled
  check (reassigned_from_practitioner_id is null or rescheduled_from_id is not null);

-- rollback:
-- alter table public.appointment drop constraint appointment_reassigned_implies_rescheduled;
-- alter table public.appointment drop column reassigned_from_practitioner_id;
```

- [ ] **Step 4: Apply it and run the test**

Run: `pnpm db:migrate && pnpm exec vitest run --config vitest.db.config.ts tests/dispatch/db/reassign.test.ts`
Expected: `applied 210_appointment_reassigned_from.sql`; the test PASSES.

- [ ] **Step 5: The ownership row and the change request**

In `docs/SPEC/OWNERSHIP.md`, after the `accounting` row of the Stage 2 table, add:

```
| `dispatch` | `app/admin/schedule/board/**`, `app/api/appointments/board.ts`, `app/api/appointments/reassign.ts`, `domain/scheduling/lateness.ts`, `tests/dispatch/**` | `210–249` (carved from scheduling's upper half, 2026-09-10, `docs/CHANGE-REQUESTS/dispatch-01.md` item 1) | `SPEC/dispatch.md` |
```

and in the ports table, after the `accounting` row:

```
| `dispatch` (Stage 2, sixth) | 5444 | 3012 | 5185 |
```

Create `docs/CHANGE-REQUESTS/dispatch-01.md`:

```markdown
# dispatch-01: what piece twenty-two asks of the shared zone

Written 10 September 2026 with the piece, from `docs/SPEC/dispatch.md`
section 14. By the precedent of pieces seven to ten and seventeen and the
cost rules of `docs/HANDOVER.md` section 6, each item rides in the piece's
own pull request under the integrator's widening for one piece.

1. **The range.** `210–249`, carved from scheduling's upper half, and the
   ports `5444/3012/5185` — the `dispatch` rows in `docs/SPEC/OWNERSHIP.md`.
2. **Two actions in `domain/shared/actor.ts`.** `appointment.reassign` and
   `appointment.board.read`, both owner, admin and lead practitioner — the
   three who may already move a visit (spec section 9).
3. **The route in `app/shell/App.tsx`.** `schedule/board`, guarded by
   `canOpenBoard` in `app/shell/adminAccess.ts`, inside the console's own
   layout: the board loads no third-party script (spec 4.1).
4. **One sentence in `domain/shared/audit-narrative.ts`**, so an appointment
   inserted with `reassigned_from_practitioner_id` reads as a reassignment
   rather than as a bare addition (spec section 11).
5. **`docs/SPEC/scheduling-manual.md`**: section 4.1 already says "drag
   between columns to reassign"; sections 8 and 10 said a dispatch board is
   out of scope, and now say it is piece twenty-two's.
6. **Four exports from `app/api/routing/practice-day.ts`** (`readDay`,
   `readBases`, `toHomeBase`, `toPlanStop`, `bucketsFor`, `placesFor`), so the
   board prices its drives with the same reads the map uses rather than a
   copy. Scheduling's file, edited under the same widening.
7. **`insertMoved` in `app/api/appointments/move-one.ts`** takes the new
   practitioner and the new column, both optional, so a move is unchanged.
8. **The seed** (`db/seed/generate.ts`, `apply.ts`, `tests/db/seed.test.ts`):
   three visits for the second practitioner on the planning day, one closed,
   one open and overrunning, one still to come (spec section 13).
```

- [ ] **Step 6: Commit**

```bash
git add db/migrations/210_appointment_reassigned_from.sql docs/SPEC/OWNERSHIP.md docs/CHANGE-REQUESTS/dispatch-01.md tests/dispatch/db/reassign.test.ts
git commit -m "feat(dispatch): who a reassigned visit was taken from (migration 210), and the stream's row

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: The two actions

**Files:**
- Modify: `domain/shared/actor.ts` (the `Action` union near line 66; the `switch` near line 282)
- Test: `domain/shared/actor.test.ts`

**Interfaces:**
- Produces: `{ type: 'appointment.reassign' }` and `{ type: 'appointment.board.read' }` in the `Action` union; `canActor` answers true for owner, admin and lead practitioner and false otherwise.

- [ ] **Step 1: Write the failing test**

In `domain/shared/actor.test.ts`, find the `describe` that covers `'appointment.move'` (search for `appointment.move`) and add beside it, using that file's own `actor(...)` helper and `NOW`:

```ts
  it('lets the three calendar roles reassign a visit and read the board, and nobody else', () => {
    for (const type of ['appointment.reassign', 'appointment.board.read'] as const) {
      expect(canActor(actor({ roles: ['owner'] }), { type }, {}, NOW)).toBe(true);
      expect(canActor(actor({ roles: ['admin'] }), { type }, {}, NOW)).toBe(true);
      expect(canActor(actor({ roles: ['lead_practitioner'] }), { type }, {}, NOW)).toBe(true);
      expect(canActor(actor({ roles: ['practitioner'] }), { type }, {}, NOW)).toBe(false);
      expect(canActor(actor({ roles: ['finance'] }), { type }, {}, NOW)).toBe(false);
      expect(canActor(actor({ roles: ['client_contact'] }), { type }, {}, NOW)).toBe(false);
    }
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -s vitest run domain/shared/actor.test.ts`
Expected: FAIL with a type error on `type` (not in the union) or `false` where `true` is expected.

- [ ] **Step 3: Add the actions**

In `domain/shared/actor.ts`, in the `Action` union directly after `| { type: 'appointment.move' }`:

```ts
  // The dispatcher (docs/SPEC/dispatch.md section 9): the same three roles
  // that may move a visit may hand one to another practitioner, and see the
  // whole practice's day on the board. A practitioner sees their own day on
  // Today and not the board (decision 3 of docs/PLAN/dispatch.md).
  | { type: 'appointment.reassign' }
  | { type: 'appointment.board.read' }
```

and in the `switch`, directly after the `case 'appointment.move':` branch's `return`:

```ts
    case 'appointment.reassign':
    case 'appointment.board.read':
      return hasRole(actor, 'owner', 'admin', 'lead_practitioner');
```

- [ ] **Step 4: Run the test**

Run: `pnpm -s vitest run domain/shared/actor.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add domain/shared/actor.ts domain/shared/actor.test.ts
git commit -m "feat(dispatch): the reassign and board-read actions

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: The lateness rule and the board states, pure

**Files:**
- Create: `domain/scheduling/lateness.ts`
- Create: `domain/scheduling/lateness.test.ts`
- Modify: `domain/scheduling/index.ts` (exports)

**Interfaces:**
- Produces:
  ```ts
  export type Progress = {
    stopId: string; windowStart: Date; windowEnd: Date; durationMinutes: number;
    status: AppointmentStatus; checkedInAt: Date | null; closedAt: Date | null; locationId: string;
  };
  export type Lateness = { late: boolean; byMinutes: number };
  export function lateness(day: readonly Progress[], drive: Matrix, now: Date, graceMinutes: number): Map<string, Lateness>;
  export const BOARD_STATES = ['waiting','agreed','on_the_way','at_the_door','running_late','finished','missed','called_off','moved'] as const;
  export type BoardState = (typeof BOARD_STATES)[number];
  export function boardState(stop: Progress, previous: Progress | null, late: boolean, now: Date): BoardState;
  export const DEFAULT_GRACE_MINUTES = 10;
  ```
- Consumes: `Matrix` from `./optimise` (a total function `(fromLocationId, toLocationId, departAt) => DriveEstimate`), `AppointmentStatus` and `isSettled` from `./status`.

- [ ] **Step 1: Write the failing tests**

Create `domain/scheduling/lateness.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Matrix } from './optimise';
import { boardState, lateness, type Progress } from './lateness';

/**
 * Running late, decided rather than typed (docs/SPEC/dispatch.md section 5),
 * and the nine states a block can be in (section 4.4). Fixed matrices, fixed
 * clocks; nothing here reads the time.
 */

// Three stops an hour apart, 45 minutes each, at three places.
const day = (overrides: Partial<Progress>[] = []): Progress[] =>
  [
    { stopId: 's1', windowStart: at('09:00'), windowEnd: at('09:45'), locationId: 'L1' },
    { stopId: 's2', windowStart: at('10:00'), windowEnd: at('10:45'), locationId: 'L2' },
    { stopId: 's3', windowStart: at('11:00'), windowEnd: at('11:45'), locationId: 'L3' },
  ].map((stop, i) => ({
    durationMinutes: 45,
    status: 'confirmed' as const,
    checkedInAt: null,
    closedAt: null,
    ...stop,
    ...(overrides[i] ?? {}),
  }));

function at(time: string): Date {
  return new Date(`2026-09-04T${time}:00+04:00`);
}

/** Fifteen minutes between any two places, zero from a place to itself. */
const fifteen: Matrix = (from, to) => ({
  seconds: from === to ? 0 : 15 * 60,
  metres: from === to ? 0 : 9000,
  source: 'straight-line',
});

describe('lateness', () => {
  it('says nothing is late while nothing has happened and every window is still open', () => {
    const result = lateness(day(), fifteen, at('09:20'), 10);
    expect([...result.values()]).toEqual([
      { late: false, byMinutes: 0 },
      { late: false, byMinutes: 0 },
      { late: false, byMinutes: 0 },
    ]);
  });

  it('does not call a visit late merely because nobody has checked in while its window is open', () => {
    const result = lateness(day(), fifteen, at('09:40'), 10);
    expect(result.get('s1')).toEqual({ late: false, byMinutes: 0 });
  });

  it('walks forward from the last visit closed, and lets the gaps absorb a single overrun', () => {
    // The first visit overran by 35 minutes and closed at 10:20. The second
    // is reached at 10:35, inside its window; the third at 11:35, inside its
    // window too, because waiting for a window to open is not lateness.
    const result = lateness(day([{ status: 'completed', closedAt: at('10:20') }]), fifteen, at('10:25'), 10);
    expect(result.get('s2')).toEqual({ late: false, byMinutes: 0 });
    expect(result.get('s3')).toEqual({ late: false, byMinutes: 0 });
  });

  it('calls the next visits late when an open visit is still running past its length', () => {
    // Checked in at 09:00, never closed, and it is now 10:50: the earliest
    // departure is now, so the second door is reached at 11:05 — twenty
    // minutes after its window shut — and the third at 12:05.
    const result = lateness(
      day([{ status: 'checked_in', checkedInAt: at('09:00') }]),
      fifteen,
      at('10:50'),
      10,
    );
    expect(result.get('s1')).toEqual({ late: false, byMinutes: 0 });
    expect(result.get('s2')).toEqual({ late: true, byMinutes: 20 });
    expect(result.get('s3')).toEqual({ late: true, byMinutes: 20 });
  });

  it('applies the grace as given, never a constant of its own', () => {
    // Closed at 10:33: the second door is reached at 10:48, three minutes late.
    const stops = day([{ status: 'completed', closedAt: at('10:33') }]);
    expect(lateness(stops, fifteen, at('10:35'), 10).get('s2')).toEqual({ late: false, byMinutes: 3 });
    expect(lateness(stops, fifteen, at('10:35'), 2).get('s2')).toEqual({ late: true, byMinutes: 3 });
  });

  it('marks a visit whose window has passed with no check-in as late by the time since, once something later has happened', () => {
    // The practitioner skipped the first door and checked in at the second.
    const result = lateness(
      day([{}, { status: 'checked_in', checkedInAt: at('10:05') }]),
      fifteen,
      at('10:10'),
      10,
    );
    expect(result.get('s1')).toEqual({ late: true, byMinutes: 25 });
    expect(result.get('s2')).toEqual({ late: false, byMinutes: 0 });
  });

  it('answers every stop, settled ones as not late', () => {
    const result = lateness(day([{ status: 'cancelled' }]), fifteen, at('12:00'), 10);
    expect(result.get('s1')).toEqual({ late: false, byMinutes: 0 });
    expect(result.size).toBe(3);
  });
});

describe('boardState', () => {
  const stop = day()[0]!;
  it('reads the state from the status, the session and the lateness, in that order', () => {
    expect(boardState({ ...stop, status: 'proposed' }, null, false, at('08:00'))).toBe('waiting');
    expect(boardState({ ...stop, status: 'confirmed' }, null, false, at('08:00'))).toBe('agreed');
    expect(boardState({ ...stop, status: 'checked_in' }, null, false, at('09:10'))).toBe('at_the_door');
    expect(boardState({ ...stop, status: 'completed' }, null, false, at('12:00'))).toBe('finished');
    expect(boardState({ ...stop, status: 'no_show' }, null, false, at('12:00'))).toBe('missed');
    expect(boardState({ ...stop, status: 'cancelled' }, null, false, at('12:00'))).toBe('called_off');
    expect(boardState({ ...stop, status: 'cancelled_late' }, null, false, at('12:00'))).toBe('called_off');
    expect(boardState({ ...stop, status: 'rescheduled' }, null, false, at('12:00'))).toBe('moved');
  });

  it('says on the way once the previous visit is closed and this window has not opened', () => {
    const previous = { ...day()[0]!, status: 'completed' as const, closedAt: at('09:40') };
    const next = day()[1]!;
    expect(boardState(next, previous, false, at('09:50'))).toBe('on_the_way');
    expect(boardState(next, previous, false, at('10:05'))).toBe('agreed');
    expect(boardState(next, null, false, at('09:50'))).toBe('agreed');
  });

  it('lets running late override waiting, agreed and on the way, but never a door already reached', () => {
    expect(boardState({ ...stop, status: 'confirmed' }, null, true, at('08:00'))).toBe('running_late');
    expect(boardState({ ...stop, status: 'proposed' }, null, true, at('08:00'))).toBe('running_late');
    expect(boardState({ ...stop, status: 'checked_in' }, null, true, at('09:10'))).toBe('at_the_door');
    expect(boardState({ ...stop, status: 'completed' }, null, true, at('12:00'))).toBe('finished');
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm -s vitest run domain/scheduling/lateness.test.ts`
Expected: FAIL — `Cannot find module './lateness'`.

- [ ] **Step 3: Write the rule**

Create `domain/scheduling/lateness.ts`:

```ts
import type { Matrix } from './optimise';
import { isSettled, type AppointmentStatus } from './status';

/**
 * Running late, decided rather than typed (docs/SPEC/dispatch.md section 5),
 * and the state a block on the board is in (section 4.4). Pure: `now` is an
 * argument, the drive matrix is an argument, and the grace is an argument —
 * never a constant of this file's own.
 *
 * **The rule.** Take the last event that actually happened: a visit closed,
 * or a check-in. From there walk forward through the remaining stops, adding
 * each service's own length and the drive between, on the same matrix the
 * optimiser uses. A stop whose earliest possible arrival is later than the
 * end of its arrival window, by more than the grace, is late, and by how much.
 *
 * **Two things it must not do.** It must not call a visit late because the
 * practitioner has not checked in yet while the window is still open — so
 * with nothing happened, the earliest arrival is simply `now`. And it must
 * not cascade a single overrun into every later stop — so the walk waits for
 * each window to open before counting the visit's length, which is what the
 * gaps between windows are for.
 */

const MINUTE_MS = 60_000;

export const DEFAULT_GRACE_MINUTES = 10;

export type Progress = {
  stopId: string;
  windowStart: Date;
  windowEnd: Date;
  /** The service's own length, from `service_type.duration_minutes`. */
  durationMinutes: number;
  status: AppointmentStatus;
  /** From the session, when one was opened at this door. */
  checkedInAt: Date | null;
  /** From the session, when the visit was closed. */
  closedAt: Date | null;
  locationId: string;
};

export type Lateness = { late: boolean; byMinutes: number };

const NOT_LATE: Lateness = { late: false, byMinutes: 0 };

/** The instant the practitioner can leave a stop, given what has happened at it. */
function departureFrom(stop: Progress, now: Date): Date | null {
  if (stop.closedAt !== null) return stop.closedAt;
  if (stop.checkedInAt !== null) {
    // Still there: they leave when the service is done, or now if that has
    // already passed and they have not closed it — an overrun.
    const planned = stop.checkedInAt.getTime() + stop.durationMinutes * MINUTE_MS;
    return new Date(Math.max(planned, now.getTime()));
  }
  return null;
}

/** Whether anything has happened at this stop that fixes the practitioner in time and place. */
function hasHappened(stop: Progress): boolean {
  return stop.closedAt !== null || stop.checkedInAt !== null;
}

function minutesLate(arrival: Date, windowEnd: Date): number {
  return Math.max(0, Math.ceil((arrival.getTime() - windowEnd.getTime()) / MINUTE_MS));
}

export function lateness(
  day: readonly Progress[],
  drive: Matrix,
  now: Date,
  graceMinutes: number,
): Map<string, Lateness> {
  const stops = [...day].sort((a, b) => a.windowStart.getTime() - b.windowStart.getTime());
  const result = new Map<string, Lateness>();
  for (const stop of stops) result.set(stop.stopId, NOT_LATE);

  // The anchor: the last stop, in window order, at which something happened.
  let anchorIndex = -1;
  for (const [index, stop] of stops.entries()) {
    if (hasHappened(stop)) anchorIndex = index;
  }

  let cursorTime: Date = now;
  let cursorLocation: string | null = null;
  if (anchorIndex >= 0) {
    const anchor = stops[anchorIndex]!;
    cursorTime = departureFrom(anchor, now) ?? now;
    cursorLocation = anchor.locationId;
    // A door skipped on the way to the anchor: late by the time since its
    // window shut, because the practitioner went past it.
    for (const stop of stops.slice(0, anchorIndex)) {
      if (isSettled(stop.status) || hasHappened(stop)) continue;
      const by = minutesLate(now, stop.windowEnd);
      result.set(stop.stopId, { late: by > graceMinutes, byMinutes: by });
    }
  }

  for (const stop of stops.slice(anchorIndex + 1)) {
    if (isSettled(stop.status) || hasHappened(stop)) {
      // Settled, or already reached: not this rule's to judge. A reached door
      // becomes the new place the walk continues from.
      if (hasHappened(stop)) {
        cursorTime = departureFrom(stop, now) ?? cursorTime;
        cursorLocation = stop.locationId;
      }
      continue;
    }
    const driveSeconds =
      cursorLocation === null ? 0 : drive(cursorLocation, stop.locationId, cursorTime).seconds;
    const arrival = new Date(cursorTime.getTime() + driveSeconds * 1000);
    const by = minutesLate(arrival, stop.windowEnd);
    result.set(stop.stopId, { late: by > graceMinutes, byMinutes: by });
    // Waiting for a window to open is not lateness: the visit starts at the
    // later of the arrival and the window, and takes its own length.
    const starts = Math.max(arrival.getTime(), stop.windowStart.getTime());
    cursorTime = new Date(starts + stop.durationMinutes * MINUTE_MS);
    cursorLocation = stop.locationId;
  }
  return result;
}

export const BOARD_STATES = [
  'waiting',
  'agreed',
  'on_the_way',
  'at_the_door',
  'running_late',
  'finished',
  'missed',
  'called_off',
  'moved',
] as const;
export type BoardState = (typeof BOARD_STATES)[number];

/**
 * The state a block shows (docs/SPEC/dispatch.md 4.4), read and never typed.
 * The status decides the settled states outright; a door reached is at the
 * door whatever the clock says; lateness overrides only the states in which
 * the practitioner has not yet arrived.
 */
export function boardState(
  stop: Progress,
  previous: Progress | null,
  late: boolean,
  now: Date,
): BoardState {
  switch (stop.status) {
    case 'completed':
      return 'finished';
    case 'no_show':
      return 'missed';
    case 'cancelled':
    case 'cancelled_late':
      return 'called_off';
    case 'rescheduled':
      return 'moved';
    case 'checked_in':
      return 'at_the_door';
    case 'proposed':
    case 'confirmed':
      break;
  }
  if (stop.checkedInAt !== null && stop.closedAt === null) return 'at_the_door';
  if (stop.closedAt !== null) return 'finished';
  if (late) return 'running_late';
  const previousClosed = previous !== null && previous.closedAt !== null;
  if (previousClosed && now.getTime() < stop.windowStart.getTime()) return 'on_the_way';
  return stop.status === 'proposed' ? 'waiting' : 'agreed';
}
```

In `domain/scheduling/index.ts`, add after the `optimise` exports:

```ts
export { BOARD_STATES, DEFAULT_GRACE_MINUTES, boardState, lateness } from './lateness';
export type { BoardState, Lateness, Progress } from './lateness';
```

- [ ] **Step 4: Run the tests**

Run: `pnpm -s vitest run domain/scheduling/lateness.test.ts && pnpm -s typecheck`
Expected: PASS (11 tests); typecheck clean. If the skipped-door case disagrees by a minute, check `minutesLate` uses `ceil` and the fixture's window end (09:45 to 10:10 is 25).

- [ ] **Step 5: Commit**

```bash
git add domain/scheduling/lateness.ts domain/scheduling/lateness.test.ts domain/scheduling/index.ts
git commit -m "feat(dispatch): running late, decided rather than typed, and the board's nine states

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: One sentence in the trail

**Files:**
- Modify: `domain/shared/audit-narrative.ts` (the `insert` branch for `appointment`; read the `contact` insert branch near line 539 for the shape)
- Test: `domain/shared/audit-narrative.test.ts`

**Interfaces:**
- Consumes: `AuditEvent` with `entityType: 'appointment'`, `action: 'insert'`, `newValues.reassigned_from_practitioner_id`.
- Produces: the sentence `"{actor} reassigned the appointment to another practitioner"` (Arabic `"{actor} أعاد إسناد الموعد إلى ممارس آخر"`) with `kind: 'create'`; every other appointment insert narrates as it did.

- [ ] **Step 1: Write the failing test**

In `domain/shared/audit-narrative.test.ts`, find how the existing tests build an event (search for `entityType: 'appointment'` or the `event(` helper) and add:

```ts
  it('reads a reassignment as one act, not as a bare addition', () => {
    const reassigned = narrate(
      event({
        entityType: 'appointment',
        action: 'insert',
        newValues: {
          status: 'confirmed',
          rescheduled_from_id: '00000008-0000-4000-8000-000000000101',
          reassigned_from_practitioner_id: '00000008-0000-4000-8000-000000000002',
        },
      }),
      'en',
    );
    expect(reassigned.sentence).toBe('Cedar Ridge reassigned the appointment to another practitioner');
    expect(reassigned.kind).toBe('create');
    const plain = narrate(
      event({ entityType: 'appointment', action: 'insert', newValues: { status: 'proposed' } }),
      'en',
    );
    expect(plain.sentence).not.toContain('reassigned');
  });
```

Use the file's own helper names (`narrate` and `event` are what the existing tests call; if the file names them differently, use its names — the assertion is what matters). The actor name comes from the helper's default actor; if that is not `Cedar Ridge`, assert with `toContain('reassigned the appointment to another practitioner')` instead.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -s vitest run domain/shared/audit-narrative.test.ts`
Expected: FAIL — the sentence reads as an addition.

- [ ] **Step 3: Add the branch**

In `domain/shared/audit-narrative.ts`, inside the function that narrates an `insert`, before the generic "added a …" fallback and beside the `contact` case, add:

```ts
    case 'appointment': {
      // A reassignment is inserted with the practitioner it was taken from
      // (migration 210): one act, said as one (docs/SPEC/dispatch.md section 11).
      if (scalar(event.newValues, 'reassigned_from_practitioner_id') !== null) {
        return pick(
          t(
            `${actor} reassigned the appointment to another practitioner`,
            `${actor} أعاد إسناد الموعد إلى ممارس آخر`,
          ),
          locale,
        );
      }
      break;
    }
```

(`scalar`, `pick` and `t` are the file's own helpers, used by the `contact` and `consent` branches directly above; `break` falls through to the generic sentence.)

- [ ] **Step 4: Run the tests**

Run: `pnpm -s vitest run domain/shared/audit-narrative.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add domain/shared/audit-narrative.ts domain/shared/audit-narrative.test.ts
git commit -m "feat(dispatch): the trail reads a reassignment as one act

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: The board route

**Files:**
- Modify: `app/api/routing/practice-day.ts` — put `export` on `readDay`, `readBases`, `toHomeBase`, `toPlanStop`, `bucketsFor`, `placesFor` (no other change)
- Modify: `app/api/appointments/schema.ts` — `BoardResponse`
- Create: `app/api/appointments/board.ts`
- Modify: `app/api/appointments/routes.ts` — mount
- Test: `tests/dispatch/db/board.test.ts`

**Interfaces:**
- Produces `GET /api/appointments/board?date=YYYY-MM-DD` answering:
  ```ts
  BoardVisit = { appointmentId, windowStart, windowEnd, status, state: BoardState,
    client: { id, givenName, familyName }, serviceType: { id, name, durationMinutes },
    emirate: string, checkedInAt: string | null, closedAt: string | null,
    lateness: { late: boolean; byMinutes: number } | null }
  BoardPractitioner = { practitionerId, displayName, visits: BoardVisit[] }
  BoardResponse = { date, latenessAvailable: boolean, practitioners: BoardPractitioner[] }
  ```
  Every practitioner of the practice has a row, visits or not (spec 4.2). `latenessAvailable` is false and every `lateness` null when the deployment has no routing seam. One `list` audit row per visit shown (`logRead(db, 'client', clientId, clientId)`), exactly as `GET /api/appointments` writes.

- [ ] **Step 1: Write the failing test**

Create `tests/dispatch/db/board.test.ts`:

```ts
import { SignJWT } from 'jose';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from '@app/api/_middleware/db';
import { createTokenVerifier } from '@app/api/_middleware/token-verifier';
import { createApi } from '@app/api/create-api';
import { createStraightLineRouting } from '@app/api/_middleware/routing/straight-line';
import type { BoardResponse } from '@app/api/appointments/schema';
import {
  AUTH,
  IDS,
  MORE_IDS,
  freshDatabase,
  seedClient,
  seedContact,
  seedCredential,
  seedLocation,
  seedPractitioner,
  seedServiceType,
  seedTenant,
  seedUser,
} from '../../db/helpers';

/**
 * The board (docs/SPEC/dispatch.md sections 4, 9 and 10): every practitioner
 * with a row, each visit with its facts and its state, one `list` audit row
 * per household shown, and the three roles admitted while everyone else is
 * refused. Ids in this file's own 7xxx block of the reserved range.
 */

const ISSUER = 'http://localhost:54321/auth/v1';
const SECRET = 'test-secret-that-unlocks-nothing-0123456789';
const KEY = new TextEncoder().encode(SECRET);

const AUTH_FINANCE = '00000000-0000-4000-8000-000000007001';
const FINANCE_USER = '00000000-0000-4000-8000-000000007002';
const PRACTITIONER_IDLE = '00000000-0000-4000-8000-000000007003';
const PRACTITIONER_IDLE_USER = '00000000-0000-4000-8000-000000007004';
const AUTH_PRACTITIONER_IDLE = '00000000-0000-4000-8000-000000007005';
const CONTACT_A = '00000000-0000-4000-8000-000000007006';
const APPT_CLOSED = '00000000-0000-4000-8000-000000007101';
const APPT_OPEN = '00000000-0000-4000-8000-000000007102';
const APPT_NEXT = '00000000-0000-4000-8000-000000007103';
const SESSION_CLOSED = '00000000-0000-4000-8000-000000007201';
const SESSION_OPEN = '00000000-0000-4000-8000-000000007202';

const DATE = '2026-09-04';
const at = (time: string) => new Date(`${DATE}T${time}:00+04:00`);
// The clock the API runs on: 10:50 on the day, after the second door opened.
const NOW = at('10:50');

let owner: pg.Client;
let pool: pg.Pool;
let api: ReturnType<typeof createApi>;

function mint(sub: string): Promise<string> {
  return new SignJWT({ role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setAudience('authenticated')
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(KEY);
}

async function get(sub: string, path: string): Promise<Response> {
  return api.request(path, { headers: { authorization: `Bearer ${await mint(sub)}` } });
}

async function seedAppointment(id: string, windowStart: Date, status: string): Promise<void> {
  await owner.query(
    'insert into appointment (id, tenant_id, client_id, practitioner_id, service_type_id, ' +
      'location_id, delivery_mode, window_start, window_end, status, created_by) ' +
      "values ($1, $2, $3, $4, $5, $6, 'home', $7, $8, $9::appointment_status, $10)",
    [
      id, IDS.tenantA, IDS.clientA, MORE_IDS.practitionerA, MORE_IDS.serviceTypeA, IDS.locationA,
      windowStart, new Date(windowStart.getTime() + 45 * 60_000), status, IDS.ownerA,
    ],
  );
}

/** A session at a door, opened when the practitioner arrived and closed when they left, if they did. */
async function seedSession(id: string, appointmentId: string, checkedInAt: Date, closedAt: Date | null) {
  await owner.query(
    'insert into session (id, tenant_id, client_id, practitioner_id, service_type_id, ' +
      "delivery_mode, status, checked_in_at, closed_at, appointment_id, created_by) values " +
      "($1, $2, $3, $4, $5, 'home', $6, $7, $8, $9, $10)",
    [
      id, IDS.tenantA, IDS.clientA, MORE_IDS.practitionerA, MORE_IDS.serviceTypeA,
      closedAt === null ? 'in_progress' : 'completed', checkedInAt, closedAt, appointmentId,
      MORE_IDS.practitionerUserA,
    ],
  );
}

beforeAll(async () => {
  owner = await freshDatabase();
  await seedTenant(owner, IDS.tenantA, IDS.ownerA, 'Synthetic Studio A');
  await owner.query('update app_user set auth_id = $1 where id = $2', [AUTH.ownerA, IDS.ownerA]);
  await seedTenant(owner, IDS.tenantB, IDS.ownerB, 'Synthetic Studio B');
  await owner.query('update app_user set auth_id = $1 where id = $2', ['00000000-0000-4000-8000-000000007007', IDS.ownerB]);
  await seedServiceType(owner, IDS.tenantA, MORE_IDS.serviceTypeA, 'nf-session');

  await seedUser(owner, {
    id: MORE_IDS.practitionerUserA, tenantId: IDS.tenantA, authId: AUTH.practitionerA,
    displayName: 'Synthetic Practitioner A', roles: ['practitioner'],
  });
  await seedPractitioner(owner, IDS.tenantA, MORE_IDS.practitionerA, MORE_IDS.practitionerUserA);
  await seedCredential(owner, {
    tenantId: IDS.tenantA, practitionerId: MORE_IDS.practitionerA, serviceTypeId: MORE_IDS.serviceTypeA,
    certification: 'bcia_bcn', validFrom: '2020-01-01', validTo: null, canExecuteSession: true,
  });
  // A second practitioner with nothing on: an idle row is still a row (spec 4.2).
  await seedUser(owner, {
    id: PRACTITIONER_IDLE_USER, tenantId: IDS.tenantA, authId: AUTH_PRACTITIONER_IDLE,
    displayName: 'Synthetic Practitioner Idle', roles: ['practitioner'],
  });
  await seedPractitioner(owner, IDS.tenantA, PRACTITIONER_IDLE, PRACTITIONER_IDLE_USER);
  await seedUser(owner, {
    id: FINANCE_USER, tenantId: IDS.tenantA, authId: AUTH_FINANCE,
    displayName: 'Synthetic Finance', roles: ['finance'],
  });
  await seedUser(owner, {
    id: MORE_IDS.contactUserA, tenantId: IDS.tenantA, authId: AUTH.contactA,
    displayName: 'Synthetic Contact', roles: ['client_contact'],
  });

  await seedClient(owner, IDS.tenantA, IDS.clientA, IDS.ownerA, 'Alpha');
  await owner.query("update client set status = 'active', date_of_birth = '1990-01-01' where id = $1", [IDS.clientA]);
  await seedContact(owner, IDS.tenantA, CONTACT_A, IDS.clientA, 'x-board-a');
  await seedLocation(owner, IDS.tenantA, IDS.locationA, IDS.clientA, IDS.ownerA);

  // The day: one visit closed at 09:40, one checked in at 10:00 and still open
  // at 10:50, one still to come at 11:00 — which cannot be reached in time.
  await seedAppointment(APPT_CLOSED, at('09:00'), 'completed');
  await seedAppointment(APPT_OPEN, at('10:00'), 'checked_in');
  await seedAppointment(APPT_NEXT, at('11:00'), 'confirmed');
  await seedSession(SESSION_CLOSED, APPT_CLOSED, at('09:02'), at('09:40'));
  await seedSession(SESSION_OPEN, APPT_OPEN, at('10:03'), null);

  pool = createPool(process.env.API_DATABASE_URL ?? '');
  api = createApi({
    pool,
    verifier: createTokenVerifier({ issuer: ISSUER, secret: SECRET }),
    keyOf: () => 'test',
    routing: createStraightLineRouting(),
    now: () => NOW,
  });
});

afterAll(async () => {
  await pool.end();
  await owner.end();
});

describe('GET /api/appointments/board', () => {
  it('answers every practitioner with a row, each visit with its facts and its state', async () => {
    const res = await get(AUTH.ownerA, `/api/appointments/board?date=${DATE}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as BoardResponse;
    expect(body.date).toBe(DATE);
    expect(body.latenessAvailable).toBe(true);
    expect(body.practitioners.map((p) => p.displayName).sort()).toEqual([
      'Synthetic Practitioner A',
      'Synthetic Practitioner Idle',
    ]);
    const idle = body.practitioners.find((p) => p.practitionerId === PRACTITIONER_IDLE);
    expect(idle?.visits).toEqual([]);
    const busy = body.practitioners.find((p) => p.practitionerId === MORE_IDS.practitionerA);
    expect(busy?.visits.map((v) => [v.appointmentId, v.state])).toEqual([
      [APPT_CLOSED, 'finished'],
      [APPT_OPEN, 'at_the_door'],
      [APPT_NEXT, 'running_late'],
    ]);
    const next = busy?.visits[2];
    expect(next?.lateness?.late).toBe(true);
    expect(next?.client).toEqual({ id: IDS.clientA, givenName: expect.any(String), familyName: 'Alpha' });
    expect(next?.serviceType.durationMinutes).toBeGreaterThan(0);
    expect(next?.emirate).toBe('DXB');
    expect(busy?.visits[0]?.closedAt).toBe(at('09:40').toISOString());
    expect(busy?.visits[1]?.checkedInAt).toBe(at('10:03').toISOString());
  });

  it('writes one list row per household shown, as the schedule does', async () => {
    const before = await owner.query<{ n: string }>(
      "select count(*)::text as n from audit_log where action = 'list' and entity_type = 'client' and client_id = $1",
      [IDS.clientA],
    );
    await get(AUTH.ownerA, `/api/appointments/board?date=${DATE}`);
    const after = await owner.query<{ n: string }>(
      "select count(*)::text as n from audit_log where action = 'list' and entity_type = 'client' and client_id = $1",
      [IDS.clientA],
    );
    expect(Number(after.rows[0]?.n) - Number(before.rows[0]?.n)).toBe(3);
  });

  it('admits the lead practitioner and refuses a practitioner, finance and a household', async () => {
    // The seeded owner is also the lead practitioner in the helpers' fixture;
    // the admitted cases are the owner above and the admin in the reassign
    // file. Refusals are what this case proves.
    for (const sub of [AUTH.practitionerA, AUTH_FINANCE, AUTH.contactA]) {
      const res = await get(sub, `/api/appointments/board?date=${DATE}`);
      expect(res.status).toBe(403);
    }
  });

  it('refuses a malformed date before reading anything', async () => {
    const res = await get(AUTH.ownerA, '/api/appointments/board?date=yesterday');
    expect(res.status).toBe(400);
  });

  it("shows another practice nothing of this one's day", async () => {
    const res = await get('00000000-0000-4000-8000-000000007007', `/api/appointments/board?date=${DATE}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as BoardResponse;
    expect(body.practitioners.flatMap((p) => p.visits)).toEqual([]);
  });
});
```

Before running, check two names against `tests/db/helpers.ts`: the exact export for the straight-line routing provider (search `app/api/_middleware/routing/` for the factory the day-map tests use, and import that) and whether `createApi` takes `now` and `routing` as options (search `app/api/create-api.ts` for `now:` and `routing:`; both exist for the day map's tests). The `session` insert lists the columns migration `300_session.sql` declares `not null`; open that file and add any other required column with a synthetic value before running.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run --config vitest.db.config.ts tests/dispatch/db/board.test.ts`
Expected: FAIL — the first case gets a 404 (no such route).

- [ ] **Step 3: The schema**

In `app/api/appointments/schema.ts`, after `ReorderResponse`:

```ts
import { BOARD_STATES } from '@domain/scheduling';

/** One visit on the board (docs/SPEC/dispatch.md 4.3 and 4.4): its facts, and the state read from them. */
export const BoardVisit = z.object({
  appointmentId: z.uuid(),
  windowStart: z.iso.datetime(),
  windowEnd: z.iso.datetime(),
  status: z.enum(APPOINTMENT_STATUSES),
  state: z.enum(BOARD_STATES),
  client: z.object({ id: z.uuid(), givenName: z.string(), familyName: z.string() }),
  serviceType: z.object({ id: z.uuid(), name: z.string(), durationMinutes: z.number().int() }),
  emirate: z.string(),
  checkedInAt: z.iso.datetime().nullable(),
  closedAt: z.iso.datetime().nullable(),
  /** Null when the deployment has no routing seam to price the drives with. */
  lateness: z.object({ late: z.boolean(), byMinutes: z.number().int().min(0) }).nullable(),
});
export type BoardVisit = z.infer<typeof BoardVisit>;

export const BoardPractitioner = z.object({
  practitionerId: z.uuid(),
  displayName: z.string(),
  /** In window order. Empty for an idle practitioner, who is still a row. */
  visits: z.array(BoardVisit),
});
export type BoardPractitioner = z.infer<typeof BoardPractitioner>;

export const BoardResponse = z.object({
  date: z.iso.date(),
  latenessAvailable: z.boolean(),
  practitioners: z.array(BoardPractitioner),
});
export type BoardResponse = z.infer<typeof BoardResponse>;
```

(Move the `import` to the top of the file with the other `@domain/scheduling` import.)

- [ ] **Step 4: The route**

Create `app/api/appointments/board.ts`:

```ts
import type { Hono } from 'hono';
import { canActor, isoDateIn } from '@domain/shared';
import {
  DEFAULT_GRACE_MINUTES,
  boardState,
  lateness,
  type AppointmentStatus,
  type Progress,
} from '@domain/scheduling';
import { logRead } from '../_middleware/audit';
import type { ApiEnv, Db } from '../_middleware/request-context';
import { dayRange, fillMatrix, readFactors } from '../routing/estimates';
import { bucketsFor, placesFor, readBases, readDay, toHomeBase, toPlanStop } from '../routing/practice-day';
import { PRACTICE_TIME_ZONE } from './move-one';
import { BoardResponse, type BoardPractitioner, type BoardVisit } from './schema';

/**
 * `GET /api/appointments/board?date=` — every practitioner's day, each visit
 * with its facts and its state, and whether each can be reached in time
 * (docs/SPEC/dispatch.md sections 4, 5 and 9).
 *
 * **Names are read, so the trail says so**: one `list` row per household
 * shown, exactly as `GET /api/appointments` writes (`app/api/appointments/list.ts`),
 * because it is the same disclosure on a different screen.
 *
 * **The drives are the map's own.** The stops and their coordinates come
 * from `practice-day.ts`'s reads and the matrix from `fillMatrix`, so the
 * board and the optimiser price a drive the same way. With no routing seam
 * configured the board still answers — with `latenessAvailable: false` and
 * no lateness on any visit — rather than refusing the whole screen.
 */

const PRACTITIONERS_SQL =
  'select p.id, u.display_name from practitioner p join app_user u on u.id = p.user_id ' +
  'where p.tenant_id = app.current_tenant_id() and u.tenant_id = app.current_tenant_id() ' +
  'order by u.display_name, p.id';

/** The facts 4.3 names for every visit of the day, and the session's two instants. */
const FACTS_SQL =
  'select a.id, a.client_id, c.given_name, c.family_name, st.id as service_type_id, st.name as service_type_name, ' +
  'l.emirate::text as emirate, ' +
  '(select s.checked_in_at from session s where s.appointment_id = a.id and s.tenant_id = app.current_tenant_id() order by s.checked_in_at desc limit 1) as checked_in_at, ' +
  '(select s.closed_at from session s where s.appointment_id = a.id and s.tenant_id = app.current_tenant_id() order by s.checked_in_at desc limit 1) as closed_at ' +
  'from appointment a ' +
  'join client c on c.id = a.client_id join service_type st on st.id = a.service_type_id ' +
  'join location l on l.id = a.location_id ' +
  'where a.tenant_id = app.current_tenant_id() and c.tenant_id = app.current_tenant_id() ' +
  'and st.tenant_id = app.current_tenant_id() and l.tenant_id = app.current_tenant_id() ' +
  'and a.window_start >= $1 and a.window_start < $2';

type FactsRow = {
  id: string;
  client_id: string;
  given_name: string;
  family_name: string;
  service_type_id: string;
  service_type_name: string;
  emirate: string;
  checked_in_at: Date | null;
  closed_at: Date | null;
};

async function readFacts(db: Db, date: string): Promise<Map<string, FactsRow>> {
  const [dayStart, dayEnd] = dayRange(date);
  const { rows } = await db.query<FactsRow>(FACTS_SQL, [dayStart, dayEnd]);
  return new Map(rows.map((row) => [row.id, row]));
}

export function mountAppointmentBoard(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  api.get('/api/appointments/board', async (c) => {
    const actor = c.get('actor');
    const requestId = c.get('requestId');
    const date = c.req.query('date');
    if (date === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return c.json({ error: 'bad_request', requestId }, 400);
    }
    if (!canActor(actor, { type: 'appointment.board.read' }, {}, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const db = c.get('db');
    const routing = c.get('routing');
    const at = now();

    const practitioners = await db.query<{ id: string; display_name: string }>(PRACTITIONERS_SQL);
    // The map's own reads: every stop of the day with its coordinates, and
    // where each practitioner starts. Includes the settled statuses the map
    // leaves out, because the board shows the whole day's history.
    const stops = await readDay(db, date);
    const bases = await readBases(db);
    const facts = await readFacts(db, date);

    const byPractitioner = new Map<string, typeof stops>();
    for (const row of stops) {
      const day = byPractitioner.get(row.practitioner_id);
      if (day) day.push(row);
      else byPractitioner.set(row.practitioner_id, [row]);
    }

    const factors = routing ? await readFactors(db) : null;
    const answer: BoardPractitioner[] = [];
    for (const practitioner of practitioners.rows) {
      const day = byPractitioner.get(practitioner.id) ?? [];
      const progress: Progress[] = day.map((row) => {
        const fact = facts.get(row.id);
        return {
          stopId: row.id,
          windowStart: row.window_start,
          windowEnd: row.window_end,
          durationMinutes: row.duration_minutes,
          status: row.status as AppointmentStatus,
          checkedInAt: fact?.checked_in_at ?? null,
          closedAt: fact?.closed_at ?? null,
          locationId: row.location_id,
        };
      });

      let late = new Map<string, { late: boolean; byMinutes: number }>();
      if (routing && factors && day.length > 0) {
        const planStops = day.map(toPlanStop);
        const baseRow = bases.get(practitioner.id);
        const base = baseRow === undefined ? null : toHomeBase(baseRow);
        const matrix = await fillMatrix(
          db,
          placesFor(planStops, base === null ? null : { locationId: base.id, point: planStops[0]!.point }),
          bucketsFor(planStops),
          date,
          factors,
          routing,
          actor.userId,
        );
        late = lateness(progress, matrix, at, DEFAULT_GRACE_MINUTES);
      }

      const visits: BoardVisit[] = [];
      for (const [index, stop] of progress.entries()) {
        const fact = facts.get(stop.stopId);
        if (!fact) continue;
        // The household's record was read to show a name: one list row.
        await logRead(db, 'client', fact.client_id, fact.client_id);
        const own = late.get(stop.stopId) ?? null;
        visits.push({
          appointmentId: stop.stopId,
          windowStart: stop.windowStart.toISOString(),
          windowEnd: stop.windowEnd.toISOString(),
          status: stop.status,
          state: boardState(stop, index === 0 ? null : progress[index - 1]!, own?.late ?? false, at),
          client: { id: fact.client_id, givenName: fact.given_name, familyName: fact.family_name },
          serviceType: {
            id: fact.service_type_id,
            name: fact.service_type_name,
            durationMinutes: stop.durationMinutes,
          },
          emirate: fact.emirate,
          checkedInAt: stop.checkedInAt?.toISOString() ?? null,
          closedAt: stop.closedAt?.toISOString() ?? null,
          lateness: routing ? own : null,
        });
      }
      answer.push({ practitionerId: practitioner.id, displayName: practitioner.display_name, visits });
    }

    return c.json(
      BoardResponse.parse({
        date: isoDateIn(dayRange(date)[0], PRACTICE_TIME_ZONE),
        latenessAvailable: routing !== undefined && routing !== null,
        practitioners: answer,
      }),
    );
  });
}
```

Two adjustments the builder makes while wiring this: (a) `readDay` in `practice-day.ts` filters `status in ('proposed','confirmed','checked_in','completed','no_show')`; the board wants every status, so give `readDay` a second parameter `statuses: readonly string[] = MAP_STATUSES` and pass the full list from the board — keep the map's default exactly as it was; (b) `toPlanStop` needs `point`, which `readDay` already provides, so the base's point above is a placeholder only when no base exists — replace the `placesFor` second argument with `base === null ? null : { locationId: base.id, point: navigationTarget(base) }` importing `navigationTarget` from `@domain/scheduling`, exactly as `practice-day.ts` does.

In `app/api/appointments/routes.ts`, import and mount after `mountAppointmentReorder`:

```ts
import { mountAppointmentBoard } from './board';
// …
  mountAppointmentBoard(api, now);
```

- [ ] **Step 5: Run the tests**

Run: `pnpm exec vitest run --config vitest.db.config.ts tests/dispatch/db/board.test.ts && pnpm -s typecheck && pnpm -s lint`
Expected: PASS (5 tests); clean. If the second-door state reads `agreed` rather than `running_late`, check the session insert's `checked_in_at` landed and that `readDay` now includes `checked_in` rows with their `duration_minutes`.

- [ ] **Step 6: Commit**

```bash
git add app/api/appointments/board.ts app/api/appointments/schema.ts app/api/appointments/routes.ts app/api/routing/practice-day.ts tests/dispatch/db/board.test.ts
git commit -m "feat(dispatch): the board route, every practitioner's day with its states and lateness

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: The reassign route

**Files:**
- Modify: `app/api/appointments/move-one.ts` — `insertMoved` takes `practitionerId?` and `reassignedFromPractitionerId?`; `INSERT_SQL` gains the column
- Modify: `app/api/appointments/schema.ts` — `ReassignAppointmentRequest`, `REASSIGN_ACTION_CODES`, `ReassignActionCode`
- Create: `app/api/appointments/reassign.ts`
- Modify: `app/api/appointments/routes.ts` — mount
- Test: `tests/dispatch/db/reassign.test.ts` (the rest of the file)

**Interfaces:**
- Produces `POST /api/appointments/:id/reassign`, body `{ practitionerId: uuid, windowStart?: iso datetime }`, `X-Reason` required; answers `MoveAppointmentResponse` (201) with the new row carrying the new practitioner; refusals: 403 (role; or the new practitioner's credential), 400 `reason_required` | `invalid_request` | `appointment_settled` | `session_open` | `same_practitioner` | `practitioner_not_found`, 404 `appointment_not_found`, 409 `ConflictResponse`.
- `insertMoved(db, { …, practitionerId?: string, reassignedFromPractitionerId?: string })` — both optional; a move passes neither.

- [ ] **Step 1: Write the failing tests**

Replace the body of `tests/dispatch/db/reassign.test.ts` (keeping Task 1's migration case) with a harness in the shape of `tests/dispatch/db/board.test.ts` (copy its `mint`, the `beforeAll` seeding of tenant, service type, practitioner A with credential, finance, contact, client A with contact and location, and `createApi`), then a second practitioner B (`PRACTITIONER_B = '…7301'`, user `…7302`, auth `…7303`) credentialed for `MORE_IDS.serviceTypeA` from `2020-01-01`, and a third, C (`…7304`, `…7305`, `…7306`) with **no** credential. Ids in this file's `73xx` block. Add a `call(sub, method, path, body, reason)` helper exactly as `tests/scheduling/db/move_and_cancel.test.ts` defines it (lines 136–150), with `REASON = 'The first practitioner is unwell.'`. Seed these visits, all for practitioner A on `2026-09-04`, all `confirmed`, each at its own hour so none clash: `APPT_OK` 09:00, `APPT_SAME` 10:00, `APPT_CLASH` 11:00, `APPT_SETTLED` 12:00 (status `completed`), `APPT_OPEN` 13:00 (with an open session as `board.test.ts` seeds one), `APPT_UNCERTIFIED` 14:00, `APPT_MOVED_TOO` 15:00. Also seed for practitioner B one `confirmed` visit at 11:00 for client B (`IDS.clientB`, seeded like client A with `LOCATION_B = '…7307'`), so a reassignment of `APPT_CLASH` onto B clashes.

Then the cases:

```ts
describe('POST /api/appointments/:id/reassign', () => {
  it('hands a visit to another practitioner as two rows, the household keeping its window', async () => {
    const res = await call(AUTH.ownerA, 'POST', `/api/appointments/${APPT_OK}/reassign`, {
      practitionerId: PRACTITIONER_B,
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as MoveAppointmentResponse;
    expect(body.appointment.practitioner.id).toBe(PRACTITIONER_B);
    expect(body.appointment.windowStart).toBe(at('09:00').toISOString());
    expect(body.movedFrom.id).toBe(APPT_OK);
    const rows = await owner.query<{ id: string; status: string; practitioner_id: string; rescheduled_from_id: string | null; reassigned_from_practitioner_id: string | null }>(
      'select id, status::text as status, practitioner_id, rescheduled_from_id, reassigned_from_practitioner_id ' +
        'from appointment where id = $1 or rescheduled_from_id = $1 order by created_at',
      [APPT_OK],
    );
    expect(rows.rows).toEqual([
      { id: APPT_OK, status: 'rescheduled', practitioner_id: MORE_IDS.practitionerA, rescheduled_from_id: null, reassigned_from_practitioner_id: null },
      { id: body.appointment.id, status: 'confirmed', practitioner_id: PRACTITIONER_B, rescheduled_from_id: APPT_OK, reassigned_from_practitioner_id: MORE_IDS.practitionerA },
    ]);
    const trail = await owner.query<{ reason: string }>(
      "select reason from audit_log where entity_type = 'appointment' and entity_id = $1 and action = 'insert'",
      [body.appointment.id],
    );
    expect(trail.rows[0]?.reason).toBe(REASON);
  });

  it('may move the window at the same time', async () => {
    const res = await call(AUTH.ownerA, 'POST', `/api/appointments/${APPT_MOVED_TOO}/reassign`, {
      practitionerId: PRACTITIONER_B,
      windowStart: at('16:00').toISOString(),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as MoveAppointmentResponse;
    expect(body.appointment.windowStart).toBe(at('16:00').toISOString());
    expect(body.movedFrom.windowStart).toBe(at('15:00').toISOString());
  });

  it('refuses the same practitioner, a settled visit, and one with a session open', async () => {
    const same = await call(AUTH.ownerA, 'POST', `/api/appointments/${APPT_SAME}/reassign`, { practitionerId: MORE_IDS.practitionerA });
    expect(same.status).toBe(400);
    expect(((await same.json()) as { code: string }).code).toBe('same_practitioner');
    const settled = await call(AUTH.ownerA, 'POST', `/api/appointments/${APPT_SETTLED}/reassign`, { practitionerId: PRACTITIONER_B });
    expect(((await settled.json()) as { code: string }).code).toBe('appointment_settled');
    const open = await call(AUTH.ownerA, 'POST', `/api/appointments/${APPT_OPEN}/reassign`, { practitionerId: PRACTITIONER_B });
    expect(((await open.json()) as { code: string }).code).toBe('session_open');
  });

  it("refuses a practitioner who is not certified for that service on that day, and one who is not free", async () => {
    const uncertified = await call(AUTH.ownerA, 'POST', `/api/appointments/${APPT_UNCERTIFIED}/reassign`, { practitionerId: PRACTITIONER_C });
    expect(uncertified.status).toBe(403);
    const clash = await call(AUTH.ownerA, 'POST', `/api/appointments/${APPT_CLASH}/reassign`, { practitionerId: PRACTITIONER_B });
    expect(clash.status).toBe(409);
    const body = (await clash.json()) as ConflictResponse;
    expect(body.issues.map((i) => i.code)).toContain('practitioner_overlap');
    const untouched = await owner.query<{ status: string }>('select status::text as status from appointment where id = $1', [APPT_CLASH]);
    expect(untouched.rows[0]).toEqual({ status: 'confirmed' });
  });

  it('insists on a reason, and refuses a practitioner, finance and a household', async () => {
    const noReason = await call(AUTH.ownerA, 'POST', `/api/appointments/${APPT_SAME}/reassign`, { practitionerId: PRACTITIONER_B }, null);
    expect(((await noReason.json()) as { code: string }).code).toBe('reason_required');
    for (const sub of [AUTH.practitionerA, AUTH_FINANCE, AUTH.contactA]) {
      const res = await call(sub, 'POST', `/api/appointments/${APPT_SAME}/reassign`, { practitionerId: PRACTITIONER_B });
      expect(res.status).toBe(403);
    }
  });

  it('rolls the whole thing back when the second write loses a race', async () => {
    // Mirror `tests/scheduling/db/move_and_cancel.test.ts`'s `APPT_RACE` case
    // (search for it): a rival booking for practitioner B at the target
    // window is committed from a second connection between the conflict read
    // and the insert, the route answers 409, and the visit being reassigned
    // is still `confirmed` on practitioner A — not `rescheduled`.
  });
});
```

Write the last case out in full by copying the race harness from the file it names; it is the one test in this plan that reuses an existing mechanism rather than a signature, and the spec (section 13) requires it.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm exec vitest run --config vitest.db.config.ts tests/dispatch/db/reassign.test.ts`
Expected: FAIL — 404 on the route.

- [ ] **Step 3: `insertMoved` learns the two new arguments**

In `app/api/appointments/move-one.ts`, change `INSERT_SQL` to:

```ts
const INSERT_SQL =
  'insert into appointment (tenant_id, client_id, practitioner_id, service_type_id, location_id, ' +
  'delivery_mode, window_start, window_end, travel_buffer_minutes, status, rescheduled_from_id, ' +
  'created_by, reassigned_from_practitioner_id) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) ' +
  'returning id, window_start, window_end, status, delivery_mode';
```

and `insertMoved`'s `args` type gains

```ts
    /** A reassignment's new practitioner; a move passes nothing and keeps the row's own. */
    practitionerId?: string;
    /** Set by a reassignment alone (migration 210). */
    reassignedFromPractitionerId?: string;
```

with the query's parameters becoming `args.practitionerId ?? args.appointment.practitioner_id` in third place and `args.reassignedFromPractitionerId ?? null` as the thirteenth. `appointmentRow` takes the practitioner it prints from `appointment`; give it a fourth optional parameter `practitioner?: { id: string; displayName: string }` and use it when given.

- [ ] **Step 4: The schema**

In `app/api/appointments/schema.ts`:

```ts
export const ReassignAppointmentRequest = z.object({
  practitionerId: z.uuid(),
  /** Omitted: the household keeps the window it was promised. */
  windowStart: z.iso.datetime().optional(),
});
export type ReassignAppointmentRequest = z.infer<typeof ReassignAppointmentRequest>;

export const REASSIGN_ACTION_CODES = [
  'invalid_request',
  'reason_required',
  'appointment_not_found',
  'appointment_settled',
  'session_open',
  'same_practitioner',
  'practitioner_not_found',
] as const;
export type ReassignActionCode = (typeof REASSIGN_ACTION_CODES)[number];
```

- [ ] **Step 5: The route**

Create `app/api/appointments/reassign.ts`, composed from `move.ts` (read it first; the shape is the same, and every comment there about raising after the first write applies):

```ts
import type { Context, Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { canActor, hasRole, type Capability } from '@domain/shared';
import {
  checkConflicts,
  windowFor,
  CLIENT_OVERLAP_MESSAGE,
  PRACTITIONER_OVERLAP_MESSAGE,
  type ExistingAppointment,
} from '@domain/scheduling';
import { cleanText } from '../_middleware/text';
import type { ApiEnv, Db } from '../_middleware/request-context';
import { requiredConsentPurposes } from './create';
import {
  appointmentRow,
  exclusionConflict,
  hasOpenSession,
  insertMoved,
  logClientRead,
  readAppointment,
  readMoveContext,
  retire,
  LIVE_STATUSES_EXCLUDED,
  REASON_MAX,
} from './move-one';
import {
  ConflictResponse,
  MoveAppointmentResponse,
  ReassignAppointmentRequest,
  type ReassignActionCode,
} from './schema';

/**
 * `POST /api/appointments/:id/reassign` — the same visit, in another
 * practitioner's hands (docs/SPEC/dispatch.md section 6). A move that also
 * changes hands: the old row becomes `rescheduled` and keeps the window and
 * the practitioner the household was promised; the new row stands beside it
 * with `rescheduled_from_id`, the new practitioner, and who it was taken from
 * (migration 210). The window may move at the same time or stay as it was.
 *
 * The checks, in order, before anything is written: the role; the visit is
 * proposed or confirmed with no session open (the two gates `move.ts` keeps);
 * the **new** practitioner exists and holds a credential valid for that
 * service on that date (`appointment.create`, which asks exactly this); and
 * `checkConflicts` passes for the new practitioner and the client. After the
 * first write a refusal is raised, never returned, for the reason `move.ts`
 * records.
 */

const NEW_PRACTITIONER_SQL =
  'select p.id, u.display_name from practitioner p join app_user u on u.id = p.user_id ' +
  'where p.id = $1 and p.tenant_id = app.current_tenant_id() and u.tenant_id = app.current_tenant_id()';

const NEW_CREDENTIALS_SQL =
  'select service_type_id, can_execute_session, can_author_protocol, can_sign_report, ' +
  'valid_from, valid_to from credential where practitioner_id = $1 and tenant_id = app.current_tenant_id()';

const NEW_PRACTITIONER_APPOINTMENTS_SQL =
  'select id, window_start, window_end, travel_buffer_minutes from appointment ' +
  `where practitioner_id = $1 and status not in ${LIVE_STATUSES_EXCLUDED} and tenant_id = app.current_tenant_id()`;

function badRequest(c: Context<ApiEnv>, requestId: string | null, code: ReassignActionCode) {
  return c.json({ error: 'bad_request', code, requestId }, 400);
}

function raise(status: 409, payload: unknown): never {
  throw new HTTPException(status, {
    res: new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } }),
  });
}

async function readNewPractitioner(db: Db, id: string) {
  const person = await db.query<{ id: string; display_name: string }>(NEW_PRACTITIONER_SQL, [id]);
  if (!person.rows[0]) return null;
  const credentials = await db.query<{
    service_type_id: string; can_execute_session: boolean; can_author_protocol: boolean;
    can_sign_report: boolean; valid_from: string; valid_to: string | null;
  }>(NEW_CREDENTIALS_SQL, [id]);
  const capabilities: Capability[] = credentials.rows.map((r) => ({
    serviceTypeId: r.service_type_id,
    canExecuteSession: r.can_execute_session,
    canAuthorProtocol: r.can_author_protocol,
    canSignReport: r.can_sign_report,
    validFrom: r.valid_from,
    validTo: r.valid_to,
  }));
  const appointments = await db.query<{ id: string; window_start: Date; window_end: Date; travel_buffer_minutes: number }>(
    NEW_PRACTITIONER_APPOINTMENTS_SQL,
    [id],
  );
  const existing: ExistingAppointment[] = appointments.rows.map((r) => ({
    id: r.id, windowStart: r.window_start, windowEnd: r.window_end, travelBufferMinutes: r.travel_buffer_minutes,
  }));
  return { id: person.rows[0].id, displayName: person.rows[0].display_name, capabilities, existing };
}

export function mountAppointmentReassign(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  api.post('/api/appointments/:id/reassign', async (c) => {
    const actor = c.get('actor');
    const requestId = c.get('requestId');
    if (!hasRole(actor, 'owner', 'admin', 'lead_practitioner')) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    if (!canActor(actor, { type: 'appointment.reassign' }, {}, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    if (cleanText(c.req.header('x-reason') ?? '', REASON_MAX).length === 0) {
      return badRequest(c, requestId, 'reason_required');
    }
    const body = ReassignAppointmentRequest.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return badRequest(c, requestId, 'invalid_request');
    const appointmentId = c.req.param('id');
    if (!z.uuid().safeParse(appointmentId).success) return badRequest(c, requestId, 'invalid_request');

    const db = c.get('db');
    const appointment = await readAppointment(db, appointmentId);
    if (!appointment) {
      return c.json({ error: 'not_found', code: 'appointment_not_found', requestId }, 404);
    }
    if (appointment.practitioner_id === body.data.practitionerId) {
      return badRequest(c, requestId, 'same_practitioner');
    }
    if (appointment.status !== 'proposed' && appointment.status !== 'confirmed') {
      return badRequest(c, requestId, 'appointment_settled');
    }
    if (await hasOpenSession(db, appointmentId)) return badRequest(c, requestId, 'session_open');

    const windowStart = body.data.windowStart ? new Date(body.data.windowStart) : appointment.window_start;
    const { end: windowEnd } = windowFor(windowStart);
    const travelBufferMinutes = appointment.travel_buffer_minutes;

    const context = await readMoveContext(db, appointment, windowStart);
    if (context === null) {
      return c.json({ error: 'not_found', code: 'appointment_not_found', requestId }, 404);
    }
    await logClientRead(db, appointment.client_id);

    const target = await readNewPractitioner(db, body.data.practitionerId);
    if (target === null) return badRequest(c, requestId, 'practitioner_not_found');

    // The booking rule, for the practitioner the visit is going to.
    if (
      !canActor(
        actor,
        { type: 'appointment.create', practitionerId: target.id, serviceTypeId: appointment.service_type_id, on: context.on },
        { assigneeCapabilities: target.capabilities },
        now(),
      )
    ) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }

    const report = checkConflicts(
      {
        practitionerId: target.id,
        clientId: appointment.client_id,
        serviceTypeId: appointment.service_type_id,
        windowStart,
        windowEnd,
        travelBufferMinutes,
        on: context.on,
      },
      {
        practitionerAppointments: target.existing,
        clientAppointments: context.clientAppointments,
        practitionerCredentials: target.capabilities,
        clientActive: context.client.status === 'active',
        requiredConsentPurposes: requiredConsentPurposes(appointment.delivery_mode, context.client.date_of_birth, context.on),
        activeConsentPurposes: context.activeConsentPurposes,
      },
    );
    if (report.blocking.length > 0) {
      return c.json(
        ConflictResponse.parse({
          error: 'conflict',
          issues: report.blocking.map((issue) => ({
            code: issue.code,
            message: issue.message,
            conflictsWithAppointmentId: issue.conflictsWithAppointmentId ?? null,
          })),
          requestId,
        }),
        409,
      );
    }

    if (!(await retire(db, appointmentId, ['proposed', 'confirmed']))) {
      return badRequest(c, requestId, 'appointment_settled');
    }
    let created;
    try {
      created = await insertMoved(db, {
        tenantId: actor.tenantId,
        appointment,
        windowStart,
        windowEnd,
        travelBufferMinutes,
        status: appointment.status,
        rescheduledFromId: appointmentId,
        createdBy: actor.userId,
        practitionerId: target.id,
        reassignedFromPractitionerId: appointment.practitioner_id,
      });
    } catch (error) {
      const code = exclusionConflict(error);
      if (code === null) throw error;
      raise(409, ConflictResponse.parse({
        error: 'conflict',
        issues: [{ code, message: code === 'client_overlap' ? CLIENT_OVERLAP_MESSAGE : PRACTITIONER_OVERLAP_MESSAGE, conflictsWithAppointmentId: null }],
        requestId,
      }));
    }
    if (!created) return c.json({ error: 'internal', requestId }, 500);

    return c.json(
      MoveAppointmentResponse.parse({
        appointment: appointmentRow(appointment, context.client, created, { id: target.id, displayName: target.displayName }),
        movedFrom: {
          id: appointmentId,
          windowStart: appointment.window_start.toISOString(),
          windowEnd: appointment.window_end.toISOString(),
        },
      }),
      201,
    );
  });
}
```

Mount it in `routes.ts` after the board: `mountAppointmentReassign(api, now);`.

- [ ] **Step 6: Run the tests, then the two neighbours**

Run: `pnpm exec vitest run --config vitest.db.config.ts tests/dispatch/db/reassign.test.ts tests/scheduling/db/move_and_cancel.test.ts tests/scheduling/db/reorder.test.ts && pnpm -s typecheck && pnpm -s lint`
(If `reorder.test.ts` is named differently, run every file under `tests/scheduling/db/`.) Expected: all PASS — the move and the reorder are unchanged by the two optional arguments.

- [ ] **Step 7: Commit**

```bash
git add app/api/appointments/reassign.ts app/api/appointments/move-one.ts app/api/appointments/schema.ts app/api/appointments/routes.ts tests/dispatch/db/reassign.test.ts
git commit -m "feat(dispatch): a visit reassigned to another practitioner, as two rows with a reason

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: The board on the screen

**Files:**
- Create: `app/admin/schedule/board/columns.ts` (pure helpers for the grid)
- Create: `app/admin/schedule/board/BoardPage.tsx`, `ReassignDrawer.tsx`, `board.css`
- Modify: `app/shell/adminAccess.ts` (`canOpenBoard`), `app/shell/App.tsx` (the route), `app/admin/schedule/SchedulePage.tsx` (the link)
- Test: `tests/dispatch/BoardPage.test.tsx`, `app/shell/adminAccess.test.ts` (if present; otherwise the App test)

**Interfaces:**
- Consumes `BoardResponse` from `GET /api/appointments/board?date=`, `POST /api/appointments/:id/reassign` with `X-Reason`, `MoveAppointmentResponse`, `ConflictResponse`.
- Produces: `/admin/schedule/board?date=YYYY-MM-DD`; `canOpenBoard(actor, now)`.

- [ ] **Step 1: Write the failing tests**

Create `tests/dispatch/BoardPage.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BoardResponse } from '../../app/api/appointments/schema';
import { BoardPage } from '../../app/admin/schedule/board/BoardPage';
import { AuthProviderBoundary } from '../../app/shell/auth/AuthContext';
import type { AuthProvider } from '../../app/shell/auth/types';

/**
 * The board in jsdom (docs/SPEC/dispatch.md section 13): the states from the
 * facts, an idle row present, a drag opening the drawer rather than
 * committing, the English-only and token rules holding. Names from
 * db/seed/names.ts; ids in the reserved shape.
 */
afterEach(cleanup);

const provider: AuthProvider = {
  kind: 'development',
  signIn: async () => undefined,
  signOut: async () => undefined,
  getAccessToken: async () => 'token',
  onChange: () => () => undefined,
};

const DATE = '2026-09-04';
const at = (time: string) => `${DATE}T${time}:00+04:00`;

const BOARD: BoardResponse = {
  date: DATE,
  latenessAvailable: true,
  practitioners: [
    {
      practitionerId: '00000008-0000-4000-8000-000000000002',
      displayName: 'Cedar Ridge',
      visits: [
        {
          appointmentId: '00000008-0000-4000-8000-000000000101',
          windowStart: at('09:00'), windowEnd: at('09:45'), status: 'completed', state: 'finished',
          client: { id: '00000008-0000-4000-8000-000000000011', givenName: 'Iris', familyName: 'Cliff' },
          serviceType: { id: '00000008-0000-4000-8000-000000000003', name: 'Neurofeedback session', durationMinutes: 45 },
          emirate: 'DXB', checkedInAt: at('09:02'), closedAt: at('09:40'), lateness: { late: false, byMinutes: 0 },
        },
        {
          appointmentId: '00000008-0000-4000-8000-000000000102',
          windowStart: at('11:00'), windowEnd: at('11:45'), status: 'confirmed', state: 'running_late',
          client: { id: '00000008-0000-4000-8000-000000000012', givenName: 'Juniper', familyName: 'Valley' },
          serviceType: { id: '00000008-0000-4000-8000-000000000003', name: 'Neurofeedback session', durationMinutes: 45 },
          emirate: 'SHJ', checkedInAt: null, closedAt: null, lateness: { late: true, byMinutes: 20 },
        },
      ],
    },
    { practitionerId: '00000008-0000-4000-8000-000000000004', displayName: 'Sage Harbour', visits: [] },
  ],
};

function mount(options: { onReassign?: (body: unknown, reason: string | null) => Response } = {}) {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/me') {
      return json({
        userId: '00000002-0000-4000-8000-000000000010', displayName: 'Hazel Harbour',
        tenantId: '00000001-0000-4000-8000-000000000001', roles: ['admin'], capabilities: [],
      });
    }
    if (url.startsWith('/api/appointments/board')) return json(BOARD);
    if (url.endsWith('/reassign')) {
      const headers = new Headers(init?.headers);
      return (options.onReassign ?? (() => json({}, 500)))(
        init?.body ? JSON.parse(String(init.body)) : null,
        headers.get('x-reason'),
      );
    }
    return json({ error: 'not_found' }, 404);
  }) as unknown as typeof fetch;
  render(
    <MemoryRouter initialEntries={[`/admin/schedule/board?date=${DATE}`]}>
      <AuthProviderBoundary provider={provider} fetchImpl={fetchImpl}>
        <Routes>
          <Route path="/admin/schedule/board" element={<BoardPage />} />
        </Routes>
      </AuthProviderBoundary>
    </MemoryRouter>,
  );
  return { fetchImpl };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('BoardPage', () => {
  it('shows every practitioner as a row, the idle one included, and each visit in its state', async () => {
    mount();
    expect(await screen.findByRole('heading', { name: 'Board' })).toBeTruthy();
    const rows = screen.getAllByRole('region');
    expect(rows.map((row) => row.getAttribute('aria-label'))).toEqual(['Cedar Ridge', 'Sage Harbour']);
    expect(within(rows[1]!).getByText('Nothing on')).toBeTruthy();
    expect(screen.getByText('Finished')).toBeTruthy();
    expect(screen.getByText('Running late, 20 min')).toBeTruthy();
    expect(screen.getByText('Iris Cliff')).toBeTruthy();
    expect(screen.getByText('09:00 – 09:45')).toBeTruthy();
  });

  it('opens the drawer prefilled from a drag rather than committing on drop', async () => {
    const onReassign = vi.fn(() => json({}, 500));
    mount({ onReassign });
    const block = await screen.findByRole('button', { name: /Juniper Valley/ });
    const target = screen.getByRole('region', { name: 'Sage Harbour' });
    fireEvent.dragStart(block, { dataTransfer: { setData: vi.fn(), getData: () => '' } });
    fireEvent.drop(target, { dataTransfer: { getData: () => '00000008-0000-4000-8000-000000000102' } });
    expect(await screen.findByRole('dialog', { name: 'Reassign the visit' })).toBeTruthy();
    expect((screen.getByLabelText('To') as HTMLSelectElement).value).toBe('00000008-0000-4000-8000-000000000004');
    expect(onReassign).not.toHaveBeenCalled();
  });

  it('sends the reason and the new practitioner, and redraws on success', async () => {
    const onReassign = vi.fn(() =>
      json({ appointment: { ...BOARD.practitioners[0]!.visits[1], id: '00000008-0000-4000-8000-000000000103' }, movedFrom: { id: '00000008-0000-4000-8000-000000000102', windowStart: at('11:00'), windowEnd: at('11:45') } }, 201),
    );
    const { fetchImpl } = mount({ onReassign });
    fireEvent.click(await screen.findByRole('button', { name: /Juniper Valley/ }));
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '00000008-0000-4000-8000-000000000004' } });
    fireEvent.change(screen.getByLabelText('Why'), { target: { value: 'Cedar is unwell this afternoon.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reassign' }));
    await waitFor(() => expect(onReassign).toHaveBeenCalledWith({ practitionerId: '00000008-0000-4000-8000-000000000004' }, 'Cedar is unwell this afternoon.'));
    await waitFor(() => expect(fetchImpl.mock.calls.filter((call) => String(call[0]).startsWith('/api/appointments/board')).length).toBe(2));
  });

  it('refuses in place with the sentence the route gave', async () => {
    mount({
      onReassign: () => json({ error: 'conflict', issues: [{ code: 'practitioner_overlap', message: 'That practitioner already has a visit then.', conflictsWithAppointmentId: null }], requestId: null }, 409),
    });
    fireEvent.click(await screen.findByRole('button', { name: /Juniper Valley/ }));
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '00000008-0000-4000-8000-000000000004' } });
    fireEvent.change(screen.getByLabelText('Why'), { target: { value: 'Cedar is unwell this afternoon.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reassign' }));
    expect(await screen.findByText('That practitioner already has a visit then.')).toBeTruthy();
  });

  it('says when lateness cannot be worked out', async () => {
    mount();
    // A second mount with latenessAvailable false is covered by changing BOARD
    // in a local copy; the sentence under test:
    expect(true).toBe(true);
  });
});
```

Replace the last case with a real one: give `mount` an `options.board?: BoardResponse` parameter, pass `{ ...BOARD, latenessAvailable: false, practitioners: BOARD.practitioners.map((p) => ({ ...p, visits: p.visits.map((v) => ({ ...v, lateness: null, state: v.state === 'running_late' ? 'agreed' : v.state })) })) }`, and assert `screen.findByText('Running late cannot be worked out on this deployment: no drive estimates are configured.')`.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm -s vitest run tests/dispatch/BoardPage.test.tsx`
Expected: FAIL — `Cannot find module '../../app/admin/schedule/board/BoardPage'`.

- [ ] **Step 3: The grid helpers**

Create `app/admin/schedule/board/columns.ts`:

```ts
/**
 * The board's columns (docs/SPEC/dispatch.md 4.2): fifteen-minute columns
 * across the practice's day, as the week grid describes them. The day runs
 * from the hour before the first window to the hour after the last block
 * ends, and never narrower than 08:00 to 18:00, so an empty day still has a
 * shape. Pure.
 */
export const QUARTER_MS = 15 * 60_000;
const PRACTICE_UTC_OFFSET = '+04:00';

export type Span = { start: Date; end: Date; columns: number };

export function daySpan(date: string, blocks: readonly { start: Date; end: Date }[]): Span {
  const floor = new Date(`${date}T08:00:00${PRACTICE_UTC_OFFSET}`);
  const ceiling = new Date(`${date}T18:00:00${PRACTICE_UTC_OFFSET}`);
  let start = floor.getTime();
  let end = ceiling.getTime();
  for (const block of blocks) {
    start = Math.min(start, block.start.getTime() - 60 * 60_000);
    end = Math.max(end, block.end.getTime() + 60 * 60_000);
  }
  // Snap to the hour, so the column heads read as clock hours.
  const hour = 60 * 60_000;
  start = Math.floor(start / hour) * hour;
  end = Math.ceil(end / hour) * hour;
  return { start: new Date(start), end: new Date(end), columns: (end - start) / QUARTER_MS };
}

/** `grid-column: <start> / <end>` for a block, one-based, clipped to the span. */
export function gridColumns(span: Span, block: { start: Date; end: Date }): { start: number; end: number } {
  const first = Math.max(1, Math.floor((block.start.getTime() - span.start.getTime()) / QUARTER_MS) + 1);
  const last = Math.min(span.columns + 1, Math.ceil((block.end.getTime() - span.start.getTime()) / QUARTER_MS) + 1);
  return { start: first, end: Math.max(first + 1, last) };
}

/** The clock hours across the top, one per four columns. */
export function hourLabels(span: Span): { label: string; column: number }[] {
  const labels: { label: string; column: number }[] = [];
  const formatter = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai' });
  for (let column = 1; column <= span.columns; column += 4) {
    labels.push({ label: formatter.format(new Date(span.start.getTime() + (column - 1) * QUARTER_MS)), column });
  }
  return labels;
}

/** A block spans its arrival window plus the service's own length (4.2). */
export function blockOf(visit: { windowStart: string; windowEnd: string; serviceType: { durationMinutes: number } }): { start: Date; end: Date } {
  const start = new Date(visit.windowStart);
  const end = new Date(new Date(visit.windowEnd).getTime() + visit.serviceType.durationMinutes * 60_000);
  return { start, end };
}
```

- [ ] **Step 4: The page, the drawer and the styles**

Create `app/admin/schedule/board/BoardPage.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { BoardResponse, type BoardPractitioner, type BoardVisit } from '../../../api/appointments/schema';
import type { BoardState } from '@domain/scheduling';
import { useAuth } from '../../../shell/auth/AuthContext';
import { Button, Note, PageHeader } from '../../../shell/components/Controls';
import { StatusChip, type StatusTone } from '../../../shell/components/StatusChip';
import { practiceDay } from '../windows';
import { formatWindow } from '../windows';
import { ReassignDrawer } from './ReassignDrawer';
import { blockOf, daySpan, gridColumns, hourLabels } from './columns';
import './board.css';

/**
 * The dispatcher's board (docs/SPEC/dispatch.md section 4): practitioners
 * down the inline start, the day across in fifteen-minute columns, every
 * visit a block in its state. Read, never typed: every state comes from the
 * route, which read it from what the practice already records.
 *
 * A drag from one row to another opens the drawer prefilled and never commits
 * on drop, because a reassignment asks for a reason and a drop cannot type
 * one (4.4). The drawer is the accessible path.
 */

export const STATE_LABELS: Record<BoardState, string> = {
  waiting: 'Waiting',
  agreed: 'Agreed',
  on_the_way: 'On the way',
  at_the_door: 'At the door',
  running_late: 'Running late',
  finished: 'Finished',
  missed: 'Missed',
  called_off: 'Called off',
  moved: 'Moved',
};

export const STATE_TONES: Record<BoardState, StatusTone> = {
  waiting: 'neutral',
  agreed: 'neutral',
  on_the_way: 'ok',
  at_the_door: 'ok',
  running_late: 'attention',
  finished: 'ok',
  missed: 'critical',
  called_off: 'neutral',
  moved: 'neutral',
};

const NO_LATENESS =
  'Running late cannot be worked out on this deployment: no drive estimates are configured.';

type State = { kind: 'loading' } | { kind: 'ready'; board: BoardResponse } | { kind: 'error' };

function stateLabel(visit: BoardVisit): string {
  if (visit.state === 'running_late' && visit.lateness) {
    return `${STATE_LABELS.running_late}, ${visit.lateness.byMinutes} min`;
  }
  return STATE_LABELS[visit.state];
}

export function BoardPage() {
  const { apiFetch } = useAuth();
  const [params] = useSearchParams();
  const date = params.get('date') ?? practiceDay(new Date());
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [drawer, setDrawer] = useState<{ visit: BoardVisit; from: BoardPractitioner; to: string | null } | null>(null);

  const load = useCallback(() => {
    let live = true;
    setState({ kind: 'loading' });
    void apiFetch(`/api/appointments/board?date=${date}`)
      .then(async (res) => {
        if (!res.ok) throw new Error('unavailable');
        return BoardResponse.parse(await res.json());
      })
      .then((board) => {
        if (live) setState({ kind: 'ready', board });
      })
      .catch(() => {
        if (live) setState({ kind: 'error' });
      });
    return () => {
      live = false;
    };
  }, [apiFetch, date]);

  useEffect(() => load(), [load]);

  const board = state.kind === 'ready' ? state.board : null;
  const blocks = board ? board.practitioners.flatMap((p) => p.visits.map(blockOf)) : [];
  const span = daySpan(date, blocks);
  const hours = hourLabels(span);

  return (
    <section className="page">
      <PageHeader
        title="Board"
        action={
          <Link className="button button--secondary" to={`/admin/schedule?date=${date}`}>
            Back to the day
          </Link>
        }
      />
      {state.kind === 'loading' ? <Note>Loading the board.</Note> : null}
      {state.kind === 'error' ? <Note tone="critical">The board could not be loaded. Try again.</Note> : null}
      {board && !board.latenessAvailable ? <Note>{NO_LATENESS}</Note> : null}
      {board ? (
        <div className="board" style={{ ['--board-columns' as string]: span.columns }}>
          <div className="board__hours" aria-hidden="true">
            {hours.map((hour) => (
              <span key={hour.column} className="board__hour numeric" style={{ gridColumn: `${hour.column} / span 4` }}>
                {hour.label}
              </span>
            ))}
          </div>
          {board.practitioners.map((practitioner) => (
            <section
              key={practitioner.practitionerId}
              className="board__row"
              role="region"
              aria-label={practitioner.displayName}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const id = event.dataTransfer.getData('text/plain');
                const found = board.practitioners
                  .flatMap((p) => p.visits.map((visit) => ({ visit, from: p })))
                  .find((each) => each.visit.appointmentId === id);
                if (found && found.from.practitionerId !== practitioner.practitionerId) {
                  setDrawer({ ...found, to: practitioner.practitionerId });
                }
              }}
            >
              <h2 className="board__name">{practitioner.displayName}</h2>
              <div className="board__lane">
                {practitioner.visits.length === 0 ? (
                  <span className="board__idle small muted">Nothing on</span>
                ) : null}
                {practitioner.visits.map((visit) => {
                  const columns = gridColumns(span, blockOf(visit));
                  const movable = visit.status === 'proposed' || visit.status === 'confirmed';
                  return (
                    <button
                      key={visit.appointmentId}
                      type="button"
                      className={`board__block board__block--${visit.state}`}
                      style={{ gridColumn: `${columns.start} / ${columns.end}` }}
                      draggable={movable}
                      onDragStart={(event) => event.dataTransfer.setData('text/plain', visit.appointmentId)}
                      onClick={() => (movable ? setDrawer({ visit, from: practitioner, to: null }) : undefined)}
                      aria-label={`${visit.client.givenName} ${visit.client.familyName}, ${formatWindow(visit.windowStart, visit.windowEnd)}, ${stateLabel(visit)}`}
                    >
                      <span className="board__window numeric">{formatWindow(visit.windowStart, visit.windowEnd)}</span>
                      <span className="board__client">{visit.client.givenName} {visit.client.familyName}</span>
                      <span className="board__facts small muted">{visit.serviceType.name}, {visit.emirate}</span>
                      <StatusChip label={stateLabel(visit)} tone={STATE_TONES[visit.state]} />
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      ) : null}
      {drawer && board ? (
        <ReassignDrawer
          visit={drawer.visit}
          from={drawer.from}
          initialTo={drawer.to}
          practitioners={board.practitioners.filter((p) => p.practitionerId !== drawer.from.practitionerId)}
          onClose={() => setDrawer(null)}
          onDone={() => {
            setDrawer(null);
            load();
          }}
        />
      ) : null}
    </section>
  );
}
```

`practiceDay` and `formatWindow` live in `app/admin/schedule/windows.ts` (the week page imports both); if `practiceDay` is not exported there, import it from where `WeekPage.tsx` gets it.

Create `app/admin/schedule/board/ReassignDrawer.tsx`:

```tsx
import { useState } from 'react';
import {
  ConflictResponse,
  MoveAppointmentResponse,
  type BoardPractitioner,
  type BoardVisit,
  type ReassignActionCode,
} from '../../../api/appointments/schema';
import { useAuth } from '../../../shell/auth/AuthContext';
import { Button, Field, Note, Select } from '../../../shell/components/Controls';
import { CloseIcon } from '../../../shell/components/Icons';
import { formatWindow } from '../windows';

/**
 * Reassigning one visit (docs/SPEC/dispatch.md section 6.4): the accessible
 * path and the one that takes the reason. Shows what the household was
 * promised, which does not change, and refuses in place with the sentence
 * the route gave. Never a modal: fixed to the inline end, no scrim.
 */

const ACTION_MESSAGES: Record<ReassignActionCode, string> = {
  invalid_request: 'Check the practitioner and try again.',
  reason_required: 'Say why this visit is changing hands before it does.',
  appointment_not_found: 'This appointment is no longer there. Close this and reload the board.',
  appointment_settled: 'This visit has already been checked in, delivered, called off or moved. Reload the board.',
  session_open: 'A session has already been started for this visit. It cannot change hands now.',
  same_practitioner: 'That is the practitioner it is already with.',
  practitioner_not_found: 'That practitioner is no longer on the practice. Reload the board.',
};

export function ReassignDrawer({
  visit,
  from,
  initialTo,
  practitioners,
  onClose,
  onDone,
}: {
  visit: BoardVisit;
  from: BoardPractitioner;
  initialTo: string | null;
  practitioners: BoardPractitioner[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { apiFetch } = useAuth();
  const [to, setTo] = useState(initialTo ?? practitioners[0]?.practitionerId ?? '');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    setError(null);
    if (reason.trim().length === 0) {
      setError(ACTION_MESSAGES.reason_required);
      return;
    }
    setBusy(true);
    try {
      const res = await apiFetch(`/api/appointments/${visit.appointmentId}/reassign`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-reason': reason.trim() },
        body: JSON.stringify({ practitionerId: to }),
      });
      if (res.status === 201) {
        MoveAppointmentResponse.parse(await res.json());
        onDone();
        return;
      }
      const body = (await res.json().catch(() => null)) as { code?: string; issues?: { message: string }[] } | null;
      if (res.status === 409 && body?.issues) {
        const parsed = ConflictResponse.safeParse(body);
        setError(parsed.success ? parsed.data.issues.map((i) => i.message).join(' ') : 'That slot is taken.');
      } else if (res.status === 403) {
        setError('That practitioner is not certified for this service on that day, or you may not reassign.');
      } else {
        const code = (body?.code ?? 'invalid_request') as ReassignActionCode;
        setError(ACTION_MESSAGES[code] ?? ACTION_MESSAGES.invalid_request);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="drawer" role="dialog" aria-label="Reassign the visit">
      <header className="drawer__header">
        <h2>Reassign the visit</h2>
        <button type="button" className="drawer__close" aria-label="Close" onClick={onClose}>
          <CloseIcon />
        </button>
      </header>
      <div className="drawer__body">
        <p className="small muted">
          {visit.client.givenName} {visit.client.familyName}, {formatWindow(visit.windowStart, visit.windowEnd)}, with{' '}
          {from.displayName}. The household keeps this window.
        </p>
        <div className="drawer__form">
          <Select id="reassign-to" label="To" value={to} onChange={(e) => setTo(e.target.value)}>
            {practitioners.map((p) => (
              <option key={p.practitionerId} value={p.practitionerId}>
                {p.displayName}
              </option>
            ))}
          </Select>
          <Field id="reassign-why" label="Why" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
          {error ? <Note tone="critical">{error}</Note> : null}
          <div className="drawer__actions">
            <Button variant="primary" disabled={busy || to === ''} onClick={() => void submit()}>
              Reassign
            </Button>
            <Button variant="quiet" onClick={onClose}>
              Keep
            </Button>
          </div>
        </div>
      </div>
    </aside>
  );
}
```

Check the drawer classes (`drawer`, `drawer__header`, `drawer__body`, `drawer__form`, `drawer__close`) against `MoveAppointmentDrawer.tsx`, which is the shape to match; use exactly its class names.

Create `app/admin/schedule/board/board.css`:

```css
/* The board (docs/SPEC/dispatch.md 4.2): rows of practitioners, fifteen-minute
   columns across. Tokens only; hue is the status chips' and nothing else. */
.board {
  display: flex;
  flex-direction: column;
  gap: var(--s-2);
  overflow-x: auto;
}

.board__hours,
.board__lane {
  display: grid;
  grid-template-columns: repeat(var(--board-columns), minmax(1.5rem, 1fr));
  gap: 0;
}

.board__hours {
  padding-inline-start: 12rem;
  border-block-end: var(--hairline) solid var(--rule);
}

.board__hour {
  font-size: var(--t-small);
  color: var(--ink-2);
  border-inline-start: var(--hairline) solid var(--rule);
  padding-inline-start: var(--s-1);
}

.board__row {
  display: grid;
  grid-template-columns: 12rem minmax(0, 1fr);
  align-items: start;
  border-block-end: var(--hairline) solid var(--rule);
  min-block-size: var(--tap);
}

.board__name {
  margin: 0;
  padding: var(--s-2) var(--s-3) var(--s-2) 0;
  font-size: var(--t-small);
  font-weight: var(--w-medium);
}

.board__lane {
  min-block-size: var(--tap);
  padding-block: var(--s-1);
}

.board__idle {
  grid-column: 1 / -1;
  align-self: center;
}

/* A block: the ledger's bordered block, in a lane. Its columns are set inline. */
.board__block {
  display: flex;
  flex-direction: column;
  gap: var(--s-1);
  padding: var(--s-1) var(--s-2);
  border: var(--hairline) solid var(--rule);
  border-radius: var(--r-2);
  background: var(--surface);
  color: var(--ink);
  text-align: start;
  min-inline-size: 0;
  cursor: grab;
}

.board__block[draggable='false'] {
  cursor: default;
}

.board__block--moved {
  opacity: 0.55;
}

.board__window {
  font-variant-numeric: tabular-nums lining-nums;
}

.board__client {
  font-weight: var(--w-medium);
  overflow-wrap: anywhere;
}

/* Below 1100px: one practitioner after another, each lane a column of blocks
   in time order — the week's own answer to the same width. */
@media (max-width: 1100px) {
  .board__hours {
    display: none;
  }
  .board__row {
    grid-template-columns: minmax(0, 1fr);
  }
  .board__lane {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
  .board__block {
    grid-column: auto !important;
  }
}

/* Below 640px it is the day list: a dispatch board on a phone is not a board. */
@media (max-width: 640px) {
  .board__name {
    padding-inline-start: 0;
  }
}
```

`!important` above overrides the inline `grid-column` in a flex lane; if the repository's lint forbids it, drop the inline style below 1100px by reading `window.matchMedia` once in the page (the `tierOf` helper in `app/shell/railState.ts` already answers which tier the screen is in; use it and set `gridColumn` only on the desk tier).

- [ ] **Step 5: The access rule, the route and the link**

In `app/shell/adminAccess.ts`, beside `canOpenSchedule`:

```ts
/** The dispatcher's board: the three calendar roles (docs/SPEC/dispatch.md section 3). */
export function canOpenBoard(actor: Actor, now: Date): boolean {
  return canActor(actor, { type: 'appointment.board.read' }, {}, now);
}
```

In `app/shell/App.tsx`, import `BoardPage` and `canOpenBoard`, and after the `schedule/week` route add:

```tsx
        <Route
          path="schedule/board"
          element={
            <RequireAuth>
              {(actor) =>
                canOpenBoard(actor, new Date()) ? (
                  <BoardPage />
                ) : (
                  <Navigate to={homeFor(actor)} replace />
                )
              }
            </RequireAuth>
          }
        />
```

In `app/admin/schedule/SchedulePage.tsx`, after the "See the week" link:

```tsx
        <Link className="link schedule__week-link" to={`/admin/schedule/board?date=${date}`}>
          Open the board
        </Link>
```

Add a case to `app/shell/adminAccess.test.ts` (or `App.test.tsx`, whichever tests `canOpenSchedule`): an admin may open the board, a practitioner may not, finance may not.

- [ ] **Step 6: Run the tests**

Run: `pnpm -s vitest run tests/dispatch/BoardPage.test.tsx app/shell tests/scheduling tests/lint && pnpm -s typecheck && pnpm -s lint && pnpm -s format:check`
Expected: all PASS, including `tests/lint/console-is-english.test.ts` and the no-hex rule.

- [ ] **Step 7: Commit**

```bash
git add app/admin/schedule/board app/shell/adminAccess.ts app/shell/App.tsx app/admin/schedule/SchedulePage.tsx tests/dispatch/BoardPage.test.tsx app/shell/adminAccess.test.ts
git commit -m "feat(dispatch): the board, every practitioner's day in its states, with the reassign drawer

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: The seed's second practitioner has a day

**Files:**
- Modify: `db/seed/generate.ts` (`SeedAppointment.status`; three visits after the planning day's five)
- Modify: `db/seed/apply.ts` (only if it narrows `status`; read the appointment insert near line 574)
- Test: `tests/db/seed.test.ts`

**Interfaces:**
- Produces three more `SeedAppointment` rows with ids `seedId('a', 6)`, `seedId('a', 7)`, `seedId('a', 8)` for `practitioners[1]` on the planning day: 09:00 `completed`, 10:00 `checked_in`, 11:15 `confirmed`, for three active households not among the five chosen.

- [ ] **Step 1: Write the failing test**

In `tests/db/seed.test.ts`, find the case that counts the planning day's appointments (search for `appointments` and `5`) and add beside it:

```ts
  it("gives the second practitioner a day the board has something true to say about", () => {
    const data = generateSeed();
    const second = data.appointments.filter((a) => a.practitionerId === data.practitioners[1]?.id);
    expect(second.map((a) => a.status)).toEqual(['completed', 'checked_in', 'confirmed']);
    expect(second.every((a) => a.windowStart.startsWith(data.planningDay))).toBe(true);
    expect(data.appointments).toHaveLength(8);
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -s vitest run tests/db/seed.test.ts`
Expected: FAIL — `expected [] to deeply equal ['completed', …]`.

- [ ] **Step 3: The seed**

In `db/seed/generate.ts`, widen the type:

```ts
  status: 'proposed' | 'confirmed' | 'checked_in' | 'completed';
```

and after the five visits are built (`const appointments: SeedAppointment[] = chosen.slice(0, 5).map(…)`), add:

```ts
  // The second practitioner's day, for the board (docs/SPEC/dispatch.md
  // section 13): one visit closed, one open and overrunning — checked in and
  // never closed, so on any day after the planning day the rule finds the
  // next door unreachable — and one still to come. Three households not on
  // the first practitioner's day, so the two days never share a family.
  const secondPractitioner = at(practitioners, 1);
  const others = visitable.filter((c) => !chosen.includes(c) && placeOf(c.id)).slice(0, 3);
  const SECOND_DAY: { time: string; status: SeedAppointment['status'] }[] = [
    { time: '09:00', status: 'completed' },
    { time: '10:00', status: 'checked_in' },
    { time: '11:15', status: 'confirmed' },
  ];
  others.forEach((c, i) => {
    const slot = at(SECOND_DAY, i);
    const start = `${planningDay}T${slot.time}:00+04:00`;
    const place = placeOf(c.id);
    if (!place) throw new Error(`No home on file for ${c.id}.`);
    appointments.push({
      id: seedId('a', 6 + i),
      clientId: c.id,
      practitionerId: secondPractitioner.id,
      serviceTypeId: visitService.id,
      locationId: place.id,
      windowStart: start,
      windowEnd: new Date(new Date(start).getTime() + 45 * 60_000).toISOString(),
      travelBufferMinutes: 15,
      status: slot.status,
    });
  });
```

Open `db/seed/apply.ts` at the appointment insert; it passes `a.status` through — confirm it does not narrow the union, and that no session row is needed (the board route reads the session's instants when there is one and the lateness rule falls back to the status alone when there is none: a `checked_in` row with no session has `checkedInAt: null`, so add to `board.ts`'s `Progress` building `checkedInAt: fact?.checked_in_at ?? (row.status === 'checked_in' ? row.window_start : null)` and `closedAt: fact?.closed_at ?? (row.status === 'completed' ? row.window_end : null)`, with a comment saying the seed and a hand-edited row are why).

- [ ] **Step 4: Run the seed tests and the seed itself**

Run: `pnpm -s vitest run tests/db/seed.test.ts && pnpm db:reset && pnpm db:migrate && pnpm seed && pnpm exec vitest run --config vitest.db.config.ts tests/db/seed.test.ts tests/dispatch/db/board.test.ts`
Expected: PASS; the seed applies eight visits.

- [ ] **Step 5: Commit**

```bash
git add db/seed/generate.ts db/seed/apply.ts tests/db/seed.test.ts app/api/appointments/board.ts
git commit -m "feat(dispatch): the seed's second practitioner has a day, one door closed and one overrunning

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: The record, the gates and the pull request

**Files:**
- Modify: `docs/SPEC/scheduling-manual.md` (sections 8 and 10: the dispatch board is piece twenty-two's), `docs/SPEC/audit.md` (the narrative catalogue's list gains the reassignment sentence), `docs/SPEC/dispatch.md` (any refinement the build learned, marked *amended* in place as piece seventeen's spec did), `docs/HANDOVER.md` section 10 (a step for the piece)
- Test: none new; the gates whole

- [ ] **Step 1: The two scheduling-manual sentences**

In `docs/SPEC/scheduling-manual.md` section 8, replace "A dispatch board and live tracking stay out." with "The dispatch board is piece twenty-two's (`docs/SPEC/dispatch.md`, 2026-09-10); live tracking stays out until piece twenty-five." In section 10, replace "Dispatch board, live tracking, client notifications" with "Live tracking (piece twenty-five), client notifications" and add at the end of that paragraph: "*The dispatch board* left this list on 2026-09-10 for piece twenty-two."

- [ ] **Step 2: The audit spec and the hand-over**

In `docs/SPEC/audit.md`, where the narrative catalogue's sentences are listed for appointments (search for "appointment" in section 6 or 9), add one line: "A reassignment (migration 210): `{actor} reassigned the appointment to another practitioner`." In `docs/HANDOVER.md` section 10, add step 14: "**Piece twenty-two, the board (this pull request):** built from `docs/superpowers/plans/2026-09-10-dispatch-board.md` in the `dispatch` worktree; migration 210; the board at `/admin/schedule/board`; a reassignment as two rows with a reason. Next: pieces twenty-three to twenty-five with plans of their own, after the two billing plans."

- [ ] **Step 3: The gates whole**

Run: `pnpm verify && pnpm test:db && pnpm build`
Expected: all green. Then on the seeded laptop (`pnpm dev`), open `/admin/schedule/board?date=<planning day>` signed in as the seeded owner: three practitioners, the first's five visits, the second's three with one "Finished", one "At the door" and one "Running late, N min"; reassign the third's confirmed visit to the third practitioner with a reason; both rows redraw; open Audit and find "reassigned the appointment to another practitioner".

- [ ] **Step 4: Commit and open the pull request**

```bash
git add docs/SPEC/scheduling-manual.md docs/SPEC/audit.md docs/SPEC/dispatch.md docs/HANDOVER.md
git commit -m "docs(dispatch): the board is piece twenty-two's, and the trail's new sentence

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push -u origin dispatch-1
gh pr create --base main --head dispatch-1 --title "Piece twenty-two: the dispatcher's board" --body-file <a plain-language body in the shape of pull request 121's, ending with the generated-with line>
```

Then the process of `docs/HANDOVER.md` section 4: one combined review (security, schema — there is a migration — compliance and design in one brief), one fix round, one re-check, the record as a comment, and the merge only when every check reads success on the head.

---

## Self-review

**Spec coverage.** 4.1 the route and the link (Task 7); 4.2 the grid, an idle row, the two narrower tiers (Task 7); 4.3 the block's facts (Tasks 5, 7); 4.4 the nine states and the three tones (Tasks 3, 7); 5 the rule, its two must-nots and the grace as an argument (Task 3); 6.1 to 6.3 the reassignment, its checks in order, raising after the first write, the migration (Tasks 1, 6); 6.4 the drag opening the drawer, the drawer taking the reason, refusing in place (Task 7); 7 no other rule (Task 3 only); 8 one column (Task 1); 9 the two routes and the two actions, one `list` row per visit (Tasks 2, 5, 6); 10 no policy change, the refusals proved (Tasks 5, 6); 11 the sentence (Task 4); 12 nothing pre-built; 13 the seed, every test named, the done-when walk (Tasks 8, 9); 14 the change requests (Task 1, and the files each task touches).

**Placeholders.** One deliberate reference to an existing mechanism rather than code: the race case in Task 6 mirrors `tests/scheduling/db/move_and_cancel.test.ts`'s `APPT_RACE`; the plan says so and why. Every other step carries its code.

**Type consistency.** `Progress`, `Lateness`, `BoardState` (Task 3) are what `board.ts` (Task 5) and `BoardPage.tsx` (Task 7) consume; `BoardVisit.state` is `z.enum(BOARD_STATES)`; `insertMoved`'s two optional arguments (Task 6) are the names `reassign.ts` passes; `appointmentRow`'s fourth argument is optional so `move.ts` and `reorder.ts` compile unchanged; `canOpenBoard` (Task 7) reads `appointment.board.read` (Task 2).

**Corrected after the build (2026-09-10).** Three places where this plan was wrong, kept here rather than quietly edited, because a plan is a record of what was decided and the corrections are part of that record.

- **"Four exports from `app/api/routing/practice-day.ts`" (change request item 6) then listed six.** The board consumes four — `readDay`, `toPlanStop`, `bucketsFor`, `placesFor` — and `readBases` and `toHomeBase` were exported for it and never used, because the matrix the lateness rule asks for takes no home base. They are module-private again, and `docs/CHANGE-REQUESTS/dispatch-01.md` item 6 now names the four.
- **"One `list` audit row per household shown" (the architecture paragraph and Task 5) where the specification says per visit.** `docs/SPEC/dispatch.md` section 9 says the board writes what `GET /api/appointments` writes, and that is `entity_type` `appointment`, `entity_id` the visit, `client_id` the household. Built as written here, the board wrote the clients list's shape instead: six identical rows against one household on one screen, saying nothing about which visits were disclosed, and two screens that are the same disclosure leaving different trails. The specification wins; the route now writes the visit.
- **The hand-over step (Task 9) ended on process rather than product.** "Next: the whole-branch review, then the pull request" is stale the moment the pull request merges. `docs/HANDOVER.md` step 14 ends on this plan's own durable sentence instead: "Next: pieces twenty-three to twenty-five with plans of their own, after the two billing plans."
