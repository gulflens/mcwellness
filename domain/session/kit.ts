/**
 * The equipment register's one rule (docs/SPEC/practitioner-phone.md section
 * 6.3, rule 2): whether an item's calibration has lapsed.
 *
 * Pure, and the clock is an argument. `app.checkin_context`
 * (db/migrations/306_kit_and_photo.sql) mirrors exactly this in SQL, so the
 * screen and the door cannot disagree about whether an amplifier is in date;
 * this file is where the rule is written down and tested.
 */

/** What a kit item is, in the practice's own words (00-data-model.md section 5). */
export const KIT_KINDS = ['amplifier', 'laptop', 'electrode_set'] as const;
export type KitKind = (typeof KIT_KINDS)[number];

/** As much of an item as the rule reads. Never a serial, never who holds it. */
export type CalibratableKit = {
  /** An item the practice has stood down is not one anything is judged on. */
  status: 'active' | 'inactive';
  /** Null for anything that is never calibrated — a laptop, a set of electrodes. */
  calibrationDueAt: Date | null;
};

/**
 * True when this item is active and its calibration fell due before `now`.
 *
 * Null is not overdue. A laptop has no calibration to lapse, and an amplifier
 * the practice has not yet recorded a calibration for is a gap in the register
 * rather than an instrument known to be out of date — the practice fills the
 * register in, and until it does the day runs. The boundary is exclusive: an
 * item due at this very instant is due, not overdue.
 */
export function isCalibrationOverdue(kit: CalibratableKit, now: Date): boolean {
  if (kit.status !== 'active') return false;
  if (kit.calibrationDueAt === null) return false;
  return kit.calibrationDueAt.getTime() < now.getTime();
}

/**
 * Whether anything assigned to this practitioner blocks a check-in
 * (section 6.3, decision 5).
 *
 * **No item assigned is no block.** The register starts empty, and the day it
 * ships must not stop every visit in the practice; a spare the practice wants
 * ignored is unassigned or set inactive. **Any assigned active item overdue is
 * a block**, whatever its kind — the rule is about the instruments a
 * practitioner is carrying, and the practice decides what it puts on the list.
 */
export function anyCalibrationOverdue(kit: readonly CalibratableKit[], now: Date): boolean {
  return kit.some((item) => isCalibrationOverdue(item, now));
}
