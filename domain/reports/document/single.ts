import { BAND_RGB } from '../../shared/bands';
import { mirrorPages, type FontSet, type Page } from '../../shared/document';
import type {
  PracticeSnapshot,
  ProgressReportContent,
  ReportDocument,
  ReportLocale,
  Ribbon,
  SessionReportContent,
  SignerSnapshot,
} from '../types';
import {
  arabicReportDate,
  COMPARISON_NOT_A_DIAGNOSIS,
  DRAFT_WORDING,
  folioWords,
  formatDifference,
  formatFigure,
  formatReportDate,
  GOAL_STATUS_WORDS,
  NOT_A_CLINIC,
  NOT_A_DIAGNOSIS,
  REFERENCE_BASIS,
  SEX_WORDS,
  WORDMARK,
  WORDING_IS_DRAFT,
  WORDS,
  type Phrase,
} from './strings';
import {
  GUTTER,
  INK,
  LEFT,
  LINE,
  MUTED,
  RIGHT,
  RULE,
  Sheet,
  SIZE,
  SMALL_LINE,
  VALUE,
  type TextOptions,
} from './sheet';

/**
 * A session or progress report in one language: the report's own locale
 * (the operator's decision of 15 October 2026, docs/SPEC/reports-v1.md
 * section 5).
 *
 * **One layout, read from either side.** Every block is laid out here left to
 * right, as the English page has always stood, in the words of the report's
 * language. An Arabic report is that page turned over on its centre line
 * (`mirrorPages`, domain/shared/document/mirror.ts): the labels end against
 * the right margin, the values end to their left, the ratings table's
 * question column stands on the right, and the ribbon's first session is its
 * rightmost slice, as a page read from the right expects.
 *
 * **Fixed words are the report's language and nothing else.** A label, a
 * heading, the standing sentences and the folio are the one half of each
 * pair in `strings.ts`; nothing here writes a word of its own. A value a
 * person typed is drawn as typed, in its own direction (`readsRightToLeft`),
 * so an English name on an Arabic page still reads left to right and an
 * Arabic goal on an English page still joins.
 *
 * **Reports issued before 15 October 2026** carry both languages and are
 * rendered by `render.ts` as they were filed (`ReportDocument.bilingual`), so
 * a lost file's re-render still matches the hash its row holds.
 *
 * Pure: no clock, no database, no live practice row.
 */

type Lang = ReportLocale;

/** Whether a value reads right to left: whether its first letter is Arabic (UAX 9, P2 and P3). */
function readsRightToLeft(text: string): boolean {
  for (const character of text) {
    if (/\p{L}/u.test(character)) return /\p{Script=Arabic}/u.test(character);
  }
  return false;
}

/**
 * Laid out left to right, so an Arabic line is anchored by its start (its
 * left edge here, its right edge once the page is turned). Every text op says
 * its alignment, because the writer's own default for a right-to-left line is
 * its end.
 */
function fixed(lang: Lang, options: TextOptions = {}): TextOptions {
  return lang === 'ar'
    ? { ...options, rtl: true, align: options.align ?? 'start' }
    : { ...options, align: options.align ?? 'start' };
}

/** A value as typed, in its own direction. */
function typed(text: string, options: TextOptions = {}): TextOptions {
  return readsRightToLeft(text)
    ? { ...options, rtl: true, align: options.align ?? 'start' }
    : { ...options, align: options.align ?? 'start' };
}

/** A date as the page's language writes it. */
function dateIn(lang: Lang, isoDate: string): string {
  return lang === 'ar' ? arabicReportDate(isoDate) : formatReportDate(isoDate);
}

/** The practice's legal name in the page's language, or the English one where it has no Arabic. */
function practiceName(lang: Lang, practice: PracticeSnapshot): string {
  return lang === 'ar' && practice.legalNameAr ? practice.legalNameAr : practice.legalName;
}

class ReportPage {
  readonly sheet: Sheet;
  readonly lang: Lang;

  constructor(document_: ReportDocument, fonts: FontSet) {
    this.lang = document_.locale;
    const practice = practiceName(this.lang, document_.practice);
    this.sheet = new Sheet(fonts, {
      practice,
      reference: document_.reference,
      single: {
        practiceRtl: readsRightToLeft(practice),
        folio: (page, of) => folioWords(page, of, this.lang),
        rtl: this.lang === 'ar',
      },
    });
  }

  say(phrase: Phrase): string {
    return phrase[this.lang];
  }

  /** A label against the margin and its value in the value column, on one line. */
  labelled(label: Phrase, value: string): void {
    if (value.length === 0) return;
    const sheet = this.sheet;
    const labelWidth = VALUE - LEFT - GUTTER;
    const valueWidth = RIGHT - VALUE;
    const labelOptions = fixed(this.lang, { grey: MUTED });
    const valueOptions = typed(value);
    const rows = Math.max(
      sheet.wrap(this.say(label), labelWidth, SIZE.body, labelOptions).length,
      sheet.wrap(value, valueWidth, SIZE.body, valueOptions).length,
    );
    sheet.room(rows * LINE);
    const y = sheet.baseline;
    sheet.paragraph(y, LEFT, this.say(label), labelWidth, SIZE.body, labelOptions);
    sheet.paragraph(y, VALUE, value, valueWidth, SIZE.body, valueOptions);
    sheet.down(rows * LINE);
  }

  section(title: Phrase): void {
    const sheet = this.sheet;
    sheet.room(LINE * 3);
    sheet.down(6);
    sheet.line(sheet.baseline, LEFT, this.say(title), SIZE.body, fixed(this.lang, { bold: true }));
    sheet.down(LINE - 3);
    sheet.rule();
    sheet.down(LINE);
  }

  /** A paragraph somebody wrote, across the measure, in its own direction. */
  paragraph(text: string, options: TextOptions = {}): void {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    const sheet = this.sheet;
    const settings = typed(trimmed, options);
    const lines = sheet.wrap(trimmed, RIGHT - LEFT, SIZE.body, settings).length;
    sheet.room(lines * LINE);
    sheet.paragraph(sheet.baseline, LEFT, trimmed, RIGHT - LEFT, SIZE.body, settings);
    sheet.down(lines * LINE);
  }

  heading(title: Phrase, practice: PracticeSnapshot): void {
    const sheet = this.sheet;
    sheet.text(LEFT, WORDMARK, SIZE.wordmark, { bold: true, align: 'start' });
    sheet.down(LINE + 4);
    sheet.text(LEFT, this.say(title), SIZE.heading, fixed(this.lang, { bold: true }));
    sheet.down(LINE);
    sheet.rule(0.45, 0.8);
    sheet.down(LINE + 2);

    const name = practiceName(this.lang, practice);
    const nameOptions = typed(name, { bold: true });
    const rows = sheet.wrap(name, RIGHT - LEFT, SIZE.body, nameOptions).length;
    sheet.room(rows * LINE);
    sheet.paragraph(sheet.baseline, LEFT, name, RIGHT - LEFT, SIZE.body, nameOptions);
    sheet.down(rows * LINE);
    // In Arabic, the practice's own Arabic where it has typed one (migration
    // 980), and the English where it has not.
    const arabic = this.lang === 'ar';
    const address = (arabic ? practice.addressAr : null) || practice.address;
    const authority =
      (arabic ? practice.licensingAuthorityAr : null) || practice.licensingAuthority;
    if (address) {
      const options = typed(address, { grey: MUTED });
      const lines = sheet.wrap(address, RIGHT - LEFT, SIZE.body, options).length;
      sheet.room(lines * LINE);
      sheet.paragraph(sheet.baseline, LEFT, address, RIGHT - LEFT, SIZE.body, options);
      sheet.down(lines * LINE);
    }
    if (practice.licenceNumber) this.labelled(WORDS.licenceNumber, practice.licenceNumber);
    if (authority) this.labelled(WORDS.licensingAuthority, authority);
    // And no tax number, ever (section 10, decision 4).
    sheet.down(4);
    sheet.rule();
    sheet.down(LINE + 2);
  }

  /** The reference, the date, the version and the household: the head of both kinds. */
  identity(document_: ReportDocument): void {
    this.labelled(WORDS.reference, document_.reference);
    this.labelled(WORDS.dateOfIssue, dateIn(this.lang, document_.issuedOn));
    if (document_.version > 1) {
      this.labelled(WORDS.version, String(document_.version));
      if (document_.amendmentReason) {
        this.labelled(WORDS.amendmentReason, document_.amendmentReason);
      }
    }
    this.labelled(WORDS.client, document_.recipient.name);
    this.labelled(WORDS.recordNumber, document_.recipient.recordNumber);
  }

  columnHeading(x: number, label: Phrase, align: 'start' | 'end'): void {
    this.sheet.line(
      this.sheet.baseline,
      x,
      this.say(label),
      SIZE.body,
      fixed(this.lang, { bold: true, align }),
    );
  }

  /** One fixed sentence, in the report's language, across the measure. */
  standingSentence(phrase: Phrase, bold = false): void {
    const sheet = this.sheet;
    const text = this.say(phrase);
    const options = fixed(this.lang, { grey: bold ? INK : MUTED, bold });
    const lines = sheet.wrap(text, RIGHT - LEFT, SIZE.small, options).length;
    sheet.room(lines * SMALL_LINE + 6);
    sheet.paragraph(sheet.baseline, LEFT, text, RIGHT - LEFT, SIZE.small, options, SMALL_LINE);
    sheet.down(lines * SMALL_LINE + 4);
  }

  signature(signer: SignerSnapshot): void {
    this.section(WORDS.signedBy);
    this.labelled(WORDS.practitioner, signer.name);
    this.labelled(WORDS.certification, signer.certification);
    if (signer.certifyingBody) this.labelled(WORDS.certifyingBody, signer.certifyingBody);
    if (signer.certificateNumber) {
      this.labelled(WORDS.certificateNumber, signer.certificateNumber);
    }
  }

  footer(): void {
    const sheet = this.sheet;
    sheet.room(LINE * 2);
    sheet.down(6);
    sheet.rule();
    sheet.down(LINE);
    if (WORDING_IS_DRAFT) this.standingSentence(DRAFT_WORDING, true);
    this.standingSentence(NOT_A_CLINIC);
    this.standingSentence(NOT_A_DIAGNOSIS);
    this.standingSentence(REFERENCE_BASIS);
  }

  /** The pages, turned over for an Arabic report. */
  finish(): Page[] {
    const pages = this.sheet.finish();
    return this.lang === 'ar' ? mirrorPages(pages) : pages;
  }
}

/** How tall the strip stands, and how wide a slice may grow — as `render.ts` draws it. */
const RIBBON = {
  height: 46,
  gap: 1.4,
  maxSliceWidth: 9,
  minSliceWidth: 1.2,
  floor: 0.12,
  emptyGrey: 0.86,
  markGrey: 0.3,
} as const;

/**
 * The cover figure (docs/DESIGN-BRIEF.md section 5), as `render.ts` draws it
 * and with its band hues; laid out from the left and turned with the page,
 * so an Arabic report's first session is its rightmost slice.
 */
function ribbonFigure(page: ReportPage, ribbon: Ribbon): void {
  const sheet = page.sheet;
  const total = ribbon.slices.length + ribbon.remaining;
  if (total === 0) return;

  page.section(WORDS.theProgramme);
  sheet.room(RIBBON.height + LINE * 3);
  const step = (RIGHT - LEFT) / total;
  const sliceWidth = Math.max(
    RIBBON.minSliceWidth,
    Math.min(RIBBON.maxSliceWidth, step - RIBBON.gap),
  );
  const floor = sheet.baseline - RIBBON.height;

  ribbon.slices.forEach((slice, at) => {
    const quality = slice.quality === null ? RIBBON.floor : Math.max(RIBBON.floor, slice.quality);
    const height = Math.max(0.6, quality * RIBBON.height);
    const x = LEFT + at * step;
    sheet.ruleAt(
      floor + height / 2,
      x,
      sliceWidth,
      height,
      INK,
      slice.band === null ? undefined : BAND_RGB[slice.band],
    );
    if (slice.mapMark) {
      sheet.ruleAt(floor + RIBBON.height / 2, x - RIBBON.gap, 0.5, RIBBON.height, RIBBON.markGrey);
    }
  });
  for (let at = 0; at < ribbon.remaining; at += 1) {
    const x = LEFT + (ribbon.slices.length + at) * step;
    sheet.ruleAt(floor + 0.6, x, sliceWidth, 1.2, RIBBON.emptyGrey);
  }

  sheet.down(RIBBON.height + 6);
  sheet.rule(RULE, 0.4);
  sheet.down(SMALL_LINE + 2);
  const legend = page.say(WORDS.ribbonLegend);
  const options = fixed(page.lang, { grey: MUTED });
  sheet.paragraph(sheet.baseline, LEFT, legend, RIGHT - LEFT, SIZE.small, options, SMALL_LINE);
  sheet.down(sheet.wrap(legend, RIGHT - LEFT, SIZE.small, options).length * SMALL_LINE);
}

/** Where a ratings row's three columns end — as `render.ts` sets them. */
const RATING = { question: LEFT, before: LEFT + 330, after: LEFT + 400 };
/** Where a comparison row's four columns end. */
const COMPARE = { measurement: LEFT, earlier: LEFT + 300, later: LEFT + 375, difference: RIGHT };

function sessionPage(document_: ReportDocument, content: SessionReportContent, fonts: FontSet) {
  const page = new ReportPage(document_, fonts);
  const sheet = page.sheet;
  const lang = page.lang;

  page.heading(WORDS.sessionReport, document_.practice);
  page.identity(document_);

  page.section(WORDS.visitDate);
  page.labelled(WORDS.visitDate, dateIn(lang, content.visitDate));
  page.labelled(
    WORDS.service,
    lang === 'ar' && content.serviceNameAr ? content.serviceNameAr : content.serviceName,
  );
  page.labelled(WORDS.practitioner, content.practitionerName);
  if (content.durationMinutes !== null) {
    page.labelled(WORDS.duration, `${content.durationMinutes} ${page.say(WORDS.minutes)}`);
  }
  if (content.goalArea) page.labelled(WORDS.goalArea, content.goalArea);

  if (content.ratings.length > 0) {
    page.section(WORDS.howItWent);
    const headings = (): void => {
      page.columnHeading(RATING.question, WORDS.question, 'start');
      page.columnHeading(RATING.before, WORDS.before, 'end');
      page.columnHeading(RATING.after, WORDS.after, 'end');
      sheet.down(LINE - 2);
      sheet.rule();
      sheet.down(LINE + 2);
    };
    headings();
    sheet.setContinuation(headings);
    const questionWidth = RATING.before - RATING.question - GUTTER * 3;
    for (const rating of content.ratings) {
      const label = lang === 'ar' && rating.labelAr ? rating.labelAr : rating.label;
      const options = typed(label);
      const rows = sheet.wrap(label, questionWidth, SIZE.body, options).length;
      sheet.room(rows * LINE);
      const y = sheet.baseline;
      sheet.paragraph(y, RATING.question, label, questionWidth, SIZE.body, options);
      const figure = (value: number | null): string => (value === null ? '' : String(value));
      sheet.line(y, RATING.before, figure(rating.before), SIZE.body, { align: 'end' });
      sheet.line(y, RATING.after, figure(rating.after), SIZE.body, { align: 'end' });
      sheet.down(rows * LINE);
    }
    sheet.setContinuation(null);
  }

  const noticed =
    content.observationChips.length > 0 ||
    content.tolerance !== null ||
    content.engagement !== null;
  if (noticed) {
    page.section(WORDS.whatWasNoticed);
    if (content.observationChips.length > 0) {
      page.paragraph(content.observationChips.join(lang === 'ar' ? '، ' : ', '));
    }
    if (content.tolerance !== null) page.labelled(WORDS.tolerance, `${content.tolerance} / 10`);
    if (content.engagement !== null) page.labelled(WORDS.engagement, `${content.engagement} / 10`);
  }

  if (content.note.trim().length > 0) {
    page.section(WORDS.practitionerNote);
    page.paragraph(content.note);
  }
  if (content.beforeNextVisit.trim().length > 0) {
    page.section(WORDS.beforeNextVisit);
    page.paragraph(content.beforeNextVisit);
  }

  page.signature(document_.signer);
  page.footer();
  return page.finish();
}

function progressPage(document_: ReportDocument, content: ProgressReportContent, fonts: FontSet) {
  const page = new ReportPage(document_, fonts);
  const sheet = page.sheet;
  const lang = page.lang;

  page.heading(WORDS.progressReport, document_.practice);
  page.identity(document_);
  page.labelled(
    WORDS.coverage,
    `${dateIn(lang, content.coverageFrom)} ${page.say(WORDS.to)} ${dateIn(lang, content.coverageTo)}`,
  );

  page.section(WORDS.sessions);
  page.labelled(WORDS.sessionsDelivered, String(content.sessionsDelivered));
  page.labelled(WORDS.sessionsEntitled, String(content.sessionsEntitled));

  ribbonFigure(page, content.ribbon);

  if (content.goals.length > 0) {
    page.section(WORDS.goals);
    for (const goal of content.goals) {
      sheet.room(LINE * 2);
      page.paragraph(goal.description, { bold: true });
      const status = GOAL_STATUS_WORDS[goal.status];
      page.labelled(WORDS.goalStatus, status ? page.say(status) : goal.status);
      page.paragraph(goal.movement);
      sheet.down(4);
    }
  }

  const comparison = content.comparison;
  if (comparison) {
    page.section(WORDS.brainMaps);
    page.labelled(WORDS.earlier, dateIn(lang, comparison.earlierOn));
    page.labelled(WORDS.later, dateIn(lang, comparison.laterOn));
    const sex = comparison.referenceSex === null ? null : SEX_WORDS[comparison.referenceSex];
    const parts = [
      comparison.referenceAgeYears === null
        ? null
        : `${comparison.referenceAgeYears} ${page.say(WORDS.years)}`,
      sex ? page.say(sex) : null,
    ].filter((part): part is string => part !== null);
    if (parts.length > 0) {
      // The age and sex the software's own comparison was made against
      // (docs/SPEC/assessment.md section 3.3).
      page.labelled(WORDS.comparedAgainst, parts.join(lang === 'ar' ? '، ' : ', '));
    }

    sheet.down(4);
    const headings = (): void => {
      page.columnHeading(COMPARE.measurement, WORDS.measurement, 'start');
      page.columnHeading(COMPARE.earlier, WORDS.earlier, 'end');
      page.columnHeading(COMPARE.later, WORDS.later, 'end');
      page.columnHeading(COMPARE.difference, WORDS.difference, 'end');
      sheet.down(LINE - 2);
      sheet.rule();
      sheet.down(LINE + 2);
    };
    headings();
    sheet.setContinuation(headings);
    const labelWidth = COMPARE.earlier - COMPARE.measurement - GUTTER * 3;
    for (const line of comparison.lines) {
      const label = lang === 'ar' && line.labelAr ? line.labelAr : line.label;
      const withUnit = `${label} (${line.unit})`;
      const options = typed(withUnit);
      const rows = sheet.wrap(withUnit, labelWidth, SIZE.body, options).length;
      sheet.room(rows * LINE);
      const y = sheet.baseline;
      sheet.paragraph(y, COMPARE.measurement, withUnit, labelWidth, SIZE.body, options);
      sheet.line(y, COMPARE.earlier, formatFigure(line.earlier), SIZE.body, { align: 'end' });
      sheet.line(y, COMPARE.later, formatFigure(line.later), SIZE.body, { align: 'end' });
      sheet.line(y, COMPARE.difference, formatDifference(line.difference), SIZE.body, {
        align: 'end',
      });
      sheet.down(rows * LINE);
    }
    sheet.setContinuation(null);
    sheet.down(4);
    page.standingSentence(COMPARISON_NOT_A_DIAGNOSIS);
  }

  if (content.summary.trim().length > 0) {
    page.section(WORDS.summary);
    page.paragraph(content.summary);
  }
  if (content.suggestion.trim().length > 0) {
    page.section(WORDS.suggestion);
    page.paragraph(content.suggestion);
  }

  page.signature(document_.signer);
  page.footer();
  return page.finish();
}

/** A report in its own language alone. */
export function singleLanguageLayout(document_: ReportDocument, fonts: FontSet): Page[] {
  return document_.content.kind === 'session'
    ? sessionPage(document_, document_.content, fonts)
    : progressPage(document_, document_.content, fonts);
}
