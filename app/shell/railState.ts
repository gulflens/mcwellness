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

/** The tablet tier's boundary, the same 768px `shell.css` changes padding at. */
const TABLET = 768;

export type Tier = 'compact' | 'tablet' | 'desk';

/**
 * Which of the three tiers a width falls in (docs/SPEC/responsive-console.md
 * section 4). One vocabulary; no screen writes a width of its own, and
 * tests/lint/one-set-of-breakpoints.test.ts holds these two numbers against
 * the stylesheet's.
 */
export function tierOf(viewportWidth: number): Tier {
  if (viewportWidth >= DESK) {
    return 'desk';
  }
  return viewportWidth >= TABLET ? 'tablet' : 'compact';
}

/** How the rail is standing: a column at either width, or floating over the page. */
export type RailMode = 'column-open' | 'column-strip' | 'overlay';

/**
 * The rail's mode, derived from the tier and the two remembered facts and
 * never stored (docs/SPEC/coloured-shell.md section 7).
 *
 * On a desk the rail is a column and pinning means nothing: it is already held
 * open. Below the desk the strip is what rests on the screen, opening floats
 * the labels over the page, and pinning keeps them there.
 *
 * Pinning pushes the content aside only on a tablet. A 220px rail on a 390px
 * phone would leave 170px of page, so on a phone pinning means only that the
 * rail stops closing itself behind you — which is what a person pinning it
 * there actually wants.
 */
export function railMode(tier: Tier, open: boolean, pinned: boolean): RailMode {
  if (tier === 'desk') {
    return open ? 'column-open' : 'column-strip';
  }
  if (!open) {
    return 'column-strip';
  }
  return tier === 'tablet' && pinned ? 'column-open' : 'overlay';
}

/**
 * Whether choosing a section should put the rail away behind you. True
 * wherever the rail is covering the page and the person has not pinned it: one
 * press goes and clears the view, rather than leaving the page hidden behind a
 * rail they must then close.
 */
export function closesOnChoice(tier: Tier, pinned: boolean): boolean {
  return tier !== 'desk' && !pinned;
}

/**
 * Whether the rail is held open across navigation, remembered on this device.
 * A second key rather than a second word in the first one, so the two facts
 * cannot overwrite each other and no migration is needed.
 */
export const PIN_KEY = 'mcwellness.rail.pinned';

export function readPinned(store: Storage | undefined): boolean {
  if (!store) {
    return false;
  }
  try {
    return store.getItem(PIN_KEY) === 'yes';
  } catch {
    // A private window may refuse storage. Unpinned is the safe answer: the
    // rail closes behind you rather than sitting over a page you cannot read.
    return false;
  }
}

export function writePinned(store: Storage | undefined, pinned: boolean): void {
  if (!store) {
    return;
  }
  try {
    store.setItem(PIN_KEY, pinned ? 'yes' : 'no');
  } catch {
    // Their choice lasts for this visit rather than the next one.
  }
}
