import { describe, expect, it } from 'vitest';
import { blankFollowUp, blankInitial } from './blank';
import { validateQeegContent } from './shape';
import {
  LIMITS,
  type CalculatedFigure,
  type QeegFollowUp,
  type QeegInitial,
  type TypedFigure,
} from './types';

/**
 * Part 3 of brief C1: the shape a stored brain-map report is held to. Each
 * rule has a test that fails when the rule is broken, and every refusal names
 * the field.
 */

const ID = (n: number) => `00000001-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SHA = 'a'.repeat(64);

const EARLIER = {
  reportId: ID(1),
  reference: 'RPT-000001',
  recordedOn: '2026-06-01',
  origin: 'issued',
  relation: 'initial',
} as const;

const typedFigure: TypedFigure = {
  kind: 'percent',
  direction: 'decrease',
  low: 25,
  high: 30,
  source: 'typed',
  basis: null,
};

const calculatedFigure: CalculatedFigure = {
  kind: 'percent',
  direction: 'increase',
  low: 12,
  high: null,
  source: 'calculated',
  basis: {
    earlierAssessmentId: ID(2),
    laterAssessmentId: ID(3),
    unit: 'uV2',
    sitesPaired: 19,
  },
};

/** A first report with something in every kind of field the shape reads. */
function validInitial(): QeegInitial {
  const blank = blankInitial();
  return {
    ...blank,
    recording: { recordedOn: '2026-09-01', eyes: 'closed_and_open', handedness: 'right' },
    subject: { nameAr: null, ageYears: 34, sex: 'female' },
    findings: {
      chosen: ['mental_fatigue', 'sleep_dysregulation'],
      custom: {
        a: { label: { en: 'Slow mornings', ar: null }, note: null, chosen: true, position: 0 },
        b: { label: { en: 'Busy evenings', ar: null }, note: null, chosen: false, position: 1 },
      },
    },
    focus: { chosen: ['sleep_recovery'], custom: {} },
    maps: {
      m1: {
        figureId: ID(10),
        sha256: SHA,
        widthPx: 800,
        heightPx: 600,
        condition: 'eyes_closed',
        caption: null,
        position: 0,
      },
    },
    recommendations: { chosen: ['recovery_capacity'], custom: {} },
    summary: {
      en: {
        text: 'Settled and steady.\nSleeping longer.',
        marks: [
          { from: 0, to: 7, bold: true },
          { from: 20, to: 28, underline: true },
        ],
      },
      ar: null,
    },
    benefits: { chosen: ['sleep'], custom: {} },
    bands: {
      ...blank.bands,
      delta: { level: 'increased', regions: ['frontal', 'central'] },
      alpha: { level: 'within_normal_limits', regions: [] },
    },
    connectivity: {
      connectivity: { level: 'mixed', regions: ['temporal'] },
      asymmetry: { level: 'left', regions: ['frontal'] },
      phase_lag: { level: 'delayed', regions: ['widespread'] },
    },
    dashboard: {
      ...blank.dashboard,
      mental_energy: { score: 6, evidence: { en: 'Slower rhythm at the front.', ar: null } },
    },
    plan: { sessions: 20, approach: 'calming' },
  };
}

/** A follow-up with a filled page of what has changed. */
function validFollowUp(): QeegFollowUp {
  const blank = blankFollowUp(EARLIER, 'follow_up');
  const initial = validInitial();
  return {
    ...blank,
    recording: initial.recording,
    findings: initial.findings,
    maps: initial.maps,
    summary: initial.summary,
    bands: {
      ...blank.bands,
      delta: { change: 'improved', regions: ['frontal'] },
      theta: { change: 'unchanged', regions: [] },
    },
    connectivity: {
      ...blank.connectivity,
      asymmetry: { change: 'mixed_changes', regions: ['left_hemisphere'] },
    },
    dashboard: {
      ...blank.dashboard,
      attention_focus: { score: 7, evidence: null, earlierScore: 4 },
    },
    change: {
      tiles: {
        t1: { figure: typedFigure, caption: { en: 'Less slow activity', ar: null }, position: 0 },
      },
      sessionsCompleted: { count: 20, source: 'gathered' },
      pairs: {
        eyes_open: {
          earlier: { figureId: ID(11), sha256: SHA, widthPx: 400, heightPx: 400 },
          later: null,
        },
        eyes_closed: { earlier: null, later: null },
      },
      table: {
        delta: { position: 0, eyesOpen: calculatedFigure, eyesClosed: null },
        alpha_1: {
          position: 1,
          eyesOpen: { kind: 'no_appreciable_change', source: 'typed', basis: null },
          eyesClosed: typedFigure,
        },
      },
      summary: { en: { text: 'Steadier.', marks: [] }, ar: null },
    },
    plan: { sessions: 15, next: 'continue_calming' },
  };
}

/** A copy with one value at a dotted path replaced (or removed, for `undefined`). */
function withValue<T>(content: T, path: string, value: unknown): T {
  const copy = structuredClone(content) as Record<string, unknown>;
  const parts = path.split('.');
  const last = parts.pop() as string;
  let at: Record<string, unknown> = copy;
  for (const part of parts) at = at[part] as Record<string, unknown>;
  if (value === undefined) delete at[last];
  else at[last] = value;
  return copy as T;
}

function refusalsOf(input: unknown): string[] {
  const answer = validateQeegContent(input);
  if (answer.ok) return [];
  return answer.refusals.map((refusal) => refusal.path);
}

function expectRefusedAt(input: unknown, path: string) {
  const answer = validateQeegContent(input);
  expect(answer.ok).toBe(false);
  expect(refusalsOf(input)).toContain(path);
}

function expectAccepted(input: unknown) {
  const answer = validateQeegContent(input);
  if (!answer.ok) expect(answer.refusals).toEqual([]);
  expect(answer.ok).toBe(true);
}

describe('validateQeegContent', () => {
  it('accepts a filled first report and a filled follow-up', () => {
    expectAccepted(validInitial());
    expectAccepted(validFollowUp());
  });

  it('accepts an unfinished draft, where null means not chosen yet', () => {
    expectAccepted(blankInitial());
    expectAccepted(blankFollowUp(EARLIER, 'final'));
  });

  it('gives back what it was given', () => {
    const answer = validateQeegContent(validFollowUp());
    expect(answer.ok && answer.content).toEqual(validFollowUp());
  });

  it('refuses something that is not a report at all', () => {
    expect(validateQeegContent(null).ok).toBe(false);
    expect(validateQeegContent([]).ok).toBe(false);
    expectRefusedAt({ ...validInitial(), edition: 'second' }, 'edition');
  });

  it('returns at most fifty refusals, and a fifty-first saying how many more there were', () => {
    const chosen = Array.from({ length: 1000 }, (_, i) => `unknown-${i}`);
    const answer = validateQeegContent(withValue(validInitial(), 'findings.chosen', chosen));
    expect(answer.ok).toBe(false);
    if (answer.ok) return;
    expect(answer.refusals).toHaveLength(51);
    expect(answer.refusals[49]?.path).toBe('findings.chosen.49');
    expect(answer.refusals[50]).toEqual({ path: '', reason: 'And 950 more.' });
  });

  describe('a field it does not know', () => {
    it('is refused by name, at the top', () => {
      const answer = validateQeegContent({ ...validInitial(), colour: 'red' });
      expect(answer).toMatchObject({ ok: false, refusals: [{ path: 'colour' }] });
    });

    it('is refused by name, deep inside', () => {
      const input = withValue(validInitial(), 'bands.delta.colour', 'red');
      expectRefusedAt(input, 'bands.delta.colour');
    });

    it('is refused by name inside a follow-up page of what has changed', () => {
      const input = withValue(validFollowUp(), 'change.pairs.eyes_open.middle', null);
      expectRefusedAt(input, 'change.pairs.eyes_open.middle');
    });

    it('refuses a measure the table cannot carry', () => {
      const input = withValue(validFollowUp(), 'change.table.gamma', {
        position: 2,
        eyesOpen: null,
        eyesClosed: null,
      });
      expectRefusedAt(input, 'change.table.gamma');
    });
  });

  describe('ids come from their list', () => {
    const cases: Array<[string, unknown]> = [
      ['findings.chosen.0', 'feeling_low'],
      ['focus.chosen.0', 'posture'],
      ['recommendations.chosen.0', 'diet'],
      ['benefits.chosen.0', 'flight'],
      ['bands.delta.regions.0', 'cerebellum'],
      ['bands.delta.level', 'high'],
      ['connectivity.asymmetry.level', 'increased'],
      ['connectivity.phase_lag.level', 'mixed'],
      ['plan.approach', 'soothing'],
    ];
    for (const [path, value] of cases) {
      it(`refuses ${String(value)} at ${path}`, () => {
        expectRefusedAt(withValue(validInitial(), path, value), path);
      });
    }

    it('refuses a band that is not in the list', () => {
      const input = withValue(validInitial(), 'bands.gamma', { level: null, regions: [] });
      expectRefusedAt(input, 'bands.gamma');
    });

    it('refuses a missing band', () => {
      expectRefusedAt(withValue(validInitial(), 'bands.theta', undefined), 'bands.theta');
    });

    it('refuses a change or a next stage from outside the follow-up lists', () => {
      expectRefusedAt(
        withValue(validFollowUp(), 'bands.delta.change', 'better'),
        'bands.delta.change',
      );
      expectRefusedAt(
        withValue(validFollowUp(), 'connectivity.phase_lag.change', 'further_improved'),
        'connectivity.phase_lag.change',
      );
      expectRefusedAt(withValue(validFollowUp(), 'plan.next', 'stop'), 'plan.next');
    });

    it('refuses a measure outside the list in a table row', () => {
      expectRefusedAt(
        withValue(validFollowUp(), 'change.table.delta.eyesOpen.kind', 'ratio'),
        'change.table.delta.eyesOpen.kind',
      );
    });
  });

  describe('no id twice', () => {
    it('refuses a finding ticked twice', () => {
      const input = withValue(validInitial(), 'findings.chosen', [
        'mental_fatigue',
        'mental_fatigue',
      ]);
      expectRefusedAt(input, 'findings.chosen.1');
    });

    it('refuses a region chosen twice, in a band and in a kind of connectivity', () => {
      expectRefusedAt(
        withValue(validInitial(), 'bands.delta.regions', ['frontal', 'central', 'frontal']),
        'bands.delta.regions.2',
      );
      expectRefusedAt(
        withValue(validFollowUp(), 'connectivity.asymmetry.regions', ['bilateral', 'bilateral']),
        'connectivity.asymmetry.regions.1',
      );
    });
  });

  describe('an edition takes only its own choices', () => {
    it('refuses a follow-up choice on a first report', () => {
      expectRefusedAt(
        withValue(validInitial(), 'bands.delta.level', 'improved'),
        'bands.delta.level',
      );
    });

    it('refuses a first-report choice on a follow-up', () => {
      expectRefusedAt(
        withValue(validFollowUp(), 'bands.delta.change', 'increased'),
        'bands.delta.change',
      );
    });

    it('refuses a first report carrying a follow-up field', () => {
      expectRefusedAt({ ...validInitial(), comparedWith: EARLIER }, 'comparedWith');
      expectRefusedAt(withValue(validInitial(), 'plan.next', 'continue_current'), 'plan.next');
    });

    it('refuses a follow-up carrying a first-report field', () => {
      expectRefusedAt(
        withValue(validFollowUp(), 'bands.delta.level', 'increased'),
        'bands.delta.level',
      );
    });
  });

  describe('stage agrees with edition', () => {
    it('refuses a first report called a follow-up', () => {
      expectRefusedAt(withValue(validInitial(), 'stage', 'follow_up'), 'stage');
      expectRefusedAt(withValue(validInitial(), 'stage', 'final'), 'stage');
    });

    it('refuses a follow-up called initial', () => {
      expectRefusedAt(withValue(validFollowUp(), 'stage', 'initial'), 'stage');
    });

    it('lets a report brought in from the old tool carry any stage', () => {
      const legacy = withValue(validInitial(), 'provenance', {
        origin: 'legacy_tool',
        format: 'qeeg.json/1',
        sourceSha256: SHA,
        notes: [{ code: 'score_defaulted', at: 'dashboard.mental_energy' }],
        asPrinted: { signerName: null, signerRole: null },
      });
      expectAccepted(withValue(legacy, 'stage', 'final'));
      expectAccepted(withValue(legacy, 'stage', 'follow_up'));
    });

    it('refuses, by name, a follow-up that says it came from the old tool', () => {
      // The old tool offered only a first report's lists, so nothing it wrote
      // is a follow-up; and a past record is frozen, so none becomes one.
      const legacy = withValue(validFollowUp(), 'provenance', {
        origin: 'legacy_tool',
        format: 'qeeg.json/1',
        sourceSha256: SHA,
        notes: [],
        asPrinted: { signerName: null, signerRole: null },
      });
      expectRefusedAt(legacy, 'provenance.origin');
      expectRefusedAt(withValue(legacy, 'stage', 'final'), 'provenance.origin');
    });
  });

  describe('ordered lists are in order', () => {
    it('refuses a repeated position', () => {
      const input = withValue(validInitial(), 'findings.custom.b.position', 0);
      expectRefusedAt(input, 'findings.custom.b.position');
    });

    it('refuses a gap in the positions', () => {
      const input = withValue(validInitial(), 'findings.custom.b.position', 2);
      expectRefusedAt(input, 'findings.custom.b.position');
    });

    it('refuses a position that is not a whole number', () => {
      const input = withValue(validInitial(), 'maps.m1.position', 0.5);
      expectRefusedAt(input, 'maps.m1.position');
    });

    it('refuses table rows out of order', () => {
      const input = withValue(validFollowUp(), 'change.table.alpha_1.position', 3);
      expectRefusedAt(input, 'change.table.alpha_1.position');
    });
  });

  describe('an ordered list’s keys', () => {
    /** The body as a request would carry it: parsed from JSON, with one list replaced. */
    function asSent(content: unknown, path: string, listJson: string): unknown {
      const body = JSON.parse(JSON.stringify(content)) as Record<string, unknown>;
      const parts = path.split('.');
      const last = parts.pop() as string;
      let at = body;
      for (const part of parts) at = at[part] as Record<string, unknown>;
      at[last] = JSON.parse(listJson);
      return body;
    }

    it('refuses the prototype’s own name by name, in a custom list, the maps and the tiles', () => {
      expectRefusedAt(
        asSent(
          validInitial(),
          'findings.custom',
          '{"__proto__": {"anything": "at all", "position": "not a number"}}',
        ),
        'findings.custom.__proto__',
      );
      expectRefusedAt(
        asSent(validInitial(), 'maps', '{"__proto__": {"dataUrl": "data:text/html;base64,AAAA"}}'),
        'maps.__proto__',
      );
      expectRefusedAt(
        asSent(
          validFollowUp(),
          'change.tiles',
          '{"__proto__": {"figure": {"kind":"percent","low":900,"source":"calculated"}}}',
        ),
        'change.tiles.__proto__',
      );
    });

    it('refuses a well-formed item hidden under the prototype’s own name', () => {
      const item = JSON.stringify({
        label: { en: 'Slow mornings', ar: null },
        note: null,
        chosen: true,
        position: 0,
      });
      const input = asSent(blankInitial(), 'findings.custom', `{"__proto__": ${item}}`);
      expectRefusedAt(input, 'findings.custom.__proto__');
    });

    it('refuses a key an object answers to, or one the app would never make', () => {
      for (const key of ['constructor', 'toString', 'Upper', '0a', 'a b', 'x'.repeat(33), '']) {
        const input = asSent(
          validInitial(),
          'focus.custom',
          JSON.stringify({
            [key]: { label: { en: 'Item', ar: null }, note: null, chosen: true, position: 0 },
          }),
        );
        expectRefusedAt(input, `focus.custom.${key}`);
      }
    });

    it('accepts the keys the app makes', () => {
      for (const key of ['c0', 'map-0', 't1', 'x'.repeat(32)]) {
        const input = asSent(
          validInitial(),
          'focus.custom',
          JSON.stringify({
            [key]: { label: { en: 'Item', ar: null }, note: null, chosen: true, position: 0 },
          }),
        );
        expectAccepted(input);
      }
    });
  });

  describe('counts', () => {
    it('refuses more custom items than a list may hold', () => {
      const custom = Object.fromEntries(
        Array.from({ length: LIMITS.customPerList + 1 }, (_, position) => [
          `c${position}`,
          { label: { en: `Item ${position}`, ar: null }, note: null, chosen: false, position },
        ]),
      );
      expectRefusedAt(withValue(validInitial(), 'focus.custom', custom), 'focus.custom');
    });

    it('accepts exactly as many custom items as a list may hold', () => {
      const custom = Object.fromEntries(
        Array.from({ length: LIMITS.customPerList }, (_, position) => [
          `c${position}`,
          { label: { en: `Item ${position}`, ar: null }, note: null, chosen: false, position },
        ]),
      );
      expectAccepted(withValue(validInitial(), 'focus.custom', custom));
    });

    it('refuses more maps than a report may hold', () => {
      const one = validInitial().maps.m1;
      const maps = Object.fromEntries(
        Array.from({ length: LIMITS.maps + 1 }, (_, position) => [
          `m${position}`,
          { ...one, position },
        ]),
      );
      expectRefusedAt(withValue(validInitial(), 'maps', maps), 'maps');
    });

    it('refuses more tiles than the page may hold', () => {
      const tile = { figure: typedFigure, caption: { en: 'A', ar: null } };
      const tiles = Object.fromEntries(
        Array.from({ length: LIMITS.tiles + 1 }, (_, position) => [
          `t${position}`,
          { ...tile, position },
        ]),
      );
      expectRefusedAt(withValue(validFollowUp(), 'change.tiles', tiles), 'change.tiles');
    });
  });

  describe('lengths', () => {
    it('refuses a label, a note, evidence, a caption or a summary that is too long', () => {
      const tooLong = (most: number) => 'x'.repeat(most + 1);
      expectRefusedAt(
        withValue(validInitial(), 'findings.custom.a.label.en', tooLong(LIMITS.label)),
        'findings.custom.a.label.en',
      );
      expectRefusedAt(
        withValue(validInitial(), 'findings.custom.a.note', { en: tooLong(LIMITS.note), ar: null }),
        'findings.custom.a.note.en',
      );
      expectRefusedAt(
        withValue(validInitial(), 'dashboard.mental_energy.evidence.ar', tooLong(LIMITS.evidence)),
        'dashboard.mental_energy.evidence.ar',
      );
      expectRefusedAt(
        withValue(validInitial(), 'maps.m1.caption', { en: tooLong(LIMITS.caption), ar: null }),
        'maps.m1.caption.en',
      );
      expectRefusedAt(
        withValue(validInitial(), 'summary.en', { text: tooLong(LIMITS.summary), marks: [] }),
        'summary.en.text',
      );
      expectRefusedAt(
        withValue(validFollowUp(), 'change.summary.en.text', tooLong(LIMITS.summary)),
        'change.summary.en.text',
      );
    });

    it('accepts text exactly at its limit', () => {
      expectAccepted(
        withValue(validInitial(), 'findings.custom.a.label.en', 'x'.repeat(LIMITS.label)),
      );
    });

    it('refuses a custom label that is empty', () => {
      expectRefusedAt(
        withValue(validInitial(), 'findings.custom.a.label.en', '   '),
        'findings.custom.a.label.en',
      );
    });
  });

  describe('typed text is handed back clean', () => {
    const dirty = '  Slow\u0000 mornings\u200b  ';

    it('cleans every typed string alike, in a label, a note, evidence and a caption', () => {
      let input = withValue(validInitial(), 'findings.custom.a.label', { en: dirty, ar: dirty });
      input = withValue(input, 'findings.custom.a.note', { en: dirty, ar: '   ' });
      input = withValue(input, 'dashboard.mental_energy.evidence', { en: dirty, ar: null });
      input = withValue(input, 'maps.m1.caption', { en: dirty, ar: dirty });
      const answer = validateQeegContent(input);
      expect(answer.ok).toBe(true);
      if (!answer.ok || answer.content.edition !== 'initial') return;
      const { findings, dashboard, maps } = answer.content;
      expect(findings.custom['a']?.label).toEqual({ en: 'Slow mornings', ar: 'Slow mornings' });
      expect(findings.custom['a']?.note).toEqual({ en: 'Slow mornings', ar: null });
      expect(dashboard.mental_energy.evidence).toEqual({ en: 'Slow mornings', ar: null });
      expect(maps['m1']?.caption).toEqual({ en: 'Slow mornings', ar: 'Slow mornings' });
    });

    it('checks a length after cleaning', () => {
      const padded = `x${' '.repeat(LIMITS.label)}`;
      const answer = validateQeegContent(
        withValue(validInitial(), 'findings.custom.a.label.en', padded),
      );
      expect(answer.ok && answer.content.findings.custom['a']?.label.en).toBe('x');
    });

    it('refuses a label that is empty once cleaned', () => {
      expectRefusedAt(
        withValue(validInitial(), 'findings.custom.a.label.en', '\u200b\u0000 '),
        'findings.custom.a.label.en',
      );
    });

    it('cleans the reference of the report compared with', () => {
      const answer = validateQeegContent(
        withValue(validFollowUp(), 'comparedWith.reference', ' RPT-000001\u200e '),
      );
      expect(
        answer.ok && answer.content.edition === 'follow-up' && answer.content.comparedWith,
      ).toMatchObject({ reference: 'RPT-000001' });
    });

    it('refuses rich text holding a character the editor removes, since marks count from it', () => {
      expectRefusedAt(
        withValue(validInitial(), 'summary.en', { text: 'a\u0000b', marks: [] }),
        'summary.en.text',
      );
    });
  });

  describe('marks', () => {
    const at = 'summary.en.marks';
    const withMarks = (marks: unknown) =>
      withValue(validInitial(), 'summary.en', { text: 'abcdefghij', marks });

    it('refuses a mark that is not whole, runs backwards, or runs off the end', () => {
      expectRefusedAt(withMarks([{ from: 0.5, to: 2, bold: true }]), `${at}.0.from`);
      expectRefusedAt(withMarks([{ from: 3, to: 3, bold: true }]), `${at}.0`);
      expectRefusedAt(withMarks([{ from: 4, to: 2, bold: true }]), `${at}.0`);
      expectRefusedAt(withMarks([{ from: -1, to: 2, bold: true }]), `${at}.0.from`);
      expectRefusedAt(withMarks([{ from: 8, to: 11, bold: true }]), `${at}.0`);
    });

    it('refuses a mark that begins or ends between the two halves of a pair', () => {
      const over = (marks: unknown) =>
        withValue(validInitial(), 'summary.en', { text: '\u{1F600} hi', marks });
      expectRefusedAt(over([{ from: 0, to: 1, bold: true }]), `${at}.0`);
      expectRefusedAt(over([{ from: 1, to: 3, bold: true }]), `${at}.0`);
      expectAccepted(over([{ from: 0, to: 2, bold: true }]));
    });

    it('refuses marks out of order or overlapping', () => {
      expectRefusedAt(
        withMarks([
          { from: 5, to: 6, bold: true },
          { from: 1, to: 2, bold: true },
        ]),
        `${at}.1`,
      );
      expectRefusedAt(
        withMarks([
          { from: 1, to: 5, bold: true },
          { from: 4, to: 6, underline: true },
        ]),
        `${at}.1`,
      );
    });

    it('accepts marks that touch', () => {
      expectAccepted(
        withMarks([
          { from: 1, to: 5, bold: true },
          { from: 5, to: 6, underline: true },
        ]),
      );
    });

    it('refuses a mark that sets neither bold nor underline', () => {
      expectRefusedAt(withMarks([{ from: 1, to: 2 }]), `${at}.0`);
    });

    it('refuses a mark that is false rather than absent, or has a colour', () => {
      expectRefusedAt(
        withMarks([{ from: 1, to: 2, bold: false, underline: true }]),
        `${at}.0.bold`,
      );
      expectRefusedAt(withMarks([{ from: 1, to: 2, bold: true, colour: 'red' }]), `${at}.0.colour`);
    });

    it('refuses more marks than a text may carry', () => {
      const marks = Array.from({ length: LIMITS.marks + 1 }, (_, i) => ({
        from: i,
        to: i + 1,
        bold: true,
      }));
      const input = withValue(validInitial(), 'summary.en', {
        text: 'x'.repeat(LIMITS.marks + 1),
        marks,
      });
      expectRefusedAt(input, at);
    });
  });

  describe('numbers', () => {
    it('holds a score to a whole number from 0 to 10, or null', () => {
      const path = 'dashboard.mental_energy.score';
      expectAccepted(withValue(validInitial(), path, 0));
      expectAccepted(withValue(validInitial(), path, 10));
      expectAccepted(withValue(validInitial(), path, null));
      expectRefusedAt(withValue(validInitial(), path, 11), path);
      expectRefusedAt(withValue(validInitial(), path, -1), path);
      expectRefusedAt(withValue(validInitial(), path, 6.5), path);
      expectRefusedAt(
        withValue(validFollowUp(), 'dashboard.attention_focus.earlierScore', 12),
        'dashboard.attention_focus.earlierScore',
      );
    });

    it('holds sessions to a whole number from 1 to the most, or null', () => {
      expectAccepted(withValue(validInitial(), 'plan.sessions', 1));
      expectAccepted(withValue(validInitial(), 'plan.sessions', LIMITS.sessionsMost));
      expectRefusedAt(withValue(validInitial(), 'plan.sessions', 0), 'plan.sessions');
      expectRefusedAt(
        withValue(validInitial(), 'plan.sessions', LIMITS.sessionsMost + 1),
        'plan.sessions',
      );
      expectRefusedAt(withValue(validInitial(), 'plan.sessions', 2.5), 'plan.sessions');
    });

    it('holds a percentage to a whole number from 1 to 100, and a range to one above it', () => {
      const path = 'change.tiles.t1.figure';
      const percent = (low: number, high: number | null) =>
        withValue(validFollowUp(), path, { ...typedFigure, low, high });
      expectAccepted(percent(1, null));
      expectAccepted(percent(99, 100));
      expectRefusedAt(percent(0, null), `${path}.low`);
      expectRefusedAt(percent(101, null), `${path}.low`);
      expectRefusedAt(percent(12.5, null), `${path}.low`);
      expectRefusedAt(percent(30, 30), `${path}.high`);
      expectRefusedAt(percent(30, 20), `${path}.high`);
      expectRefusedAt(percent(30, 101), `${path}.high`);
    });
  });

  describe('dates', () => {
    it('holds a date to YYYY-MM-DD and a real day', () => {
      expectAccepted(withValue(validInitial(), 'recording.recordedOn', '2028-02-29'));
      for (const bad of ['2026-02-30', '2026-13-01', '2026-9-1', '01/09/2026', '2027-02-29']) {
        expectRefusedAt(
          withValue(validInitial(), 'recording.recordedOn', bad),
          'recording.recordedOn',
        );
      }
      expectRefusedAt(
        withValue(validFollowUp(), 'comparedWith.recordedOn', '2026-04-31'),
        'comparedWith.recordedOn',
      );
    });

    it('holds a date to a year from 2000 to 2100, as the reader does', () => {
      for (const bad of ['0000-01-01', '0000-02-29', '0050-06-01', '9999-12-31', '1999-12-31']) {
        expectRefusedAt(
          withValue(validInitial(), 'recording.recordedOn', bad),
          'recording.recordedOn',
        );
      }
      expectAccepted(withValue(validInitial(), 'recording.recordedOn', '2000-01-01'));
    });
  });

  describe('a figure reference', () => {
    it('holds its id to a uuid, its digest to 64 lower-case hex, and its sizes above 0', () => {
      expectRefusedAt(withValue(validInitial(), 'maps.m1.figureId', 'map-1'), 'maps.m1.figureId');
      expectRefusedAt(
        withValue(validInitial(), 'maps.m1.sha256', 'A'.repeat(64)),
        'maps.m1.sha256',
      );
      expectRefusedAt(
        withValue(validInitial(), 'maps.m1.sha256', 'a'.repeat(63)),
        'maps.m1.sha256',
      );
      expectRefusedAt(withValue(validInitial(), 'maps.m1.widthPx', 0), 'maps.m1.widthPx');
      expectRefusedAt(withValue(validInitial(), 'maps.m1.heightPx', 10.5), 'maps.m1.heightPx');
      expectRefusedAt(
        withValue(validFollowUp(), 'change.pairs.eyes_open.earlier.figureId', 'x'),
        'change.pairs.eyes_open.earlier.figureId',
      );
    });
  });

  describe('where a figure came from', () => {
    it('refuses a calculated figure with no basis', () => {
      const path = 'change.table.delta.eyesOpen';
      expectRefusedAt(
        withValue(validFollowUp(), path, { ...calculatedFigure, basis: null }),
        `${path}.basis`,
      );
    });

    it('refuses a typed figure that claims a basis', () => {
      const path = 'change.table.alpha_1.eyesClosed';
      expectRefusedAt(
        withValue(validFollowUp(), path, { ...typedFigure, basis: calculatedFigure.basis }),
        `${path}.basis`,
      );
    });

    it('refuses a calculated figure whose two assessments are one and the same', () => {
      const path = 'change.table.delta.eyesOpen.basis';
      const same = { ...calculatedFigure.basis, laterAssessmentId: ID(2) };
      expectRefusedAt(withValue(validFollowUp(), path, same), `${path}.laterAssessmentId`);
    });

    it('refuses a headline with no words for what it is', () => {
      for (const en of ['', '   ']) {
        expectRefusedAt(
          withValue(validFollowUp(), 'change.tiles.t1.caption', { en, ar: null }),
          'change.tiles.t1.caption.en',
        );
      }
    });

    it('refuses a basis whose assessments are not uuids', () => {
      const path = 'change.table.delta.eyesOpen.basis.laterAssessmentId';
      expectRefusedAt(withValue(validFollowUp(), path, 'later'), path);
    });
  });

  describe('what can be calculated', () => {
    it('refuses a calculated figure for a measure the app does not record', () => {
      const path = 'change.table.alpha_1.eyesClosed';
      expectRefusedAt(withValue(validFollowUp(), path, calculatedFigure), `${path}.source`);
    });

    it('accepts a calculated figure for a measure the app records', () => {
      expectAccepted(withValue(validFollowUp(), 'change.table.delta.eyesClosed', calculatedFigure));
    });

    it('refuses a calculated figure on a tile', () => {
      const path = 'change.tiles.t1.figure';
      expectRefusedAt(withValue(validFollowUp(), path, calculatedFigure), `${path}.source`);
    });
  });

  describe('a follow-up names what it is compared with', () => {
    it('refuses a follow-up with nothing to compare with', () => {
      expectRefusedAt(withValue(validFollowUp(), 'comparedWith', undefined), 'comparedWith');
    });

    it('refuses an earlier report whose id is not a uuid', () => {
      expectRefusedAt(
        withValue(validFollowUp(), 'comparedWith.reportId', 'first'),
        'comparedWith.reportId',
      );
    });

    it('holds the reference to null exactly when the earlier report was imported', () => {
      const imported = withValue(validFollowUp(), 'comparedWith.origin', 'imported');
      expectRefusedAt(imported, 'comparedWith.reference');
      expectAccepted(withValue(imported, 'comparedWith.reference', null));
      expectRefusedAt(
        withValue(validFollowUp(), 'comparedWith.reference', null),
        'comparedWith.reference',
      );
    });
  });
});
