import { describe, expect, it } from 'vitest';
import { WINDOW_MINUTES, windowFor } from './window';

describe('windowFor', () => {
  it('sets the end 45 minutes after the start', () => {
    const start = new Date('2026-09-10T06:00:00.000Z');
    const { start: gotStart, end } = windowFor(start);
    expect(gotStart).toBe(start);
    expect(end.getTime() - start.getTime()).toBe(WINDOW_MINUTES * 60_000);
  });

  it('crosses a UTC day boundary correctly', () => {
    const start = new Date('2026-09-10T23:50:00.000Z');
    const { end } = windowFor(start);
    expect(end.toISOString()).toBe('2026-09-11T00:35:00.000Z');
  });

  it('is a fixed duration regardless of the local calendar', () => {
    // A daylight-saving transition changes the local clock, never the elapsed
    // minutes: the window is computed in absolute time (Date.getTime()), not
    // by adding "45 minutes" to a wall-clock string.
    const start = new Date('2026-03-08T09:30:00.000Z');
    const { end } = windowFor(start);
    expect(end.getTime() - start.getTime()).toBe(45 * 60_000);
  });
});
