import { useEffect, type RefObject } from 'react';

/**
 * The behaviour every drawer on this screen needs and none of them had.
 *
 * A drawer that does not hold focus is a drawer a keyboard cannot use:
 * Shift+Tab from the close button landed on the page behind it, where the
 * rows are still clickable and a screen reader still reads them out, so the
 * person is editing one thing and hearing another.
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
 * The shell has no drawer primitive to borrow this from; when it grows one,
 * this is what it should do, and `docs/CHANGE-REQUESTS/billing-03.md` says so.
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
    const behind = [...document.body.children].filter(
      (element): element is HTMLElement =>
        element instanceof HTMLElement && !element.contains(drawer.current),
    );
    for (const element of behind) {
      element.inert = true;
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
      // The width handle joins the cycle last: `inert` alone (above) only
      // kept the mouse working on it, since being marked inert and being
      // reachable by Tab are two different guarantees and this hook only
      // controls the second one by walking `drawer.current`'s own subtree —
      // which the handle, sitting beside `.admin__main`, is never part of
      // (round-one review finding 1, 2026-09-12). Queried by this one class
      // and nothing else, so the cycle cannot pick up anything further.
      //
      // Visibility is asked through `display`, not `offsetParent` the way
      // `focusable`'s own filter above does: `offsetParent` is `null` for
      // *every* `position: fixed` element, by specification, whether it is
      // showing or not — a fixed box is not affiliated with an offset
      // parent at all — and the handle is fixed. Checked in a real browser
      // for this round: with `offsetParent`, the handle never joined the
      // cycle, drawer open or not (round-two review's own suggested check
      // for this, verified and replaced rather than copied as written).
      // `display` correctly reflects both shell.css's `:has()` rule and the
      // tablet-tier media query that hides it below 768px.
      const handle = document.querySelector<HTMLElement>('.drawer__resize');
      if (handle && getComputedStyle(handle).display !== 'none') {
        focusable.push(handle);
      }
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
