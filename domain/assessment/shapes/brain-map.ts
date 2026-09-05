import { BANDS, BRAIN_MAP_CONDITIONS, SITES, UNITS } from '../types';
import type { Band, BrainMapCondition, Site, Unit } from '../types';

/**
 * The brain map's declared shape (docs/SPEC/assessment.md sections 3.2 and 5).
 *
 * A shape is data, not code: it says what the drawer asks for and what
 * `validateDerived` refuses, and the two can never drift apart because they
 * read the same declaration. A screen laying out fields from this is a screen
 * that cannot ask for a field the validator does not know.
 *
 * **It declares no meaning.** There is no reference range here, no cut-off and
 * no word: the equipment's software makes its own comparison against its own
 * database and the platform keeps what it reported (section 3.4).
 */
export type BrainMapShape = {
  kind: 'brain-map';
  instrument: 'qeeg';
  /** The editions of the instrument this shape describes. */
  versions: readonly string[];
  /**
   * The service whose credential a practitioner must hold to record one
   * (section 7.2 and decision 4): the brain map is a service the practice
   * already sells, and `can_execute_session` on a credential for it is the
   * gate. Null on a shape that has no service of its own.
   */
  serviceCode: string | null;
  sites: readonly Site[];
  bands: readonly Band[];
  units: readonly Unit[];
  conditions: readonly BrainMapCondition[];
};

export const BRAIN_MAP_SHAPE: BrainMapShape = {
  kind: 'brain-map',
  instrument: 'qeeg',
  // One edition today. A second is a string added here and a note in the
  // change request, never a branch in a validator.
  versions: ['1'],
  serviceCode: 'brain-map',
  sites: SITES,
  bands: BANDS,
  units: UNITS,
  conditions: BRAIN_MAP_CONDITIONS,
};

/**
 * The key a figure is paired on across two recordings: the site and the band,
 * and nothing about the day. Stable, so a comparison lines two maps up by
 * what was measured rather than by the order somebody typed it in.
 */
export function figureKey(figure: { site: Site; band: Band }): string {
  return `${figure.site}.${figure.band}`;
}
