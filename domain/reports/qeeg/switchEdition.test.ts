import { describe, expect, it } from 'vitest';
import { blankFollowUp, blankInitial } from './blank';
import { BAND_IDS, CONNECTIVITY_IDS, DIMENSION_IDS } from './catalogue/ids';
import { validateQeegContent } from './shape';
import { toFollowUp, toInitial } from './switchEdition';
import type { ComparedWith, QeegFollowUp, QeegInitial } from './types';

/** Part 6 of brief C1: turning a draft from one edition into the other. */

const EARLIER: ComparedWith = {
  reportId: '00000001-0000-4000-8000-000000000001',
  reference: 'RPT-000001',
  recordedOn: '2026-06-01',
  origin: 'issued',
  relation: 'previous',
};

function firstReport(): QeegInitial {
  const blank = blankInitial();
  return {
    ...blank,
    recording: { recordedOn: '2026-09-01', eyes: 'open', handedness: 'ambidextrous' },
    subject: { nameAr: null, ageYears: 29, sex: 'male' },
    findings: {
      chosen: ['reduced_mental_energy'],
      custom: {
        a: { label: { en: 'Restless evenings', ar: null }, note: null, chosen: true, position: 0 },
      },
    },
    focus: { chosen: ['mental_energy', 'attention_focus'], custom: {} },
    maps: {
      m: {
        figureId: '00000001-0000-4000-8000-000000000010',
        sha256: 'b'.repeat(64),
        widthPx: 640,
        heightPx: 480,
        condition: 'eyes_open',
        caption: null,
        position: 0,
      },
    },
    recommendations: { chosen: ['attention_focus'], custom: {} },
    summary: {
      en: { text: 'Bright and steady.', marks: [{ from: 0, to: 6, bold: true }] },
      ar: null,
    },
    benefits: { chosen: ['resilience'], custom: {} },
    bands: {
      delta: { level: 'increased', regions: ['frontal', 'central'] },
      theta: { level: 'reduced', regions: ['parietal'] },
      alpha: { level: 'within_normal_limits', regions: [] },
      beta: { level: null, regions: ['temporal'] },
      high_beta: { level: 'increased', regions: ['widespread'] },
    },
    connectivity: {
      connectivity: { level: 'mixed', regions: ['frontal'] },
      asymmetry: { level: 'left', regions: ['left_hemisphere'] },
      phase_lag: { level: null, regions: [] },
    },
    dashboard: {
      ...blank.dashboard,
      mental_energy: { score: 3, evidence: { en: 'Slow rhythm at rest.', ar: 'إيقاع بطيء' } },
      decision_making: { score: 8, evidence: null },
    },
    plan: { sessions: 30, approach: 'calming_and_stabilising' },
  };
}

function followUp(): QeegFollowUp {
  const { content } = toFollowUp(firstReport(), EARLIER, 'follow_up');
  return {
    ...content,
    bands: { ...content.bands, delta: { change: 'improved', regions: ['frontal'] } },
    connectivity: {
      ...content.connectivity,
      phase_lag: { change: 'unchanged', regions: [] },
    },
    dashboard: {
      ...content.dashboard,
      mental_energy: { ...content.dashboard.mental_energy, earlierScore: 2 },
    },
    change: {
      ...content.change,
      sessionsCompleted: { count: 30, source: 'typed' },
      summary: { en: { text: 'Calmer.', marks: [] }, ar: null },
    },
    plan: { sessions: 10, next: 'progress_to_optimisation' },
  };
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

const KEPT = [
  'kind',
  'schema',
  'wording',
  'provenance',
  'subject',
  'recording',
  'findings',
  'focus',
  'maps',
  'recommendations',
  'summary',
  'benefits',
] as const;

describe('toFollowUp', () => {
  it('keeps what both editions share', () => {
    const before = firstReport();
    const { content } = toFollowUp(before, EARLIER, 'final');
    for (const key of KEPT) expect(content[key], key).toEqual(before[key]);
    expect(content.plan.sessions).toBe(30);
    for (const dimension of DIMENSION_IDS) {
      expect(content.dashboard[dimension]).toEqual({
        ...before.dashboard[dimension],
        earlierScore: null,
      });
    }
  });

  it('becomes a follow-up at the stage given, compared with the report given', () => {
    const { content } = toFollowUp(firstReport(), EARLIER, 'final');
    expect(content.edition).toBe('follow-up');
    expect(content.stage).toBe('final');
    expect(content.comparedWith).toEqual(EARLIER);
    expect(content.change).toEqual(blankFollowUp(EARLIER, 'final').change);
  });

  it('keeps every band’s and measure’s regions', () => {
    const before = firstReport();
    const { content } = toFollowUp(before, EARLIER, 'follow_up');
    for (const band of BAND_IDS)
      expect(content.bands[band].regions).toEqual(before.bands[band].regions);
    for (const measure of CONNECTIVITY_IDS) {
      expect(content.connectivity[measure].regions).toEqual(before.connectivity[measure].regions);
    }
  });

  it('clears every level and the approach, and lists each one set aside', () => {
    const { content, setAside } = toFollowUp(firstReport(), EARLIER, 'follow_up');
    for (const band of BAND_IDS) expect(content.bands[band].change).toBeNull();
    for (const measure of CONNECTIVITY_IDS) expect(content.connectivity[measure].change).toBeNull();
    expect(content.plan.next).toBeNull();
    expect(setAside).toEqual([
      { at: 'bands.delta', was: 'increased' },
      { at: 'bands.theta', was: 'reduced' },
      { at: 'bands.alpha', was: 'within_normal_limits' },
      { at: 'bands.high_beta', was: 'increased' },
      { at: 'connectivity.connectivity', was: 'mixed' },
      { at: 'connectivity.asymmetry', was: 'left' },
      { at: 'plan.approach', was: 'calming_and_stabilising' },
    ]);
  });

  it('maps nothing from one list to the other', () => {
    const { content } = toFollowUp(firstReport(), EARLIER, 'follow_up');
    expect(Object.values(content.bands).every((band) => band.change === null)).toBe(true);
    expect(JSON.stringify(content)).not.toMatch(/moved_further|improved|"level"|"approach"/);
  });

  it('gives a follow-up that passes the shape', () => {
    const { content } = toFollowUp(firstReport(), EARLIER, 'follow_up');
    expect(validateQeegContent(content)).toMatchObject({ ok: true });
  });

  it('does not change what it was given', () => {
    const before = deepFreeze(firstReport());
    expect(() => toFollowUp(before, EARLIER, 'follow_up')).not.toThrow();
    expect(before).toEqual(firstReport());
  });
});

describe('toInitial', () => {
  it('keeps what both editions share, and the scores with their evidence', () => {
    const before = followUp();
    const { content } = toInitial(before);
    for (const key of KEPT) expect(content[key], key).toEqual(before[key]);
    expect(content.plan).toEqual({ sessions: 10, approach: null });
    for (const dimension of DIMENSION_IDS) {
      const { score, evidence } = before.dashboard[dimension];
      expect(content.dashboard[dimension]).toEqual({ score, evidence });
    }
  });

  it('becomes a first report at the initial stage, with nothing of the comparison left', () => {
    const { content } = toInitial(followUp());
    expect(content.edition).toBe('initial');
    expect(content.stage).toBe('initial');
    expect(content).not.toHaveProperty('comparedWith');
    expect(content).not.toHaveProperty('change');
    for (const dimension of DIMENSION_IDS) {
      expect(content.dashboard[dimension]).not.toHaveProperty('earlierScore');
    }
  });

  it('clears every change and the next stage, lists each one set aside, and keeps regions', () => {
    const before = followUp();
    const { content, setAside } = toInitial(before);
    for (const band of BAND_IDS) {
      expect(content.bands[band]).toEqual({ level: null, regions: before.bands[band].regions });
    }
    for (const measure of CONNECTIVITY_IDS) {
      expect(content.connectivity[measure]).toEqual({
        level: null,
        regions: before.connectivity[measure].regions,
      });
    }
    expect(setAside).toEqual([
      { at: 'bands.delta', was: 'improved' },
      { at: 'connectivity.phase_lag', was: 'unchanged' },
      { at: 'plan.next', was: 'progress_to_optimisation' },
    ]);
  });

  it('gives a first report that passes the shape', () => {
    expect(validateQeegContent(toInitial(followUp()).content)).toMatchObject({ ok: true });
  });

  it('does not change what it was given', () => {
    const before = deepFreeze(followUp());
    expect(() => toInitial(before)).not.toThrow();
    expect(before).toEqual(followUp());
  });
});

describe('there and back', () => {
  it('leaves the kept parts as they were', () => {
    const before = firstReport();
    const there = toFollowUp(before, EARLIER, 'follow_up').content;
    const back = toInitial(there).content;
    for (const key of KEPT) expect(back[key], key).toEqual(before[key]);
    expect(back.dashboard).toEqual(before.dashboard);
    expect(back.plan.sessions).toBe(before.plan.sessions);
    for (const band of BAND_IDS)
      expect(back.bands[band].regions).toEqual(before.bands[band].regions);
    for (const measure of CONNECTIVITY_IDS) {
      expect(back.connectivity[measure].regions).toEqual(before.connectivity[measure].regions);
    }
  });
});
