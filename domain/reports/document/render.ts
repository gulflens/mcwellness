import type { Page, FontSet } from '../../shared/document';
import type {
  PracticeSnapshot,
  ProgressReportContent,
  ReportDocument,
  Ribbon,
  SessionReportContent,
  SignerSnapshot,
} from '../types';
import {
  arabicReportDate,
  DRAFT_WORDING,
  formatDifference,
  formatFigure,
  formatReportDate,
  NOT_A_CLINIC,
  NOT_A_DIAGNOSIS,
  REFERENCE_BASIS,
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
} from './sheet';

/**
 * The look of a report: the console's quiet ledger, on paper, with one figure
 * on it (docs/SPEC/reports-v1.md section 5, docs/DESIGN-BRIEF.md sections 5
 * and 6.2).
 *
 * **The frame both kinds share**: the practice's identity block, the client's
 * name and record number, the reference and the date, the ribbon where the
 * report has one, the signature block, and the two standing sentences — that
 * McWellness is a wellness provider and not a medical clinic, and that a brain
 * map is a measurement and not a diagnosis, in the consent's own words. And,
 * until the practice's lawyer has approved the wording, a third line on every
 * copy saying so.
 *
 * **Bilingual, and honestly so.** Every label is set twice on the same line:
 * English against the left margin, Arabic against the right, the value between
 * them. The practitioner's own narrative is set once, in the locale chosen at
 * issue, because a paragraph a person wrote is not something a renderer may
 * translate.
 *
 * **The ribbon is drawn in ink, and its bands are named in words.** The design
 * brief gives each band a hue and calls the ribbon the one place hue enters a
 * report; the shared PDF writer sets type and rules in greyscale and has no
 * colour operator, and `domain/shared/document` is the shared zone this
 * worktree may not edit. So the printed strip carries the shape — a slice per
 * session, its height the recording's quality, a hairline at each brain map,
 * empty slices ahead — and says which bands were trained underneath it in
 * words. The screen's own ribbon carries the hue from the tokens.
 * `docs/CHANGE-REQUESTS/reports-01.md` asks the trunk for the colour operator
 * that would let the paper carry it too.
 *
 * **Nothing here names an electrode site, a band threshold or a protocol.**
 * There is no field on any type in this folder that could hold one.
 *
 * Pure: no clock, no database, no live practice row. The same document renders
 * to the same bytes, which is what the byte-identical re-render test proves.
 */

/** A label in both languages on one line, with its value between them. */
function labelled(sheet: Sheet, label: Phrase, value: string): void {
  if (value.length === 0) return;
  const arabicWidth = sheet.width(label.ar, SIZE.body, { rtl: true });
  const labelWidth = VALUE - LEFT - GUTTER;
  const valueWidth = RIGHT - VALUE - (arabicWidth > 0 ? arabicWidth + GUTTER : 0);

  const rows = Math.max(
    sheet.wrap(label.en, labelWidth, SIZE.body, {}).length,
    sheet.wrap(value, valueWidth, SIZE.body, {}).length,
  );
  sheet.room(rows * LINE);

  const y = sheet.baseline;
  sheet.paragraph(y, LEFT, label.en, labelWidth, SIZE.body, { grey: MUTED });
  sheet.paragraph(y, VALUE, value, valueWidth, SIZE.body, {});
  sheet.line(y, RIGHT, label.ar, SIZE.body, { grey: MUTED, align: 'end', rtl: true });
  sheet.down(rows * LINE);
}

/** A section heading: English on the line, Arabic against the right margin. */
function section(sheet: Sheet, title: Phrase): void {
  sheet.room(LINE * 3);
  sheet.down(6);
  const y = sheet.baseline;
  sheet.line(y, LEFT, title.en, SIZE.body, { bold: true });
  sheet.line(y, RIGHT, title.ar, SIZE.body, { bold: true, align: 'end', rtl: true });
  sheet.down(LINE - 3);
  sheet.rule();
  sheet.down(LINE);
}

/**
 * A paragraph the practitioner wrote, set once in the report's own locale.
 * Right-aligned and right-to-left for an Arabic report, which is what makes
 * the Arabic edition a layout rather than a translation dropped into an
 * English one.
 */
function narrative(sheet: Sheet, text: string, rtl: boolean): void {
  const trimmed = text.trim();
  if (trimmed.length === 0) return;
  const options = rtl ? { rtl: true, align: 'end' as const } : {};
  const lines = sheet.wrap(trimmed, RIGHT - LEFT, SIZE.body, options).length;
  sheet.room(lines * LINE);
  sheet.paragraph(sheet.baseline, rtl ? RIGHT : LEFT, trimmed, RIGHT - LEFT, SIZE.body, options);
  sheet.down(lines * LINE);
}

/** The practice, from the snapshot and nowhere else. */
function practiceBlock(sheet: Sheet, practice: PracticeSnapshot): void {
  const arabicWidth = practice.legalNameAr
    ? sheet.width(practice.legalNameAr, SIZE.body, { rtl: true })
    : 0;
  const nameWidth = RIGHT - LEFT - (arabicWidth > 0 ? arabicWidth + GUTTER : 0);
  const rows = sheet.wrap(practice.legalName, nameWidth, SIZE.body, { bold: true }).length;
  sheet.room(rows * LINE);

  const top = sheet.baseline;
  sheet.paragraph(top, LEFT, practice.legalName, nameWidth, SIZE.body, { bold: true });
  if (practice.legalNameAr) {
    sheet.line(top, RIGHT, practice.legalNameAr, SIZE.body, { align: 'end', rtl: true });
  }
  sheet.down(rows * LINE);

  if (practice.address) {
    const lines = sheet.wrap(practice.address, RIGHT - LEFT, SIZE.body, {}).length;
    sheet.room(lines * LINE);
    sheet.paragraph(sheet.baseline, LEFT, practice.address, RIGHT - LEFT, SIZE.body, {
      grey: MUTED,
    });
    sheet.down(lines * LINE);
  }
  if (practice.licenceNumber) labelled(sheet, WORDS.licenceNumber, practice.licenceNumber);
  if (practice.licensingAuthority) {
    labelled(sheet, WORDS.licensingAuthority, practice.licensingAuthority);
  }
  // And no tax number, ever (section 10, decision 4). There is no field on
  // PracticeSnapshot for one, so there is no branch here that could print it.
}

function heading(sheet: Sheet, title: Phrase): void {
  sheet.text(LEFT, WORDMARK, SIZE.wordmark, { bold: true });
  sheet.text(RIGHT, title.ar, SIZE.heading, { align: 'end', rtl: true });
  sheet.down(LINE + 4);
  sheet.text(LEFT, title.en, SIZE.heading, { bold: true });
  sheet.down(LINE);
  sheet.rule(0.45, 0.8);
  sheet.down(LINE + 2);
}

/** Who signed, and on what authority, as it was true at signing (section 3). */
function signatureBlock(sheet: Sheet, signer: SignerSnapshot): void {
  section(sheet, WORDS.signedBy);
  labelled(sheet, WORDS.practitioner, signer.name);
  labelled(sheet, WORDS.certification, signer.certification);
  if (signer.certifyingBody) labelled(sheet, WORDS.certifyingBody, signer.certifyingBody);
  if (signer.certificateNumber) {
    labelled(sheet, WORDS.certificateNumber, signer.certificateNumber);
  }
}

/** One fixed sentence, English then Arabic, both across the measure. */
function standingSentence(sheet: Sheet, phrase: Phrase, bold = false): void {
  const english = sheet.wrap(phrase.en, RIGHT - LEFT, SIZE.small, {}).length;
  const arabic = sheet.wrap(phrase.ar, RIGHT - LEFT, SIZE.small, { rtl: true }).length;
  sheet.room((english + arabic) * SMALL_LINE + 6);
  sheet.paragraph(
    sheet.baseline,
    LEFT,
    phrase.en,
    RIGHT - LEFT,
    SIZE.small,
    { grey: bold ? INK : MUTED, bold },
    SMALL_LINE,
  );
  sheet.down(english * SMALL_LINE + 1);
  sheet.paragraph(
    sheet.baseline,
    RIGHT,
    phrase.ar,
    RIGHT - LEFT,
    SIZE.small,
    { grey: bold ? INK : MUTED, bold, align: 'end', rtl: true },
    SMALL_LINE,
  );
  sheet.down(arabic * SMALL_LINE + 4);
}

function footer(sheet: Sheet): void {
  sheet.room(LINE * 2);
  sheet.down(6);
  sheet.rule();
  sheet.down(LINE);
  // The draft line first, in ink rather than grey: it is the one sentence on
  // the page a reader must not skim past (section 10, decision 5).
  if (WORDING_IS_DRAFT) standingSentence(sheet, DRAFT_WORDING, true);
  standingSentence(sheet, NOT_A_CLINIC);
  standingSentence(sheet, NOT_A_DIAGNOSIS);
  standingSentence(sheet, REFERENCE_BASIS);
}

// --------------------------------------------------------------------------
// The ribbon
// --------------------------------------------------------------------------

/** How tall the strip stands, and how wide a slice may grow. */
const RIBBON = {
  height: 46,
  gap: 1.4,
  maxSliceWidth: 9,
  minSliceWidth: 1.2,
  /** A slice with no quality score still has to be visible. */
  floor: 0.12,
  emptyGrey: 0.86,
  markGrey: 0.3,
} as const;

/**
 * The cover figure (docs/DESIGN-BRIEF.md section 5): one slice per completed
 * session, height the visit's signal quality, a hairline at each brain map,
 * empty slices for the sessions remaining.
 *
 * A vertical slice is drawn as a horizontal rule whose thickness is its
 * height: the shared writer sets type and strokes rules, and a stroked rule
 * covers half its thickness either side of its baseline, so a slice standing
 * from the strip's floor to a height h is a rule of thickness h placed at the
 * floor plus half of h. That is the whole trick, and it is why this figure
 * needs nothing added to the writer.
 */
function ribbonFigure(sheet: Sheet, ribbon: Ribbon): void {
  const total = ribbon.slices.length + ribbon.remaining;
  if (total === 0) return;

  section(sheet, WORDS.theProgramme);
  sheet.room(RIBBON.height + LINE * 3);

  const measureWidth = RIGHT - LEFT;
  const step = measureWidth / total;
  const sliceWidth = Math.max(
    RIBBON.minSliceWidth,
    Math.min(RIBBON.maxSliceWidth, step - RIBBON.gap),
  );
  // The strip stands on the baseline below the current cursor, so the cursor
  // moves once, afterwards, by the whole of its height.
  const floor = sheet.baseline - RIBBON.height;

  ribbon.slices.forEach((slice, at) => {
    const quality = slice.quality === null ? RIBBON.floor : Math.max(RIBBON.floor, slice.quality);
    const height = Math.max(0.6, quality * RIBBON.height);
    const x = LEFT + at * step;
    sheet.ruleAt(floor + height / 2, x, sliceWidth, height, INK);
    if (slice.mapMark) {
      // A hairline the full height of the strip, in front of the slice it
      // marks: a brain map is a day, not a session, and it sits between them.
      sheet.ruleAt(floor + RIBBON.height / 2, x - RIBBON.gap, 0.5, RIBBON.height, RIBBON.markGrey);
    }
  });

  for (let at = 0; at < ribbon.remaining; at += 1) {
    const x = LEFT + (ribbon.slices.length + at) * step;
    // An empty slice: the same width, a hairline high, so the strip says how
    // much of the programme is still ahead without pretending to a figure.
    sheet.ruleAt(floor + 0.6, x, sliceWidth, 1.2, RIBBON.emptyGrey);
  }

  sheet.down(RIBBON.height + 6);
  sheet.rule(RULE, 0.4);
  sheet.down(SMALL_LINE + 2);

  const legend = WORDS.ribbonLegend;
  sheet.paragraph(
    sheet.baseline,
    LEFT,
    legend.en,
    RIGHT - LEFT,
    SIZE.small,
    { grey: MUTED },
    SMALL_LINE,
  );
  sheet.down(sheet.wrap(legend.en, RIGHT - LEFT, SIZE.small, {}).length * SMALL_LINE);
  sheet.paragraph(
    sheet.baseline,
    RIGHT,
    legend.ar,
    RIGHT - LEFT,
    SIZE.small,
    { grey: MUTED, align: 'end', rtl: true },
    SMALL_LINE,
  );
  sheet.down(sheet.wrap(legend.ar, RIGHT - LEFT, SIZE.small, { rtl: true }).length * SMALL_LINE);

  // **The bands are not named.** The strip carries the whole of the figure's
  // shape in ink — a slice per session at the height of its recording's
  // quality, a hairline at each brain map, empty slices for the sessions ahead
  // — and the design brief admits a band only as that slice's hue. Printing
  // "Bands trained: Theta, Alpha" put on the page a fact the specification
  // keeps off it, and it read as a legend for a colour nothing had drawn. The
  // ink strip stands on its own until the writer has a colour operator
  // (docs/CHANGE-REQUESTS/reports-01.md, request R3); the console's own ribbon
  // carries the hue from the tokens meanwhile.
}

// --------------------------------------------------------------------------
// The two pages
// --------------------------------------------------------------------------

/** Where a ratings row's three columns end. */
const RATING = { question: LEFT, before: LEFT + 330, after: LEFT + 400 };
/** Where a comparison row's four columns end. */
const COMPARE = {
  measurement: LEFT,
  earlier: LEFT + 300,
  later: LEFT + 375,
  difference: RIGHT,
};

function columnHeading(sheet: Sheet, x: number, label: Phrase, align: 'start' | 'end'): void {
  const y = sheet.baseline;
  sheet.line(y, x, label.en, SIZE.body, { bold: true, align });
  sheet.line(y - SMALL_LINE, x, label.ar, SIZE.small, { grey: MUTED, align, rtl: true });
}

function sessionPage(
  document_: ReportDocument,
  content: SessionReportContent,
  fonts: FontSet,
): Page[] {
  const rtl = document_.locale === 'ar';
  const sheet = new Sheet(fonts, {
    practice: document_.practice.legalName,
    reference: document_.reference,
  });

  heading(sheet, WORDS.sessionReport);
  practiceBlock(sheet, document_.practice);
  sheet.down(4);
  sheet.rule();
  sheet.down(LINE + 2);

  labelled(sheet, WORDS.reference, document_.reference);
  labelled(sheet, WORDS.dateOfIssue, formatReportDate(document_.issuedOn));
  if (document_.version > 1) {
    labelled(sheet, WORDS.version, String(document_.version));
    if (document_.amendmentReason) {
      labelled(sheet, WORDS.amendmentReason, document_.amendmentReason);
    }
  }
  labelled(sheet, WORDS.client, document_.recipient.name);
  labelled(sheet, WORDS.recordNumber, document_.recipient.recordNumber);

  section(sheet, WORDS.visitDate);
  labelled(sheet, WORDS.visitDate, formatReportDate(content.visitDate));
  labelled(
    sheet,
    WORDS.service,
    rtl && content.serviceNameAr ? content.serviceNameAr : content.serviceName,
  );
  labelled(sheet, WORDS.practitioner, content.practitionerName);
  if (content.durationMinutes !== null) {
    labelled(
      sheet,
      WORDS.duration,
      `${content.durationMinutes} ${WORDS.minutes[document_.locale]}`,
    );
  }
  if (content.goalArea) labelled(sheet, WORDS.goalArea, content.goalArea);

  if (content.ratings.length > 0) {
    section(sheet, WORDS.howItWent);
    const headings = (): void => {
      columnHeading(sheet, RATING.question, WORDS.question, 'start');
      columnHeading(sheet, RATING.before, WORDS.before, 'end');
      columnHeading(sheet, RATING.after, WORDS.after, 'end');
      sheet.down(SMALL_LINE + LINE - 4);
      sheet.rule();
      sheet.down(LINE + 2);
    };
    headings();
    sheet.setContinuation(headings);
    const questionWidth = RATING.before - RATING.question - GUTTER * 3;
    for (const rating of content.ratings) {
      const label = rtl && rating.labelAr ? rating.labelAr : rating.label;
      const rows = sheet.wrap(label, questionWidth, SIZE.body, {}).length;
      sheet.room(rows * LINE);
      const y = sheet.baseline;
      sheet.paragraph(y, RATING.question, label, questionWidth, SIZE.body, {});
      sheet.line(y, RATING.before, rating.before === null ? '' : String(rating.before), SIZE.body, {
        align: 'end',
      });
      sheet.line(y, RATING.after, rating.after === null ? '' : String(rating.after), SIZE.body, {
        align: 'end',
      });
      sheet.down(rows * LINE);
    }
    sheet.setContinuation(null);
  }

  const noticed =
    content.observationChips.length > 0 ||
    content.tolerance !== null ||
    content.engagement !== null;
  if (noticed) {
    section(sheet, WORDS.whatWasNoticed);
    if (content.observationChips.length > 0) {
      const words = content.observationChips.join(rtl ? '، ' : ', ');
      const lines = sheet.wrap(words, RIGHT - LEFT, SIZE.body, {}).length;
      sheet.room(lines * LINE);
      sheet.paragraph(sheet.baseline, LEFT, words, RIGHT - LEFT, SIZE.body, {});
      sheet.down(lines * LINE);
    }
    if (content.tolerance !== null) {
      labelled(sheet, WORDS.tolerance, `${content.tolerance} / 10`);
    }
    if (content.engagement !== null) {
      labelled(sheet, WORDS.engagement, `${content.engagement} / 10`);
    }
  }

  if (content.note.trim().length > 0) {
    section(sheet, WORDS.practitionerNote);
    narrative(sheet, content.note, rtl);
  }
  if (content.beforeNextVisit.trim().length > 0) {
    section(sheet, WORDS.beforeNextVisit);
    narrative(sheet, content.beforeNextVisit, rtl);
  }

  signatureBlock(sheet, document_.signer);
  footer(sheet);
  return sheet.finish();
}

function progressPage(
  document_: ReportDocument,
  content: ProgressReportContent,
  fonts: FontSet,
): Page[] {
  const rtl = document_.locale === 'ar';
  const sheet = new Sheet(fonts, {
    practice: document_.practice.legalName,
    reference: document_.reference,
  });

  heading(sheet, WORDS.progressReport);
  practiceBlock(sheet, document_.practice);
  sheet.down(4);
  sheet.rule();
  sheet.down(LINE + 2);

  labelled(sheet, WORDS.reference, document_.reference);
  labelled(sheet, WORDS.dateOfIssue, formatReportDate(document_.issuedOn));
  if (document_.version > 1) {
    labelled(sheet, WORDS.version, String(document_.version));
    if (document_.amendmentReason) {
      labelled(sheet, WORDS.amendmentReason, document_.amendmentReason);
    }
  }
  labelled(sheet, WORDS.client, document_.recipient.name);
  labelled(sheet, WORDS.recordNumber, document_.recipient.recordNumber);
  labelled(
    sheet,
    WORDS.coverage,
    rtl
      ? `${arabicReportDate(content.coverageFrom)} ${WORDS.to.ar} ${arabicReportDate(content.coverageTo)}`
      : `${formatReportDate(content.coverageFrom)} ${WORDS.to.en} ${formatReportDate(content.coverageTo)}`,
  );

  section(sheet, WORDS.sessions);
  labelled(sheet, WORDS.sessionsDelivered, String(content.sessionsDelivered));
  labelled(sheet, WORDS.sessionsEntitled, String(content.sessionsEntitled));

  ribbonFigure(sheet, content.ribbon);

  if (content.goals.length > 0) {
    section(sheet, WORDS.goals);
    for (const goal of content.goals) {
      const rows = sheet.wrap(goal.description, RIGHT - LEFT, SIZE.body, { bold: true }).length;
      sheet.room(rows * LINE + LINE);
      sheet.paragraph(sheet.baseline, LEFT, goal.description, RIGHT - LEFT, SIZE.body, {
        bold: true,
      });
      sheet.down(rows * LINE);
      labelled(sheet, WORDS.goalStatus, goal.status);
      if (goal.movement.trim().length > 0) {
        const moved = sheet.wrap(
          goal.movement,
          RIGHT - LEFT,
          SIZE.body,
          rtl ? { rtl: true, align: 'end' } : {},
        ).length;
        sheet.room(moved * LINE);
        sheet.paragraph(
          sheet.baseline,
          rtl ? RIGHT : LEFT,
          goal.movement,
          RIGHT - LEFT,
          SIZE.body,
          rtl ? { rtl: true, align: 'end' } : {},
        );
        sheet.down(moved * LINE);
      }
      sheet.down(4);
    }
  }

  const comparison = content.comparison;
  if (comparison) {
    section(sheet, WORDS.brainMaps);
    labelled(
      sheet,
      WORDS.earlier,
      rtl ? arabicReportDate(comparison.earlierOn) : formatReportDate(comparison.earlierOn),
    );
    labelled(
      sheet,
      WORDS.later,
      rtl ? arabicReportDate(comparison.laterOn) : formatReportDate(comparison.laterOn),
    );
    if (comparison.referenceAgeYears !== null || comparison.referenceSex !== null) {
      // The age and sex the software's own comparison was made against: a
      // comparison made against a nine-year-old is not the one made against a
      // ten-year-old (docs/SPEC/assessment.md section 3.3).
      const parts = [
        comparison.referenceAgeYears === null
          ? null
          : `${comparison.referenceAgeYears} ${WORDS.years[document_.locale]}`,
        comparison.referenceSex,
      ].filter((part): part is string => part !== null && part.length > 0);
      labelled(sheet, WORDS.comparedAgainst, parts.join(rtl ? '، ' : ', '));
    }

    sheet.down(4);
    const headings = (): void => {
      columnHeading(sheet, COMPARE.measurement, WORDS.measurement, 'start');
      columnHeading(sheet, COMPARE.earlier, WORDS.earlier, 'end');
      columnHeading(sheet, COMPARE.later, WORDS.later, 'end');
      columnHeading(sheet, COMPARE.difference, WORDS.difference, 'end');
      sheet.down(SMALL_LINE + LINE - 4);
      sheet.rule();
      sheet.down(LINE + 2);
    };
    headings();
    sheet.setContinuation(headings);
    const labelWidth = COMPARE.earlier - COMPARE.measurement - GUTTER * 3;
    for (const line of comparison.lines) {
      const label = rtl && line.labelAr ? line.labelAr : line.label;
      const withUnit = `${label} (${line.unit})`;
      const rows = sheet.wrap(withUnit, labelWidth, SIZE.body, {}).length;
      sheet.room(rows * LINE);
      const y = sheet.baseline;
      sheet.paragraph(y, COMPARE.measurement, withUnit, labelWidth, SIZE.body, {});
      sheet.line(y, COMPARE.earlier, formatFigure(line.earlier), SIZE.body, { align: 'end' });
      sheet.line(y, COMPARE.later, formatFigure(line.later), SIZE.body, { align: 'end' });
      sheet.line(y, COMPARE.difference, formatDifference(line.difference), SIZE.body, {
        align: 'end',
      });
      sheet.down(rows * LINE);
    }
    sheet.setContinuation(null);
    sheet.down(4);
    // The comparison's own sentence, the same one the screen carries, so the
    // two can never drift apart (docs/SPEC/assessment.md section 3.3).
    standingSentence(sheet, NOT_A_DIAGNOSIS);
  }

  if (content.summary.trim().length > 0) {
    section(sheet, WORDS.summary);
    narrative(sheet, content.summary, rtl);
  }
  if (content.suggestion.trim().length > 0) {
    section(sheet, WORDS.suggestion);
    narrative(sheet, content.suggestion, rtl);
  }

  signatureBlock(sheet, document_.signer);
  footer(sheet);
  return sheet.finish();
}

/** Lays out a report, across as many pages as its sections need. */
export function layout(document_: ReportDocument, fonts: FontSet): Page[] {
  return document_.content.kind === 'session'
    ? sessionPage(document_, document_.content, fonts)
    : progressPage(document_, document_.content, fonts);
}

/** The report's title, which is what a reader's browser tab and file manager show. */
export function titleOf(document_: ReportDocument): string {
  const words = document_.content.kind === 'session' ? WORDS.sessionReport : WORDS.progressReport;
  return `${words.en} ${document_.reference}`;
}
