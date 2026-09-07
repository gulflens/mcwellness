/**
 * What a form does when it refuses.
 *
 * A submit that failed used to change nothing a person could notice without
 * looking: the button stayed where it was, focus stayed where it was, and the
 * reason appeared under a field that might be off-screen. For anyone not
 * watching the whole form — a screen reader, a magnifier, anyone who pressed
 * the button and looked away — the drawer simply did nothing.
 *
 * So a refusal moves focus to the first field that is wrong. Its message is
 * already bound to it through `aria-describedby` (the shell's `Field`), so
 * moving there says the field and says the reason, in that order, which is
 * the order a person needs them in. The drawer's own summary carries
 * `role="alert"` beside it for the case where the fault belongs to no single
 * field.
 *
 * Copied from app/admin/billing/refusal.ts rather than imported across streams
 * (docs/SPEC/OWNERSHIP.md rule 3).
 */
export function focusFirstInvalid(fieldIds: readonly string[]): void {
  for (const id of fieldIds) {
    const field = document.getElementById(id);
    if (field) {
      field.focus();
      return;
    }
  }
}
