import { describe, expect, it } from 'vitest';
import {
  visitOutcome,
  visitOutcomeWord,
  visitsFor,
  type AppointmentStatus,
  type SplittableVisit,
} from './visits';

/** docs/SPEC/client-portal.md sections 3.2 and 5, rule 7. */

const TODAY = '2026-09-05';

function visit(
  id: string,
  date: string,
  status: AppointmentStatus,
  hour = 10,
): SplittableVisit & { id: string } {
  return { id, date, startsAt: `${date}T${String(hour).padStart(2, '0')}:00:00.000Z`, status };
}

describe('visitOutcome', () => {
  it('calls a late cancellation a cancellation and nothing more', () => {
    expect(visitOutcome('cancelled_late')).toBe('cancelled');
    expect(visitOutcome('cancelled')).toBe('cancelled');
  });

  it('names the other two finished states', () => {
    expect(visitOutcome('completed')).toBe('completed');
    expect(visitOutcome('no_show')).toBe('missed');
  });

  it('gives nothing for a visit that has not happened yet', () => {
    for (const status of ['proposed', 'confirmed', 'checked_in', 'rescheduled'] as const) {
      expect(visitOutcome(status)).toBeNull();
    }
  });

  it('has a word for every outcome in both languages', () => {
    expect(visitOutcomeWord('completed', 'en')).toBe('Completed');
    expect(visitOutcomeWord('completed', 'ar')).not.toBe('Completed');
    expect(visitOutcomeWord('missed', 'ar').length).toBeGreaterThan(0);
    expect(visitOutcomeWord('cancelled', 'ar').length).toBeGreaterThan(0);
  });
});

describe('visitsFor', () => {
  it('lists what is coming soonest first, from the start of today', () => {
    const split = visitsFor(
      [
        visit('later', '2026-09-20', 'confirmed'),
        visit('today', TODAY, 'checked_in'),
        visit('soon', '2026-09-08', 'confirmed'),
      ],
      TODAY,
    );
    expect(split.upcoming.map((v) => v.id)).toEqual(['today', 'soon', 'later']);
  });

  it('lists what has happened most recently first', () => {
    const split = visitsFor(
      [
        visit('old', '2026-06-01', 'completed'),
        visit('recent', '2026-09-01', 'no_show'),
        visit('middle', '2026-08-01', 'cancelled_late'),
      ],
      TODAY,
    );
    expect(split.past.map((v) => v.id)).toEqual(['recent', 'middle', 'old']);
  });

  it('never shows a proposal the practice has not put to the household', () => {
    const split = visitsFor([visit('p', '2026-09-20', 'proposed')], TODAY);
    expect(split.upcoming).toEqual([]);
    expect(split.past).toEqual([]);
  });

  it('never shows a moved visit twice', () => {
    const split = visitsFor(
      [visit('was', '2026-09-10', 'rescheduled'), visit('is', '2026-09-12', 'confirmed')],
      TODAY,
    );
    expect(split.upcoming.map((v) => v.id)).toEqual(['is']);
    expect(split.past).toEqual([]);
  });

  it('leaves a confirmed visit whose day has gone by out of both lists', () => {
    const split = visitsFor([visit('stale', '2026-09-01', 'confirmed')], TODAY);
    expect(split.upcoming).toEqual([]);
    expect(split.past).toEqual([]);
  });

  it('orders two visits on the same day by when they start', () => {
    const split = visitsFor(
      [visit('afternoon', TODAY, 'confirmed', 15), visit('morning', TODAY, 'confirmed', 9)],
      TODAY,
    );
    expect(split.upcoming.map((v) => v.id)).toEqual(['morning', 'afternoon']);
  });
});
