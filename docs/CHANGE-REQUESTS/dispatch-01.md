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
   layout: the board loads no third-party script (spec 4.1). With it, three
   more of scheduling's and the shell's own files: the link that is the
   board's only door, in `app/admin/schedule/SchedulePage.tsx` ("Open the
   board", carrying the day the page is showing); the route's own cases in
   `app/shell/App.test.tsx`, which prove an admin and a lead practitioner
   reach the board and a practitioner is sent home from it; and a dependency
   rather than an edit — the reassign drawer takes the console's shared drawer
   behaviour from `app/shell/components/useDrawer.ts`, which is unchanged.
4. **One sentence in `domain/shared/audit-narrative.ts`**, so an appointment
   inserted with `reassigned_from_practitioner_id` reads as a reassignment
   rather than as a bare addition (spec section 11). With it its own test,
   `domain/shared/audit-narrative.test.ts`, and the catalogue's own document,
   `docs/SPEC/audit.md`, where section 9's rendering rule now records what an
   `appointment.insert` sentence reads before it speaks. Both are the trunk's.
5. **`docs/SPEC/scheduling-manual.md`**: section 4.1 already says "drag
   between columns to reassign"; sections 8 and 10 said a dispatch board is
   out of scope, and now say it is piece twenty-two's.
6. **Four exports from `app/api/routing/practice-day.ts`** (`readDay`,
   `toPlanStop`, `bucketsFor`, `placesFor`), so the board prices its drives
   with the same reads the map uses rather than a copy. Scheduling's file,
   edited under the same widening. Four and not six: `readBases` and
   `toHomeBase` were exported at first and never used by the board, because
   the matrix the lateness rule asks for takes no home base (spec section 5,
   amended). The whole-branch review ruled on them and they are
   module-private again, still used inside their own file by the day map — so
   this piece widens the file's surface by exactly what it consumes.
7. **`insertMoved` in `app/api/appointments/move-one.ts`** takes the new
   practitioner and the new column, both optional, so a move is unchanged and
   its callers `move.ts` and `reorder.ts` are untouched. One more of
   scheduling's files goes with it:
   `tests/scheduling/db/move_and_cancel.test.ts`, whose move case now also
   asserts that a plain move leaves `reassigned_from_practitioner_id` null on
   the row it writes — the column is a reassignment's alone.
8. **The seed** (`db/seed/generate.ts` with its own test
   `db/seed/generate.test.ts`, and `tests/db/seed.test.ts`), the trunk's own
   files: three visits for the second practitioner on the planning day, one
   closed, one open and overrunning, one still to come (spec section 13), so
   the board opens on a fresh laptop with a finished row and a late one.
   Three facts follow from them. `SeedAppointment.status` is widened to admit
   `checked_in` and `completed`, which the seed had no visit in before. The
   day now holds eight appointments rather than five, so the seed test's
   unfiltered count reads 8. And `tests/db/clients.test.ts`'s
   clientless-practitioner case signs in as the third seeded practitioner,
   because the second now has households on their own day. (`db/seed/apply.ts`
   was listed here in the first draft and is not touched: the widened status
   needed no change in the writer.)
9. **One throw in `app/api/routing/estimates.ts`.** `fillMatrix`'s returned
   matrix answered `{ seconds: 0 }` for a pair whose location id was never
   handed in — a figure that makes a door nobody can reach read as comfortably
   on time, and one the matrix's two real fallbacks cannot stand in for,
   because with no coordinate there is no straight line to work out. It now
   throws naming that id, which surfaces a caller's bug loudly and can be
   reached by no honest caller: `readDay` inner-joins `location`, and the
   optimiser and the board both build `places` from every stop they go on to
   ask about. Scheduling's file, edited under the same widening; the routing
   suites under `tests/scheduling/db/` and `tests/dispatch/db/board.test.ts`
   are what prove it unreachable, and `tests/dispatch/matrix.test.ts` is the
   unit case for the throw itself.
10. **Three more of the appointments module's own files.** All scheduling's,
    all edited under the same widening, none changing anything a scheduling
    screen reads:
    - `app/api/appointments/schema.ts` — the board's shapes (`BoardVisit`,
      `BoardPractitioner`, `BoardResponse`) and the reassignment's
      (`ReassignAppointmentRequest`, `REASSIGN_ACTION_CODES`), beside the
      module's existing ones rather than in a file of their own, because this
      is the one place the appointments wire is described.
    - `app/api/appointments/routes.ts` — the two new routes mounted where the
      module's others are.
    - `domain/scheduling/index.ts` — the barrel re-exporting what
      `domain/scheduling/lateness.ts` (dispatch's own file) provides:
      `BOARD_STATES`, `DEFAULT_GRACE_MINUTES`, `boardState`, `drivenStops`,
      `lateness`, `previousStop`, and the three types.

## Left for the scheduling stream

Named here so nothing is lost, and left because each is either outside this
piece's plan or a change to a file the piece has no other business in. None
of them is a defect on this branch.

- **The third copy of `raise` and the constraint-to-409 body.**
  `reassign.ts`, `move.ts` and `reorder.ts` each carry it; the place for one
  copy is `move-one.ts`, which is where the pieces they share already live.
- **`readMoveContext` reads more than a reassignment uses.** It also reads
  the *old* practitioner's credentials and calendar, which a reassignment
  never consults — two queries for nothing. A split in `move-one.ts` is
  scheduling's to make.
- **The target's calendar is read unbounded by date.**
  `NEW_PRACTITIONER_APPOINTMENTS_SQL` in `reassign.ts` mirrors
  `readMoveContext`'s own shape, so narrowing one means narrowing both.
- **`app/admin/schedule/SchedulePage.tsx`'s drawer is mounted without a
  `key`.** The board's own drawer was given one during this piece (a reason
  typed against one visit must never be posted against another); the day
  schedule's has the same shape and the same exposure.

And two notes outside this stream altogether, recorded where somebody will
find them:

- **The console shell collapses `main` on a live resize.** Reproduced on
  `/admin/clients` by dragging 1440px down to 900px without reloading; the
  main column falls to about 64px until the page is reloaded. The shell's.
- **`db/seed/index.ts` overrides the generator's planning day.** Pre-existing,
  and the reason the seeded board's day is not always the generator's. The
  trunk's.
