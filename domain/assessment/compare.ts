import { figureKey } from './shapes';
import type {
  Assessment,
  Band,
  BrainMapCondition,
  Instrument,
  Provenance,
  ReferenceSex,
  Site,
  Unit,
} from './types';

/**
 * Two measurements of one instrument, set side by side
 * (docs/SPEC/assessment.md sections 3.3 and 5, rule 3).
 *
 * The earlier figure, the later figure, the difference, **and nothing else**.
 * No comparison of the platform's own against any reference database, no
 * colour beyond the band's own hue on the screen, and no word: nothing here is
 * labelled high, low or abnormal, because what a measurement means is the
 * practitioner's judgement and it belongs in a signed report.
 *
 * **The output is plain, serialisable data**, and deliberately so: the reports
 * stream quotes a comparison into its own snapshot through the ids carried
 * here, never through a foreign key to a table its migration range may not
 * assume is present (docs/SPEC/reports-v1.md section 6). Everything a report
 * needs to print the comparison again — the ids, the dates, the editions, what
 * produced the figures, and the age and sex each reference comparison was made
 * against — is in the value, so a report renders from its own snapshot and
 * never reads this table back.
 */

export type ComparisonSide = {
  assessmentId: string;
  performedAt: string;
  instrumentVersion: string;
  provenance: Provenance;
  /**
   * The age and sex the equipment's software compared the recording against,
   * as it was made. A birthday and a corrected record both move the live
   * answer; the comparison that was actually made does not — which is why the
   * screen shows these beside the figures (section 3.3).
   */
  referenceAgeYears: number | null;
  referenceSex: ReferenceSex | null;
  /** Eyes open or closed. Absent on a questionnaire. */
  condition: BrainMapCondition | null;
};

export type ComparedFigure = {
  /** `Fz.alpha` for a brain map, `total` for a questionnaire. Stable across days. */
  key: string;
  site: Site | null;
  band: Band | null;
  unit: Unit;
  earlier: number;
  later: number;
  /** later − earlier, rounded so two readers of one pair never see two answers. */
  difference: number;
};

/** A figure one recording has and the other does not. Shown, never silently dropped. */
export type UnpairedFigure = {
  key: string;
  site: Site | null;
  band: Band | null;
  presentIn: 'earlier' | 'later';
};

export type Comparison = {
  clientId: string;
  instrument: Instrument;
  kind: 'brain-map' | 'questionnaire';
  earlier: ComparisonSide;
  later: ComparisonSide;
  figures: readonly ComparedFigure[];
  unpaired: readonly UnpairedFigure[];
  /** The most a questionnaire could have scored. Null for a brain map. */
  maximum: number | null;
};

export type ComparisonRefusal =
  /** One assessment against itself is not a comparison. */
  | 'same_assessment'
  /** Two people's measurements are not a pair (rule 3). */
  | 'different_clients'
  /** Two instruments' figures are not a pair (rule 3). */
  | 'different_instruments'
  /** Subtracting a percentage from a power produces a number and means nothing (rule 3). */
  | 'unit_mismatch'
  /** A questionnaire scored out of a different maximum is a different scale. */
  | 'maximum_mismatch'
  /** The arguments are named earlier and later, and they must be. */
  | 'out_of_order';

export type CompareResult =
  { ok: true; value: Comparison } | { ok: false; reason: ComparisonRefusal; key?: string };

/**
 * Six decimal places. The figures are typed by a person from what the software
 * printed, so a difference is never genuinely finer than this, and rounding
 * here keeps `0.3 - 0.1` from reaching a screen — or a report's snapshot — as
 * `0.19999999999999998`.
 */
function difference(later: number, earlier: number): number {
  return Number((later - earlier).toFixed(6));
}

function sideOf(assessment: Assessment): ComparisonSide {
  return {
    assessmentId: assessment.id,
    performedAt: assessment.performedAt,
    instrumentVersion: assessment.instrumentVersion,
    provenance: assessment.derived.provenance,
    referenceAgeYears: assessment.referenceAgeYears,
    referenceSex: assessment.referenceSex,
    condition: assessment.derived.kind === 'brain-map' ? assessment.derived.condition : null,
  };
}

export function compare(earlier: Assessment, later: Assessment): CompareResult {
  if (earlier.id === later.id) {
    return { ok: false, reason: 'same_assessment' };
  }
  if (earlier.clientId !== later.clientId) {
    return { ok: false, reason: 'different_clients' };
  }
  if (earlier.instrument !== later.instrument || earlier.derived.kind !== later.derived.kind) {
    return { ok: false, reason: 'different_instruments' };
  }
  if (later.performedAt < earlier.performedAt) {
    return { ok: false, reason: 'out_of_order' };
  }

  if (earlier.derived.kind === 'brain-map' && later.derived.kind === 'brain-map') {
    const before = new Map(earlier.derived.figures.map((f) => [figureKey(f), f]));
    const after = new Map(later.derived.figures.map((f) => [figureKey(f), f]));
    const figures: ComparedFigure[] = [];
    const unpaired: UnpairedFigure[] = [];
    for (const [key, first] of before) {
      const second = after.get(key);
      if (second === undefined) {
        unpaired.push({ key, site: first.site, band: first.band, presentIn: 'earlier' });
        continue;
      }
      if (first.unit !== second.unit) {
        return { ok: false, reason: 'unit_mismatch', key };
      }
      figures.push({
        key,
        site: first.site,
        band: first.band,
        unit: first.unit,
        earlier: first.value,
        later: second.value,
        difference: difference(second.value, first.value),
      });
    }
    for (const [key, second] of after) {
      if (!before.has(key)) {
        unpaired.push({ key, site: second.site, band: second.band, presentIn: 'later' });
      }
    }
    return {
      ok: true,
      value: {
        clientId: earlier.clientId,
        instrument: earlier.instrument,
        kind: 'brain-map',
        earlier: sideOf(earlier),
        later: sideOf(later),
        figures,
        unpaired,
        maximum: null,
      },
    };
  }

  if (earlier.derived.kind === 'questionnaire' && later.derived.kind === 'questionnaire') {
    if (earlier.derived.maximum !== later.derived.maximum) {
      return { ok: false, reason: 'maximum_mismatch', key: 'maximum' };
    }
    // The total, and only the total (rule 2): a questionnaire's answer is a
    // person's own sentence about a day, and setting two of them beside each
    // other question by question is a reading rather than an arithmetic.
    return {
      ok: true,
      value: {
        clientId: earlier.clientId,
        instrument: earlier.instrument,
        kind: 'questionnaire',
        earlier: sideOf(earlier),
        later: sideOf(later),
        figures: [
          {
            key: 'total',
            site: null,
            band: null,
            unit: 'points',
            earlier: earlier.derived.total,
            later: later.derived.total,
            difference: difference(later.derived.total, earlier.derived.total),
          },
        ],
        unpaired: [],
        maximum: earlier.derived.maximum,
      },
    };
  }

  // Unreachable: the kinds were compared above. Written rather than cast, so a
  // third kind of payload added later fails here loudly instead of silently
  // comparing nothing.
  return { ok: false, reason: 'different_instruments' };
}
