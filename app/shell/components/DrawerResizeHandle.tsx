import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import {
  MIN_DRAWER_WIDTH,
  clampDrawerWidth,
  maxDrawerWidth,
  writeDrawerWidth,
} from './useDrawerWidth';

/** How far an arrow key moves the edge, in pixels. */
const STEP = 32;

/**
 * The one drawer the console ever shows at a time, if any — read from the
 * DOM rather than a prop, because this handle mounts once for the whole
 * console (`AdminLayout`, not each of the 27 screens that render a drawer)
 * and has no other way to know which one, if any, is currently open.
 */
function openDrawer(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.drawer');
}

/**
 * The width to step or drag from. Read fresh off the open drawer's own box
 * every time, rather than kept in this component's state between renders:
 * mounting once for the console (instead of once per drawer, which the
 * width itself used to assume) means nothing tells this component when a
 * different drawer has replaced the last one, or when the person has
 * navigated on without ever touching the handle. The floor is the answer
 * when there is nothing open to measure, which only matters for a stray
 * keyboard event — the handle itself is invisible then (shell.css's
 * `:has()` rule).
 */
function currentWidth(): number {
  const width = openDrawer()?.getBoundingClientRect().width;
  return width !== undefined && width > 0 ? Math.round(width) : MIN_DRAWER_WIDTH;
}

/**
 * Clamps and applies to every drawer at once, live — the part every set
 * needs, drag included. Never writes to storage on its own: a drag calls
 * this on each `pointermove`, and a synchronous write on every one of those
 * is a write per frame for no reader who is not already looking at the
 * screen (round-two review finding 5, 2026-09-12) — `commitDrawerWidth`
 * below is where a width actually becomes the remembered choice.
 */
function applyDrawerWidth(width: number): number {
  const clamped = clampDrawerWidth(width, window.innerWidth);
  document.documentElement.style.setProperty('--drawer', `${clamped}px`);
  document.documentElement.style.setProperty('--drawer-resized', `${clamped}px`);
  return clamped;
}

/** Applies and remembers: every discrete choice — a key press, a drag's end. */
function commitDrawerWidth(width: number): number {
  const clamped = applyDrawerWidth(width);
  writeDrawerWidth(clamped);
  return clamped;
}

/**
 * Distance from the pointer to the viewport's inline end — which is where the
 * drawer's own edge is anchored (`.drawer` sets `inset-inline-end: 0`), so
 * this is exactly the width a drawer anchored there would need to reach the
 * pointer.
 *
 * `clientX` is a physical coordinate; inline-end is not the same physical
 * edge in both directions, so direction is read explicitly rather than
 * assumed — from the handle's own computed style, the same place the CSS
 * logical properties above read it from, rather than from `<html>`: the
 * console fixes `dir="ltr"` there and sets `dir="rtl"` lower down for the
 * one surface that needs it (`app/client/PortalRoot.tsx`), so asking the
 * document would never see it. In LTR the end edge is the viewport's
 * physical right, so the distance is what is left of the viewport past the
 * pointer. In RTL the end edge is the physical left, so the distance is the
 * pointer's position measured from that edge directly.
 */
function widthFromPointer(handle: Element, clientX: number): number {
  const rtl = getComputedStyle(handle).direction === 'rtl';
  return Math.round(rtl ? clientX : window.innerWidth - clientX);
}

/**
 * The drag handle every drawer shares (the operator's ask of 2026-09-12: "be
 * able to resize this client enrollment area … pull it with the handle
 * slightly to make room"). Mounted once in `AdminLayout`, as a sibling of
 * `.admin__main`, rather than inside each of the 27 screens that render a
 * `.drawer` — one edge to keep working rather than 27.
 *
 * Invisible whenever no drawer is open: shell.css hides it by default and
 * shows it only under `.admin:has(.drawer)`, so no state here has to track
 * whether one is showing.
 *
 * Because it lives beside `.admin__main` rather than inside the drawer it
 * resizes, `useDrawer`'s focus trap does not see it as part of the drawer's
 * own subtree — `app/shell/components/useDrawer.ts` names it explicitly so
 * marking the rest of the console `inert` while a drawer is open never
 * disables the one control that must keep working for exactly as long as
 * that is true.
 */
export function DrawerResizeHandle() {
  const [width, setWidth] = useState(() => currentWidth());
  // Whether a drag is in progress — the one thing `onPointerMove` and
  // `finishDrag` both ask, rather than `hasPointerCapture`: a `pointercancel`
  // is not guaranteed to have released capture yet by the time it fires, so
  // a check that depends on capture state can disagree with itself between
  // the two events it is meant to treat alike (round-three review finding 5,
  // 2026-09-12). Mirrors the `drawing` ref
  // `app/admin/clients/SignaturePad.tsx` already uses for the same pair of
  // events, rather than inventing a second shape for one hook over.
  const dragging = useRef(false);

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    // The browser's other default action for a mousedown-and-drag is
    // selecting whatever text the pointer crosses on its way — harmless
    // nowhere near a drawer, but this handle spends its whole life sitting
    // over the ledger (round-two review finding 4, 2026-09-12).
    event.preventDefault();
    // Optional, as SignaturePad's own call is: a browser that cannot capture
    // the pointer still gets a working drag, just without the guarantee that
    // leaving the handle's own bounds keeps tracking it.
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragging.current = true;
    setWidth(currentWidth());
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!dragging.current) {
      return;
    }
    setWidth(applyDrawerWidth(widthFromPointer(event.currentTarget, event.clientX)));
  }

  /**
   * The end of a drag, however it ends. `onPointerUp` and `onPointerCancel`
   * both call this rather than each doing its own half: a `pointercancel` —
   * a touch a system gesture interrupts, a stylus leaving range, the browser
   * taking the pointer back — skipped `onPointerUp` entirely under the
   * previous, up-only write, so the whole drag was forgotten on the next
   * load with nothing on screen to say so (round-three review finding 5,
   * 2026-09-12, worse than the per-frame write finding 5 of round two
   * removed, since that one at least never lost a width outright). Guarded
   * by `dragging` rather than by whether capture is still held, so a cancel
   * followed by an up — or either firing twice, which the spec does not
   * rule out — commits once, from whichever width was last applied, never
   * stale and never doubled.
   */
  function finishDrag() {
    if (!dragging.current) {
      return;
    }
    dragging.current = false;
    writeDrawerWidth(width);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const from = currentWidth();
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      setWidth(commitDrawerWidth(from + STEP));
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      setWidth(commitDrawerWidth(from - STEP));
    } else if (event.key === 'Home') {
      event.preventDefault();
      setWidth(commitDrawerWidth(MIN_DRAWER_WIDTH));
    } else if (event.key === 'End') {
      event.preventDefault();
      setWidth(commitDrawerWidth(maxDrawerWidth(window.innerWidth)));
    }
  }

  return (
    <div
      className="drawer__resize"
      role="separator"
      aria-orientation="vertical"
      aria-label="Drawer width"
      aria-valuenow={width}
      aria-valuemin={MIN_DRAWER_WIDTH}
      aria-valuemax={maxDrawerWidth(window.innerWidth)}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      onKeyDown={onKeyDown}
      onFocus={() => setWidth(currentWidth())}
    />
  );
}
