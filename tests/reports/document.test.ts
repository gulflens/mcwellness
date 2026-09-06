import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { documentFonts } from '../../app/api/billing/fonts';
import { NOT_A_DIAGNOSIS as SCREEN_SENTENCE } from '../../app/admin/assessments/copy';
import { extractAll, extractText, toVisualOrder } from '../../domain/shared/document';
import {
  COMPARISON_NOT_A_DIAGNOSIS,
  layout,
  renderReport,
  WORDS,
} from '../../domain/reports/document';
import { isListedFamilyName, isListedGivenName } from '../../db/seed/names';
import type {
  PracticeSnapshot,
  ProgressReportContent,
  ReportDocument,
  SessionReportContent,
  SignerSnapshot,
} from '../../domain/reports';

/**
 * What a rendered report says, read back off the page.
 *
 * The text is extracted through the same `/ToUnicode` map a PDF viewer uses to
 * let a person select and copy it (`domain/shared/document/extract.ts`), so
 * these are assertions about the document a household actually receives, not
 * about the object that produced it.
 *
 * **The absences matter as much as the presences.** A report may carry no
 * electrode site, no band threshold, no protocol name, no tax number and no
 * medical-claim language beyond the consent's own two sentences — and each of
 * those is asserted as *not* on the page rather than left to a positive test
 * that happens not to look for it.
 *
 * Every figure is synthetic and every person is from `db/seed/names.ts`
 * (.claude/rules/testing.md) — proved by the last test in this file rather
 * than remembered, because a hand-written name is exactly the kind of thing
 * that reads as fine and is not.
 */

const fonts = documentFonts();

/** The signer, and the household the report is addressed to. Both from the lists. */
const SIGNER_NAME = 'Hazel Harbour';
const RECIPIENT_NAME = 'Dahlia Meadow';

/**
 * The same string as a person copying it off the page gets it: the letters
 * themselves, in the order the glyphs are drawn, which for a right-to-left run
 * is the reverse of the order it is read in.
 */
const asCopied = (arabic: string): string =>
  String.fromCodePoint(...toVisualOrder([...arabic].map((c) => c.codePointAt(0) ?? 0)));

const PRACTICE: PracticeSnapshot = {
  legalName: 'Synthetic Wellness Studio',
  legalNameAr: 'استوديو العافية التجريبي',
  address: 'Unit 1, Synthetic Tower, Dubai',
  licenceNumber: 'SYN-000000',
  licensingAuthority: 'Synthetic Department of Economy and Tourism',
};

const SIGNER: SignerSnapshot = {
  name: SIGNER_NAME,
  certification: 'bcia_bcn',
  certifyingBody: 'BCIA',
  certificateNumber: 'SYN-0001',
};

const SESSION_CONTENT: SessionReportContent = {
  kind: 'session',
  sessionId: '00000003-0000-4000-8000-000000000001',
  visitDate: '2026-09-01',
  serviceName: 'Neurofeedback session',
  serviceNameAr: 'جلسة تدريب',
  practitionerName: SIGNER_NAME,
  durationMinutes: 60,
  goalArea: 'Sleep',
  ratings: [
    {
      key: 'calm',
      label: 'How settled do you feel?',
      labelAr: 'ما مدى شعورك بالهدوء؟',
      before: 4,
      after: 7,
    },
    { key: 'focus', label: 'How easy is it to focus?', labelAr: null, before: 3, after: 3 },
  ],
  observationChips: ['settled quickly', 'talkative afterwards'],
  tolerance: 8,
  engagement: 7,
  note: 'A steady visit throughout, with no breaks asked for.',
  beforeNextVisit: 'Keep to the same bedtime and drink water beforehand.',
};

const PROGRESS_CONTENT: ProgressReportContent = {
  kind: 'progress',
  coverageFrom: '2026-06-01',
  coverageTo: '2026-09-01',
  sessionsDelivered: 12,
  sessionsEntitled: 15,
  goals: [
    {
      id: '00000009-0000-4000-8000-000000000001',
      description: 'Sleep through the night without waking',
      status: 'active',
      movement: 'Waking once a week rather than most nights.',
    },
  ],
  ribbon: {
    slices: [
      { index: 1, quality: 0.62, band: 'theta', mapMark: true },
      { index: 2, quality: 0.81, band: 'alpha', mapMark: false },
      { index: 3, quality: null, band: null, mapMark: false },
      { index: 4, quality: 0.9, band: 'alpha', mapMark: true },
    ],
    remaining: 3,
  },
  comparison: {
    instrument: 'qeeg',
    earlierOn: '2026-06-02',
    laterOn: '2026-08-30',
    earlierAssessmentId: '00000000-0000-4000-8000-0000000005a1',
    laterAssessmentId: '00000000-0000-4000-8000-0000000005a2',
    referenceAgeYears: 10,
    referenceSex: 'female',
    lines: [
      {
        label: 'Frontal ratio',
        labelAr: 'النسبة الأمامية',
        unit: 'ratio',
        earlier: 2.4,
        later: 2.1,
        difference: -0.3,
      },
      {
        label: 'Peak frequency',
        labelAr: null,
        unit: 'Hz',
        earlier: 9.1,
        later: 9.8,
        difference: 0.7,
      },
    ],
  },
  summary: 'Settling faster and sleeping longer across the twelve visits.',
  suggestion: 'Three more sessions, then a repeat brain map.',
};

function report(over: Partial<ReportDocument> = {}): ReportDocument {
  return {
    kind: 'progress',
    locale: 'en',
    practice: PRACTICE,
    signer: SIGNER,
    recipient: { name: RECIPIENT_NAME, recordNumber: 'MW-000004' },
    reference: 'RPT-000001',
    issuedOn: '2026-09-06',
    version: 1,
    amendmentReason: null,
    content: PROGRESS_CONTENT,
    ...over,
  };
}

describe('a rendered session report', () => {
  const bytes = renderReport(report({ kind: 'session', content: SESSION_CONTENT }), fonts);
  const text = extractAll(bytes);

  it('is a PDF', () => {
    expect(bytes.subarray(0, 8)).toEqual(new TextEncoder().encode('%PDF-1.7'));
  });

  it('carries the practice, the reference, the client and the record number', () => {
    expect(text).toContain('Synthetic Wellness Studio');
    expect(text).toContain('RPT-000001');
    expect(text).toContain(RECIPIENT_NAME);
    expect(text).toContain('MW-000004');
    expect(text).toContain('6 September 2026');
  });

  it('carries the visit, the service, the practitioner and the ratings', () => {
    expect(text).toContain('1 September 2026');
    expect(text).toContain('Neurofeedback session');
    expect(text).toContain(SIGNER_NAME);
    expect(text).toContain('60 minutes');
    expect(text).toContain('How settled do you feel?');
  });

  it('carries what the practitioner wrote and what to expect next', () => {
    expect(text).toContain('A steady visit throughout');
    expect(text).toContain('Keep to the same bedtime');
  });

  it('names who signed it and on what authority', () => {
    expect(text).toContain('bcia_bcn');
    expect(text).toContain('BCIA');
    expect(text).toContain('SYN-0001');
  });

  it('sets every fixed label in Arabic beside its English', () => {
    expect(text).toContain(asCopied(WORDS.sessionReport.ar));
    expect(text).toContain(asCopied(WORDS.client.ar));
    expect(text).toContain(asCopied(WORDS.signedBy.ar));
  });

  it('carries the two standing sentences, in the consent’s own words', () => {
    expect(text).toContain('McWellness is a wellness provider, not a medical clinic');
    expect(text).toContain('It is not a diagnosis.');
  });

  it('carries the draft line on every copy, until the wording is approved', () => {
    expect(text).toContain("Draft wording, in use until the practice's lawyer approves");
  });

  it('says the reference is the practice’s own and not a tax number', () => {
    expect(text).toContain('It is not a tax number.');
  });

  it('carries no tax number, no electrode site, no threshold and no protocol', () => {
    for (const forbidden of ['TRN', 'VAT', 'Cz', 'electrode', 'threshold', 'protocol']) {
      expect(text).not.toContain(forbidden);
    }
  });

  it('makes no medical claim beyond the consent’s own two sentences', () => {
    // Twice each, and every one is the consent's own. "diagnose or treat" in
    // the line saying this is not a clinic, and "it is not a diagnosis" about
    // a measurement; "not a medical clinic" and "medical or psychiatric
    // conditions" in the same line. Counted rather than merely looked for, so
    // a third occurrence from anywhere else fails here.
    expect(text.match(/diagnos/gi)?.length).toBe(2);
    expect(text.match(/medical/gi)?.length).toBe(2);
    for (const forbidden of ['patient', 'treatment', 'therapy', 'cure', 'symptom']) {
      expect(text.toLowerCase()).not.toContain(forbidden);
    }
  });
});

describe('a rendered progress report', () => {
  const bytes = renderReport(report(), fonts);
  const text = extractAll(bytes);

  it('carries the coverage and the sessions delivered against those bought', () => {
    expect(text).toContain('1 June 2026 to 1 September 2026');
    expect(text).toContain('Sessions delivered');
    expect(text).toContain('Sessions on the programme');
  });

  it('carries the goal and what has moved', () => {
    expect(text).toContain('Sleep through the night without waking');
    expect(text).toContain('Waking once a week rather than most nights.');
  });

  it('carries the brain-map comparison as figures and a difference', () => {
    expect(text).toContain('Frontal ratio (ratio)');
    expect(text).toContain('2.4');
    expect(text).toContain('2.1');
    expect(text).toContain('-0.3');
    expect(text).toContain('+0.7');
  });

  it('says the age and sex the comparison was made against', () => {
    expect(text).toContain('10 years, female');
  });

  it('carries the not-a-diagnosis sentence beside the comparison as well as in the footer', () => {
    expect(text.match(/It is not a diagnosis\./g)?.length).toBe(2);
  });

  it('prints the comparison’s own sentence beneath the figures, in both languages', () => {
    // The Compare screen's fixed sentence, word for word
    // (`app/admin/assessments/copy.ts`), which docs/SPEC/assessment.md section
    // 3.3 puts on anything printed from the comparison. The footer's line
    // about what a brain map is says something else and stays where it is, so
    // both are asserted here rather than one standing in for the other.
    expect(text).toContain(COMPARISON_NOT_A_DIAGNOSIS.en);
    // Set as an RTL run, so it is read back a clause at a time: the writer
    // starts a fresh run at each full stop.
    expect(text).toContain(asCopied('هذه مقارنة بين قياسات أُخذت في أيام مختلفة'));
    expect(text).toContain(asCopied('وهي ليست تشخيصاً'));
    // And it is the screen's sentence, not merely one like it.
    expect(COMPARISON_NOT_A_DIAGNOSIS.en).toBe(SCREEN_SENTENCE.en);
    expect(COMPARISON_NOT_A_DIAGNOSIS.ar).toBe(SCREEN_SENTENCE.ar);
    expect(text).toContain('A brain map (qEEG) is a measurement recorded the same way.');
  });

  it('draws the ribbon as one mark per session and empty marks for those remaining', () => {
    // Seven marks in all: four slices and three empty ones, plus two hairlines
    // where a brain map was taken. The strip is drawn with the writer's rules,
    // so this counts the rules the figure produced rather than the words.
    const pages = layout(report(), fonts);
    const rules = pages.flatMap((page) => page.ops).filter((op) => op.kind === 'rule');
    // Ribbon marks are the rules narrower than a quarter of the measure; the
    // section rules run the whole width.
    const marks = rules.filter((op) => op.kind === 'rule' && op.width < 120);
    expect(marks).toHaveLength(4 + 3 + 2);
  });

  it('names no band on the paper: the ink strip stands on its own', () => {
    // The design brief admits a band only as the slice's hue, and the writer
    // has none yet (docs/CHANGE-REQUESTS/reports-01.md, request R3). A line of
    // words naming the bands put a fact on the page the specification keeps
    // off it, and read as a legend for a colour nothing had drawn.
    expect(text).not.toContain('Bands trained');
    expect(text).not.toContain('Theta');
  });

  it('carries the ribbon’s legend in both languages', () => {
    expect(text).toContain('One mark per session delivered.');
    expect(text).toContain(asCopied(WORDS.theProgramme.ar));
  });

  it('says nothing about brain maps where a household has only one', () => {
    const without = renderReport(
      report({ content: { ...PROGRESS_CONTENT, comparison: null } }),
      fonts,
    );
    const page = extractAll(without);
    expect(page).not.toContain('Frontal ratio');
    expect(page).not.toContain('Brain maps compared');
    // And the one standing sentence stays, because it is the footer's.
    expect(page.match(/It is not a diagnosis\./g)?.length).toBe(1);
  });
});

describe('a corrected report', () => {
  it('says which version it is and why it exists', () => {
    const text = extractAll(
      renderReport(
        report({
          version: 2,
          amendmentReason: 'The visit date was written as the day it was typed.',
        }),
        fonts,
      ),
    );
    expect(text).toContain('Why this version exists');
    expect(text).toContain('The visit date was written as the day it was typed.');
  });

  it('says nothing about a version on the first one', () => {
    expect(extractAll(renderReport(report(), fonts))).not.toContain('Why this version exists');
  });
});

describe('the Arabic edition', () => {
  const bytes = renderReport(
    report({
      locale: 'ar',
      content: {
        ...PROGRESS_CONTENT,
        summary: 'ينام لفترة أطول ويستقر أسرع عبر الزيارات الاثنتي عشرة.',
        suggestion: 'ثلاث جلسات أخرى، ثم إعادة خريطة الدماغ.',
        goals: [
          {
            id: '00000009-0000-4000-8000-000000000001',
            description: 'النوم طوال الليل دون استيقاظ',
            status: 'active',
            movement: 'يستيقظ مرة في الأسبوع بدل معظم الليالي.',
          },
        ],
      },
    }),
    fonts,
  );
  const text = extractAll(bytes);

  it('sets the practitioner’s own narrative in the language it was written in', () => {
    expect(text).toContain(asCopied('ينام لفترة أطول'));
  });

  it('still sets every fixed label in both languages', () => {
    expect(text).toContain('Progress report');
    expect(text).toContain(asCopied(WORDS.progressReport.ar));
  });

  it('names no band in Arabic either', () => {
    expect(text).not.toContain(asCopied('نطاقات التدريب'));
  });
});

describe('rendering is deterministic', () => {
  it('produces the same bytes from the same report, every time', () => {
    // The whole of what makes the snapshot rule hold: `report.content` plus the
    // row's own snapshots re-render to the file that was filed.
    const first = renderReport(report(), fonts);
    const second = renderReport(report(), fonts);
    expect(createHash('sha256').update(first).digest('hex')).toBe(
      createHash('sha256').update(second).digest('hex'),
    );
  });

  it('produces different bytes when the content differs', () => {
    const changed = renderReport(
      report({ content: { ...PROGRESS_CONTENT, sessionsDelivered: 13 } }),
      fonts,
    );
    expect(createHash('sha256').update(renderReport(report(), fonts)).digest('hex')).not.toBe(
      createHash('sha256').update(changed).digest('hex'),
    );
  });
});

describe('a long report', () => {
  it('takes a second page and says which sheet is which', () => {
    const many = Array.from({ length: 24 }, (_, at) => ({
      id: `00000009-0000-4000-8000-${String(at + 1).padStart(12, '0')}`,
      description: `Goal number ${at + 1}, written out at some length so the page fills`,
      status: 'active',
      movement: 'Moving along steadily, as the practitioner has recorded it after each visit.',
    }));
    const text = extractText(
      renderReport(report({ content: { ...PROGRESS_CONTENT, goals: many.slice(0, 20) } }), fonts),
    ).join('\n');
    expect(text).toContain('Page 1 of');
  });
});

describe('the people in this file', () => {
  it('names every one of them from the fixed fictional lists', () => {
    // db/seed/generate.test.ts asks the same of the seed. A fixture is held to
    // it too: the name this test was written for read as synthetic and was on
    // neither list.
    for (const full of [SIGNER_NAME, RECIPIENT_NAME]) {
      const [given, family] = full.split(' ');
      expect(isListedGivenName(given ?? ''), full).toBe(true);
      expect(isListedFamilyName(family ?? ''), full).toBe(true);
    }
  });
});
