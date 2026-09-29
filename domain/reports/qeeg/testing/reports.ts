/**
 * Invented first reports for the tests of the report's pages: a sparse one,
 * a full one, a long one and a brain map with no programme after it, and the
 * facts a report does not hold itself.
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
import { blankInitial, eachOf } from '../blank';
import {
  BAND_IDS,
  BENEFIT_IDS,
  DIMENSION_IDS,
  FINDING_IDS,
  FOCUS_IDS,
  QEEG_ONLY,
  RECOMMENDATION_IDS,
  REGION_IDS,
} from '../catalogue/ids';
import type { ReportFacts } from '../document/build';
import { LIMITS } from '../types';
import type { Bilingual, CustomItem, Mark, MapEntry, Ordered, QeegInitial } from '../types';

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

/** Almost everything left blank: a draft previewed before it is filled. */
export function sparseReport(): QeegInitial {
  return blankInitial();
}

/** A report as one is usually filled in. */
export function fullReport(): QeegInitial {
  const blank = blankInitial();
  return {
    ...blank,
    subject: { nameAr: CLIENT_NAME.ar, ageYears: 34, sex: 'female' },
    recording: { recordedOn: '2026-09-14', eyes: 'closed_and_open', handedness: 'right' },
    findings: {
      chosen: ['reduced_attention_focus', 'mental_fatigue', 'sleep_dysregulation'],
      custom: customItems(1, 40, false),
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
      custom: customItems(1, 30, true),
    },
    summary: summaryOf(900, 2, true),
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

/** The facts a report does not hold itself, for a report with these maps. */
export function factsFor(
  content: QeegInitial,
  options: { readonly signed?: boolean } = {},
): ReportFacts {
  const signed = options.signed ?? true;
  const pictures: Record<string, DocumentImage> = {};
  for (const map of Object.values(content.maps)) {
    pictures[map.figureId] = pictureOf({ width: map.widthPx, height: map.heightPx });
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
    pictures,
  };
}

/** The four reports by name, in the order the tests go through them. */
export const CASES = Object.freeze({
  sparse: sparseReport,
  full: fullReport,
  long: longReport,
  qeegOnly: qeegOnlyReport,
});
export type CaseName = keyof typeof CASES;
