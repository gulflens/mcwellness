import { useEffect, useRef, type RefObject } from 'react';

/**
 * Focus an element once, when the panel that holds it first appears.
 *
 * Not an inline `ref={(node) => node?.focus()}`: React runs an inline ref
 * callback on every render, so every keystroke into a field beneath the
 * heading re-rendered the form, re-ran the callback, and moved focus back to
 * the heading — a person typing their name kept one letter (round 63).
 */
export function useFocusOnOpen<T extends HTMLElement>(): RefObject<T | null> {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return ref;
}
