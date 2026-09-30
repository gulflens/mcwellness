/**
 * Invented reports for the tests of the report's pages: first reports (a
 * sparse one, a full one, a long one and a brain map with no programme after
 * it), follow-ups (a sparse one, one of pictures and words alone, a full one
 * and a long one), and the facts a report does not hold itself.
 *
 * **For tests only**, and the sample pages. Four test files and the script
 * that renders the samples ask for the same four reports, and a report
 * copied four times would drift. A test file cannot be imported by another
 * without running its tests twice, so they live here, as `drawsNothing.ts`
 * does. Nothing that reaches a page imports it.
 *
 * **Nobody real.** Names come from `db/seed/names.ts`, telephone numbers
 * from the range kept for tests, addresses at `example.com`, ids from the
 * range kept for them. No map is a real one: a picture here is its size and
 * no bytes, and a test that renders one draws it itself.
 *
 * **Each passes the shape** (`shape.test` of these lives in the pages'
 * tests), because whoever builds the pages takes only content that has.
 */

import type { DocumentImage } from '@domain/shared/document';
import { FAMILY_NAMES, GIVEN_NAMES } from '../../../../db/seed/names';
import { blankFollowUp, blankInitial, eachOf } from '../blank';
import {
  BAND_IDS,
  BENEFIT_IDS,
  DIMENSION_IDS,
  FINDING_IDS,
  FOCUS_IDS,
  MEASURE_IDS,
  QEEG_ONLY,
  RECOMMENDATION_IDS,
  REGION_IDS,
} from '../catalogue/ids';
import type { ReportFacts } from '../document/build';
import { LIMITS } from '../types';
import type {
  Bilingual,
  ChangeRow,
  ComparedWith,
  CustomItem,
  FigureRef,
  Mark,
  MapEntry,
  Ordered,
  QeegContent,
  QeegFollowUp,
  QeegInitial,
  Tile,
  TypedFigure,
} from '../types';

const given = GIVEN_NAMES[2] ?? { en: 'Cedar', ar: 'أرز' };
const family = FAMILY_NAMES[3] ?? { en: 'Dune', ar: 'كثيب' };

/** The client's name as the record holds it, in English and Arabic. */
export const CLIENT_NAME = Object.freeze({
  en: `${given.en} ${family.en}`,
  ar: `${given.ar} ${family.ar}`,
});

const signerGiven = GIVEN_NAMES[7] ?? { en: 'Hazel', ar: 'بندق' };
const signerFamily = FAMILY_NAMES[0] ?? { en: 'Bay', ar: 'خليج' };

/** A figure id of the range kept for tests. */
export function figureIdOf(place: number): string {
  return `0000000f-0000-4000-8000-${String(place + 1).padStart(12, '0')}`;
}

/** A digest that is only the right shape. */
const DIGEST = 'a'.repeat(64);

/** A map's size, in pixels: a picture three hundred dots to the inch at its place. */
export const MAP_PIXELS = Object.freeze({ width: 1600, height: 1200 });

/** A picture of a map with its size and no bytes: layout never reads them. */
export function pictureOf(pixels: { width: number; height: number } = MAP_PIXELS): DocumentImage {
  return { width: pixels.width, height: pixels.height, colours: 'rgb', data: new Uint8Array(0) };
}

/** English words of about `length` letters, made of an invented sentence said again. */
export function wordsOf(length: number, sentence: string): string {
  let text = '';
  while (text.length + sentence.length + 1 <= length)
    text = text === '' ? sentence : `${text} ${sentence}`;
  return text === '' ? sentence.slice(0, length) : text;
}

const EN_SENTENCE = 'Steady attention held through the afternoon recording.';
const AR_SENTENCE = 'انتباه ثابت طوال تسجيل فترة ما بعد الظهر.';

function bilingual(en: string, ar: string | null): Bilingual {
  return { en, ar };
}

/** `count` items of her own, each with a label of `length` letters, all chosen. */
function customItems(count: number, length: number, notes: boolean): Ordered<CustomItem> {
  const items: Record<string, CustomItem & { position: number }> = {};
  for (let place = 0; place < count; place += 1) {
    items[`c${place}`] = {
      label: bilingual(
        wordsOf(length, `Item ${place + 1}. ${EN_SENTENCE}`),
        wordsOf(length, `بند ${place + 1}. ${AR_SENTENCE}`),
      ),
      note: notes
        ? bilingual(wordsOf(LIMITS.note, EN_SENTENCE), wordsOf(LIMITS.note, AR_SENTENCE))
        : null,
      chosen: true,
      position: place,
    };
  }
  return items;
}

function mapsOf(count: number, captions: boolean): Ordered<MapEntry> {
  const maps: Record<string, MapEntry & { position: number }> = {};
  for (let place = 0; place < count; place += 1) {
    maps[`map-${place}`] = {
      figureId: figureIdOf(place),
      sha256: DIGEST,
      widthPx: MAP_PIXELS.width,
      heightPx: MAP_PIXELS.height,
      condition: place % 2 === 0 ? 'eyes_closed' : 'eyes_open',
      caption: captions
        ? bilingual(
            wordsOf(LIMITS.caption, `Map ${place + 1}, ${EN_SENTENCE}`),
            wordsOf(LIMITS.caption, `خريطة ${place + 1}، ${AR_SENTENCE}`),
          )
        : null,
      position: place,
    };
  }
  return maps;
}

/** A summary of paragraphs, with a bold stretch and an underlined one in the first. */
function summaryOf(length: number, paragraphs: number, arabic: boolean): QeegInitial['summary'] {
  const each = Math.floor((length - (paragraphs - 1)) / paragraphs);
  const text = (sentence: string) =>
    Array.from({ length: paragraphs }, () => wordsOf(each, sentence)).join('\n');
  const marks: Mark[] = [
    { from: 0, to: 6, bold: true },
    { from: 7, to: 16, underline: true },
  ];
  return {
    en: { text: text(EN_SENTENCE), marks },
    ar: arabic ? { text: text(AR_SENTENCE), marks: [{ from: 0, to: 5, bold: true }] } : null,
  };
}

const SUMMARY_EN = [
  `${given.en}'s recording shows a busy, alert pattern at the front of the head, with slower activity when the eyes were closed. This fits what ${given.en} described: a mind that stays switched on late into the evening.`,
  'The programme begins by helping the brain settle, then builds steady attention for longer stretches of work. We will review progress together after the first ten sessions.',
].join('\n');

const SUMMARY_AR = [
  'يظهر التسجيل نمطا نشطا ويقظا في مقدمة الرأس، مع نشاط أبطأ عند إغلاق العينين. ويتفق ذلك مع ما وصفه العميل: ذهن يبقى منشغلا حتى وقت متأخر من المساء.',
  'يبدأ البرنامج بمساعدة الدماغ على الهدوء، ثم يبني انتباها ثابتا لفترات عمل أطول. وسنراجع التقدم معا بعد الجلسات العشر الأولى.',
].join('\n');

/** A summary as a practitioner writes one: two short paragraphs, a name in bold, a phrase underlined. */
const NATURAL_SUMMARY: QeegInitial['summary'] = {
  en: {
    text: SUMMARY_EN,
    marks: [
      { from: 0, to: given.en.length, bold: true },
      {
        from: SUMMARY_EN.indexOf('a busy, alert pattern'),
        to: SUMMARY_EN.indexOf('a busy, alert pattern') + 'a busy, alert pattern'.length,
        underline: true,
      },
    ],
  },
  ar: { text: SUMMARY_AR, marks: [{ from: 0, to: 4, bold: true }] },
};

/** Almost everything left blank: a draft previewed before it is filled. */
export function sparseReport(): QeegInitial {
  return blankInitial();
}

/**
 * A report as one is usually filled in: short, natural items of her own, in
 * English and Arabic, as the sample pages show them. Filler of the longest
 * lengths the shape allows is the long report's alone.
 */
export function fullReport(): QeegInitial {
  const blank = blankInitial();
  return {
    ...blank,
    subject: { nameAr: CLIENT_NAME.ar, ageYears: 34, sex: 'female' },
    recording: { recordedOn: '2026-09-14', eyes: 'closed_and_open', handedness: 'right' },
    findings: {
      chosen: ['reduced_attention_focus', 'mental_fatigue', 'sleep_dysregulation'],
      custom: {
        c0: {
          label: bilingual('Difficulty winding down in the evening', 'صعوبة في الاسترخاء مساء'),
          note: null,
          chosen: true,
          position: 0,
        },
      },
    },
    focus: {
      chosen: ['attention_focus', 'stress_regulation', 'sleep_recovery', 'mental_energy'],
      custom: {},
    },
    maps: mapsOf(2, false),
    bands: {
      delta: { level: 'within_normal_limits', regions: ['widespread'] },
      theta: { level: 'increased', regions: ['frontal', 'central'] },
      alpha: { level: 'reduced', regions: ['occipital'] },
      beta: { level: 'increased', regions: ['frontal', 'temporal', 'left_hemisphere'] },
      high_beta: { level: 'within_normal_limits', regions: [] },
    },
    connectivity: {
      connectivity: { level: 'reduced', regions: ['frontal', 'parietal'] },
      asymmetry: { level: 'left', regions: ['frontal'] },
      phase_lag: { level: 'normal', regions: [] },
    },
    dashboard: {
      mental_energy: { score: 3, evidence: bilingual(EN_SENTENCE, AR_SENTENCE) },
      attention_focus: { score: 5, evidence: null },
      cognitive_flexibility: { score: 8, evidence: null },
      stress_regulation: { score: 2, evidence: bilingual(EN_SENTENCE, null) },
      recovery_capacity: { score: 6, evidence: null },
      decision_making: { score: 10, evidence: null },
    },
    recommendations: {
      chosen: ['mental_energy', 'attention_focus', 'stress_regulation'],
      custom: {
        c0: {
          label: bilingual('Screen-free evenings', 'أمسيات بلا شاشات'),
          note: bilingual(
            'Put screens away an hour before bed to help the mind settle.',
            'ضع الشاشات جانبا قبل النوم بساعة ليهدأ الذهن.',
          ),
          chosen: true,
          position: 0,
        },
      },
    },
    summary: NATURAL_SUMMARY,
    benefits: {
      chosen: ['attention_focus', 'sleep', 'mental_energy', 'resilience', 'recovery'],
      custom: {},
    },
    plan: { sessions: 20, approach: 'calming' },
  };
}

/** Every list full, every typed thing as long as the shape allows. */
export function longReport(): QeegInitial {
  const full = fullReport();
  const evidence = bilingual(
    wordsOf(LIMITS.evidence, EN_SENTENCE),
    wordsOf(LIMITS.evidence, AR_SENTENCE),
  );
  return {
    ...full,
    subject: { ...full.subject, ageYears: 67 },
    findings: {
      chosen: [...FINDING_IDS],
      custom: customItems(LIMITS.customPerList, LIMITS.label, false),
    },
    focus: {
      chosen: [...FOCUS_IDS],
      custom: customItems(LIMITS.customPerList, LIMITS.label, false),
    },
    maps: mapsOf(LIMITS.maps, true),
    bands: eachOf(BAND_IDS, () => ({ level: 'increased' as const, regions: [...REGION_IDS] })),
    connectivity: {
      connectivity: { level: 'mixed', regions: [...REGION_IDS] },
      asymmetry: { level: 'bilateral', regions: [...REGION_IDS] },
      phase_lag: { level: 'altered', regions: [...REGION_IDS] },
    },
    dashboard: eachOf(DIMENSION_IDS, (id) => ({
      score: [1, 4, 5, 7, 8, 10][DIMENSION_IDS.indexOf(id)] ?? 0,
      evidence,
    })),
    recommendations: {
      chosen: [...RECOMMENDATION_IDS],
      custom: customItems(LIMITS.customPerList, LIMITS.label, true),
    },
    summary: summaryOf(LIMITS.summary, 6, true),
    benefits: {
      chosen: [...BENEFIT_IDS],
      custom: customItems(LIMITS.customPerList, LIMITS.label, false),
    },
    plan: { sessions: LIMITS.sessionsMost, approach: 'calming_and_stabilising' },
  };
}

/** A full report of a brain map with no programme after it. */
export function qeegOnlyReport(): QeegInitial {
  return { ...fullReport(), plan: { sessions: QEEG_ONLY, approach: null } };
}

/** Every picture a report names: its own maps, and the earlier and later map of each pair. */
function figuresOf(content: QeegContent): FigureRef[] {
  const own: FigureRef[] = Object.values(content.maps);
  if (content.edition === 'initial') return own;
  const paired = Object.values(content.change.pairs).flatMap((pair) =>
    [pair.earlier, pair.later].filter((figure): figure is FigureRef => figure !== null),
  );
  return [...own, ...paired];
}

/** The facts a report does not hold itself, for a report with these maps. */
export function factsFor(
  content: QeegContent,
  options: { readonly signed?: boolean } = {},
): ReportFacts {
  const signed = options.signed ?? true;
  const pictures: Record<string, DocumentImage> = {};
  for (const figure of figuresOf(content)) {
    pictures[figure.figureId] = pictureOf({ width: figure.widthPx, height: figure.heightPx });
  }
  return {
    clientName: CLIENT_NAME.en,
    reference: signed ? 'RPT-000042' : null,
    issuedOn: signed ? '2026-09-20' : null,
    signer: signed
      ? {
          name: `${signerGiven.en} ${signerFamily.en}`,
          certification: 'Neurofeedback practitioner',
          certifyingBody: 'Example Certification Board',
          certificateNumber: 'EX-0042',
        }
      : null,
    practice: {
      name: 'McWellness',
      nameAr: 'ماك ويلنس',
      address: 'Example Street, Dubai',
      phone: '+971 50 000 0042',
      email: 'hello@example.com',
      website: 'example.com',
    },
    logo: pictureOf({ width: 520, height: 260 }),
    // No fixture holds a calculated figure; a test that makes one hands its days in.
    calculatedFrom: null,
    pictures,
  };
}

// ---------------------------------------------------------------------------
// Follow-ups
// ---------------------------------------------------------------------------

/** The client's first report, as a follow-up names it. */
export const COMPARED_WITH: ComparedWith = Object.freeze({
  reportId: '0000000e-0000-4000-8000-000000000001',
  reference: 'RPT-000041',
  recordedOn: '2026-06-10',
  origin: 'issued',
  relation: 'initial',
});

/** A map the earlier report printed, borrowed by a pair: ids after the report's own. */
export function earlierFigureOf(place: number): FigureRef {
  return {
    figureId: figureIdOf(20 + place),
    sha256: DIGEST,
    widthPx: MAP_PIXELS.width,
    heightPx: MAP_PIXELS.height,
  };
}

/** A map of this report's own, as a pair names it. */
function laterFigureOf(place: number): FigureRef {
  return {
    figureId: figureIdOf(place),
    sha256: DIGEST,
    widthPx: MAP_PIXELS.width,
    heightPx: MAP_PIXELS.height,
  };
}

/** Her own estimate, as a percentage that rose or fell, or a range of one. */
export function typedPercent(
  direction: 'increase' | 'decrease',
  low: number,
  high: number | null = null,
): TypedFigure {
  return { kind: 'percent', direction, low, high, source: 'typed', basis: null };
}

/** Her own estimate that nothing appreciable changed. */
export const NO_CHANGE: TypedFigure = Object.freeze({
  kind: 'no_appreciable_change',
  source: 'typed',
  basis: null,
});

const CHANGE_SUMMARY_EN = [
  'Slow activity at the front of the head has eased since June, most clearly with the eyes closed.',
  `${given.en} says evenings feel calmer and sleep comes more easily.`,
].join('\n');

const CHANGE_SUMMARY_AR = [
  'خف النشاط البطيء في مقدمة الرأس منذ يونيو، وأوضح ما يكون ذلك عند إغلاق العينين.',
  'يقول العميل إن الأمسيات أصبحت أهدأ وإن النوم يأتي بسهولة أكبر.',
].join('\n');

const FOLLOW_UP_SUMMARY_EN = [
  `${given.en}'s evenings have been calmer since June, and the busy pattern at the front of the head has eased, most of all with the eyes closed.`,
  'The next stage keeps the calming approach for twenty more sessions, and we will look at the maps together again at the halfway point.',
].join('\n');

const FOLLOW_UP_SUMMARY_AR = [
  'أصبحت الأمسيات أهدأ منذ يونيو، وخف النمط النشط في مقدمة الرأس، وأوضح ما يكون ذلك عند إغلاق العينين.',
  'تستمر المرحلة التالية بنهج التهدئة لعشرين جلسة أخرى، وسننظر في الخرائط معا مرة أخرى في منتصف الطريق.',
].join('\n');

/** A follow-up's summary as a practitioner writes one: what has moved, and what comes next. */
const FOLLOW_UP_SUMMARY: QeegFollowUp['summary'] = {
  en: { text: FOLLOW_UP_SUMMARY_EN, marks: [{ from: 0, to: given.en.length, bold: true }] },
  ar: { text: FOLLOW_UP_SUMMARY_AR, marks: [] },
};

/** Nothing filled in yet but what it is compared with: a draft previewed before it is filled. */
export function sparseFollowUp(): QeegFollowUp {
  return blankFollowUp({ ...COMPARED_WITH }, 'follow_up');
}

/**
 * A follow-up as one is usually filled in: the same short, natural items as
 * the full first report, changes chosen, the earlier scores beside the new,
 * two headlines of her own, the sessions completed, both pairs and four rows.
 */
export function fullFollowUp(): QeegFollowUp {
  const blank = sparseFollowUp();
  const first = fullReport();
  const tiles: Record<string, Tile & { position: number }> = {
    t0: {
      figure: typedPercent('decrease', 40),
      caption: bilingual('Slow activity at the front', 'النشاط البطيء في المقدمة'),
      position: 0,
    },
    t1: {
      figure: typedPercent('increase', 15, 20),
      caption: bilingual('Calm, steady focus', 'تركيز هادئ وثابت'),
      position: 1,
    },
  };
  const table: Partial<Record<(typeof MEASURE_IDS)[number], ChangeRow>> = {
    delta: {
      position: 0,
      eyesOpen: typedPercent('decrease', 25, 30),
      eyesClosed: typedPercent('decrease', 40),
    },
    theta: { position: 1, eyesOpen: typedPercent('increase', 15), eyesClosed: NO_CHANGE },
    alpha: { position: 2, eyesOpen: null, eyesClosed: typedPercent('increase', 10) },
    beta_2: { position: 3, eyesOpen: typedPercent('decrease', 20), eyesClosed: null },
  };
  return {
    ...blank,
    subject: first.subject,
    recording: first.recording,
    findings: first.findings,
    focus: first.focus,
    maps: first.maps,
    recommendations: first.recommendations,
    summary: FOLLOW_UP_SUMMARY,
    benefits: first.benefits,
    bands: {
      delta: { change: 'unchanged', regions: ['widespread'] },
      theta: { change: 'improved', regions: ['frontal', 'central'] },
      alpha: { change: 'further_improved', regions: ['occipital'] },
      beta: { change: 'moved_further', regions: ['temporal'] },
      high_beta: { change: 'now_within_normal_limits', regions: [] },
    },
    connectivity: {
      connectivity: { change: 'improved', regions: ['frontal', 'parietal'] },
      asymmetry: { change: 'unchanged', regions: ['frontal'] },
      phase_lag: { change: 'now_within_normal_limits', regions: [] },
    },
    dashboard: {
      mental_energy: { score: 5, evidence: bilingual(EN_SENTENCE, AR_SENTENCE), earlierScore: 3 },
      attention_focus: { score: 5, evidence: null, earlierScore: 5 },
      cognitive_flexibility: { score: 7, evidence: null, earlierScore: 8 },
      stress_regulation: { score: 4, evidence: null, earlierScore: 2 },
      recovery_capacity: { score: 6, evidence: null, earlierScore: null },
      decision_making: { score: 9, evidence: null, earlierScore: 10 },
    },
    change: {
      tiles,
      sessionsCompleted: { count: 20, source: 'gathered' },
      pairs: {
        eyes_open: { earlier: earlierFigureOf(1), later: laterFigureOf(1) },
        eyes_closed: { earlier: earlierFigureOf(0), later: laterFigureOf(0) },
      },
      table,
      summary: {
        en: { text: CHANGE_SUMMARY_EN, marks: [] },
        ar: { text: CHANGE_SUMMARY_AR, marks: [] },
      },
    },
    plan: { sessions: 20, next: 'continue_calming' },
  };
}

/** The page of what has changed with pictures and words alone: no headline, no table. */
export function picturesOnlyFollowUp(): QeegFollowUp {
  const full = fullFollowUp();
  return {
    ...full,
    change: { ...full.change, tiles: {}, sessionsCompleted: null, table: {} },
  };
}

/** Every list full, every typed thing as long as the shape allows, every row of the table. */
export function longFollowUp(): QeegFollowUp {
  const full = fullFollowUp();
  const long = longReport();
  const caption = bilingual(
    wordsOf(LIMITS.caption, EN_SENTENCE),
    wordsOf(LIMITS.caption, AR_SENTENCE),
  );
  const table: Partial<Record<(typeof MEASURE_IDS)[number], ChangeRow>> = {};
  MEASURE_IDS.forEach((measure, position) => {
    table[measure] = {
      position,
      eyesOpen: typedPercent('decrease', 25, 30),
      eyesClosed: typedPercent('increase', 95, 100),
    };
  });
  return {
    ...full,
    subject: long.subject,
    findings: long.findings,
    focus: long.focus,
    maps: long.maps,
    recommendations: long.recommendations,
    summary: long.summary,
    benefits: long.benefits,
    bands: eachOf(BAND_IDS, () => ({ change: 'moved_further' as const, regions: [...REGION_IDS] })),
    connectivity: {
      connectivity: { change: 'mixed_changes', regions: [...REGION_IDS] },
      asymmetry: { change: 'mixed_changes', regions: [...REGION_IDS] },
      phase_lag: { change: 'moved_further', regions: [...REGION_IDS] },
    },
    dashboard: eachOf(DIMENSION_IDS, (id) => ({
      ...long.dashboard[id],
      earlierScore: [10, 0, 5, 9, 8, 1][DIMENSION_IDS.indexOf(id)] ?? 0,
    })),
    change: {
      tiles: {
        t0: { figure: typedPercent('decrease', 99, 100), caption, position: 0 },
        t1: { figure: typedPercent('increase', 99, 100), caption, position: 1 },
      },
      sessionsCompleted: { count: LIMITS.sessionsMost, source: 'typed' },
      pairs: full.change.pairs,
      table,
      summary: summaryOf(LIMITS.summary, 6, true),
    },
    plan: { sessions: LIMITS.sessionsMost, next: 'adjust_focus' },
  };
}

/** The reports by name, in the order the tests go through them: first reports, then follow-ups. */
export const CASES = Object.freeze({
  sparse: sparseReport,
  full: fullReport,
  long: longReport,
  qeegOnly: qeegOnlyReport,
  followUpSparse: sparseFollowUp,
  followUpPictures: picturesOnlyFollowUp,
  followUpFull: fullFollowUp,
  followUpLong: longFollowUp,
});
export type CaseName = keyof typeof CASES;
