// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  PIN_KEY,
  RAIL_KEY,
  closesOnChoice,
  railMode,
  railOpenByDefault,
  readPinned,
  readRail,
  tierOf,
  writePinned,
  writeRail,
} from './railState';

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

describe('tierOf', () => {
  it('names the three tiers at their boundaries', () => {
    expect(tierOf(1200)).toBe('desk');
    expect(tierOf(1199)).toBe('tablet');
    expect(tierOf(768)).toBe('tablet');
    expect(tierOf(767)).toBe('compact');
    expect(tierOf(390)).toBe('compact');
  });
});

describe('railMode', () => {
  it('is a column on a desk, and pinning there means nothing', () => {
    expect(railMode('desk', true, false)).toBe('column-open');
    expect(railMode('desk', false, false)).toBe('column-strip');
    expect(railMode('desk', true, true)).toBe('column-open');
    expect(railMode('desk', false, true)).toBe('column-strip');
  });

  it('rests as a strip below the desk until it is opened', () => {
    expect(railMode('tablet', false, false)).toBe('column-strip');
    expect(railMode('compact', false, false)).toBe('column-strip');
    expect(railMode('tablet', false, true)).toBe('column-strip');
    expect(railMode('compact', false, true)).toBe('column-strip');
  });

  it('covers the content when opened, and pushes it once pinned on a tablet', () => {
    expect(railMode('tablet', true, false)).toBe('overlay');
    expect(railMode('tablet', true, true)).toBe('column-open');
  });

  it('still covers on a phone even when pinned, where 220px would leave 170', () => {
    expect(railMode('compact', true, false)).toBe('overlay');
    expect(railMode('compact', true, true)).toBe('overlay');
  });
});

describe('closesOnChoice', () => {
  it('puts itself away behind you below the desk, unless you pinned it', () => {
    expect(closesOnChoice('compact', false)).toBe(true);
    expect(closesOnChoice('tablet', false)).toBe(true);
    expect(closesOnChoice('compact', true)).toBe(false);
    expect(closesOnChoice('tablet', true)).toBe(false);
  });

  it('never closes on a desk, where choosing a section does not move the rail', () => {
    expect(closesOnChoice('desk', false)).toBe(false);
    expect(closesOnChoice('desk', true)).toBe(false);
  });
});

describe('readPinned and writePinned', () => {
  it('starts unpinned and remembers the choice', () => {
    const store = emptyStore();
    expect(readPinned(store)).toBe(false);
    writePinned(store, true);
    expect(store.getItem(PIN_KEY)).toBe('yes');
    expect(readPinned(store)).toBe(true);
    writePinned(store, false);
    expect(store.getItem(PIN_KEY)).toBe('no');
    expect(readPinned(store)).toBe(false);
  });

  it('is unpinned when storage refuses or is absent, never stuck open', () => {
    expect(readPinned(refusing)).toBe(false);
    expect(readPinned(undefined)).toBe(false);
    expect(() => writePinned(refusing, true)).not.toThrow();
    expect(() => writePinned(undefined, true)).not.toThrow();
  });

  it('keeps its own key, so the two facts never overwrite each other', () => {
    expect(PIN_KEY).not.toBe(RAIL_KEY);
    const store = emptyStore();
    writeRail(store, true);
    writePinned(store, true);
    expect(readRail(store, 390)).toBe(true);
    expect(readPinned(store)).toBe(true);
  });
});
