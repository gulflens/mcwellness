/**
 * The width every right-side drawer in the console shares, remembered on this
 * device (the operator's ask of 2026-09-12: "be able to resize this client
 * enrollment area … pull it with the handle slightly to make room").
 *
 * One key rather than one per screen: the operator asked to widen "this"
 * drawer and have the room stick, not to tune each of the 27 screens that
 * render one separately. `DrawerResizeHandle` is the only writer; this module
 * is the only place that decides what a width is allowed to be.
 *
 * **Clamped on the way in, not only on the way out.** A value already in
 * storage can predate a narrower browser window, or a floor and ceiling this
 * build changed, or simply have been hand-edited — `readDrawerWidth` refuses
 * to hand back a width nobody could see or use, the same as a fresh drag
 * would.
 *
 * **Every storage access is wrapped.** A private window and a browser set to
 * block site data both throw the moment `localStorage` is touched, not only
 * when it is full — reading the property can throw before `getItem` is ever
 * called. The console must keep working either way: a throw means "nothing
 * was ever chosen", not a crash.
 */
export const MIN_DRAWER_WIDTH = 320;

export const DRAWER_WIDTH_KEY = 'mcwellness.drawer.width';

/**
 * The ceiling for a given viewport: never more than 90% of it, and never more
 * than 1100px even on a very wide display — a drawer that wide stops reading
 * as a drawer beside the ledger.
 */
export function maxDrawerWidth(viewport: number): number {
  return Math.min(Math.round(viewport * 0.9), 1100);
}

/**
 * A width, forced between the floor and this viewport's ceiling. A value that
 * is not a finite number — `NaN`, `Infinity`, a stray string coerced badly —
 * answers the floor rather than propagating, since "unreadable" and "too
 * narrow" ask for the same fallback.
 */
export function clampDrawerWidth(value: number, viewport: number): number {
  if (!Number.isFinite(value)) {
    return MIN_DRAWER_WIDTH;
  }
  return Math.min(Math.max(value, MIN_DRAWER_WIDTH), maxDrawerWidth(viewport));
}

/**
 * The remembered width, clamped to this viewport, or `null` when there is
 * nothing to apply — no choice was ever stored, the stored text does not
 * parse as a number, or storage itself refused the read. `null` always means
 * "let the default stand"; it never means zero.
 */
export function readDrawerWidth(viewport: number): number | null {
  try {
    const stored = localStorage.getItem(DRAWER_WIDTH_KEY);
    if (stored === null) {
      return null;
    }
    const value = Number(stored);
    if (!Number.isFinite(value)) {
      return null;
    }
    return clampDrawerWidth(value, viewport);
  } catch {
    // A private window, or a browser set to block site data: the console
    // still works, the drawer simply takes the default width every time.
    return null;
  }
}

/**
 * Remembers a width for every drawer to come. Swallows a throw the same way
 * `readDrawerWidth` does: the choice then lasts for this visit only, and
 * nothing on screen needs to say so.
 */
export function writeDrawerWidth(value: number): void {
  try {
    localStorage.setItem(DRAWER_WIDTH_KEY, String(value));
  } catch {
    // Nothing to do and nothing to tell the person.
  }
}
