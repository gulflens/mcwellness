// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { RAIL_KEY, railOpenByDefault, readRail, writeRail } from './railState';

/** A storage that refuses everything, as a private window's can. */
const refusing: Storage = {
  get length() {
    return 0;
  },
  clear() {
    throw new Error('refused');
  },
  getItem() {
    throw new Error('refused');
  },
  key() {
    throw new Error('refused');
  },
  removeItem() {
    throw new Error('refused');
  },
  setItem() {
    throw new Error('refused');
  },
};

function emptyStore(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => void map.delete(key),
    setItem: (key, value) => void map.set(key, value),
  };
}

describe('railOpenByDefault', () => {
  it('opens on a desk and closes on anything smaller', () => {
    expect(railOpenByDefault(1200)).toBe(true);
    expect(railOpenByDefault(1440)).toBe(true);
    expect(railOpenByDefault(1199)).toBe(false);
    expect(railOpenByDefault(820)).toBe(false);
    expect(railOpenByDefault(390)).toBe(false);
  });
});

describe('readRail', () => {
  it('takes the tier default when nothing is remembered', () => {
    expect(readRail(emptyStore(), 1440)).toBe(true);
    expect(readRail(emptyStore(), 820)).toBe(false);
  });

  it("lets the person's own choice beat the default at any size", () => {
    const store = emptyStore();
    store.setItem(RAIL_KEY, 'closed');
    expect(readRail(store, 1440)).toBe(false);
    store.setItem(RAIL_KEY, 'open');
    expect(readRail(store, 390)).toBe(true);
  });

  it('ignores a value it does not recognise', () => {
    const store = emptyStore();
    store.setItem(RAIL_KEY, 'sideways');
    expect(readRail(store, 1440)).toBe(true);
    expect(readRail(store, 820)).toBe(false);
  });

  it('falls back to the default when storage refuses or is absent', () => {
    expect(readRail(refusing, 1440)).toBe(true);
    expect(readRail(refusing, 820)).toBe(false);
    expect(readRail(undefined, 820)).toBe(false);
    expect(readRail(undefined, 1440)).toBe(true);
  });
});

describe('writeRail', () => {
  it('remembers the choice', () => {
    const store = emptyStore();
    writeRail(store, false);
    expect(store.getItem(RAIL_KEY)).toBe('closed');
    writeRail(store, true);
    expect(store.getItem(RAIL_KEY)).toBe('open');
  });

  it('says nothing when storage refuses or is absent', () => {
    expect(() => writeRail(refusing, true)).not.toThrow();
    expect(() => writeRail(undefined, true)).not.toThrow();
  });
});
