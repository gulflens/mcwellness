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
6. **Six exports from `app/api/routing/practice-day.ts`** (`readDay`,
   `readBases`, `toHomeBase`, `toPlanStop`, `bucketsFor`, `placesFor`), so the
   board prices its drives with the same reads the map uses rather than a
   copy. Scheduling's file, edited under the same widening.
7. **`insertMoved` in `app/api/appointments/move-one.ts`** takes the new
   practitioner and the new column, both optional, so a move is unchanged.
8. **The seed** (`db/seed/generate.ts`, `apply.ts`, `tests/db/seed.test.ts`):
   three visits for the second practitioner on the planning day, one closed,
   one open and overrunning, one still to come (spec section 13).
