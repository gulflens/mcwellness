// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DRAWER_WIDTH_KEY,
  MIN_DRAWER_WIDTH,
  clampDrawerWidth,
  maxDrawerWidth,
  readDrawerWidth,
  writeDrawerWidth,
} from './useDrawerWidth';

describe('clampDrawerWidth', () => {
  it('keeps a sensible width', () => {
    expect(clampDrawerWidth(720, 1440)).toBe(720);
  });

  it('refuses to go below the floor or above the ceiling', () => {
    expect(clampDrawerWidth(4, 1440)).toBe(MIN_DRAWER_WIDTH);
    expect(clampDrawerWidth(9000, 1440)).toBe(maxDrawerWidth(1440));
  });

  it('lets a narrow viewport lower the ceiling', () => {
    expect(maxDrawerWidth(800)).toBe(720);
    expect(maxDrawerWidth(4000)).toBe(1100);
  });

  it('answers the floor for a value that is not a number', () => {
    expect(clampDrawerWidth(Number.NaN, 1440)).toBe(MIN_DRAWER_WIDTH);
  });
});

describe('readDrawerWidth', () => {
  beforeEach(() => localStorage.clear());

  it('is null when nothing was ever stored', () => {
    expect(readDrawerWidth(1440)).toBe(null);
  });

  it('clamps on the way in, not only on the way out', () => {
    localStorage.setItem(DRAWER_WIDTH_KEY, '9000');
    expect(readDrawerWidth(1440)).toBe(maxDrawerWidth(1440));
  });

  it('is null for a stored value that is not a number', () => {
    localStorage.setItem(DRAWER_WIDTH_KEY, 'wide please');
    expect(readDrawerWidth(1440)).toBe(null);
  });

  it('round-trips a width it wrote', () => {
    writeDrawerWidth(720);
    expect(readDrawerWidth(1440)).toBe(720);
  });
});

describe('a localStorage that throws', () => {
  // A private window, and a browser set to block site data, both throw the
  // moment `localStorage` is touched — not only when a call inside it fails.
  // This is the one thing standing between that browser and a broken console,
  // so it is stubbed at the property itself rather than at `getItem`, which a
  // narrower stub could pass while missing.
  it('reads as null rather than throwing', () => {
    const thrown = vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    try {
      expect(readDrawerWidth(1440)).toBe(null);
    } finally {
      thrown.mockRestore();
    }
  });

  it('writes without throwing back out', () => {
    const thrown = vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    try {
      expect(() => writeDrawerWidth(720)).not.toThrow();
    } finally {
      thrown.mockRestore();
    }
  });
});
