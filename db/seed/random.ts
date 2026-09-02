/**
 * A small seeded random source (mulberry32), so the generator produces the same
 * practice on every run and a test can name "client 7" and mean it.
 */

export type Random = {
  next(): number;
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  shuffle<T>(items: readonly T[]): T[];
  chance(probability: number): boolean;
};

export function seededRandom(seed: number): Random {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <T>(items: readonly T[]): T => {
    const index = Math.floor(next() * items.length);
    for (const item of items.slice(index, index + 1)) {
      return item;
    }
    throw new Error('Nothing to pick from.');
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick,
    shuffle: (items) => {
      const pool = [...items];
      const out: (typeof pool)[number][] = [];
      while (pool.length > 0) {
        out.push(...pool.splice(Math.floor(next() * pool.length), 1));
      }
      return out;
    },
    chance: (probability) => next() < probability,
  };
}

/** The item at an index, or a throw: the generator never reads past a list. */
export function at<T>(items: readonly T[], index: number): T {
  for (const item of items.slice(index, index + 1)) {
    return item;
  }
  throw new Error(`No item at index ${index}.`);
}
