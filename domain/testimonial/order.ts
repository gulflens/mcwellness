/**
 * The order approved reviews are shown in on the website (docs/SPEC/testimonials.md
 * section 4). The office arranges them with Move up and Move down; the page
 * shows them in that order, and a review approved since the last arranging
 * goes to the top until somebody moves it. Pure.
 */

export type MoveDirection = 'up' | 'down';

/**
 * The list as it would read after one review moves one place, or null when
 * there is nowhere to go — the first cannot go up, the last cannot go down,
 * and a review not in the list is not this list's to move. A new list; the
 * one given is left alone.
 */
export function moveTestimonial<T>(
  shown: readonly T[],
  id: T,
  direction: MoveDirection,
): T[] | null {
  const from = shown.indexOf(id);
  if (from === -1) return null;
  const to = direction === 'up' ? from - 1 : from + 1;
  if (to < 0 || to >= shown.length) return null;
  const next = [...shown];
  next[from] = shown[to] as T;
  next[to] = id;
  return next;
}
