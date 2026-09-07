/**
 * Whether the console's rail is open, remembered on this device
 * (docs/SPEC/responsive-console.md section 6).
 *
 * The tier decides the first answer: open where there is room for the labels,
 * closed to a strip of icons where there is not. The person's own choice then
 * beats the tier at every size until they change it again. Nothing personal is
 * stored; the key holds one word.
 */
export const RAIL_KEY = 'mcwellness.rail';

/** The desk tier's boundary, the same 1200px `shell.css` opens the rail at. */
const DESK = 1200;

export function railOpenByDefault(viewportWidth: number): boolean {
  return viewportWidth >= DESK;
}

export function readRail(store: Storage | undefined, viewportWidth: number): boolean {
  const fallback = railOpenByDefault(viewportWidth);
  if (!store) {
    return fallback;
  }
  try {
    const stored = store.getItem(RAIL_KEY);
    if (stored === 'open') {
      return true;
    }
    if (stored === 'closed') {
      return false;
    }
    return fallback;
  } catch {
    // A private window may refuse storage. The console still works; the rail
    // simply takes the size of the screen as its answer.
    return fallback;
  }
}

export function writeRail(store: Storage | undefined, open: boolean): void {
  if (!store) {
    return;
  }
  try {
    store.setItem(RAIL_KEY, open ? 'open' : 'closed');
  } catch {
    // Nothing to do and nothing to tell the person: their choice lasts for
    // this visit rather than the next one.
  }
}
