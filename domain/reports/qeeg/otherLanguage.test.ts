import { describe, expect, it } from 'vitest';
import { blankFollowUp, blankInitial } from './blank';
import { DIMENSION_IDS } from './catalogue/ids';
import { withOtherLanguageFrom } from './otherLanguage';
import { validateQeegContent } from './shape';
import type {
  Bilingual,
  ComparedWith,
  CustomItem,
  Locale,
  Picked,
  QeegContent,
  QeegFollowUp,
  QeegInitial,
  RichText,
} from './types';
import { LIMITS } from './types';

/**
 * Brief G, item 5: the second report of one recording takes only the other
 * language's halves of typed text from what was sent. Everything else is the
 * first report's.
 */

const ID = (n: number) => `0000000A-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SHA = 'b'.repeat(64);

const EARLIER: ComparedWith = {
  reportId: ID(1),
  recordedOn: '2026-03-14',
  relation: 'initial',
  origin: 'issued',
  reference: 'RPT-000001',
};

const both = (en: string, ar: string | null = null): Bilingual => ({ en, ar });

function customOf<Id extends string>(chosen: readonly Id[], label: string): Picked<Id> {
  const item = (position: number): CustomItem & { position: number } => ({
    label: both(`${label} ${position}`, `عربي ${position}`),
    note: both(`Note ${position}`, `ملاحظة ${position}`),
    chosen: position === 0,
    position,
  });
  return { chosen: [...chosen], custom: { c0: item(0), c1: item(1) } };
}

/** Every typed text of a first report given a value, English and Arabic. */
function filledInitial(): QeegInitial {
  const blank = blankInitial();
  return {
    ...blank,
    recording: { recordedOn: '2026-09-01', eyes: 'closed', handedness: 'right' },
    findings: customOf(['mental_fatigue'], 'Finding'),
    focus: customOf(['sleep_recovery'], 'Focus'),
    maps: {
      'map-0': {
        figureId: ID(10),
        sha256: SHA,
        widthPx: 800,
        heightPx: 600,
        condition: 'eyes_open',
        caption: both('Open, first run', 'مفتوحة'),
        position: 0,
      },
    },
    recommendations: customOf(['recovery_capacity'], 'Recommendation'),
    summary: {
      en: { text: 'Settled and steady.', marks: [{ from: 0, to: 7, bold: true }] },
      ar: { text: 'هادئة ومستقرة', marks: [{ from: 0, to: 5, underline: true }] },
    },
    benefits: customOf(['sleep'], 'Benefit'),
    bands: { ...blank.bands, delta: { level: 'increased', regions: ['frontal'] } },
    dashboard: Object.fromEntries(
      DIMENSION_IDS.map((d, i) => [d, { score: i + 2, evidence: both(`Seen ${d}`, `دليل ${i}`) }]),
    ) as QeegInitial['dashboard'],
    plan: { sessions: 20, approach: 'calming' },
  };
}

/** Every typed text of a follow-up given a value, English and Arabic. */
function filledFollowUp(): QeegFollowUp {
  const initial = filledInitial();
  const blank = blankFollowUp(EARLIER, 'follow_up');
  return {
    ...blank,
    recording: initial.recording,
    findings: initial.findings,
    focus: initial.focus,
    maps: initial.maps,
    recommendations: initial.recommendations,
    summary: initial.summary,
    benefits: initial.benefits,
    bands: { ...blank.bands, theta: { change: 'improved', regions: ['central'] } },
    dashboard: Object.fromEntries(
      DIMENSION_IDS.map((d, i) => [
        d,
        { score: i + 3, evidence: both(`Now ${d}`, `الآن ${i}`), earlierScore: i + 1 },
      ]),
    ) as QeegFollowUp['dashboard'],
    change: {
      tiles: {
        t0: {
          figure: {
            kind: 'percent',
            direction: 'decrease',
            low: 20,
            high: null,
            source: 'typed',
            basis: null,
          },
          caption: both('Less slow activity', 'نشاط أبطأ أقل'),
          position: 0,
        },
      },
      sessionsCompleted: { count: 20, source: 'gathered' },
      pairs: blank.change.pairs,
      table: {},
      summary: {
        en: { text: 'Steadier.', marks: [] },
        ar: { text: 'أكثر ثباتا', marks: [{ from: 0, to: 4, bold: true }] },
      },
    },
    plan: { sessions: 15, next: 'continue_calming' },
  };
}

type Json = null | string | number | boolean | Json[] | { [key: string]: Json };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A typed text: an object of exactly `en` and `ar`, plain or formatted. */
function isTyped(value: unknown): value is { en: unknown; ar: unknown } {
  return isObject(value) && Object.keys(value).sort().join() === 'ar,en';
}

function textOf(half: unknown): string | null {
  if (typeof half === 'string') return half;
  if (isObject(half) && typeof half['text'] === 'string') return half['text'];
  return null;
}

/** Every typed text found anywhere in `value`, by its dotted path. */
function typedTexts(value: unknown, path = ''): Array<[string, { en: unknown; ar: unknown }]> {
  if (isTyped(value)) return [[path, value]];
  if (Array.isArray(value)) return value.flatMap((v, i) => typedTexts(v, `${path}.${i}`));
  if (isObject(value)) {
    return Object.entries(value).flatMap(([k, v]) => typedTexts(v, path ? `${path}.${k}` : k));
  }
  return [];
}

/** Every path where `value` holds null. */
function nullsOf(value: unknown, path = ''): string[] {
  if (value === null) return [path];
  if (Array.isArray(value)) return value.flatMap((v, i) => nullsOf(v, `${path}.${i}`));
  if (isObject(value)) {
    return Object.entries(value).flatMap(([k, v]) => nullsOf(v, path ? `${path}.${k}` : k));
  }
  return [];
}

/** A copy with every typed half replaced by `tag` and the half's name. */
function tagged<T>(value: T, tag: string): T {
  const walk = (v: unknown): unknown => {
    if (isTyped(v)) {
      const half = (old: unknown, name: string) =>
        isObject(old) ? { text: `${tag} ${name}`, marks: [] } : `${tag} ${name}`;
      return { en: half(v.en, 'en'), ar: half(v.ar ?? v.en, 'ar') };
    }
    if (Array.isArray(v)) return v.map(walk);
    if (isObject(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value) as T;
}

/** A copy with the `locale` half of every typed text set to null, to compare the rest. */
function withoutHalf(value: unknown, locale: Locale): Json {
  if (isTyped(value)) return { ...(value as { en: Json; ar: Json }), [locale]: null };
  if (Array.isArray(value)) return value.map((v) => withoutHalf(v, locale));
  if (isObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, withoutHalf(v, locale)]));
  }
  return value as Json;
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}

function expectShapeAccepts(content: QeegContent) {
  const answer = validateQeegContent(content);
  if (!answer.ok) expect(answer.refusals).toEqual([]);
  expect(answer.ok).toBe(true);
}

/** Nulls a filled report may hold: none of them is typed text. */
const NOT_TYPED =
  /^(subject|recording)\.|\.(level|change|score)$|^plan\.|^change\.pairs\.|\.figure\.(high|basis)$/;

describe('withOtherLanguageFrom', () => {
  describe('every typed text is walked', () => {
    it('leaves no typed text of the filled reports null, so a new one is caught below', () => {
      // A typed text added to the type and left null by the blank would sit at
      // a path this pattern does not know, and fail here.
      for (const content of [filledInitial(), filledFollowUp()]) {
        expect(nullsOf(content).filter((path) => !NOT_TYPED.test(path))).toEqual([]);
      }
    });

    for (const locale of ['ar', 'en'] as const) {
      for (const [edition, make] of [
        ['a first report', filledInitial],
        ['a follow-up', filledFollowUp],
      ] as const) {
        it(`takes the ${locale} half of every typed text from what was sent, in ${edition}`, () => {
          const first = tagged(make(), 'FIRST');
          const sent = tagged(make(), 'SENT');
          const result = withOtherLanguageFrom(first, sent, locale);
          const other = locale === 'ar' ? 'en' : 'ar';
          const found = typedTexts(result);
          expect(found.length).toBe(typedTexts(first).length);
          expect(found.length).toBeGreaterThan(20);
          for (const [path, text] of found) {
            expect(textOf(text[locale]), path).toBe(`SENT ${locale}`);
            expect(textOf(text[other]), path).toBe(`FIRST ${other}`);
          }
          expectShapeAccepts(result);
        });
      }
    }
  });

  describe('items are matched by key', () => {
    it('matches an item by its key, not its place', () => {
      const first = filledInitial();
      const sent = filledInitial();
      const swapped: QeegInitial = {
        ...sent,
        findings: {
          ...sent.findings,
          custom: {
            c0: { ...sent.findings.custom['c1']!, position: 0, label: both('x', 'ثاني') },
            c1: { ...sent.findings.custom['c0']!, position: 1, label: both('y', 'أول') },
          },
        },
      };
      const result = withOtherLanguageFrom(first, swapped, 'ar');
      expect(result.findings.custom['c0']?.label).toEqual(both('Finding 0', 'ثاني'));
      expect(result.findings.custom['c1']?.label).toEqual(both('Finding 1', 'أول'));
      expect(result.findings.custom['c0']?.position).toBe(0);
    });

    it('ignores an item the first report does not hold', () => {
      const first = filledInitial();
      const sent = filledInitial();
      const extra: QeegInitial = {
        ...sent,
        focus: {
          ...sent.focus,
          custom: {
            ...sent.focus.custom,
            c9: { label: both('Added', 'مضاف'), note: null, chosen: true, position: 2 },
          },
        },
        maps: {
          ...sent.maps,
          'map-5': { ...sent.maps['map-0']!, position: 1, caption: both('New', 'جديد') },
        },
      };
      const result = withOtherLanguageFrom(first, extra, 'ar');
      expect(Object.keys(result.focus.custom)).toEqual(['c0', 'c1']);
      expect(Object.keys(result.maps)).toEqual(['map-0']);
      expectShapeAccepts(result);
    });

    it('keeps the first report half where what was sent does not hold the item', () => {
      const first = filledFollowUp();
      const sent = filledFollowUp();
      const fewer: QeegFollowUp = {
        ...sent,
        benefits: { ...sent.benefits, custom: {} },
        maps: {},
        change: { ...sent.change, tiles: {} },
        dashboard: {
          ...sent.dashboard,
          mental_energy: { ...sent.dashboard.mental_energy, evidence: null },
        },
      };
      const result = withOtherLanguageFrom(first, fewer, 'ar');
      expect(result.benefits.custom['c0']?.label).toEqual(first.benefits.custom['c0']?.label);
      expect(result.maps['map-0']?.caption).toEqual(first.maps['map-0']?.caption);
      expect(result.edition === 'follow-up' && result.change.tiles['t0']?.caption).toEqual(
        first.change.tiles['t0']?.caption,
      );
      expect(result.dashboard.mental_energy.evidence).toEqual(
        first.dashboard.mental_energy.evidence,
      );
    });

    it('adds no typed text the first report did not have', () => {
      const first: QeegInitial = {
        ...filledInitial(),
        dashboard: {
          ...filledInitial().dashboard,
          mental_energy: { score: 4, evidence: null },
        },
      };
      const result = withOtherLanguageFrom(first, filledInitial(), 'ar');
      expect(result.dashboard.mental_energy.evidence).toBeNull();
    });
  });

  describe('nothing else of what was sent is read', () => {
    /** A follow-up that differs from `filledFollowUp` in everything but typed text. */
    function otherInEverything(): QeegFollowUp {
      const sent = filledFollowUp();
      return {
        ...sent,
        stage: 'final',
        subject: { nameAr: 'صفصاف مرفأ', ageYears: 70, sex: 'male' },
        recording: { recordedOn: '2026-10-01', eyes: 'open', handedness: 'left' },
        comparedWith: {
          reportId: ID(99),
          recordedOn: '2026-03-14',
          relation: 'initial',
          origin: 'issued',
          reference: 'RPT-000099',
        },
        findings: { ...sent.findings, chosen: ['sleep_dysregulation'] },
        focus: {
          ...sent.focus,
          chosen: [],
          custom: {
            c0: { ...sent.focus.custom['c0']!, chosen: false },
            c1: { ...sent.focus.custom['c1']!, chosen: true },
          },
        },
        maps: {
          'map-0': {
            ...sent.maps['map-0']!,
            figureId: ID(50),
            sha256: 'c'.repeat(64),
            widthPx: 10,
            heightPx: 10,
            condition: 'eyes_closed',
          },
        },
        bands: { ...sent.bands, theta: { change: 'moved_further', regions: ['occipital'] } },
        dashboard: Object.fromEntries(
          DIMENSION_IDS.map((d) => [d, { ...sent.dashboard[d], score: 9, earlierScore: 0 }]),
        ) as QeegFollowUp['dashboard'],
        change: {
          ...sent.change,
          tiles: {
            t0: {
              ...sent.change.tiles['t0']!,
              figure: { kind: 'no_appreciable_change', source: 'typed', basis: null },
            },
          },
          sessionsCompleted: { count: 3, source: 'typed' },
          table: {
            delta: {
              position: 0,
              eyesOpen: { kind: 'no_appreciable_change', source: 'typed', basis: null },
              eyesClosed: null,
            },
          },
        },
        plan: { sessions: 40, next: null },
      };
    }

    it('takes no score, finding, region, map, figure, stage, comparison or subject', () => {
      const first = filledFollowUp();
      const result = withOtherLanguageFrom(first, otherInEverything(), 'ar');
      expect(withoutHalf(result, 'ar')).toEqual(withoutHalf(first, 'ar'));
      expectShapeAccepts(result);
    });

    it('takes nothing of where it came from, or its edition', () => {
      const first = filledInitial();
      const sent: QeegInitial = {
        ...filledInitial(),
        stage: 'final',
        provenance: {
          origin: 'legacy_tool',
          format: 'qeeg.json/1',
          sourceSha256: SHA,
          notes: [],
          asPrinted: { signerName: 'Willow Harbour', signerRole: null },
        },
      };
      const result = withOtherLanguageFrom(first, sent, 'ar');
      expect(withoutHalf(result, 'ar')).toEqual(withoutHalf(first, 'ar'));
      const fromOther = withOtherLanguageFrom(first, filledFollowUp(), 'ar');
      expect(fromOther.edition).toBe('initial');
      expect(withoutHalf(fromOther, 'ar')).toEqual(withoutHalf(first, 'ar'));
    });
  });

  describe('when what was sent is of the other edition', () => {
    it('takes only the typed texts both editions share', () => {
      const first = tagged(filledFollowUp(), 'FIRST');
      const sent = tagged(filledInitial(), 'SENT');
      const result = withOtherLanguageFrom(first, sent, 'ar');
      if (result.edition !== 'follow-up') throw new Error('expected a follow-up');
      expect(textOf(result.summary.ar)).toBe('SENT ar');
      expect(textOf(result.findings.custom['c0']?.label.ar)).toBe('SENT ar');
      expect(textOf(result.dashboard.decision_making.evidence?.ar)).toBe('SENT ar');
      expect(textOf(result.change.summary.ar)).toBe('FIRST ar');
      expect(textOf(result.change.tiles['t0']?.caption.ar)).toBe('FIRST ar');
      expectShapeAccepts(result);
    });

    it('never throws, either way round, in either language', () => {
      for (const locale of ['ar', 'en'] as const) {
        expect(() =>
          withOtherLanguageFrom(filledInitial(), filledFollowUp(), locale),
        ).not.toThrow();
        expect(() =>
          withOtherLanguageFrom(filledFollowUp(), filledInitial(), locale),
        ).not.toThrow();
      }
    });
  });

  describe('a half of nothing', () => {
    function sentWith(ar: string | null, en = 'Kept English'): QeegInitial {
      const sent = filledInitial();
      return {
        ...sent,
        findings: {
          ...sent.findings,
          custom: {
            ...sent.findings.custom,
            c0: { ...sent.findings.custom['c0']!, label: { en, ar } },
          },
        },
        summary: {
          en: { text: en, marks: [] },
          ar: ar === null ? null : { text: ar, marks: [] },
        },
      };
    }

    it('makes an Arabic of nothing none', () => {
      for (const ar of [null, '', '   ', '\u200b\u0000\t']) {
        const result = withOtherLanguageFrom(filledInitial(), sentWith(ar), 'ar');
        expect(result.findings.custom['c0']?.label.ar, String(ar)).toBeNull();
        expect(result.summary.ar, String(ar)).toBeNull();
      }
    });

    it('keeps the first report English where the English sent is empty once cleaned', () => {
      const first = filledInitial();
      for (const en of ['', '   ', '\u200b\u0000']) {
        const result = withOtherLanguageFrom(first, sentWith('عربي', en), 'en');
        expect(result.findings.custom['c0']?.label.en, en).toBe('Finding 0');
        expect(result.summary.en, en).toEqual(first.summary.en);
        expectShapeAccepts(result);
      }
    });
  });

  describe('what is taken is cleaned', () => {
    /** A follow-up sent with `ar` as the Arabic of every typed text but the change page's. */
    function sentWithArabic(ar: string, summary: RichText): QeegFollowUp {
      const sent = filledFollowUp();
      return {
        ...sent,
        findings: {
          ...sent.findings,
          custom: {
            ...sent.findings.custom,
            c0: { ...sent.findings.custom['c0']!, label: both('x', ar), note: both('x', ar) },
          },
        },
        maps: { 'map-0': { ...sent.maps['map-0']!, caption: both('x', ar) } },
        dashboard: {
          ...sent.dashboard,
          stress_regulation: { ...sent.dashboard.stress_regulation, evidence: both('x', ar) },
        },
        summary: { en: sent.summary.en, ar: summary },
        change: {
          ...sent.change,
          tiles: { t0: { ...sent.change.tiles['t0']!, caption: both('x', ar) } },
        },
      };
    }

    it('cleans each half taken as the shape does', () => {
      const ar = `  a\u0000b${'ب'.repeat(50)}\u200b  `;
      const summary = {
        text: `\ufeff  س\tص\r\nع${'ب'.repeat(50)}`,
        marks: [{ from: 3, to: 4, bold: true as const }],
      };
      const result = withOtherLanguageFrom(filledFollowUp(), sentWithArabic(ar, summary), 'ar');
      if (result.edition !== 'follow-up') throw new Error('expected a follow-up');
      const cleaned = `ab${'ب'.repeat(50)}`;
      expect(result.findings.custom['c0']?.label.ar).toBe(cleaned);
      expect(result.findings.custom['c0']?.note?.ar).toBe(cleaned);
      expect(result.maps['map-0']?.caption?.ar).toBe(cleaned);
      expect(result.change.tiles['t0']?.caption.ar).toBe(cleaned);
      expect(result.dashboard.stress_regulation.evidence?.ar).toBe(cleaned);
      expect(result.summary.ar).toEqual({
        text: `س ص\nع${'ب'.repeat(50)}`,
        marks: [{ from: 0, to: 1, bold: true }],
      });
      expectShapeAccepts(result);
    });

    it('never cuts a half that is too long: the shape refuses it by name', () => {
      // The specification: text that is too long is refused, never cut.
      const ar = 'ب'.repeat(LIMITS.note + 1);
      const summary = { text: 'ب'.repeat(LIMITS.summary + 1), marks: [] };
      const result = withOtherLanguageFrom(filledFollowUp(), sentWithArabic(ar, summary), 'ar');
      expect(result.findings.custom['c0']?.label.ar).toHaveLength(LIMITS.note + 1);
      const answer = validateQeegContent(result);
      expect(answer.ok).toBe(false);
      if (answer.ok) return;
      expect(answer.refusals.map((refusal) => refusal.path).sort()).toEqual(
        [
          'findings.custom.c0.label.ar',
          'findings.custom.c0.note.ar',
          'maps.map-0.caption.ar',
          'dashboard.stress_regulation.evidence.ar',
          'summary.ar.text',
          'change.tiles.t0.caption.ar',
        ].sort(),
      );
    });

    it('keeps more than two hundred marks for the shape to refuse, never dropping them', () => {
      const summary = {
        text: 'ب '.repeat(300).trim(),
        marks: Array.from({ length: 300 }, (_, i) => ({
          from: 2 * i,
          to: 2 * i + 1,
          bold: true as const,
        })),
      };
      const result = withOtherLanguageFrom(filledFollowUp(), sentWithArabic('ب', summary), 'ar');
      expect(result.summary.ar?.marks).toHaveLength(300);
      expect(validateQeegContent(result)).toMatchObject({
        ok: false,
        refusals: [{ path: 'summary.ar.marks' }],
      });
    });
  });

  describe('what it was given', () => {
    it('returns a new value and never changes what it was given', () => {
      const first = deepFreeze(filledFollowUp());
      const sent = deepFreeze(tagged(filledFollowUp(), 'SENT'));
      const before = JSON.stringify([first, sent]);
      const result = withOtherLanguageFrom(first, sent, 'ar');
      expect(JSON.stringify([first, sent])).toBe(before);
      expect(result).not.toBe(first);
      expect(result.findings).not.toBe(first.findings);
      expect(result.recording).not.toBe(first.recording);
      expect(result.bands.delta.regions).not.toBe(first.bands.delta.regions);
      expect(Object.isFrozen(result.findings)).toBe(false);
    });
  });
});
