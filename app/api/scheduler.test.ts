import { describe, expect, it } from 'vitest';
import { dueJobs, localDayHour } from './scheduler';

/** An instant named in Dubai time (four hours ahead of UTC, no summer time). */
const dubai = (day: string, hour: number, minute = 0) => {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, date, hour - 4, minute));
};

describe('the practice-local day and hour', () => {
  it("reads Dubai time, not the machine's", () => {
    // 23:30 UTC on the 9th is 03:30 on the 10th in Dubai.
    expect(localDayHour(new Date('2026-09-09T23:30:00Z'))).toEqual({ day: '2026-09-10', hour: 3 });
  });
});

describe('what falls due between two ticks', () => {
  it('sweeps erasure files on every change of the hour, and not within one', () => {
    expect(dueJobs(dubai('2026-09-10', 10, 0), dubai('2026-09-10', 10, 59))).toEqual([]);
    expect(dueJobs(dubai('2026-09-10', 10, 59), dubai('2026-09-10', 11, 0))).toEqual([
      'erasure-files',
    ]);
  });

  it('posts the books on the first tick at or after three in the morning, once', () => {
    expect(dueJobs(dubai('2026-09-10', 2, 59), dubai('2026-09-10', 3, 0))).toEqual([
      'erasure-files',
      'post-books',
    ]);
    // The next tick inside the same hour does neither again.
    expect(dueJobs(dubai('2026-09-10', 3, 0), dubai('2026-09-10', 3, 1))).toEqual([]);
    // And the following hour sweeps without posting.
    expect(dueJobs(dubai('2026-09-10', 3, 59), dubai('2026-09-10', 4, 0))).toEqual([
      'erasure-files',
    ]);
  });

  it('does not post for a process that started later in the day, until the next morning', () => {
    expect(dueJobs(dubai('2026-09-10', 10, 0), dubai('2026-09-10', 11, 0))).toEqual([
      'erasure-files',
    ]);
    // Asleep across midnight and woken at half past three: both are due.
    expect(dueJobs(dubai('2026-09-10', 23, 30), dubai('2026-09-11', 3, 30))).toEqual([
      'erasure-files',
      'post-books',
    ]);
    // Asleep from before three until after: the posting is still owed.
    expect(dueJobs(dubai('2026-09-11', 1, 0), dubai('2026-09-11', 9, 0))).toEqual([
      'erasure-files',
      'post-books',
    ]);
  });
});
