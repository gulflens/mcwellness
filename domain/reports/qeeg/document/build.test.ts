import { describe, expect, it } from 'vitest';
import { STANDING_SENTENCES, WORDS } from '../../document/strings';
import { BAND_IDS, CONNECTIVITY_IDS } from '../catalogue/ids';
import { sessionLabel } from '../sentences';
import {
  CASES,
  CLIENT_NAME,
  factsFor,
  figureIdOf,
  fullReport,
  longReport,
  pictureOf,
  qeegOnlyReport,
  sparseReport,
} from '../testing/reports';
import type { Locale, QeegInitial } from '../types';
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
import { BODY_WIDTH, GAP, MAP } from './geometry';
import { ARABIC, ENGLISH, across } from './pieces/checks';
import type { Drawing } from './typeset';

/**
 * docs/SPEC/reports-qeeg.md section 12: a first report's content, its
 * language and the facts it does not hold itself, turned into the blocks of
 * its pages, in the order of the practice's report.
 */

/** A body as tall as a page leaves under the practice's header and a footer. */
const BODY_HEIGHT = 680;

const LOCALES: readonly Locale[] = ['en', 'ar'];
const drawingOf = (locale: Locale): Drawing => (locale === 'en' ? ENGLISH : ARABIC);
const say = (key: string, locale: Locale) => phrase(key, 'initial', locale);

function inputOf(content: QeegInitial, locale: Locale = 'en', signed = true): ReportInput {
  return { content, locale, facts: factsFor(content, { signed }) };
}

function build(content: QeegInitial, locale: Locale = 'en', signed = true): Part[] {
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
    expect([...sections]).toEqual(SECTIONS.filter((section) => section !== 'maps'));
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
    expect(wordsDrawn([partOf(parts, 'recommendation.4')], ENGLISH)).toContain('Item 1.');
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
    expect(words).toContain('انتباه');
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
});
