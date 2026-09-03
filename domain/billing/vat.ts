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

/**
 * What the practice did about VAT on a given amount.
 *
 * `standard` is the five per cent every service carries once the practice is
 * registered (billing.md section 5.1: there is no healthcare zero-rating for a
 * wellness business). `not_registered` is what an unregistered practice does,
 * which is not "zero-rated" and not "exempt": those are VAT treatments a
 * registered supplier applies, and claiming either on a document would be a
 * statement about a registration nobody holds. It charges no VAT because it is
 * outside the tax altogether.
 */
export type VatTreatment = 'standard' | 'not_registered';

export type VatResolution = {
  treatment: VatTreatment;
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
 *
 * This is the rate arithmetic and nothing else: it answers what the standard
 * rate comes to, which is what a price row stamps. Whether the practice may
 * actually charge it is `resolveSaleVat`'s question, and every sale asks that
 * one.
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

/** The practice, as far as VAT is concerned: registered, or not. */
export type Supplier = {
  /** `tenant.vat_registered` — false until the AED 375,000 threshold is crossed. */
  vatRegistered: boolean;
};

/**
 * What a sale charges: the standard rate while the practice is registered for
 * VAT, and nothing at all while it is not (migration 406,
 * docs/CHANGE-REQUESTS/trunk-notes.md round 20 request 1a).
 *
 * McWellness is not registered today. Its tax certificate is a **corporate-tax**
 * registration and its number is never a VAT number, so an invoice it issues
 * carries no VAT, names no rate, and shows one AED figure. Prices are published
 * net either way, so the family pays exactly what the price list showed them;
 * registering later adds five per cent on top of the same net price and changes
 * nothing already issued.
 *
 * The `settingVersion` travels even at a zero rate. It records which VAT
 * setting was consulted, not what was charged, and an invoice line's foreign
 * key wants a real one — so a registration granted next year can be reasoned
 * about against what the rate was on the day.
 */
export function resolveSaleVat(
  netFils: Fils,
  setting: VatSetting,
  supplier: Supplier,
): VatResolution {
  if (supplier.vatRegistered) {
    return resolveVat(netFils, setting);
  }
  return {
    treatment: 'not_registered',
    rateBasisPoints: 0,
    settingVersion: setting.version,
    vatFils: fils(0),
    grossFils: netFils,
  };
}
