import { describe, expect, it } from 'vitest';
import { blankFollowUp, blankInitial } from './blank';
import { BAND_IDS, CONNECTIVITY_IDS, DIMENSION_IDS } from './catalogue/ids';
import { bandIsComplete, measureIsComplete, missingForIssue } from './complete';
import type { ComparedWith, Missing, QeegContent, QeegFollowUp, QeegInitial } from './types';

/** Part 4 of brief C1: what a report still needs before it can be signed. */

const EARLIER: ComparedWith = {
  reportId: '00000001-0000-4000-8000-000000000001',
  reference: 'RPT-000001',
  recordedOn: '2026-06-01',
  origin: 'issued',
  relation: 'initial',
};

const MAP = {
  figureId: '00000001-0000-4000-8000-000000000010',
  sha256: 'a'.repeat(64),
  widthPx: 800,
  heightPx: 600,
  condition: 'eyes_open',
  caption: null,
  position: 0,
} as const;

/** The 26 things, in order, that a blank report of either edition is missing. */
const EVERYTHING: Missing[] = [
  { section: 'heading.recording', what: 'label.date' },
  { section: 'heading.client', what: 'label.eyes' },
  { section: 'heading.client', what: 'label.handedness' },
  { section: 'heading.client', what: 'label.age' },
  { section: 'heading.findings', what: 'heading.findings' },
  { section: 'heading.focus', what: 'heading.focus' },
  { section: 'heading.brain', what: 'map' },
  ...BAND_IDS.map((id) => ({ section: 'heading.brain', what: `band.${id}` })),
  ...CONNECTIVITY_IDS.map((id) => ({ section: 'label.findings', what: `connectivity.${id}` })),
  ...DIMENSION_IDS.map((id) => ({ section: 'heading.dashboard', what: `dimension.${id}` })),
  { section: 'heading.recommendations', what: 'heading.recommendations' },
  { section: 'heading.summary', what: 'heading.summary' },
  { section: 'heading.benefits', what: 'heading.benefits' },
  { section: 'heading.programme', what: 'sessions' },
  { section: 'heading.approach', what: 'heading.approach' },
];

type Fill<T> = (content: T) => T;

/** What fills each row on either edition. */
function commonFills<T extends QeegContent>(): Array<[string, Fill<T>]> {
  return [
    ['label.date', (c) => ({ ...c, recording: { ...c.recording, recordedOn: '2026-09-01' } })],
    ['label.eyes', (c) => ({ ...c, recording: { ...c.recording, eyes: 'closed' } })],
    ['label.handedness', (c) => ({ ...c, recording: { ...c.recording, handedness: 'left' } })],
    ['label.age', (c) => ({ ...c, subject: { ...c.subject, ageYears: 40 } })],
    ['heading.findings', (c) => ({ ...c, findings: { chosen: ['mental_fatigue'], custom: {} } })],
    ['heading.focus', (c) => ({ ...c, focus: { chosen: ['sleep_recovery'], custom: {} } })],
    ['map', (c) => ({ ...c, maps: { m: MAP } })],
    [
      'heading.recommendations',
      (c) => ({ ...c, recommendations: { chosen: ['decision_making'], custom: {} } }),
    ],
    [
      'heading.summary',
      (c) => ({ ...c, summary: { en: { text: 'Steady.', marks: [] }, ar: null } }),
    ],
    ['heading.benefits', (c) => ({ ...c, benefits: { chosen: ['sleep'], custom: {} } })],
    ['sessions', (c) => ({ ...c, plan: { ...c.plan, sessions: 20 } })],
  ];
}

function initialFills(): Array<[string, Fill<QeegInitial>]> {
  return [
    ...commonFills<QeegInitial>(),
    ...BAND_IDS.map((id): [string, Fill<QeegInitial>] => [
      `band.${id}`,
      (c) => ({ ...c, bands: { ...c.bands, [id]: { level: 'reduced', regions: ['occipital'] } } }),
    ]),
    [
      'connectivity.connectivity',
      (c) => ({
        ...c,
        connectivity: { ...c.connectivity, connectivity: { level: 'mixed', regions: ['frontal'] } },
      }),
    ],
    [
      'connectivity.asymmetry',
      (c) => ({
        ...c,
        connectivity: { ...c.connectivity, asymmetry: { level: 'right', regions: ['frontal'] } },
      }),
    ],
    [
      'connectivity.phase_lag',
      (c) => ({
        ...c,
        connectivity: { ...c.connectivity, phase_lag: { level: 'normal', regions: ['central'] } },
      }),
    ],
    ...DIMENSION_IDS.map((id): [string, Fill<QeegInitial>] => [
      `dimension.${id}`,
      (c) => ({ ...c, dashboard: { ...c.dashboard, [id]: { score: 0, evidence: null } } }),
    ]),
    ['heading.approach', (c) => ({ ...c, plan: { ...c.plan, approach: 'stabilising' } })],
  ];
}

function followUpFills(): Array<[string, Fill<QeegFollowUp>]> {
  return [
    ...commonFills<QeegFollowUp>(),
    ...BAND_IDS.map((id): [string, Fill<QeegFollowUp>] => [
      `band.${id}`,
      (c) => ({ ...c, bands: { ...c.bands, [id]: { change: 'improved', regions: ['frontal'] } } }),
    ]),
    ...CONNECTIVITY_IDS.map((id): [string, Fill<QeegFollowUp>] => [
      `connectivity.${id}`,
      (c) => ({
        ...c,
        connectivity: {
          ...c.connectivity,
          [id]: { change: 'mixed_changes', regions: ['central'] },
        },
      }),
    ]),
    ...DIMENSION_IDS.map((id): [string, Fill<QeegFollowUp>] => [
      `dimension.${id}`,
      (c) => ({
        ...c,
        dashboard: { ...c.dashboard, [id]: { score: 10, evidence: null, earlierScore: null } },
      }),
    ]),
    ['heading.approach', (c) => ({ ...c, plan: { ...c.plan, next: 'adjust_focus' } })],
  ];
}

function finished<T>(blank: T, fills: Array<[string, Fill<T>]>): T {
  return fills.reduce((content, [, fill]) => fill(content), blank);
}

describe('missingForIssue', () => {
  it('finds exactly the 26 things missing from a blank first report, in order', () => {
    expect(missingForIssue(blankInitial())).toEqual(EVERYTHING);
  });

  it('finds exactly the 26 things missing from a blank follow-up, in order', () => {
    expect(missingForIssue(blankFollowUp(EARLIER, 'follow_up'))).toEqual(EVERYTHING);
  });

  it('has a fill for every row on each edition', () => {
    expect(
      initialFills()
        .map(([what]) => what)
        .sort(),
    ).toEqual(EVERYTHING.map((m) => m.what).sort());
    expect(
      followUpFills()
        .map(([what]) => what)
        .sort(),
    ).toEqual(EVERYTHING.map((m) => m.what).sort());
  });

  for (const [what, fill] of initialFills()) {
    it(`drops ${what} from a first report once it is filled`, () => {
      const missing = missingForIssue(fill(blankInitial()));
      expect(missing).toHaveLength(25);
      expect(missing.map((m) => m.what)).not.toContain(what);
    });
  }

  for (const [what, fill] of followUpFills()) {
    it(`drops ${what} from a follow-up once it is filled`, () => {
      const missing = missingForIssue(fill(blankFollowUp(EARLIER, 'final')));
      expect(missing).toHaveLength(25);
      expect(missing.map((m) => m.what)).not.toContain(what);
    });
  }

  it('finds nothing missing from a finished report of either edition', () => {
    expect(missingForIssue(finished(blankInitial(), initialFills()))).toEqual([]);
    expect(missingForIssue(finished(blankFollowUp(EARLIER, 'follow_up'), followUpFills()))).toEqual(
      [],
    );
  });

  it('does not count a custom finding that is not ticked', () => {
    const content: QeegInitial = {
      ...blankInitial(),
      findings: {
        chosen: [],
        custom: {
          a: { label: { en: 'Slow mornings', ar: null }, note: null, chosen: false, position: 0 },
        },
      },
    };
    expect(missingForIssue(content).map((m) => m.what)).toContain('heading.findings');
  });

  it('counts a custom item that is ticked', () => {
    const content: QeegInitial = {
      ...blankInitial(),
      benefits: {
        chosen: [],
        custom: {
          a: { label: { en: 'Calmer drives', ar: null }, note: null, chosen: true, position: 0 },
        },
      },
    };
    expect(missingForIssue(content).map((m) => m.what)).not.toContain('heading.benefits');
  });

  it('counts a summary of nothing but white space as missing', () => {
    const content: QeegInitial = {
      ...blankInitial(),
      summary: { en: { text: ' \n ', marks: [] }, ar: { text: 'هدوء', marks: [] } },
    };
    expect(missingForIssue(content).map((m) => m.what)).toContain('heading.summary');
  });

  it('asks nothing of sex, which may be unknown', () => {
    const done = finished(blankInitial(), initialFills());
    expect(missingForIssue({ ...done, subject: { ...done.subject, sex: null } })).toEqual([]);
  });

  it('asks nothing of the page of what has changed', () => {
    const done = finished(blankFollowUp(EARLIER, 'follow_up'), followUpFills());
    expect(done.change.tiles).toEqual({});
    expect(missingForIssue(done)).toEqual([]);
  });
});

describe('bandIsComplete', () => {
  const initialWith = (band: QeegInitial['bands']['delta']): QeegInitial => {
    const blank = blankInitial();
    return { ...blank, bands: { ...blank.bands, delta: band } };
  };
  const followUpWith = (band: QeegFollowUp['bands']['delta']): QeegFollowUp => {
    const blank = blankFollowUp(EARLIER, 'follow_up');
    return { ...blank, bands: { ...blank.bands, delta: band } };
  };

  it('needs a level and a region on a first report: either alone is not enough', () => {
    expect(bandIsComplete(initialWith({ level: 'increased', regions: [] }), 'delta')).toBe(false);
    expect(bandIsComplete(initialWith({ level: null, regions: ['frontal'] }), 'delta')).toBe(false);
    expect(bandIsComplete(initialWith({ level: 'increased', regions: ['frontal'] }), 'delta')).toBe(
      true,
    );
  });

  it('needs no region for a band within normal limits', () => {
    expect(
      bandIsComplete(initialWith({ level: 'within_normal_limits', regions: [] }), 'delta'),
    ).toBe(true);
  });

  it('needs no region for an unchanged band, or one now within normal limits, on a follow-up', () => {
    expect(bandIsComplete(followUpWith({ change: 'unchanged', regions: [] }), 'delta')).toBe(true);
    expect(
      bandIsComplete(followUpWith({ change: 'now_within_normal_limits', regions: [] }), 'delta'),
    ).toBe(true);
  });

  it('needs a change and a region otherwise on a follow-up', () => {
    expect(bandIsComplete(followUpWith({ change: 'moved_further', regions: [] }), 'delta')).toBe(
      false,
    );
    expect(bandIsComplete(followUpWith({ change: null, regions: ['frontal'] }), 'delta')).toBe(
      false,
    );
    expect(
      bandIsComplete(followUpWith({ change: 'moved_further', regions: ['frontal'] }), 'delta'),
    ).toBe(true);
  });
});

describe('measureIsComplete', () => {
  it('needs a level and a region on a first report: either alone is not enough', () => {
    const blank = blankInitial();
    const withAsymmetry = (asymmetry: QeegInitial['connectivity']['asymmetry']): QeegInitial => ({
      ...blank,
      connectivity: { ...blank.connectivity, asymmetry },
    });
    expect(measureIsComplete(withAsymmetry({ level: 'left', regions: [] }), 'asymmetry')).toBe(
      false,
    );
    expect(
      measureIsComplete(withAsymmetry({ level: null, regions: ['frontal'] }), 'asymmetry'),
    ).toBe(false);
    expect(
      measureIsComplete(withAsymmetry({ level: 'left', regions: ['frontal'] }), 'asymmetry'),
    ).toBe(true);
  });

  it('follows the band rule on a follow-up', () => {
    const blank = blankFollowUp(EARLIER, 'follow_up');
    const withLag = (phase_lag: QeegFollowUp['connectivity']['phase_lag']): QeegFollowUp => ({
      ...blank,
      connectivity: { ...blank.connectivity, phase_lag },
    });
    expect(measureIsComplete(withLag({ change: 'unchanged', regions: [] }), 'phase_lag')).toBe(
      true,
    );
    expect(measureIsComplete(withLag({ change: 'improved', regions: [] }), 'phase_lag')).toBe(
      false,
    );
    expect(
      measureIsComplete(withLag({ change: 'improved', regions: ['parietal'] }), 'phase_lag'),
    ).toBe(true);
  });
});
