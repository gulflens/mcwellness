import { describe, expect, it } from 'vitest';
import { blankFollowUp, blankInitial } from './blank';
import { DIMENSION_IDS } from './catalogue/ids';
import { missingForIssue } from './complete';
import {
  prefillFollowUp,
  type EarlierReport,
  type PrefillRefusal,
  type PrefillRequest,
} from './prefill';
import { validateQeegContent } from './shape';
import type { ComparedWith, MapEntry, QeegContent, QeegFollowUp, QeegInitial } from './types';

/**
 * Brief G, item 6: a follow-up begun from an earlier report brings forward
 * the facts, and offers her last choices beside the form, never inside it.
 */

const ID = (n: number) => `0000000B-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SHA = 'd'.repeat(64);
const CLIENT = ID(100);
const OTHER_CLIENT = ID(200);

function map(n: number, condition: MapEntry['condition'], position: number) {
  return {
    figureId: ID(n),
    sha256: SHA,
    widthPx: 800 + n,
    heightPx: 600,
    condition,
    caption: null,
    position,
  };
}

/** A signed first report with something in every part a follow-up could take from. */
function earlierContent(): QeegInitial {
  const blank = blankInitial();
  return {
    ...blank,
    subject: { nameAr: 'بندق مرج', ageYears: 34, sex: 'female' },
    recording: { recordedOn: '2026-03-14', eyes: 'closed_and_open', handedness: 'left' },
    findings: {
      chosen: ['mental_fatigue', 'sleep_dysregulation'],
      custom: {
        c0: { label: { en: 'Unticked', ar: null }, note: null, chosen: false, position: 0 },
        c1: {
          label: { en: 'Slow mornings', ar: 'صباح بطيء' },
          note: null,
          chosen: true,
          position: 1,
        },
      },
    },
    focus: { chosen: ['sleep_recovery'], custom: {} },
    maps: {
      'map-0': map(1, 'eyes_closed', 2),
      'map-1': map(2, 'eyes_open', 1),
      'map-2': map(3, 'eyes_open', 3),
      'map-3': map(4, null, 0),
    },
    recommendations: {
      chosen: ['recovery_capacity'],
      custom: {
        c0: {
          label: { en: 'Walk daily', ar: null },
          note: { en: 'Twenty minutes outdoors.', ar: null },
          chosen: true,
          position: 0,
        },
      },
    },
    summary: { en: { text: 'Settled and steady.', marks: [] }, ar: null },
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
      mental_energy: { score: 2, evidence: { en: 'Low in the afternoon.', ar: null } },
      attention_focus: { score: 3, evidence: null },
      cognitive_flexibility: { score: 4, evidence: null },
      stress_regulation: { score: 0, evidence: null },
      recovery_capacity: { score: 10, evidence: null },
      decision_making: { score: null, evidence: null },
    },
    plan: { sessions: 20, approach: 'calming' },
  };
}

function earlier(changes: Partial<EarlierReport> = {}): EarlierReport {
  return {
    reportId: ID(1),
    clientId: CLIENT,
    status: 'issued',
    withdrawn: false,
    erased: false,
    reference: 'RPT-000001',
    content: earlierContent(),
    ...changes,
  };
}

function request(changes: Partial<PrefillRequest> = {}): PrefillRequest {
  return {
    clientId: CLIENT,
    draftId: ID(9),
    stage: 'follow_up',
    recordedOn: '2026-09-20',
    ...changes,
  };
}

function prefilled(from: EarlierReport = earlier(), asked: PrefillRequest = request()) {
  const answer = prefillFollowUp(from, asked);
  if (!answer.ok) throw new Error(`expected a prefill, was refused: ${answer.reason}`);
  return answer;
}

const ISSUED: ComparedWith = {
  reportId: ID(1),
  recordedOn: '2026-03-14',
  relation: 'initial',
  origin: 'issued',
  reference: 'RPT-000001',
};

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}

describe('prefillFollowUp', () => {
  describe('what is brought forward', () => {
    it('names the earlier report it is compared with', () => {
      expect(prefilled().content.comparedWith).toEqual(ISSUED);
    });

    it('calls a follow-up it is compared with previous, and a first report initial', () => {
      const followUp: QeegFollowUp = {
        ...blankFollowUp(ISSUED, 'follow_up'),
        recording: { recordedOn: '2026-06-01', eyes: null, handedness: null },
      };
      const from = earlier({ reportId: ID(2), reference: 'RPT-000002', content: followUp });
      expect(prefilled(from).content.comparedWith).toEqual({
        reportId: ID(2),
        recordedOn: '2026-06-01',
        relation: 'previous',
        origin: 'issued',
        reference: 'RPT-000002',
      });
      const final = { ...followUp, stage: 'final' as const };
      expect(prefilled(earlier({ content: final })).content.comparedWith.relation).toBe('previous');
    });

    it('says a past record was imported, with no reference', () => {
      const from = earlier({ status: 'imported', reference: null });
      expect(prefilled(from).content.comparedWith).toEqual({
        ...ISSUED,
        origin: 'imported',
        reference: null,
      });
    });

    it('brings forward each of the six scores as the earlier score', () => {
      const { dashboard } = prefilled().content;
      expect(DIMENSION_IDS.map((d) => dashboard[d].earlierScore)).toEqual([2, 3, 4, 0, 10, null]);
      for (const d of DIMENSION_IDS) {
        expect(dashboard[d].score, d).toBeNull();
        expect(dashboard[d].evidence, d).toBeNull();
      }
    });

    it('brings forward the first map of each condition, by place, as the earlier picture', () => {
      const { pairs } = prefilled().content.change;
      const ref = (n: number) => ({
        figureId: ID(n),
        sha256: SHA,
        widthPx: 800 + n,
        heightPx: 600,
      });
      expect(pairs).toEqual({
        eyes_open: { earlier: ref(2), later: null },
        eyes_closed: { earlier: ref(1), later: null },
      });
    });

    it('brings forward no picture for a condition the earlier report had none of', () => {
      const content = { ...earlierContent(), maps: { 'map-0': map(1, 'eyes_open', 0) } };
      const { pairs } = prefilled(earlier({ content })).content.change;
      expect(pairs.eyes_closed).toEqual({ earlier: null, later: null });
    });

    it('brings forward the handedness, and takes the day and the stage from the request', () => {
      const { content } = prefilled(earlier(), request({ stage: 'final' }));
      expect(content.recording).toEqual({
        recordedOn: '2026-09-20',
        eyes: null,
        handedness: 'left',
      });
      expect(content.stage).toBe('final');
      expect(prefilled(earlier(), request({ recordedOn: null })).content.recording.recordedOn).toBe(
        null,
      );
    });

    it('brings nothing else forward: the rest is as a blank follow-up has it', () => {
      const { content } = prefilled();
      const blank = blankFollowUp(ISSUED, 'follow_up');
      expect(content).toEqual({
        ...blank,
        recording: { ...blank.recording, recordedOn: '2026-09-20', handedness: 'left' },
        dashboard: {
          mental_energy: { score: null, evidence: null, earlierScore: 2 },
          attention_focus: { score: null, evidence: null, earlierScore: 3 },
          cognitive_flexibility: { score: null, evidence: null, earlierScore: 4 },
          stress_regulation: { score: null, evidence: null, earlierScore: 0 },
          recovery_capacity: { score: null, evidence: null, earlierScore: 10 },
          decision_making: { score: null, evidence: null, earlierScore: null },
        },
        change: { ...blank.change, pairs: content.change.pairs },
      });
      expect(content.subject).toEqual({ nameAr: null, ageYears: null, sex: null });
      expect(content.provenance).toEqual({ origin: 'app' });
    });

    it('brings forward an earlier follow-up own scores, never its earlier scores', () => {
      const followUp: QeegFollowUp = {
        ...blankFollowUp(ISSUED, 'follow_up'),
        recording: { recordedOn: '2026-06-01', eyes: null, handedness: null },
        dashboard: {
          mental_energy: { score: 4, evidence: null, earlierScore: 1 },
          attention_focus: { score: 5, evidence: null, earlierScore: 2 },
          cognitive_flexibility: { score: 6, evidence: null, earlierScore: 3 },
          stress_regulation: { score: 7, evidence: null, earlierScore: 0 },
          recovery_capacity: { score: 8, evidence: null, earlierScore: 10 },
          decision_making: { score: 9, evidence: null, earlierScore: null },
        },
      };
      const { dashboard } = prefilled(earlier({ content: followUp })).content;
      expect(DIMENSION_IDS.map((d) => dashboard[d].earlierScore)).toEqual([4, 5, 6, 7, 8, 9]);
      const unscored: QeegFollowUp = {
        ...followUp,
        dashboard: {
          ...followUp.dashboard,
          mental_energy: { score: null, evidence: null, earlierScore: 1 },
        },
      };
      const again = prefilled(earlier({ content: unscored })).content.dashboard;
      expect(again.mental_energy.earlierScore).toBeNull();
    });

    it('trims the reference it brings forward', () => {
      const from = earlier({ reference: '  RPT-000001\u200e ' });
      expect(prefilled(from).content.comparedWith).toMatchObject({ reference: 'RPT-000001' });
    });

    it('brings forward no score that is not a whole number, and no hand it does not know', () => {
      const content = {
        ...earlierContent(),
        recording: { ...earlierContent().recording, handedness: 'both' },
        dashboard: { ...earlierContent().dashboard, mental_energy: { score: 5.5, evidence: null } },
      } as unknown as QeegContent;
      const answer = prefilled(earlier({ content }));
      expect(answer.content.dashboard.mental_energy.earlierScore).toBeNull();
      expect(answer.content.recording.handedness).toBeNull();
    });

    it('passes the shape, as a first report and as a past record are followed up', () => {
      for (const from of [earlier(), earlier({ status: 'imported', reference: null })]) {
        const answer = validateQeegContent(prefilled(from).content);
        if (!answer.ok) expect(answer.refusals).toEqual([]);
        expect(answer.ok).toBe(true);
      }
    });

    it('fills no box a practitioner must fill', () => {
      // The day she gave and the hand brought forward are facts; everything
      // she judges is still asked for, exactly as on a blank follow-up.
      const { content } = prefilled();
      const blank: QeegFollowUp = {
        ...blankFollowUp(ISSUED, 'follow_up'),
        recording: content.recording,
      };
      expect(missingForIssue(content)).toEqual(missingForIssue(blank));
      const bare = earlier({
        content: {
          ...earlierContent(),
          recording: { ...earlierContent().recording, handedness: null },
        },
      });
      expect(missingForIssue(prefilled(bare, request({ recordedOn: null })).content)).toEqual(
        missingForIssue(blankFollowUp(ISSUED, 'follow_up')),
      );
    });
  });

  describe('what is offered beside it', () => {
    it('offers what she chose last time, less what she added and unticked', () => {
      const { offered } = prefilled();
      expect(offered.findings).toEqual({
        chosen: ['mental_fatigue', 'sleep_dysregulation'],
        custom: {
          c1: {
            label: { en: 'Slow mornings', ar: 'صباح بطيء' },
            note: null,
            chosen: true,
            position: 0,
          },
        },
      });
      expect(offered.recommendations.custom['c0']?.note).toEqual({
        en: 'Twenty minutes outdoors.',
        ar: null,
      });
      expect(offered.focus).toEqual({ chosen: ['sleep_recovery'], custom: {} });
      expect(offered.benefits).toEqual({ chosen: ['sleep'], custom: {} });
    });

    it('offers the regions of every band and every kind of connectivity', () => {
      const { offered } = prefilled();
      expect(offered.regions.bands).toEqual({
        delta: ['frontal', 'central'],
        theta: [],
        alpha: [],
        beta: [],
        high_beta: [],
      });
      expect(offered.regions.connectivity).toEqual({
        connectivity: ['temporal'],
        asymmetry: ['frontal'],
        phase_lag: ['widespread'],
      });
    });

    it('offers what she added in the order of its places, not of its keys', () => {
      const item = (en: string, position: number) => ({
        label: { en, ar: null },
        note: null,
        chosen: true,
        position,
      });
      const content = {
        ...earlierContent(),
        focus: { chosen: [], custom: { c0: item('Second', 1), c1: item('First', 0) } },
      };
      const { focus } = prefilled(earlier({ content })).offered;
      expect(focus.custom['c1']).toMatchObject({ position: 0, label: { en: 'First' } });
      expect(focus.custom['c0']).toMatchObject({ position: 1, label: { en: 'Second' } });
    });

    it('offers no region it does not know', () => {
      const content = {
        ...earlierContent(),
        bands: {
          ...earlierContent().bands,
          delta: { level: 'increased', regions: ['frontal', 'nowhere'] },
        },
      } as unknown as QeegContent;
      expect(prefilled(earlier({ content })).offered.regions.bands.delta).toEqual(['frontal']);
    });

    it('puts nothing it offers inside the content', () => {
      const { content } = prefilled();
      expect(content.findings).toEqual({ chosen: [], custom: {} });
      expect(content.bands.delta).toEqual({ change: null, regions: [] });
    });

    it('hands over copies, and never changes what it was given', () => {
      const from = deepFreeze(earlier());
      const asked = deepFreeze(request());
      const before = JSON.stringify([from, asked]);
      const answer = prefilled(from, asked);
      expect(JSON.stringify([from, asked])).toBe(before);
      expect(answer.offered.findings.chosen).not.toBe(from.content.findings.chosen);
      expect(answer.offered.regions.bands.delta).not.toBe(from.content.bands.delta.regions);
      expect(Object.isFrozen(answer.offered.findings)).toBe(false);
    });
  });

  describe('what it refuses', () => {
    /** Each refusal, in order, with the change to a good request that earns it. */
    const RULES: ReadonlyArray<
      readonly [
        PrefillRefusal,
        (from: EarlierReport, asked: PrefillRequest) => [EarlierReport, PrefillRequest],
      ]
    > = [
      ['other_client', (from, asked) => [{ ...from, clientId: OTHER_CLIENT }, asked]],
      ['erased', (from, asked) => [{ ...from, erased: true }, asked]],
      ['same_report', (from, asked) => [from, { ...asked, draftId: from.reportId }]],
      ['draft', (from, asked) => [{ ...from, status: 'draft' }, asked]],
      ['superseded', (from, asked) => [{ ...from, status: 'superseded' }, asked]],
      ['withdrawn', (from, asked) => [{ ...from, withdrawn: true }, asked]],
      ['no_reference', (from, asked) => [{ ...from, reference: null }, asked]],
      [
        'undated',
        (from, asked) => [
          {
            ...from,
            content: {
              ...from.content,
              recording: { ...from.content.recording, recordedOn: null },
            },
          },
          asked,
        ],
      ],
      ['no_such_day', (from, asked) => [from, { ...asked, recordedOn: '2026-02-30' }]],
      ['recorded_later', (from, asked) => [from, { ...asked, recordedOn: '2026-03-13' }]],
    ];

    RULES.forEach(([reason, rule], index) => {
      it(`refuses with ${reason} alone`, () => {
        const [from, asked] = rule(earlier(), request());
        expect(prefillFollowUp(from, asked)).toEqual({ ok: false, reason });
      });

      it(`refuses with ${reason} before every reason after it`, () => {
        let pair: [EarlierReport, PrefillRequest] = [earlier(), request()];
        // The later rules first, so that where two set one field this one wins.
        for (const [, later] of RULES.slice(index).reverse()) pair = later(...pair);
        expect(prefillFollowUp(...pair)).toEqual({ ok: false, reason });
      });
    });

    it('refuses an issued report with an empty reference, and a past record with one', () => {
      expect(prefillFollowUp(earlier({ reference: '  ' }), request())).toEqual({
        ok: false,
        reason: 'no_reference',
      });
      expect(prefillFollowUp(earlier({ status: 'imported' }), request())).toEqual({
        ok: false,
        reason: 'no_reference',
      });
    });

    it('refuses a request whose day is no day, and never drops it in silence', () => {
      for (const recordedOn of ['2026-02-30', 'yesterday', '', '14/09/2026', '1999-12-31']) {
        expect(prefillFollowUp(earlier(), request({ recordedOn })), recordedOn).toEqual({
          ok: false,
          reason: 'no_such_day',
        });
      }
    });

    it('calls an earlier report whose day is no day undated', () => {
      for (const recordedOn of ['2026-02-30', 'yesterday', '']) {
        const content = {
          ...earlierContent(),
          recording: { ...earlierContent().recording, recordedOn },
        };
        expect(prefillFollowUp(earlier({ content }), request()), recordedOn).toEqual({
          ok: false,
          reason: 'undated',
        });
      }
    });

    it('allows an earlier report recorded the same day', () => {
      expect(prefillFollowUp(earlier(), request({ recordedOn: '2026-03-14' })).ok).toBe(true);
    });

    it('allows a first draft, with no id yet', () => {
      expect(prefillFollowUp(earlier(), request({ draftId: null })).ok).toBe(true);
    });

    it('says nothing of another client report, not even that it is a draft', () => {
      for (const status of ['draft', 'superseded', 'imported', 'issued'] as const) {
        const from = earlier({ clientId: OTHER_CLIENT, status, erased: true, withdrawn: true });
        expect(prefillFollowUp(from, request())).toEqual({ ok: false, reason: 'other_client' });
      }
    });
  });

  describe('whatever it is handed', () => {
    it('never throws', () => {
      const odd: unknown[] = [
        {},
        { recording: null },
        { recording: { recordedOn: '2026-03-14' } },
        { ...earlierContent(), maps: { x: null, y: { condition: 'eyes_open' } }, bands: null },
        { ...earlierContent(), dashboard: { mental_energy: { score: 'high' } } },
      ];
      for (const content of odd) {
        const from = earlier({ content: content as QeegContent });
        expect(() => prefillFollowUp(from, request()), JSON.stringify(content)).not.toThrow();
      }
      expect(prefillFollowUp(earlier({ content: {} as QeegContent }), request())).toEqual({
        ok: false,
        reason: 'undated',
      });
    });

    it('reads what it cannot read as not there', () => {
      const content = {
        ...earlierContent(),
        maps: { x: null, y: { condition: 'eyes_open', position: 0 } },
        dashboard: { mental_energy: { score: 'high' }, attention_focus: { score: 11 } },
      } as unknown as QeegContent;
      const answer = prefilled(earlier({ content }));
      expect(answer.content.change.pairs.eyes_open.earlier).toBeNull();
      expect(answer.content.dashboard.mental_energy.earlierScore).toBeNull();
      expect(answer.content.dashboard.attention_focus.earlierScore).toBeNull();
      expect(validateQeegContent(answer.content).ok).toBe(true);
    });
  });
});
