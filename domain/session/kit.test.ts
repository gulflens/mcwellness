import { describe, expect, it } from 'vitest';
import { anyCalibrationOverdue, isCalibrationOverdue, KIT_KINDS } from './kit';

/**
 * The calibration rule (docs/SPEC/practitioner-phone.md section 6.3, rule 2),
 * including the boundary in the practice's own zone: 2026-09-07T04:00:00Z is
 * eight in the morning in Dubai, and a calibration falling due at exactly that
 * instant is due rather than overdue.
 */

const NOW = new Date('2026-09-07T04:00:00Z');
const YESTERDAY = new Date('2026-09-06T04:00:00Z');
const TOMORROW = new Date('2026-09-08T04:00:00Z');

describe('isCalibrationOverdue', () => {
  it('is overdue when an active item fell due before now', () => {
    expect(isCalibrationOverdue({ status: 'active', calibrationDueAt: YESTERDAY }, NOW)).toBe(true);
  });

  it('is not overdue when it falls due later', () => {
    expect(isCalibrationOverdue({ status: 'active', calibrationDueAt: TOMORROW }, NOW)).toBe(false);
  });

  it('is not overdue at the very instant it falls due', () => {
    expect(isCalibrationOverdue({ status: 'active', calibrationDueAt: NOW }, NOW)).toBe(false);
  });

  it('is not overdue a millisecond after that instant, which is the boundary', () => {
    const amoment = new Date(NOW.getTime() + 1);
    expect(isCalibrationOverdue({ status: 'active', calibrationDueAt: NOW }, amoment)).toBe(true);
  });

  it('is never overdue for an item that is never calibrated', () => {
    expect(isCalibrationOverdue({ status: 'active', calibrationDueAt: null }, NOW)).toBe(false);
  });

  it('is never overdue for an item the practice has stood down', () => {
    expect(isCalibrationOverdue({ status: 'inactive', calibrationDueAt: YESTERDAY }, NOW)).toBe(
      false,
    );
  });
});

describe('anyCalibrationOverdue', () => {
  it('does not block a practitioner with nothing assigned', () => {
    expect(anyCalibrationOverdue([], NOW)).toBe(false);
  });

  it('does not block when everything assigned is in date', () => {
    expect(
      anyCalibrationOverdue(
        [
          { status: 'active', calibrationDueAt: TOMORROW },
          { status: 'active', calibrationDueAt: null },
        ],
        NOW,
      ),
    ).toBe(false);
  });

  it('blocks when one assigned active item is overdue', () => {
    expect(
      anyCalibrationOverdue(
        [
          { status: 'active', calibrationDueAt: TOMORROW },
          { status: 'active', calibrationDueAt: YESTERDAY },
        ],
        NOW,
      ),
    ).toBe(true);
  });

  it('does not block when the only overdue item is one the practice stood down', () => {
    expect(
      anyCalibrationOverdue(
        [
          { status: 'active', calibrationDueAt: TOMORROW },
          { status: 'inactive', calibrationDueAt: YESTERDAY },
        ],
        NOW,
      ),
    ).toBe(false);
  });
});

describe('KIT_KINDS', () => {
  it('names the three kinds the data model does, and no fourth', () => {
    expect([...KIT_KINDS]).toEqual(['amplifier', 'laptop', 'electrode_set']);
  });
});
