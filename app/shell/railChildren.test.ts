import { describe, expect, it } from 'vitest';
import { childIsCurrent, sectionHolds, type RailChild } from './railChildren';

/**
 * The two questions the rail asks about a sub-page, both pure: which section's
 * list is showing, and which row in it is the view on screen. They are here
 * rather than in the component because the answers turn on address parsing —
 * a hash that may be absent, a path that may be a prefix of another — and that
 * is exactly the kind of thing worth testing without a browser.
 */
describe('sectionHolds', () => {
  it('holds the section itself and everything beneath it', () => {
    expect(sectionHolds('/admin/schedule', '/admin/schedule')).toBe(true);
    expect(sectionHolds('/admin/schedule', '/admin/schedule/week')).toBe(true);
    expect(sectionHolds('/admin/schedule', '/admin/schedule/board')).toBe(true);
    expect(sectionHolds('/admin/settings', '/admin/settings/team')).toBe(true);
  });

  it('holds nothing of another section', () => {
    expect(sectionHolds('/admin/schedule', '/admin/billing')).toBe(false);
    expect(sectionHolds('/admin/books', '/admin/clients')).toBe(false);
  });

  it('does not hold a section whose name merely starts the same', () => {
    // The guard against a bare startsWith: /admin/billing must not swallow a
    // future /admin/billing-archive, and /admin/audit must not swallow
    // /admin/auditors. A section boundary is a slash or the end of the path.
    expect(sectionHolds('/admin/billing', '/admin/billing-archive')).toBe(false);
    expect(sectionHolds('/admin/audit', '/admin/auditors')).toBe(false);
  });
});

// Named rather than indexed out of an array: `noUncheckedIndexedAccess` is on,
// and a test reads better naming the row it is asking about anyway.
const prices: RailChild = { key: 'prices', label: 'Prices', to: '/admin/billing#prices' };
const invoices: RailChild = { key: 'invoices', label: 'Invoices', to: '/admin/billing#invoices' };
const day: RailChild = { key: 'day', label: 'Day', to: '/admin/schedule', end: true };
const week: RailChild = { key: 'week', label: 'Week', to: '/admin/schedule/week' };

describe('childIsCurrent', () => {
  it('marks the row the address names', () => {
    expect(childIsCurrent(invoices, '/admin/billing', '#invoices', false)).toBe(true);
    expect(childIsCurrent(prices, '/admin/billing', '#invoices', true)).toBe(false);
  });

  it('marks the first row when the address names no section', () => {
    // BillingPage and BooksPage both open on their first section when the
    // address carries no hash, so the rail says the same thing the page does.
    expect(childIsCurrent(prices, '/admin/billing', '', true)).toBe(true);
    expect(childIsCurrent(invoices, '/admin/billing', '', false)).toBe(false);
  });

  it('reads a hash with or without its sign', () => {
    expect(childIsCurrent(invoices, '/admin/billing', 'invoices', false)).toBe(true);
  });

  it('marks no row of a section the reader has left', () => {
    expect(childIsCurrent(prices, '/admin/books', '', true)).toBe(false);
    expect(childIsCurrent(invoices, '/admin/books', '#invoices', false)).toBe(false);
  });

  it('keeps the day view from lighting up on the week and the board', () => {
    // The day is the section's own address, so without `end` every page
    // beneath it would mark it current — the mistake NavLink's own `end` prop
    // exists to prevent.
    expect(childIsCurrent(day, '/admin/schedule', '', false)).toBe(true);
    expect(childIsCurrent(day, '/admin/schedule/week', '', false)).toBe(false);
    expect(childIsCurrent(week, '/admin/schedule/week', '', false)).toBe(true);
  });

  it('ignores a query string, which is a date and not a view', () => {
    // /admin/schedule/week?date=2026-09-12 is still the week.
    expect(childIsCurrent(week, '/admin/schedule/week', '', false)).toBe(true);
  });
});
