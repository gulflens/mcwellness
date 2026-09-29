import { describe, expect, it } from 'vitest';
import { COMPARISON_SENTENCE, STANDING_SENTENCES, WORDS } from '../../document/strings';
import { BAND_IDS, CONNECTIVITY_IDS } from '../catalogue/ids';
import { sessionLabel } from '../sentences';
import { classifyScoreChange } from '../scoreChange';
import {
  CASES,
  CLIENT_NAME,
  COMPARED_WITH,
  earlierFigureOf,
  factsFor,
  figureIdOf,
  fullFollowUp,
  fullReport,
  longFollowUp,
  longReport,
  NO_CHANGE,
  pictureOf,
  picturesOnlyFollowUp,
  qeegOnlyReport,
  sparseFollowUp,
  sparseReport,
  typedPercent,
} from '../testing/reports';
import type { CalculatedFigure, Locale, QeegContent, QeegFollowUp, QeegInitial } from '../types';
import { phrase } from '../wording';
import {
  buildQeegReport,
  footerOf,
  LEFT_OUT_WITHOUT_PROGRAMME,
  mapImageKey,
  SECTIONS,
  titleOf,
} from './build';
import type { Part, ReportInput } from './build';
import { BODY_WIDTH, CHANGE, GAP, MAP } from './geometry';
import { INK } from './palette';
import type { LayoutOp } from './scale';
import { ARABIC, ENGLISH, across } from './pieces/checks';
import type { Drawing } from './typeset';

/**
 * docs/SPEC/reports-qeeg.md section 12: a first report's content, its
 * language and the facts it does not hold itself, turned into the blocks of
 * its pages, in the order of the practice's report.
 */

/** This module's builder and the sentences' module, as written: read to hold them to one rule. */
const SOURCES = import.meta.glob<string>(['./build.ts', '../sentences.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
});
const BUILD_SOURCE = SOURCES['./build.ts'] ?? '';
const SENTENCES_SOURCE = SOURCES['../sentences.ts'] ?? '';

/** A body as tall as a page leaves under the practice's header and a footer. */
const BODY_HEIGHT = 680;

const LOCALES: readonly Locale[] = ['en', 'ar'];
const drawingOf = (locale: Locale): Drawing => (locale === 'en' ? ENGLISH : ARABIC);
const say = (key: string, locale: Locale) => phrase(key, 'initial', locale);

function inputOf(content: QeegContent, locale: Locale = 'en', signed = true): ReportInput {
  return { content, locale, facts: factsFor(content, { signed }) };
}

function build(content: QeegContent, locale: Locale = 'en', signed = true): Part[] {
  return buildQeegReport(inputOf(content, locale, signed), drawingOf(locale), BODY_HEIGHT);
}

const idsOf = (parts: readonly Part[]) => parts.map((part) => part.id);
const partOf = (parts: readonly Part[], id: string): Part => {
  const found = parts.find((part) => part.id === id);
  if (!found) throw new Error(`No part ${id}.`);
  return found;
};

/** Every word a list of parts draws at the body's width, one string. */
function wordsDrawn(parts: readonly Part[], drawing: Drawing): string {
  return parts.map((part) => across(part.at(BODY_WIDTH).ops, drawing.measure)).join(' ');
}

/** The first words of a fixed sentence, with its bold marks taken out. */
function openingOf(key: string, locale: Locale, count = 4): string {
  return say(key, locale).replaceAll('**', '').split(' ').slice(0, count).join(' ');
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

describe('the parts of a first report', () => {
  it('come section by section, in the order of the practice report', () => {
    for (const make of Object.values(CASES)) {
      const order = build(make()).map((part) => SECTIONS.indexOf(part.section));
      expect(order).toEqual([...order].sort((one, other) => one - other));
    }
  });

  it('hold every section but the maps in a report with no map', () => {
    const sections = new Set(build(sparseReport()).map((part) => part.section));
    expect([...sections]).toEqual(
      SECTIONS.filter((section) => section !== 'maps' && section !== 'change'),
    );
  });

  it('are set out as the practice report sets them, part by part', () => {
    expect(idsOf(build(fullReport()))).toEqual([
      'client',
      'overview.heading',
      'overview.text',
      'findings.heading',
      'findings.lead',
      'findings.list',
      'focus.heading',
      'focus.lead',
      'focus.list',
      'map.0',
      'map.1',
      'brain.heading',
      ...BAND_IDS.map((band) => `band.${band}`),
      ...CONNECTIVITY_IDS.map((id) => `connectivity.${id}`),
      'dashboard.heading',
      'dashboard.note',
      'dashboard.grid',
      'recommendations.heading',
      'recommendations.lead',
      'recommendation.1',
      'recommendation.2',
      'recommendation.3',
      'recommendation.4',
      'summary.heading',
      'summary.1',
      'summary.2',
      'benefits.heading',
      'benefits.list',
      'programme.heading',
      'programme.text',
      'programme.length',
      'programme.sessions',
      'approach.heading',
      'approach.text',
      'approach.line',
      'closing.monitoring',
      'closing.gradual',
      'final.note',
      'final.standing',
      'signature',
    ]);
  });

  it('start a page at each map, the bands, the dashboard, the recommendations and the programme', () => {
    const starting = build(fullReport())
      .filter((part) => part.newPage)
      .map((part) => part.id);
    expect(starting).toEqual([
      'map.0',
      'map.1',
      'brain.heading',
      'dashboard.heading',
      'recommendations.heading',
      'programme.heading',
    ]);
  });

  it('keep every heading and every lead with what follows it', () => {
    const parts = build(fullReport());
    for (const id of [
      'overview.heading',
      'findings.heading',
      'findings.lead',
      'focus.heading',
      'focus.lead',
      'brain.heading',
      'dashboard.heading',
      'dashboard.note',
      'recommendations.heading',
      'recommendations.lead',
      'summary.heading',
      'benefits.heading',
      'programme.heading',
      'programme.length',
      'approach.heading',
      'approach.text',
    ]) {
      expect(partOf(parts, id).keep, id).toBe(true);
    }
    expect(partOf(parts, 'findings.list').keep).toBe(false);
  });

  it('pin the signature to the foot, with the standing sentences kept beside it', () => {
    const parts = build(fullReport());
    const signature = partOf(parts, 'signature');
    expect(signature.pinBottom).toBe(true);
    expect(signature.marginTop).toBe(GAP.beforeSignature);
    expect(partOf(parts, 'final.standing').keep).toBe(true);
    expect(parts.filter((part) => part.pinBottom).map((part) => part.id)).toEqual(['signature']);
  });

  it('fit the dashboard, and nothing else, to its page', () => {
    const parts = build(fullReport());
    expect(parts.filter((part) => part.fit).map((part) => part.id)).toEqual(['dashboard.grid']);
  });

  it('share the spare room of a page before each section, and before the connectivity', () => {
    const parts = build(fullReport());
    expect(parts.filter((part) => part.gapBefore).map((part) => part.id)).toEqual([
      'connectivity.connectivity',
    ]);
    for (const id of [
      'overview.heading',
      'findings.heading',
      'focus.heading',
      'programme.length',
      'approach.heading',
      'closing.monitoring',
      'final.note',
    ]) {
      expect(partOf(parts, id).sectionStart, id).toBe(true);
    }
  });

  it('draw the dashboard note up towards its heading', () => {
    expect(partOf(build(fullReport()), 'dashboard.note').marginTop).toBe(-GAP.noteRaisedBy);
  });

  it('give each part its height at the width of the page body', () => {
    for (const part of build(fullReport())) {
      const block = part.at(BODY_WIDTH);
      expect(part.height, part.id).toBe(block.height + block.overhang);
    }
  });

  it('never end an id in a slash and a number, and never use one twice', () => {
    for (const make of Object.values(CASES)) {
      const ids = idsOf(build(make()));
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.filter((id) => /\/[0-9]+$/.test(id))).toEqual([]);
    }
  });

  it('change nothing they are given', () => {
    const content = deepFreeze(fullReport());
    const facts = deepFreeze(factsFor(content));
    expect(() =>
      buildQeegReport({ content, locale: 'ar', facts }, ARABIC, BODY_HEIGHT),
    ).not.toThrow();
  });
});

describe('the words of each part', () => {
  it('head the report with the client, the recording and the reference', () => {
    for (const locale of LOCALES) {
      const words = wordsDrawn([partOf(build(fullReport(), locale), 'client')], drawingOf(locale));
      expect(words).toContain(locale === 'en' ? CLIENT_NAME.en : CLIENT_NAME.ar);
      expect(words).toContain('14/09/2026');
      expect(words).toContain('RPT-000042');
      expect(words).toContain(say('value.stage.initial', locale).split(' ')[0]);
      expect(words).toContain(WORDS.reference[locale].split(' ')[0]);
    }
  });

  it('leave the reference out of a preview, which has none yet', () => {
    const words = wordsDrawn([partOf(build(fullReport(), 'en', false), 'client')], ENGLISH);
    expect(words).not.toContain(WORDS.reference.en);
    expect(words).not.toContain(WORDS.dateOfIssue.en);
  });

  it('list what was ticked in the order of the list, then what she added', () => {
    const content: QeegInitial = {
      ...fullReport(),
      findings: { chosen: ['sleep_dysregulation', 'mental_fatigue'], custom: {} },
    };
    const words = wordsDrawn([partOf(build(content), 'findings.list')], ENGLISH);
    expect(words.indexOf(say('finding.mental_fatigue', 'en'))).toBeLessThan(
      words.indexOf(say('finding.sleep_dysregulation', 'en')),
    );
  });

  it('say that nothing was chosen where a list is empty', () => {
    const parts = build(sparseReport());
    for (const id of ['findings.list', 'focus.list', 'recommendations.none', 'benefits.list']) {
      expect(wordsDrawn([partOf(parts, id)], ENGLISH), id).toBe(say('text.none_selected', 'en'));
    }
  });

  it('number the recommendations from one, hers after the list', () => {
    const parts = build(fullReport());
    const first = wordsDrawn([partOf(parts, 'recommendation.1')], ENGLISH);
    expect(first).toContain('01');
    expect(first).toContain(say('recommendation.mental_energy.name', 'en'));
    expect(wordsDrawn([partOf(parts, 'recommendation.4')], ENGLISH)).toContain(
      'Screen-free evenings',
    );
  });

  it('set the summary one part to a paragraph, and a dash where there is none', () => {
    expect(build(longReport()).filter((part) => part.section === 'summary')).toHaveLength(7);
    const empty = build(sparseReport()).filter((part) => part.section === 'summary');
    expect(idsOf(empty)).toEqual(['summary.heading', 'summary.none']);
    expect(wordsDrawn([partOf(empty, 'summary.none')], ENGLISH)).toBe('—');
  });

  it('let a list longer than its room be cut between its items, each part a list of its own', () => {
    const list = partOf(build(longReport()), 'findings.list').at(BODY_WIDTH);
    const cut = list.split?.(list.height / 2);
    expect(cut).not.toBeNull();
    const [first, second] = cut ?? [];
    expect((first?.height ?? 0) + (first?.overhang ?? 0)).toBeLessThanOrEqual(list.height / 2);
    const words = (block: typeof list | undefined) =>
      block ? across(block.ops, ENGLISH.measure) : '';
    expect(words(first)).toContain(say('finding.brainwave_dysregulation', 'en'));
    expect(words(second)).toContain('Item 12.');
    expect(words(first)).not.toContain('Item 12.');
  });

  it('cut a list nowhere when not even its first item stands in the room', () => {
    const list = partOf(build(fullReport()), 'findings.list').at(BODY_WIDTH);
    expect(list.split?.(1)).toBeNull();
  });

  it('let a summary paragraph be cut between its lines', () => {
    const paragraph = partOf(build(longReport()), 'summary.1').at(BODY_WIDTH);
    expect(paragraph.split?.(paragraph.height / 2)).not.toBeNull();
  });

  it('print her Arabic summary on an Arabic page', () => {
    const words = wordsDrawn([partOf(build(fullReport(), 'ar'), 'summary.1')], ARABIC);
    expect(words).toContain('مقدمة الرأس');
  });

  it('put the number of sessions in the pill, in the words of the report', () => {
    for (const locale of LOCALES) {
      const words = wordsDrawn(
        [partOf(build(fullReport(), locale), 'programme.sessions')],
        drawingOf(locale),
      );
      for (const word of sessionLabel(20, locale).split(' ')) expect(words).toContain(word);
    }
  });

  it('close with the agreement’s own sentences, word for word', () => {
    for (const locale of LOCALES) {
      const words = wordsDrawn(
        [partOf(build(fullReport(), locale), 'final.standing')],
        drawingOf(locale),
      );
      const squeezed = (text: string) => text.replace(/\s+/g, '');
      expect(squeezed(words).length).toBe(
        squeezed(STANDING_SENTENCES.map((sentence) => sentence[locale]).join('')).length,
      );
    }
  });

  it('sign with the signer’s name, certification, body and number', () => {
    const facts = factsFor(fullReport());
    const words = wordsDrawn([partOf(build(fullReport()), 'signature')], ENGLISH);
    expect(words).toContain(WORDS.signedBy.en);
    expect(words).toContain(facts.signer?.name ?? '');
    expect(words).toContain(facts.signer?.certification ?? '');
    expect(words).toContain(facts.signer?.certifyingBody ?? '');
    expect(words).toContain(facts.signer?.certificateNumber ?? '');
  });

  it('leave the signer out of a preview, and keep the room and the label', () => {
    const signature = partOf(build(fullReport(), 'en', false), 'signature');
    expect(wordsDrawn([signature], ENGLISH)).toBe(WORDS.signedBy.en);
    expect(signature.at(BODY_WIDTH).ops.some((op) => op.kind === 'rule')).toBe(true);
  });

  it('leave no gap of the wording unfilled and no bold mark showing', () => {
    for (const make of Object.values(CASES)) {
      for (const locale of LOCALES) {
        const words = wordsDrawn(build(make(), locale), drawingOf(locale));
        expect(words).not.toMatch(/[{}]/);
        expect(words).not.toContain('**');
      }
    }
  });
});

describe('the brain maps', () => {
  it('give each map a page of its own, in the order she placed them', () => {
    const parts = build(longReport()).filter((part) => part.section === 'maps');
    expect(idsOf(parts)).toEqual(Array.from({ length: 8 }, (_, place) => `map.${place}`));
    expect(parts.every((part) => part.newPage)).toBe(true);
  });

  it('draw each map as the picture it names, as large as the page allows', () => {
    const map = partOf(build(fullReport()), 'map.0').at(BODY_WIDTH);
    const image = map.ops.find((op) => op.kind === 'image');
    expect(image?.kind === 'image' && image.image).toBe(mapImageKey(figureIdOf(0)));
    expect(map.height).toBeLessThanOrEqual(BODY_HEIGHT - MAP.reserve);
  });

  it('label a map by its caption, else by its eyes, in the words of the report', () => {
    const plain = wordsDrawn([partOf(build(fullReport()), 'map.0')], ENGLISH);
    expect(plain).toBe(say('map.eyes_closed', 'en'));
    const captioned = wordsDrawn([partOf(build(longReport()), 'map.1')], ENGLISH);
    expect(captioned).toContain('Map 2');
  });

  it('refuse a map whose picture was not handed over, by its place', () => {
    const content = fullReport();
    const facts = { ...factsFor(content), pictures: {} };
    expect(() => buildQeegReport({ content, locale: 'en', facts }, ENGLISH, BODY_HEIGHT)).toThrow(
      /buildQeegReport was given no picture for the map at place 1/,
    );
  });

  it('refuse a picture of another size than its map records', () => {
    const content = fullReport();
    const facts = {
      ...factsFor(content),
      pictures: {
        [figureIdOf(0)]: pictureOf({ width: 10, height: 10 }),
        [figureIdOf(1)]: pictureOf(),
      },
    };
    expect(() => buildQeegReport({ content, locale: 'en', facts }, ENGLISH, BODY_HEIGHT)).toThrow(
      /buildQeegReport was given a picture 10 by 10 for a map of 1600 by 1200/,
    );
  });
});

describe('a brain map with no programme after it', () => {
  it('lists what it leaves out in one place', () => {
    expect(LEFT_OUT_WITHOUT_PROGRAMME).toEqual([
      'programme.length',
      'programme.sessions',
      'approach.heading',
      'approach.text',
      'approach.line',
    ]);
  });

  it('leaves out exactly those parts', () => {
    const full = idsOf(build(fullReport()));
    const only = idsOf(build(qeegOnlyReport()));
    expect(only).toEqual(full.filter((id) => !LEFT_OUT_WITHOUT_PROGRAMME.includes(id)));
  });

  it('draws none of the words it leaves out, in either language', () => {
    for (const locale of LOCALES) {
      const words = wordsDrawn(build(qeegOnlyReport(), locale), drawingOf(locale));
      expect(words).not.toContain(openingOf('text.programme_length', locale));
      expect(words).not.toContain(say('heading.approach', locale));
      expect(words).not.toContain(openingOf('text.approach', locale));
      expect(words).not.toContain(say('label.qeeg_only', locale));
    }
    expect(wordsDrawn(build(qeegOnlyReport()), ENGLISH)).not.toMatch(/[0-9]+ Sessions?/);
  });

  it('still draws its heading, the closing paragraphs, the final note and the signature', () => {
    for (const locale of LOCALES) {
      const words = wordsDrawn(build(qeegOnlyReport(), locale), drawingOf(locale));
      expect(words).toContain(say('heading.programme', locale));
      expect(words).toContain(openingOf('text.monitoring', locale));
      expect(words).toContain(openingOf('text.gradual', locale));
      expect(words).toContain(openingOf('text.final_note', locale, 2));
      expect(words).toContain(WORDS.signedBy[locale]);
    }
  });

  it('draws them all when a programme was agreed', () => {
    for (const locale of LOCALES) {
      const words = wordsDrawn(build(fullReport(), locale), drawingOf(locale));
      expect(words).toContain(openingOf('text.programme_length', locale));
      expect(words).toContain(say('heading.approach', locale));
      expect(words).toContain(openingOf('text.approach', locale));
    }
  });
});

describe('the frame of every page', () => {
  it('counts the pages in the words of the report', () => {
    expect(footerOf(inputOf(fullReport())).page(2, 9)).toBe('Page 2 of 9');
    expect(footerOf(inputOf(fullReport(), 'ar')).page(2, 9)).toBe('صفحة 2 من 9');
  });

  it('names the practice and how to reach it at the foot', () => {
    const facts = factsFor(fullReport());
    const lines = footerOf(inputOf(fullReport()))
      .lines.map((line) => line.text)
      .join(' ');
    expect(lines).toContain(facts.practice.name);
    expect(lines).toContain(facts.practice.phone ?? '');
    expect(lines).toContain(facts.practice.email ?? '');
  });

  it('titles the file in English, with its reference once it has one', () => {
    expect(titleOf(inputOf(fullReport(), 'ar'))).toBe('Initial QEEG RPT-000042');
    expect(titleOf(inputOf(fullReport(), 'en', false))).toBe('Initial QEEG');
  });

  it('asks the wording for its frame in the edition the content carries', () => {
    expect(titleOf(inputOf(fullFollowUp(), 'ar'))).toBe('Follow-up QEEG RPT-000042');
    expect(footerOf(inputOf(fullFollowUp(), 'ar')).page(2, 9)).toBe('صفحة 2 من 9');
    const source = BUILD_SOURCE.slice(BUILD_SOURCE.indexOf('export function footerOf'));
    const frame = source.slice(0, source.indexOf('/** The shape a score'));
    expect(frame).not.toContain("'initial'");
    // The sentences both editions share are asked for as shared, never as a first report's.
    expect(SENTENCES_SOURCE).not.toMatch(/phrase\([^)]*'initial'/);
    expect(BUILD_SOURCE.length).toBeGreaterThan(0);
  });
});

describe('a follow-up', () => {
  const later = (key: string, locale: Locale) => phrase(key, 'follow-up', locale);
  const changeIds = (parts: readonly Part[]) =>
    parts.filter((part) => part.section === 'change').map((part) => part.id);
  /** The triangles a list of parts draws: every path filled with the ink. */
  const markersIn = (parts: readonly Part[]): LayoutOp[] =>
    parts.flatMap((part) =>
      part.at(BODY_WIDTH).ops.filter((op) => op.kind === 'path' && op.fill === INK),
    );

  it('keeps the first report’s order, with the page of what has changed after the maps', () => {
    const ids = idsOf(build(fullFollowUp()));
    const initial = idsOf(build(fullReport()));
    expect(ids.filter((id) => !id.startsWith('change.') && id !== 'summary.lead')).toEqual(initial);
    expect(ids.indexOf('change.heading')).toBe(ids.indexOf('map.1') + 1);
    expect(ids.indexOf('brain.heading')).toBe(ids.indexOf('change.note') + 1);
    expect(ids.indexOf('summary.lead')).toBe(ids.indexOf('summary.heading') + 1);
  });

  it('sets out its page of what has changed as section 10 lists it', () => {
    expect(changeIds(build(fullFollowUp()))).toEqual([
      'change.heading',
      'change.headlines',
      'change.pairs.heading',
      'change.pair.eyes_closed',
      'change.pair.eyes_open',
      'change.table.heading',
      'change.table.head',
      'change.row.delta',
      'change.row.theta',
      'change.row.alpha',
      'change.row.beta_2',
      'change.comparison',
      'change.summary.heading',
      'change.summary.1',
      'change.summary.2',
      'change.note',
    ]);
  });

  it('starts its page of what has changed on a page of its own', () => {
    const parts = build(fullFollowUp());
    expect(partOf(parts, 'change.heading').newPage).toBe(true);
    expect(parts.filter((part) => part.section === 'change' && part.newPage)).toHaveLength(1);
  });

  it('keeps each heading of the page with what follows it, and the table’s head with two rows', () => {
    const parts = build(fullFollowUp());
    for (const id of [
      'change.heading',
      'change.pairs.heading',
      'change.table.heading',
      'change.table.head',
      'change.row.delta',
      'change.summary.heading',
    ]) {
      expect(partOf(parts, id).keep, id).toBe(true);
    }
    for (const id of ['change.row.theta', 'change.row.beta_2', 'change.pair.eyes_open']) {
      expect(partOf(parts, id).keep, id).toBe(false);
    }
    const one: QeegFollowUp = {
      ...fullFollowUp(),
      change: {
        ...fullFollowUp().change,
        table: { theta: { position: 0, eyesOpen: NO_CHANGE, eyesClosed: null } },
      },
    };
    const single = build(one);
    expect(partOf(single, 'change.table.head').keep).toBe(true);
    expect(partOf(single, 'change.row.theta').keep).toBe(false);
  });

  it('never lets a pair, the headlines or a row of the table be cut', () => {
    const parts = build(longFollowUp()).filter(
      (part) =>
        part.id.startsWith('change.pair.') ||
        part.id.startsWith('change.row.') ||
        part.id === 'change.headlines',
    );
    expect(parts.length).toBeGreaterThan(10);
    for (const part of parts) expect(part.at(BODY_WIDTH).split, part.id).toBeUndefined();
  });

  it('speaks in a follow-up’s own words, in both languages', () => {
    for (const locale of LOCALES) {
      const words = wordsDrawn(build(fullFollowUp(), locale), drawingOf(locale));
      expect(words).toContain(later('heading.approach', locale));
      expect(words).not.toContain(say('heading.approach', locale));
      expect(words).toContain(later('next.continue_calming.label', locale));
      expect(words).toContain(later('heading.change', locale));
      expect(words).toContain(later('term.earlier.initial', locale).split(' ')[0]);
      expect(words).toContain(later('change.band.improved.sentence', locale).split('**')[0]);
    }
  });

  it('says what it is compared with at its head: the earlier report, its day and its reference', () => {
    for (const locale of LOCALES) {
      const words = wordsDrawn(
        [partOf(build(fullFollowUp(), locale), 'client')],
        drawingOf(locale),
      );
      expect(words).toContain(later('label.compared_with', locale).split(' ')[0]);
      expect(words).toContain('10/06/2026');
      expect(words).toContain('RPT-000041');
    }
    // Set as the other values of the column are, with a capital.
    expect(wordsDrawn([partOf(build(fullFollowUp()), 'client')], ENGLISH)).toContain(
      'Initial QEEG, 10/06/2026, RPT-000041',
    );
    const previous: QeegFollowUp = {
      ...fullFollowUp(),
      comparedWith: { ...COMPARED_WITH, relation: 'previous' },
    };
    expect(wordsDrawn([partOf(build(previous), 'client')], ENGLISH)).toContain('Previous QEEG,');
    const imported: QeegFollowUp = {
      ...fullFollowUp(),
      comparedWith: { ...COMPARED_WITH, origin: 'imported', reference: null },
    };
    const parts = build(imported);
    expect(wordsDrawn([partOf(parts, 'client')], ENGLISH)).not.toContain('RPT-000041');
    expect(wordsDrawn([partOf(parts, 'change.earlier')], ENGLISH)).toBe(
      later('note.earlier_imported', 'en'),
    );
  });

  it('opens its summary with the practice’s paragraph, above hers, every time', () => {
    for (const make of [fullFollowUp, sparseFollowUp]) {
      const parts = build(make()).filter((part) => part.section === 'summary');
      expect(parts[1]?.id).toBe('summary.lead');
      expect(wordsDrawn([parts[1] as Part], ENGLISH)).toContain('The follow-up QEEG demonstrates');
    }
    expect(idsOf(build(sparseFollowUp()))).not.toContain('summary.none');
  });

  it('shows the earlier score beside each score that has one, marked only when it moved', () => {
    const content = fullFollowUp();
    const grid = partOf(build(content), 'dashboard.grid');
    const words = wordsDrawn([grid], ENGLISH);
    for (const earlier of [3, 5, 8, 2, 10]) expect(words).toContain(`was ${earlier}`);
    const moved = Object.values(content.dashboard).filter(
      ({ score, earlierScore }) =>
        score !== null &&
        earlierScore !== null &&
        classifyScoreChange(earlierScore, score) !== 'steady',
    );
    expect(moved).toHaveLength(4);
    expect(markersIn([grid])).toHaveLength(moved.length);
    // A first report's dashboard has no earlier score and no marker.
    expect(markersIn([partOf(build(fullReport()), 'dashboard.grid')])).toEqual([]);
  });

  it('prints her headlines, and the sessions completed with where the number came from', () => {
    for (const locale of LOCALES) {
      const words = wordsDrawn(
        [partOf(build(fullFollowUp(), locale), 'change.headlines')],
        drawingOf(locale),
      );
      expect(words).toContain('40%');
      expect(words).toContain('20');
      expect(words).toContain(later('tile.sessions_completed', locale).split(' ')[0]);
      expect(words).toContain(later('tile.sessions.gathered', locale).split(' ')[0]);
    }
    const typedCount: QeegFollowUp = {
      ...fullFollowUp(),
      change: { ...fullFollowUp().change, sessionsCompleted: { count: 12, source: 'typed' } },
    };
    expect(wordsDrawn([partOf(build(typedCount), 'change.headlines')], ENGLISH)).toContain(
      later('tile.sessions.typed', 'en'),
    );
  });

  it('writes a figure in words, about and a range included, and no appreciable change as such', () => {
    const parts = build(fullFollowUp());
    const delta = wordsDrawn([partOf(parts, 'change.row.delta')], ENGLISH);
    expect(delta).toContain('Delta, 1–4 Hz');
    expect(delta).toContain('about 25–30% lower');
    expect(delta).toContain('about 40% lower');
    expect(wordsDrawn([partOf(parts, 'change.row.theta')], ENGLISH)).toContain(
      'No appreciable change',
    );
    expect(wordsDrawn([partOf(parts, 'change.headlines')], ENGLISH)).toMatch(
      // A tile is narrow, and its figure may wrap before its last word.
      /about 15–20% higher|about 15–20%\n?.*higher/,
    );
  });

  it('marks every figure that moved with a triangle in the ink, and none that held, never in words', () => {
    for (const locale of LOCALES) {
      const parts = build(fullFollowUp(), locale).filter((part) => part.section === 'change');
      // Two headlines, and five figures of the table that rose or fell.
      expect(markersIn(parts)).toHaveLength(7);
      for (const op of markersIn(parts)) {
        expect(op.kind === 'path' && op.segments).toHaveLength(4);
      }
      expect(wordsDrawn(parts, drawingOf(locale))).not.toMatch(/[▲▼△▽↑↓≈]/);
    }
    const held = picturesOnlyFollowUp();
    expect(markersIn(build(held).filter((part) => part.section === 'change'))).toEqual([]);
  });

  it('labels each map of a pair by its recording, its eyes and its day, the earlier first', () => {
    for (const locale of LOCALES) {
      const words = wordsDrawn(
        [partOf(build(fullFollowUp(), locale), 'change.pair.eyes_closed')],
        drawingOf(locale),
      );
      expect(words).toContain(later('pair.earlier.initial', locale).split(' ')[0]);
      expect(words).toContain(later('pair.later', locale).split(' ')[0]);
      expect(words).toContain('10/06/2026');
      expect(words).toContain('14/09/2026');
    }
    const images = partOf(build(fullFollowUp()), 'change.pair.eyes_closed')
      .at(BODY_WIDTH)
      .ops.flatMap((op) => (op.kind === 'image' ? [op.image] : []));
    expect(images).toEqual([mapImageKey(earlierFigureOf(0).figureId), mapImageKey(figureIdOf(0))]);
  });

  it('draws the maps of a pair between the least and the preferred height', () => {
    for (const make of [fullFollowUp, longFollowUp]) {
      const pair = partOf(build(make()), 'change.pair.eyes_open').at(BODY_WIDTH);
      for (const op of pair.ops) {
        if (op.kind !== 'image') continue;
        expect(op.height).toBeLessThanOrEqual(CHANGE.mapPreferred + 1e-9);
      }
    }
  });

  it('prints the words for a map not recorded, and leaves out a pair with neither map', () => {
    const content = fullFollowUp();
    const oneSided: QeegFollowUp = {
      ...content,
      change: {
        ...content.change,
        pairs: {
          eyes_closed: { earlier: null, later: content.change.pairs.eyes_closed.later },
          eyes_open: { earlier: null, later: null },
        },
      },
    };
    const parts = build(oneSided);
    expect(wordsDrawn([partOf(parts, 'change.pair.eyes_closed')], ENGLISH)).toContain(
      later('pair.not_recorded', 'en'),
    );
    expect(idsOf(parts)).not.toContain('change.pair.eyes_open');
  });

  it('works with pictures and words alone: no headline, no table, no note', () => {
    expect(changeIds(build(picturesOnlyFollowUp()))).toEqual([
      'change.heading',
      'change.pairs.heading',
      'change.pair.eyes_closed',
      'change.pair.eyes_open',
      'change.comparison',
      'change.summary.heading',
      'change.summary.1',
      'change.summary.2',
    ]);
  });

  it('leaves out a row with no figure, and a headline she left empty', () => {
    const content = fullFollowUp();
    const empty: QeegFollowUp = {
      ...content,
      change: {
        ...content.change,
        tiles: {},
        sessionsCompleted: null,
        table: {
          ...content.change.table,
          delta: { position: 0, eyesOpen: null, eyesClosed: null },
        },
      },
    };
    const ids = changeIds(build(empty));
    expect(ids).not.toContain('change.row.delta');
    expect(ids).not.toContain('change.headlines');
    expect(ids).toContain('change.row.theta');
  });

  it('prints the comparison’s own sentence beneath the figures, word for word, in both languages', () => {
    // docs/SPEC/reports-qeeg.md section 10, point 8, and docs/SPEC/assessment.md
    // section 3.3: on every comparison, and so on a page of pictures alone too.
    const squeezed = (text: string) => text.replace(/\s+/g, '');
    for (const make of [fullFollowUp, picturesOnlyFollowUp, longFollowUp]) {
      for (const locale of LOCALES) {
        const parts = build(make(), locale);
        const words = wordsDrawn([partOf(parts, 'change.comparison')], drawingOf(locale));
        expect(squeezed(words).length).toBe(squeezed(COMPARISON_SENTENCE[locale]).length);
        const ids = idsOf(parts);
        const at = ids.indexOf('change.comparison');
        const figures = ids.filter((id) => /^change\.(row\.|pair\.|headlines)/.test(id));
        for (const id of figures) expect(ids.indexOf(id), id).toBeLessThan(at);
        if (ids.includes('change.summary.heading')) {
          expect(at).toBeLessThan(ids.indexOf('change.summary.heading'));
        }
      }
    }
  });

  it('prints no comparison sentence where nothing is compared', () => {
    expect(idsOf(build(sparseFollowUp()))).not.toContain('change.comparison');
    // The sessions completed are a count, and compare nothing.
    const sessionsOnly: QeegFollowUp = {
      ...sparseFollowUp(),
      change: { ...sparseFollowUp().change, sessionsCompleted: { count: 20, source: 'gathered' } },
    };
    const ids = idsOf(build(sessionsOnly));
    expect(ids).toContain('change.headlines');
    expect(ids).not.toContain('change.comparison');
    for (const make of Object.values(CASES)) {
      const content = make();
      if (content.edition === 'initial') {
        expect(idsOf(build(content))).not.toContain('change.comparison');
      }
    }
  });

  it('heads her summary of what has changed apart from the report’s own summary', () => {
    for (const locale of LOCALES) {
      const parts = build(fullFollowUp(), locale);
      const own = wordsDrawn([partOf(parts, 'change.summary.heading')], drawingOf(locale));
      expect(own).toBe(later('heading.change_summary', locale));
      expect(own).not.toBe(wordsDrawn([partOf(parts, 'summary.heading')], drawingOf(locale)));
    }
    expect(() => phrase('heading.change_summary', 'initial', 'en')).toThrow();
  });

  it('carries in its fixture a summary of its own, as a practitioner writes a follow-up’s', () => {
    for (const locale of ['en', 'ar'] as const) {
      const own = fullFollowUp().summary[locale]?.text ?? '';
      expect(own).not.toBe(fullReport().summary[locale]?.text);
      expect(own.split('\n')).toHaveLength(2);
    }
    expect(fullFollowUp().summary.en.text).toContain('since June');
  });

  it('prints its heading and a dash when nothing of the page is filled in yet', () => {
    const parts = build(sparseFollowUp());
    expect(changeIds(parts)).toEqual(['change.heading', 'change.none']);
    expect(wordsDrawn([partOf(parts, 'change.none')], ENGLISH)).toBe('—');
  });

  describe('where its figures came from', () => {
    // docs/SPEC/reports-qeeg.md section 10, points 2 and 4: a page of typed
    // figures says they are her estimates; a page of calculated figures says
    // what they were calculated from; the practitioner never chooses.
    const DAYS = { earlierOn: '2026-06-09', laterOn: '2026-09-13' };
    const calculated = (figure: ReturnType<typeof typedPercent>): CalculatedFigure => ({
      ...figure,
      source: 'calculated',
      basis: {
        earlierAssessmentId: '0000000a-0000-4000-8000-000000000001',
        laterAssessmentId: '0000000a-0000-4000-8000-000000000002',
        unit: 'uV2',
        sitesPaired: 19,
      },
    });
    const content = fullFollowUp();
    const onlyCalculated: QeegFollowUp = {
      ...content,
      change: {
        ...content.change,
        tiles: {},
        table: {
          delta: {
            position: 0,
            eyesOpen: calculated(typedPercent('decrease', 30)),
            eyesClosed: null,
          },
        },
      },
    };
    const mixed: QeegFollowUp = {
      ...onlyCalculated,
      change: {
        ...onlyCalculated.change,
        table: {
          ...onlyCalculated.change.table,
          theta: { position: 1, eyesOpen: typedPercent('increase', 10), eyesClosed: null },
        },
      },
    };
    const buildWith = (made: QeegFollowUp, locale: Locale) =>
      buildQeegReport(
        { content: made, locale, facts: { ...factsFor(made), calculatedFrom: DAYS } },
        drawingOf(locale),
        BODY_HEIGHT,
      );
    const wordsOfPart = (made: QeegFollowUp, locale: Locale, id: string) =>
      wordsDrawn([partOf(buildWith(made, locale), id)], drawingOf(locale));
    const opening = (key: string, locale: Locale) =>
      later(key, locale).split(' ').slice(0, 3).join(' ');

    it('prints the note that follows from the figures, in both languages', () => {
      for (const locale of LOCALES) {
        expect(wordsOfPart(content, locale, 'change.note')).toContain(
          opening('note.figures.typed', locale),
        );
        expect(wordsOfPart(onlyCalculated, locale, 'change.note')).toContain(
          opening('note.figures.calculated', locale),
        );
        expect(wordsOfPart(mixed, locale, 'change.note')).toContain(
          opening('note.figures.both', locale),
        );
        expect(idsOf(build(picturesOnlyFollowUp(), locale))).not.toContain('change.note');
      }
    });

    it('names by their days the two assessments calculated figures came from', () => {
      for (const locale of LOCALES) {
        for (const made of [onlyCalculated, mixed]) {
          const note = wordsOfPart(made, locale, 'change.note');
          expect(note).toContain('09/06/2026');
          expect(note).toContain('13/09/2026');
        }
        expect(wordsOfPart(content, locale, 'change.note')).not.toContain('09/06/2026');
      }
    });

    it('heads a table of estimates as estimated, and one with a calculated figure as not', () => {
      for (const locale of LOCALES) {
        const head = (made: QeegFollowUp) => wordsOfPart(made, locale, 'change.table.heading');
        expect(head(content)).toBe(later('heading.change_table', locale));
        expect(head(onlyCalculated)).toBe(later('heading.change_table.calculated', locale));
        expect(head(mixed)).toBe(later('heading.change_table.calculated', locale));
      }
    });

    it('refuses calculated figures handed over without the days they were calculated from', () => {
      expect(() =>
        buildQeegReport(
          { content: onlyCalculated, locale: 'en', facts: factsFor(onlyCalculated) },
          ENGLISH,
          BODY_HEIGHT,
        ),
      ).toThrow(
        /buildQeegReport was given calculated figures and not the days of the two assessments they were calculated from/,
      );
    });
  });

  it('keeps its programme: a follow-up has no brain-map-only choice', () => {
    const ids = idsOf(build(fullFollowUp()));
    for (const id of LEFT_OUT_WITHOUT_PROGRAMME) expect(ids, id).toContain(id);
    for (const locale of LOCALES) {
      const words = wordsDrawn(
        [partOf(build(fullFollowUp(), locale), 'programme.sessions')],
        drawingOf(locale),
      );
      for (const word of sessionLabel(20, locale).split(' ')) expect(words).toContain(word);
    }
  });

  it('refuses a pair whose picture was not handed over, by which map it is', () => {
    const content = fullFollowUp();
    const facts = factsFor(content);
    const pictures = { ...facts.pictures };
    delete pictures[earlierFigureOf(1).figureId];
    expect(() =>
      buildQeegReport(
        { content, locale: 'en', facts: { ...facts, pictures } },
        ENGLISH,
        BODY_HEIGHT,
      ),
    ).toThrow(/buildQeegReport was given no picture for the earlier map of the eyes open pair/);
  });

  it('changes nothing it is given', () => {
    const content = deepFreeze(longFollowUp());
    const facts = deepFreeze(factsFor(content));
    expect(() =>
      buildQeegReport({ content, locale: 'ar', facts }, ARABIC, BODY_HEIGHT),
    ).not.toThrow();
  });
});
