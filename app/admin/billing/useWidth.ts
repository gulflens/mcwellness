import { useCallback, useEffect, useState } from 'react';

/**
 * How wide the element is, asked of the element itself rather than the
 * window, as docs/SPEC/responsive-console.md section 8 asks of tables: what
 * decides whether a ledger fits is the room it has beside the rail, not the
 * screen.
 *
 * A ledger that is a table with room and a list of cards without draws one or
 * the other, never both with one hidden by CSS: two copies of every figure
 * would be two of everything for a screen reader. Null until the element has
 * been measured — the first paint, and jsdom, which lays nothing out — and
 * every caller reads null as "room enough", so the table is the default and
 * a phone swaps it once, before anyone has read it.
 *
 * The ref is a callback, not an object: the element it measures often appears
 * only once its data has loaded, after the component's first effect has run.
 */
export function useWidth<T extends HTMLElement>(): [(element: T | null) => void, number | null] {
  const [element, setElement] = useState<T | null>(null);
  const [width, setWidth] = useState<number | null>(null);
  const ref = useCallback((next: T | null) => setElement(next), []);

  useEffect(() => {
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      const measured = entry?.contentRect.width ?? 0;
      // Nothing measured yet is not a phone.
      if (measured > 0) setWidth(Math.round(measured));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  return [ref, width];
}

/** True when there is room for `needed` pixels, or nothing is measured yet. */
export function roomFor(width: number | null, needed: number): boolean {
  return width === null || width >= needed;
}
