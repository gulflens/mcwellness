/**
 * The caps on a brain map's size, and the refusal, never a shrinking, of one
 * over them.
 */

import { describe, expect, it } from 'vitest';
import {
  MAX_FILE_BYTES,
  MAX_LONG_EDGE_PX,
  MAX_MAPS_PER_REPORT,
  MAX_PIXELS,
  refuseSize,
} from './limits';

describe('the size a brain map may be', () => {
  it('states its caps', () => {
    expect(MAX_LONG_EDGE_PX).toBe(4096);
    expect(MAX_PIXELS).toBe(12_000_000);
    expect(MAX_FILE_BYTES).toBe(5 * 1024 * 1024);
    expect(MAX_MAPS_PER_REPORT).toBe(8);
  });

  it('accepts a map inside every cap, up to the edge itself', () => {
    expect(refuseSize(736, 976)).toBeNull();
    expect(refuseSize(4096, 2000)).toBeNull();
    expect(refuseSize(2000, 4096)).toBeNull();
    expect(refuseSize(3000, 4000)).toBeNull();
  });

  it('refuses a map wider than the long-edge cap rather than shrinking it', () => {
    expect(refuseSize(4097, 100)).toBe('too_wide');
  });

  it('refuses a map taller than the long-edge cap', () => {
    expect(refuseSize(100, 4097)).toBe('too_tall');
  });

  it('refuses a map with every edge in bounds but too many pixels altogether', () => {
    expect(refuseSize(4000, 3001)).toBe('too_many_pixels');
    expect(refuseSize(4096, 4096)).toBe('too_many_pixels');
  });

  it('refuses a map with nothing in it, or a size that is not a count of pixels', () => {
    expect(refuseSize(0, 100)).toBe('empty');
    expect(refuseSize(100, 0)).toBe('empty');
    expect(refuseSize(-5, 100)).toBe('empty');
    expect(refuseSize(Number.NaN, 100)).toBe('empty');
    expect(refuseSize(10.5, 100)).toBe('empty');
  });
});
