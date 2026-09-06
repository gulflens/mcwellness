import { fils, type Fils } from './fils';

/**
 * Where the practice stands against the two VAT registration thresholds
 * (docs/PLAN/pieces-seven-to-nine.md, "Small things folded into the shared
 * rounds", the VAT threshold watch).
 *
 * The Federal Tax Authority sets two marks on a business's taxable supplies
 * over the previous twelve months:
 *
 *   AED 187,500  registering becomes a **choice**;
 *   AED 375,000  registering becomes a **duty**, within thirty days.
 *
 * Pure, and the figure is always an argument: nothing here reads a clock or a
 * database. Fils in, a word out.
 *
 * **This is not VAT arithmetic and does not belong to `domain/billing`.** What
 * a line of an invoice is charged is `resolveVat`'s (CLAUDE.md rule 6). This
 * says where the practice's own registration duty stands, which is a fact
 * about the practice read by one settings screen, so it lives in the shared
 * zone with the rest of what more than one module may need.
 *
 * **It decides nothing.** Turning the switch on stays a hand's act: an invoice
 * may not carry VAT until the authority has issued the number the row requires
 * (migration 905), and the thirty-day forward test cannot be computed from a
 * ledger. This tells the owner where they stand and nothing more.
 */

/** AED 187,500, where registering becomes a choice. */
export const VAT_VOLUNTARY_THRESHOLD_FILS: Fils = fils(18_750_000);

/** AED 375,000, where registering becomes a duty within thirty days. */
export const VAT_MANDATORY_THRESHOLD_FILS: Fils = fils(37_500_000);

/**
 * Where a figure stands against the two marks. `mandatory` means the practice
 * is past the second one; it does not mean it has registered.
 */
export type VatThresholdStand = 'below' | 'voluntary' | 'mandatory';

/**
 * At the mark counts as past it: the authority's test is "exceeds", and a
 * business sitting exactly on the figure is the one case where being told
 * early costs nothing and being told late costs a penalty.
 */
export function vatThresholdStand(taxableSuppliesFils: number): VatThresholdStand {
  if (taxableSuppliesFils >= VAT_MANDATORY_THRESHOLD_FILS) return 'mandatory';
  if (taxableSuppliesFils >= VAT_VOLUNTARY_THRESHOLD_FILS) return 'voluntary';
  return 'below';
}
