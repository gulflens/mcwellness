/**
 * The order the practice lists its packages in, set by hand (operator,
 * 20 October 2026: Silver, Gold, Platinum, then Complimentary — an order no
 * price or name gives).
 *
 * A package moves one place at a time, past the nearest package still on
 * offer: a withdrawn one sits in the folded list, out of sight of the rest,
 * so stepping over it is what a person looking at the table expects. A
 * withdrawn package does not move at all.
 */

export type PackageMove = 'up' | 'down';

/** A package as the order reads it, already in its current order. */
export type OrderedPackage = { id: string; status: 'active' | 'inactive' };

/**
 * Every package numbered from one in its new order, or null when the move
 * cannot happen: the package is first (up) or last (down) among those on
 * offer, is withdrawn, or is not in the list.
 *
 * The whole list is renumbered rather than two positions swapped, so a gap or
 * a tie an earlier write left behind closes the next time anything moves.
 */
export function movePackage(
  packages: readonly OrderedPackage[],
  id: string,
  direction: PackageMove,
): { id: string; position: number }[] | null {
  const from = packages.findIndex((p) => p.id === id);
  if (from === -1 || packages[from]?.status !== 'active') return null;

  const step = direction === 'up' ? -1 : 1;
  let to = from + step;
  while (to >= 0 && to < packages.length && packages[to]?.status !== 'active') to += step;
  if (to < 0 || to >= packages.length) return null;

  const reordered = [...packages];
  [reordered[from], reordered[to]] = [reordered[to]!, reordered[from]!];
  return reordered.map((p, index) => ({ id: p.id, position: index + 1 }));
}
