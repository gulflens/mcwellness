import { describe, expect, it } from 'vitest';
import { blankFollowUp, blankInitial, eachOf } from './blank';
import { BAND_IDS, CONNECTIVITY_IDS } from './catalogue/ids';
import {
  isOffered,
  nothingOffered,
  stillOffered,
  takeChosen,
  takeCustom,
  takeRegions,
} from './offered';
import type { Offered } from './prefill';
import { validateQeegContent } from './shape';
import type { ComparedWith, QeegFollowUp } from './types';

/**
 * Brief S: what she chose last time is offered beside the form, and taken one
 * by one. Taking one changes the follow-up exactly as ticking it would, and
 * it is then no longer offered.
 */

const ID = (n: number) => `0000000C-0000-4000-8000-${String(n).padStart(12, '0')}`;

const COMPARED: ComparedWith = {
  reportId: ID(1),
  recordedOn: '2026-03-14',
  relation: 'initial',
  origin: 'issued',
  reference: 'RPT-000001',
};

function offered(): Offered {
  return {
    findings: {
      chosen: ['mental_fatigue', 'sleep_dysregulation'],
      custom: {
        c1: { label: { en: 'Slow mornings', ar: null }, note: null, chosen: true, position: 0 },
      },
    },
    focus: { chosen: ['sleep_recovery'], custom: {} },
    recommendations: {
      chosen: [],
      custom: {
        c0: {
          label: { en: 'Walk daily', ar: null },
          note: { en: 'Twenty minutes outdoors.', ar: null },
          chosen: true,
          position: 0,
        },
      },
    },
    benefits: { chosen: ['sleep'], custom: {} },
    regions: {
      bands: { ...eachOf(BAND_IDS, () => []), delta: ['frontal', 'central'] },
      connectivity: eachOf(CONNECTIVITY_IDS, () => []),
    },
  };
}

function followUp(): QeegFollowUp {
  return blankFollowUp(COMPARED, 'follow_up');
}

describe('takeChosen', () => {
  it('ticks what was offered, in the list’s own order', () => {
    const one = takeChosen(followUp(), 'findings', 'sleep_dysregulation');
    const two = takeChosen(one, 'findings', 'mental_fatigue');
    expect(two.findings.chosen).toEqual(['mental_fatigue', 'sleep_dysregulation']);
    expect(validateQeegContent(two).ok).toBe(true);
  });

  it('changes nothing when it is already ticked, and nothing it was given', () => {
    const start = takeChosen(followUp(), 'benefits', 'sleep');
    const before = structuredClone(start);
    expect(takeChosen(start, 'benefits', 'sleep')).toBe(start);
    expect(start).toEqual(before);
  });
});

describe('takeCustom', () => {
  it('adds her earlier item as one of her own, ticked, at the end of the list', () => {
    const start = followUp();
    const withOwn = {
      ...start,
      recommendations: {
        chosen: [],
        custom: {
          c0: { label: { en: 'Read at night', ar: null }, note: null, chosen: true, position: 0 },
        },
      },
    };
    const taken = takeCustom(withOwn, 'recommendations', 'c0', offered());
    expect(Object.values(taken.recommendations.custom)).toHaveLength(2);
    const added = Object.entries(taken.recommendations.custom).find(
      ([, item]) => item.label.en === 'Walk daily',
    );
    expect(added?.[0]).toBe('c1');
    expect(added?.[1]).toEqual({
      label: { en: 'Walk daily', ar: null },
      note: { en: 'Twenty minutes outdoors.', ar: null },
      chosen: true,
      position: 1,
    });
    expect(validateQeegContent(taken).ok).toBe(true);
  });

  it('changes nothing for a key that is not offered', () => {
    const start = followUp();
    expect(takeCustom(start, 'findings', 'c9', offered())).toBe(start);
  });
});

describe('takeRegions', () => {
  it('adds the earlier regions of a band to those she has, in the list’s order', () => {
    const start = followUp();
    const withCentral = {
      ...start,
      bands: { ...start.bands, delta: { change: null, regions: ['temporal' as const] } },
    };
    const taken = takeRegions(withCentral, 'bands', 'delta', offered());
    expect(taken.bands.delta.regions).toEqual(['frontal', 'central', 'temporal']);
    expect(taken.bands.delta.change).toBeNull();
  });
});

describe('stillOffered', () => {
  it('leaves out what she has already taken or chosen herself', () => {
    let content = takeChosen(followUp(), 'findings', 'mental_fatigue');
    content = takeCustom(content, 'findings', 'c1', offered());
    content = takeRegions(content, 'bands', 'delta', offered());
    const left = stillOffered(content, offered());
    expect(left.findings.chosen).toEqual(['sleep_dysregulation']);
    expect(left.findings.custom).toEqual({});
    expect(left.regions.bands.delta).toEqual([]);
    expect(left.focus.chosen).toEqual(['sleep_recovery']);
  });

  it('offers only the regions not already hers', () => {
    const start = followUp();
    const withFrontal = {
      ...start,
      bands: { ...start.bands, delta: { change: null, regions: ['frontal' as const] } },
    };
    expect(stillOffered(withFrontal, offered()).regions.bands.delta).toEqual(['central']);
  });

  it('knows when nothing is left to offer', () => {
    expect(nothingOffered(offered())).toBe(false);
    let content = followUp();
    content = takeChosen(content, 'findings', 'mental_fatigue');
    content = takeChosen(content, 'findings', 'sleep_dysregulation');
    content = takeCustom(content, 'findings', 'c1', offered());
    content = takeChosen(content, 'focus', 'sleep_recovery');
    content = takeCustom(content, 'recommendations', 'c0', offered());
    content = takeChosen(content, 'benefits', 'sleep');
    content = takeRegions(content, 'bands', 'delta', offered());
    expect(nothingOffered(stillOffered(content, offered()))).toBe(true);
  });
});

describe('isOffered', () => {
  it('accepts what the prefill answers', () => {
    expect(isOffered(offered())).toBe(true);
  });

  it('refuses anything else', () => {
    for (const value of [null, {}, 'x', { ...offered(), regions: null }, blankInitial()]) {
      expect(isOffered(value)).toBe(false);
    }
    const bad = offered();
    expect(isOffered({ ...bad, findings: { chosen: ['not_a_finding'], custom: {} } })).toBe(false);
  });
});
