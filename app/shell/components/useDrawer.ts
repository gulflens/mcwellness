import { useEffect, type RefObject } from 'react';

/**
 * The behaviour every right-side drawer in the console needs.
 *
 * A drawer that does not hold focus is a drawer a keyboard cannot use:
 * Shift+Tab from the close button lands on the page behind it, where the rows
 * are still clickable and a screen reader still reads them out, so the person
 * is editing one thing and hearing another.
 *
 * Three things, together:
 *
 *   - **`inert` on the page behind.** One attribute; it takes the whole
 *     background out of the tab order and out of the accessibility tree at
 *     once, which no amount of key handling can do as completely.
 *   - **A cycle inside.** Tab from the last control returns to the first, and
 *     Shift+Tab from the first goes to the last, for browsers where `inert`
 *     is unavailable and as the thing that makes the drawer feel closed.
 *   - **Focus returned** to whatever opened it, and Escape to close.
 *
 * This is the shell's copy of the hook `app/admin/billing/useDrawer.ts`
 * wrote first, moved here — as `docs/CHANGE-REQUESTS/billing-03.md` asked —
 * the moment a second screen needed the same behaviour. Billing's own copy
 * stays where it is until that worktree adopts this one: the trunk does not
 * edit a stream's files (docs/SPEC/OWNERSHIP.md), and two identical
 * implementations for one round is a smaller problem than one stream's screen
 * breaking on somebody else's refactor.
 */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useDrawer(
  drawer: RefObject<HTMLElement | null>,
  first: RefObject<HTMLElement | null>,
  onClose: () => void,
): void {
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    first.current?.focus();

    // Everything that is not this drawer: the rail, the page, the section
    // beneath it. `inert` is the whole guarantee; the cycle below is the
    // courtesy.
    //
    // Walked up the tree, sibling by sibling, rather than taken off
    // `document.body.children` — which is where this started and where it did
    // nothing at all. The app renders inside `#root`, so the only child of
    // `body` that does not contain the drawer is a stray script tag: the rail
    // stayed focusable with the drawer open, which is the whole thing `inert`
    // was there to prevent (design review, round 20). Marking the siblings at
    // every level from the drawer up to `body` leaves exactly the drawer's own
    // ancestors live, which is what the attribute is for.
    const behind: HTMLElement[] = [];
    // Walked downwards from `body`, level by level: at each one, the single
    // child that contains the drawer is stepped into and every other child is
    // marked. Downwards rather than up from the drawer so that what is
    // mutated is read off the document rather than off the ref, which is what
    // `react-hooks/immutability` asks for and is no harder to read.
    for (let level: HTMLElement | null = document.body; level !== null;) {
      let holdsTheDrawer: HTMLElement | null = null;
      for (const child of level.children) {
        if (!(child instanceof HTMLElement)) {
          continue;
        }
        if (drawer.current !== null && child.contains(drawer.current)) {
          holdsTheDrawer = child;
          continue;
        }
        // `!child.inert` so a drawer opened above another drawer does not
        // un-inert, on the way out, what the first one had already marked.
        if (!child.inert) {
          child.inert = true;
          behind.push(child);
        }
      }
      // `contains` counts an element as containing itself: stop at the drawer
      // rather than stepping into it and marking its own controls inert.
      level = holdsTheDrawer === drawer.current ? null : holdsTheDrawer;
    }

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !drawer.current) {
        return;
      }
      const focusable = [...drawer.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (element) => element.offsetParent !== null || element === document.activeElement,
      );
      const start = focusable[0];
      const end = focusable[focusable.length - 1];
      if (!start || !end) {
        return;
      }
      if (!event.shiftKey && document.activeElement === end) {
        event.preventDefault();
        start.focus();
      } else if (event.shiftKey && document.activeElement === start) {
        event.preventDefault();
        end.focus();
      }
    };

    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      for (const element of behind) {
        element.inert = false;
      }
      opener?.focus();
    };
  }, [drawer, first, onClose]);
}
