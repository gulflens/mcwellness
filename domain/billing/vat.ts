/**
 * VAT is worked out once, from the practice's own rate, and never typed by
 * hand anywhere else (CLAUDE.md rule 6, docs/SPEC/billing.md section 5.1).
 * Every service is standard-rated; there is one treatment because there is
 * one rule. Pure: no I/O, no clock read inside (.claude/rules/testing.md).
 */

import { addFils, fils, type Fils } from '../shared';

/**
 * The tenant's own VAT rate, as stored on `vat_setting`. Basis points: 10000
 * is 100%, so the UAE standard rate of 5% is 500.
 */
export type VatSetting = {
  rateBasisPoints: number;
  version: number;
};

export type VatResolution = {
  treatment: 'standard';
  rateBasisPoints: number;
  settingVersion: number;
  vatFils: Fils;
  grossFils: Fils;
};

/**
 * Computes VAT on a net amount from the given setting, rounding half up to
 * the nearest fils. Called once at the moment a price is written, and again,
 * with the row's own stamped setting, whenever that price is displayed — the
 * same function both times, so a later VAT change can never quietly alter a
 * figure already shown to a family.
 */
export function resolveVat(netFils: Fils, setting: VatSetting): VatResolution {
  const vatFils = fils(Math.round((netFils * setting.rateBasisPoints) / 10_000));
  return {
    treatment: 'standard',
    rateBasisPoints: setting.rateBasisPoints,
    settingVersion: setting.version,
    vatFils,
    grossFils: addFils(netFils, vatFils),
  };
}
