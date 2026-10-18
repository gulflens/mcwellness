import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * A small floating panel anchored to the control that opened it (DESIGN.md,
 * level 2): a column's menu, the Columns list. Into the body, so a sticky
 * table header cannot clip it; placed below the anchor and kept on screen,
 * flipping above when there is no room beneath. Escape and a press outside
 * close it, and focus goes back to the anchor. The pattern is the date
 * field's calendar panel (CalendarPanel.tsx), in a form any control can use.
 */
const GAP = 4;
const MARGIN = 8;

export function Popover({
  anchor,
  label,
  onClose,
  children,
  className,
}: {
  anchor: HTMLElement;
  /** The panel's accessible name: "Name column", "Columns". */
  label: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  const panel = useRef<HTMLDivElement | null>(null);
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const element = panel.current;
    if (!element) return;
    const a = anchor.getBoundingClientRect();
    const p = element.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const rtl = getComputedStyle(anchor).direction === 'rtl';
    let left = rtl ? a.right - p.width : a.left;
    left = Math.max(MARGIN, Math.min(left, vw - p.width - MARGIN));
    let top = a.bottom + GAP;
    if (top + p.height > vh - MARGIN && a.top - GAP - p.height >= MARGIN)
      top = a.top - GAP - p.height;
    setPlace({ top: top + window.scrollY, left: left + window.scrollX });
  }, [anchor]);

  // Focus the first control inside once placed, so the keyboard lands in it.
  useEffect(() => {
    if (!place) return;
    const first = panel.current?.querySelector<HTMLElement>(
      'input, button, select, [tabindex]:not([tabindex="-1"])',
    );
    first?.focus();
  }, [place]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      // Bubbling, not capturing, so an open calendar inside closes first.
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault();
        onClose();
        anchor.focus();
      }
    }
    function onPress(event: PointerEvent) {
      const target = event.target as Node;
      if (panel.current?.contains(target) || anchor.contains(target)) return;
      // A date field's calendar opens in a panel of its own on the body; a
      // press inside it is still inside this popover's work.
      if (target instanceof Element && target.closest('.calendar')) return;
      onClose();
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPress, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPress, true);
    };
  }, [anchor, onClose]);

  return createPortal(
    <div
      ref={panel}
      role="dialog"
      aria-label={label}
      className={['popover', className].filter(Boolean).join(' ')}
      // Physical coordinates on purpose: they come from measured boxes, which
      // are physical in either reading direction (as CalendarPanel's are).
      style={
        place ? { top: place.top, left: place.left } : { top: 0, left: 0, visibility: 'hidden' }
      }
    >
      {children}
    </div>,
    document.body,
  );
}
