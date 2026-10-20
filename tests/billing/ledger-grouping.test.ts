import { describe, expect, it } from 'vitest';
import { dayOf, groupBy, monthOf } from '../../app/admin/billing/LedgerSearch';

/**
 * The bands the invoice and receipt books are grouped under, read by the
 * practice's own calendar in Asia/Dubai, whatever the reader's clock says.
 */
describe('the bands a growing book is grouped under', () => {
  it('names a month in words, from a calendar date', () => {
    expect(monthOf('2026-10-20')).toEqual({ key: '2026-10', label: 'October 2026' });
    expect(monthOf('2026-09-01')).toEqual({ key: '2026-09', label: 'September 2026' });
  });

  it('says Today and Yesterday by the practice’s day, and the weekday before that', () => {
    // 22:30 in Dubai on 20 October is still 20 October there.
    const now = new Date('2026-10-20T18:30:00Z');
    expect(dayOf('2026-10-20T05:00:00Z', now).label).toBe('Today, 20 October');
    expect(dayOf('2026-10-19T12:00:00Z', now).label).toBe('Yesterday, 19 October');
    expect(dayOf('2026-10-08T09:00:00Z', now).label).toBe('Thursday, 8 October');
  });

  it('puts a payment taken after midnight in Dubai on the next day, though it is the day before in UTC', () => {
    const now = new Date('2026-10-20T08:00:00Z');
    // 20:30 UTC on the 19th is 00:30 on the 20th in Dubai.
    expect(dayOf('2026-10-19T20:30:00Z', now)).toEqual({
      key: '2026-10-20',
      label: 'Today, 20 October',
    });
  });

  it('gathers rows under their key in the order they came, opening a new group on each change', () => {
    const rows = ['2026-10-02', '2026-10-01', '2026-09-30', '2026-09-03'];
    const groups = groupBy(rows, monthOf);
    expect(groups.map((g) => [g.label, g.items])).toEqual([
      ['October 2026', ['2026-10-02', '2026-10-01']],
      ['September 2026', ['2026-09-30', '2026-09-03']],
    ]);
    expect(groupBy([], monthOf)).toEqual([]);
  });
});
