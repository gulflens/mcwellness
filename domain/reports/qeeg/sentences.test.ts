import { describe, expect, it } from 'vitest';
import { blankFollowUp, blankInitial } from './blank';
import {
  APPROACH_IDS,
  BAND_CHANGES,
  BAND_IDS,
  CONNECTIVITY_CHANGES,
  CONNECTIVITY_IDS,
  INITIAL_BAND_LEVELS,
  INITIAL_CONNECTIVITY_LEVELS,
  NEXT_STAGE_IDS,
  type BandId,
  type ConnectivityId,
} from './catalogue/ids';
import {
  approachLine,
  bandHeading,
  bandSentence,
  earlierTerm,
  measureSentence,
  paragraph,
  regionPhrase,
  sessionLabel,
} from './sentences';
import type { ComparedWith, Locale, QeegFollowUp, QeegInitial, Regions } from './types';
import { fill, phrase } from './wording';

/** Part 5 of brief C1: the sentences a report builds from its wording. */

const LOCALES: readonly Locale[] = ['en', 'ar'];
const NOTHING = '—';

const EARLIER: ComparedWith = {
  reportId: '00000001-0000-4000-8000-000000000001',
  reference: 'RPT-000001',
  recordedOn: '2026-06-01',
  origin: 'issued',
  relation: 'initial',
};

const w = (key: string, edition: 'initial' | 'follow-up', locale: Locale) =>
  phrase(key, edition, locale);

function initialWithBand(band: BandId, level: string | null, regions: Regions): QeegInitial {
  const blank = blankInitial();
  return {
    ...blank,
    bands: { ...blank.bands, [band]: { level, regions } },
  } as QeegInitial;
}

function initialWithMeasure(
  measure: ConnectivityId,
  level: string | null,
  regions: Regions,
): QeegInitial {
  const blank = blankInitial();
  return {
    ...blank,
    connectivity: { ...blank.connectivity, [measure]: { level, regions } },
  } as QeegInitial;
}

function followUpWithBand(band: BandId, change: string | null, regions: Regions): QeegFollowUp {
  const blank = blankFollowUp(EARLIER, 'follow_up');
  return {
    ...blank,
    bands: { ...blank.bands, [band]: { change, regions } },
  } as QeegFollowUp;
}

function followUpWithMeasure(
  measure: ConnectivityId,
  change: string | null,
  regions: Regions,
): QeegFollowUp {
  const blank = blankFollowUp(EARLIER, 'follow_up');
  return {
    ...blank,
    connectivity: { ...blank.connectivity, [measure]: { change, regions } },
  } as QeegFollowUp;
}

describe('regionPhrase', () => {
  it('prints a dash for no region, and one region as itself', () => {
    expect(regionPhrase([], 'en')).toBe(NOTHING);
    expect(regionPhrase(['temporal'], 'en')).toBe('temporal regions');
  });

  it('joins several with the list joiners, the last with its own', () => {
    expect(regionPhrase(['frontal', 'central', 'temporal'], 'en')).toBe(
      'frontal regions, central regions and temporal regions',
    );
  });

  it('prints regions in list order, whatever order they were chosen in', () => {
    expect(regionPhrase(['occipital', 'frontal'], 'en')).toBe(
      'frontal regions and occipital regions',
    );
  });

  it('attaches the Arabic last joiner to the word that follows it', () => {
    expect(regionPhrase(['central', 'frontal'], 'ar')).toBe('المناطق الجبهية والمناطق المركزية');
    expect(regionPhrase(['frontal', 'central', 'parietal'], 'ar')).toBe(
      'المناطق الجبهية، المناطق المركزية والمناطق الجدارية',
    );
  });
});

describe('bandHeading', () => {
  it('names the band with its range', () => {
    expect(bandHeading('delta', 'en')).toBe('Delta (1–4 Hz)');
    expect(bandHeading('high_beta', 'en')).toBe('High Beta (25–30 Hz)');
    expect(bandHeading('alpha', 'ar')).toBe(
      fill(w('band.with_range', 'initial', 'ar'), { name: 'ألفا', from: 8, to: 12 }),
    );
  });
});

describe('bandSentence on a first report', () => {
  it('reads Delta increased in the frontal and central regions to the letter', () => {
    const content = initialWithBand('delta', 'increased', ['central', 'frontal']);
    expect(bandSentence(content, 'delta', 'en')).toBe(
      '**Increased** activity, primarily involving the **frontal regions and central regions**.',
    );
  });

  it('reads Alpha within normal limits with no region to the letter', () => {
    const content = initialWithBand('alpha', 'within_normal_limits', []);
    expect(bandSentence(content, 'alpha', 'en')).toBe('Activity **within normal limits**.');
  });

  for (const locale of LOCALES) {
    it(`builds a band with a level from its base and the involving clause, in ${locale}`, () => {
      const content = initialWithBand('theta', 'reduced', ['parietal']);
      const base = fill(w('sentence.band.level', 'initial', locale), {
        level: w('level.band.reduced.word', 'initial', locale),
      });
      const clause = fill(w('clause.band.involving', 'initial', locale), {
        regions: regionPhrase(['parietal'], locale),
      });
      expect(bandSentence(content, 'theta', locale)).toBe(
        base + clause + w('sentence.end', 'initial', locale),
      );
    });

    it(`builds a band within normal limits with the across clause, in ${locale}`, () => {
      const content = initialWithBand('beta', 'within_normal_limits', ['widespread']);
      const clause = fill(w('clause.band.across', 'initial', locale), {
        regions: regionPhrase(['widespread'], locale),
      });
      expect(bandSentence(content, 'beta', locale)).toBe(
        w('sentence.band.normal', 'initial', locale) +
          clause +
          w('sentence.end', 'initial', locale),
      );
    });

    it(`leaves the clause out when no region was chosen, in ${locale}`, () => {
      const content = initialWithBand('theta', 'increased', []);
      const base = fill(w('sentence.band.level', 'initial', locale), {
        level: w('level.band.increased.word', 'initial', locale),
      });
      expect(bandSentence(content, 'theta', locale)).toBe(
        base + w('sentence.end', 'initial', locale),
      );
    });
  }
});

describe('measureSentence on a first report', () => {
  for (const locale of LOCALES) {
    for (const measure of ['connectivity', 'phase_lag'] as const) {
      it(`builds ${measure} from its base and the connectivity clause, in ${locale}`, () => {
        const level = INITIAL_CONNECTIVITY_LEVELS[measure][1];
        const content = initialWithMeasure(measure, level, ['temporal']);
        const base = fill(w(`sentence.${measure}`, 'initial', locale), {
          level: w(`level.${measure}.${level}.word`, 'initial', locale),
        });
        const clause = fill(w('clause.connectivity.involving', 'initial', locale), {
          regions: regionPhrase(['temporal'], locale),
        });
        expect(measureSentence(content, measure, locale)).toBe(
          base + clause + w('sentence.end', 'initial', locale),
        );
      });
    }

    it(`builds asymmetry with its own clause, in ${locale}`, () => {
      const content = initialWithMeasure('asymmetry', 'right', ['frontal', 'right_hemisphere']);
      const base = fill(w('sentence.asymmetry', 'initial', locale), {
        level: w('level.asymmetry.right.word', 'initial', locale),
      });
      const clause = fill(w('clause.asymmetry.involving', 'initial', locale), {
        regions: regionPhrase(['frontal', 'right_hemisphere'], locale),
      });
      expect(measureSentence(content, 'asymmetry', locale)).toBe(
        base + clause + w('sentence.end', 'initial', locale),
      );
    });
  }
});

describe('sentences on a follow-up', () => {
  for (const locale of LOCALES) {
    it(`builds a changed band with the involving clause, in ${locale}`, () => {
      const content = followUpWithBand('delta', 'improved', ['frontal']);
      const clause = fill(w('clause.band.involving', 'follow-up', locale), {
        regions: regionPhrase(['frontal'], locale),
      });
      expect(bandSentence(content, 'delta', locale)).toBe(
        w('change.band.improved.sentence', 'follow-up', locale) +
          clause +
          w('sentence.end', 'follow-up', locale),
      );
    });

    it(`builds a band now within normal limits with the across clause, in ${locale}`, () => {
      const content = followUpWithBand('alpha', 'now_within_normal_limits', ['occipital']);
      const clause = fill(w('clause.band.across', 'follow-up', locale), {
        regions: regionPhrase(['occipital'], locale),
      });
      expect(bandSentence(content, 'alpha', locale)).toBe(
        w('change.band.now_within_normal_limits.sentence', 'follow-up', locale) +
          clause +
          w('sentence.end', 'follow-up', locale),
      );
    });

    for (const measure of CONNECTIVITY_IDS) {
      it(`builds ${measure} changed with the connectivity clause, in ${locale}`, () => {
        const content = followUpWithMeasure(measure, 'mixed_changes', ['bilateral']);
        const clause = fill(w('clause.connectivity.involving', 'follow-up', locale), {
          regions: regionPhrase(['bilateral'], locale),
        });
        expect(measureSentence(content, measure, locale)).toBe(
          w(`change.${measure}.mixed_changes.sentence`, 'follow-up', locale) +
            clause +
            w('sentence.end', 'follow-up', locale),
        );
      });
    }
  }

  it('reads an unchanged band with no region as the base and the end alone', () => {
    const content = followUpWithBand('theta', 'unchanged', []);
    expect(bandSentence(content, 'theta', 'en')).toBe('Activity **unchanged and broadly stable**.');
  });
});

describe('every sentence', () => {
  const regionSets: Regions[] = [[], ['frontal'], ['widespread', 'frontal', 'left_hemisphere']];

  function everySentence(): Array<{ at: string; text: string }> {
    const found: Array<{ at: string; text: string }> = [];
    for (const locale of LOCALES) {
      for (const regions of regionSets) {
        for (const band of BAND_IDS) {
          for (const level of INITIAL_BAND_LEVELS) {
            const content = initialWithBand(band, level, regions);
            found.push({ at: `${band} ${level}`, text: bandSentence(content, band, locale) });
          }
          for (const change of BAND_CHANGES) {
            const content = followUpWithBand(band, change, regions);
            found.push({ at: `${band} ${change}`, text: bandSentence(content, band, locale) });
          }
        }
        for (const measure of CONNECTIVITY_IDS) {
          for (const level of INITIAL_CONNECTIVITY_LEVELS[measure]) {
            const content = initialWithMeasure(measure, level, regions);
            found.push({
              at: `${measure} ${level}`,
              text: measureSentence(content, measure, locale),
            });
          }
          for (const change of CONNECTIVITY_CHANGES) {
            const content = followUpWithMeasure(measure, change, regions);
            found.push({
              at: `${measure} ${change}`,
              text: measureSentence(content, measure, locale),
            });
          }
        }
      }
    }
    return found;
  }

  it('has an even number of bold marks', () => {
    for (const { at, text } of everySentence()) {
      expect(text.split('**').length % 2, at).toBe(1);
    }
  });

  it('holds no unfilled gap', () => {
    for (const { at, text } of everySentence()) {
      expect(text, at).not.toMatch(/[{}]/);
    }
  });

  it('ends with the end of a sentence', () => {
    for (const { at, text } of everySentence()) {
      expect(text.endsWith('.'), at).toBe(true);
    }
  });
});

describe('an unfinished draft', () => {
  it('gives a dash, without throwing, for every band and measure of a blank report', () => {
    for (const locale of LOCALES) {
      for (const content of [blankInitial(), blankFollowUp(EARLIER, 'final')]) {
        for (const band of BAND_IDS) expect(bandSentence(content, band, locale)).toBe(NOTHING);
        for (const measure of CONNECTIVITY_IDS) {
          expect(measureSentence(content, measure, locale)).toBe(NOTHING);
        }
      }
    }
  });

  it('gives no approach line until one is chosen', () => {
    expect(approachLine(blankInitial(), 'en')).toBeNull();
    expect(approachLine(blankFollowUp(EARLIER, 'follow_up'), 'ar')).toBeNull();
  });
});

describe('sessionLabel', () => {
  it('says one session and many sessions in English', () => {
    expect(sessionLabel(1, 'en')).toBe('1 Session');
    expect(sessionLabel(2, 'en')).toBe('2 Sessions');
    expect(sessionLabel(20, 'en')).toBe('20 Sessions');
  });

  it('agrees with the number in Arabic, pinned to the letter', () => {
    const expected: Array<[number, string]> = [
      [1, 'جلسة واحدة'],
      [2, 'جلستان'],
      [3, '3 جلسات'],
      [10, '10 جلسات'],
      [11, '11 جلسة'],
      [99, '99 جلسة'],
      [100, '100 جلسة'],
      [101, '101 جلسة'],
      [102, '102 جلسة'],
      [103, '103 جلسات'],
      [110, '110 جلسات'],
      [111, '111 جلسة'],
      [200, '200 جلسة'],
    ];
    for (const [count, label] of expected)
      expect(sessionLabel(count, 'ar'), String(count)).toBe(label);
  });
});

describe('approachLine', () => {
  for (const locale of LOCALES) {
    it(`prints each approach of a first report, in ${locale}`, () => {
      for (const approach of APPROACH_IDS) {
        const content: QeegInitial = { ...blankInitial(), plan: { sessions: 20, approach } };
        expect(approachLine(content, locale)).toBe(
          fill(w('text.approach_line', 'initial', locale), {
            label: w(`approach.${approach}.label`, 'initial', locale),
            text: w(`approach.${approach}.text`, 'initial', locale),
          }),
        );
      }
    });

    it(`prints each next stage of a follow-up, in ${locale}`, () => {
      for (const next of NEXT_STAGE_IDS) {
        const blank = blankFollowUp(EARLIER, 'follow_up');
        const content: QeegFollowUp = { ...blank, plan: { sessions: 15, next } };
        expect(approachLine(content, locale)).toBe(
          fill(w('text.approach_line', 'follow-up', locale), {
            label: w(`next.${next}.label`, 'follow-up', locale),
            text: w(`next.${next}.text`, 'follow-up', locale),
          }),
        );
      }
    });
  }

  it('reads as a bold label and its text', () => {
    const content: QeegInitial = { ...blankInitial(), plan: { sessions: 20, approach: 'calming' } };
    expect(approachLine(content, 'en')).toMatch(/^\*\*Calming:\*\* Training will begin/);
  });
});

describe('earlierTerm and paragraph', () => {
  const compared = (relation: 'initial' | 'previous') =>
    blankFollowUp({ ...EARLIER, relation }, 'follow_up');

  it('says initial when compared with the client’s first report, and previous otherwise', () => {
    expect(earlierTerm(compared('initial'), 'en')).toBe('initial QEEG');
    expect(earlierTerm(compared('previous'), 'en')).toBe('previous QEEG');
    expect(earlierTerm(compared('previous'), 'ar')).toBe(
      w('term.earlier.previous', 'follow-up', 'ar'),
    );
  });

  it('fills the earlier report into a follow-up paragraph', () => {
    const text = paragraph('text.overview', compared('previous'), 'en');
    expect(text).toContain('with the previous QEEG to evaluate');
    expect(text).not.toMatch(/[{}]/);
    const arabic = paragraph('text.summary_lead', compared('initial'), 'ar');
    expect(arabic).toContain(w('term.earlier.initial', 'follow-up', 'ar'));
    expect(arabic).not.toMatch(/[{}]/);
  });

  it('prints a first report’s paragraph as it stands', () => {
    expect(paragraph('text.overview', blankInitial(), 'en')).toBe(
      w('text.overview', 'initial', 'en'),
    );
  });

  it('refuses a paragraph that belongs to the other edition', () => {
    expect(() => paragraph('text.summary_lead', blankInitial(), 'en')).toThrow(/follow-up|initial/);
  });
});
