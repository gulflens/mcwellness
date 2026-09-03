import { describe, expect, it } from 'vitest';
import { WINDOW_MINUTES, formatArrivalWindow, windowFor } from './window';

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

describe('formatArrivalWindow', () => {
  const start = new Date('2026-09-10T05:00:00Z'); // 09:00 in Dubai
  const { end } = windowFor(start);

  it('reads as the window a household was promised, in the practice’s own zone', () => {
    expect(formatArrivalWindow(start, end, 'Asia/Dubai')).toContain('09:00');
    expect(formatArrivalWindow(start, end, 'Asia/Dubai')).toContain('09:45');
    // Stripped of the isolates, it is exactly the range and nothing else.
    expect(formatArrivalWindow(start, end, 'Asia/Dubai').replace(/[⁦⁩]/g, '')).toBe('09:00–09:45');
  });

  it('isolates the range, so Arabic around it cannot reverse the two times', () => {
    const formatted = formatArrivalWindow(start, end, 'Asia/Dubai');
    // Without these the bidirectional algorithm renders 09:45–09:00 inside an
    // Arabic paragraph: the practice telling a household the wrong hour.
    expect(formatted.startsWith('⁦')).toBe(true);
    expect(formatted.endsWith('⁩')).toBe(true);
    // The start still comes first inside the isolate.
    expect(formatted.indexOf('09:00')).toBeLessThan(formatted.indexOf('09:45'));
  });
});
