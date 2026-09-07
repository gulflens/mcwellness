import { describe, expect, it } from 'vitest';
import { travelBufferFor } from './buffer';

/** Scheduling rule 6.2: the drive in whole minutes, rounded up, plus ten, clamped to 15–90. */
describe('travelBufferFor', () => {
  it('is the drive plus ten, in whole minutes rounded up', () => {
    expect(travelBufferFor(25 * 60)).toBe(35);
    expect(travelBufferFor(25 * 60 + 1)).toBe(36);
  });
  it('never drops below fifteen', () => {
    expect(travelBufferFor(0)).toBe(15);
    expect(travelBufferFor(3 * 60)).toBe(15);
    expect(travelBufferFor(-5)).toBe(15);
  });
  it('never exceeds ninety', () => {
    expect(travelBufferFor(3 * 3600)).toBe(90);
  });
});
