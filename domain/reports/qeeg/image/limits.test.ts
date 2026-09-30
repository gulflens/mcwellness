/**
 * The caps on a brain map's size, and the refusal, never a shrinking, of one
 * over them.
 */

import { describe, expect, it } from 'vitest';
import {
  MAX_FILE_BYTES,
  MAX_INPUT_BYTES,
  MAX_LONG_EDGE_PX,
  MAX_PIXELS,
  refuseInputBytes,
  refuseSize,
} from './limits';

describe('the size of the file she chooses', () => {
  it('is capped at eight times the stored cap, which holds the largest plain picture inside the pixel cap', () => {
    expect(MAX_INPUT_BYTES).toBe(8 * MAX_FILE_BYTES);
    // An uncompressed 24-bit picture at the pixel cap, with a generous header.
    expect(MAX_PIXELS * 3 + 1024).toBeLessThan(MAX_INPUT_BYTES);
  });

  it('refuses a larger file before it is read', () => {
    expect(refuseInputBytes(MAX_INPUT_BYTES)).toBeNull();
    expect(refuseInputBytes(MAX_INPUT_BYTES + 1)).toBe('file_too_large');
    expect(refuseInputBytes(0)).toBe('empty');
  });
});

describe('the size a brain map may be', () => {
  it('states its caps', () => {
    expect(MAX_LONG_EDGE_PX).toBe(4096);
    expect(MAX_PIXELS).toBe(12_000_000);
    expect(MAX_FILE_BYTES).toBe(5 * 1024 * 1024);
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
