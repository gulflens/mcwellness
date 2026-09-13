// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DrawerResizeHandle } from './DrawerResizeHandle';
import { DRAWER_WIDTH_KEY } from './useDrawerWidth';

afterEach(cleanup);

/**
 * A `pointercancel` — a touch a system gesture interrupts, a stylus leaving
 * range, the browser taking the pointer back — skips `onPointerUp` entirely.
 * Round two moved the write from every `pointermove` to `onPointerUp` alone;
 * this is the case that fix forgot (round-three review finding 5,
 * 2026-09-12): without an `onPointerCancel` that also commits, the whole
 * drag vanished on the next load with nothing on screen to say so. jsdom
 * implements neither `setPointerCapture` nor `hasPointerCapture` at all, which
 * is exactly why the fix reads a `dragging` ref instead of capture state —
 * these tests exercise that ref directly rather than skirting the gap.
 */
describe('DrawerResizeHandle — a cancelled drag', () => {
  beforeEach(() => localStorage.clear());

  it('commits the moved-to width on pointercancel, not only on pointerup', () => {
    const { getByRole } = render(<DrawerResizeHandle />);
    const handle = getByRole('separator');

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 900 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 700 });
    fireEvent.pointerCancel(handle, { pointerId: 1 });

    const expected = String(window.innerWidth - 700);
    expect(localStorage.getItem(DRAWER_WIDTH_KEY)).toBe(expected);
  });

  it('applies the width live during the drag, before the cancel commits it', () => {
    const { getByRole } = render(<DrawerResizeHandle />);
    const handle = getByRole('separator');

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 900 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 700 });
    expect(localStorage.getItem(DRAWER_WIDTH_KEY)).toBe(null);
    // Read off the attribute directly: this suite carries vitest's own
    // matchers, not jest-dom's (app/shell/components/DateField.test.tsx).
    expect(handle.getAttribute('aria-valuenow')).toBe(String(window.innerWidth - 700));

    fireEvent.pointerCancel(handle, { pointerId: 1 });
    expect(localStorage.getItem(DRAWER_WIDTH_KEY)).toBe(String(window.innerWidth - 700));
  });

  it('commits once even if a pointerup follows the cancel', () => {
    const { getByRole } = render(<DrawerResizeHandle />);
    const handle = getByRole('separator');

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 900 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 700 });
    fireEvent.pointerCancel(handle, { pointerId: 1 });
    const afterCancel = localStorage.getItem(DRAWER_WIDTH_KEY);

    // A pointermove after the drag has already ended must not resume it, and
    // the pointerup that follows must not overwrite the cancel's own value
    // with something stale or double-write it.
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 500 });
    fireEvent.pointerUp(handle, { pointerId: 1 });

    expect(localStorage.getItem(DRAWER_WIDTH_KEY)).toBe(afterCancel);
  });

  it('still commits normally on a clean pointerup, with no cancel', () => {
    const { getByRole } = render(<DrawerResizeHandle />);
    const handle = getByRole('separator');

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 900 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 700 });
    fireEvent.pointerUp(handle, { pointerId: 1 });

    expect(localStorage.getItem(DRAWER_WIDTH_KEY)).toBe(String(window.innerWidth - 700));
  });
});
