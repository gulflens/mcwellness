import { describe, expect, it } from 'vitest';
import { documentFonts } from '../../app/api/billing/fonts';
import {
  COMPARISON_NOT_A_DIAGNOSIS,
  layout,
  NOT_A_CLINIC,
  NOT_A_DIAGNOSIS,
  REFERENCE_BASIS,
  renderReport,
  WORDS,
} from '../../domain/reports/document';
import { extractText, PAGE_WIDTH, type Op } from '../../domain/shared/document';
import type {
  PracticeSnapshot,
  ProgressReportContent,
  ReportDocument,
  SessionReportContent,
} from '../../domain/reports';

/**
 * A report in the client's language: English or Arabic, never both
 * (the operator's decision of 15 October 2026; docs/SPEC/reports-v1.md
 * section 5; docs/CHANGE-REQUESTS/docfix-03.md).
 *
 * Read off the laid-out page, op by op: an English page carries no Arabic
 * letter at all, and an Arabic page carries no fixed English word — only what
 * a person typed in Latin letters (a name, a code, a unit) and the wordmark.
 * An Arabic page is the English page mirrored: its labels stand against the
 * right margin and its values to their left.
 *
 * Every person is from `db/seed/names.ts`.
 */

const fonts = documentFonts();
const MIRROR = (x: number): number => PAGE_WIDTH - x;
const ARABIC = /\p{Script=Arabic}/u;
const LATIN = /[A-Za-z]/;

const PRACTICE: PracticeSnapshot = {
  legalName: 'Synthetic Wellness Studio',
  legalNameAr: 'استوديو العافية التجريبي',
  address: 'Unit 1, Synthetic Tower, Dubai',
  licenceNumber: 'SYN-000000',
  licensingAuthority: 'Synthetic Department of Economy and Tourism',
};

/** What a person typed in Latin letters, which an Arabic page carries as typed. */
const TYPED_LATIN = [
  'McWellness',
  'Hazel Harbour',
  'Dahlia Meadow',
  'RPT-000001',
  'MW-000099',
  'SYN-000000',
  'SYN-0001',
  'BCIA',
  'bcia_bcn',
  'qEEG',
  'Unit 1, Synthetic Tower, Dubai',
  'Synthetic Department of Economy and Tourism',
  'ratio',
];
// The English page's own typed values are English, so it may carry no Arabic letter at all.

const SESSION: SessionReportContent = {
  kind: 'session',
  sessionId: '00000003-0000-4000-8000-000000000001',
  visitDate: '2026-09-01',
  serviceName: 'Neurofeedback session',
  serviceNameAr: 'جلسة تدريب',
  practitionerName: 'Hazel Harbour',
  durationMinutes: 60,
  goalArea: 'النوم',
  ratings: [
    {
      key: 'calm',
      label: 'How settled do you feel?',
      labelAr: 'ما مدى شعورك بالهدوء؟',
      before: 4,
      after: 7,
    },
  ],
  observationChips: ['هدأ بسرعة'],
  tolerance: 8,
  engagement: 7,
  note: 'زيارة هادئة استمرت ٤٥ دقيقة.',
  beforeNextVisit: 'النوم في الموعد نفسه.',
};

const PROGRESS: ProgressReportContent = {
  kind: 'progress',
  coverageFrom: '2026-06-01',
  coverageTo: '2026-09-01',
  sessionsDelivered: 12,
  sessionsEntitled: 15,
  goals: [
    {
      id: '00000009-0000-4000-8000-000000000001',
      description: 'النوم طوال الليل',
      status: 'active',
      movement: 'يستيقظ مرة في الأسبوع.',
    },
  ],
  ribbon: {
    slices: [
      { index: 1, quality: 0.62, band: 'theta', mapMark: true },
      { index: 2, quality: 0.81, band: 'alpha', mapMark: false },
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
    ],
  },
  summary: 'هدوء أسرع ونوم أطول.',
  suggestion: 'ثلاث جلسات أخرى.',
};

/** The same two reports in English: every value typed in English. */
const SESSION_EN: SessionReportContent = {
  ...SESSION,
  goalArea: 'Sleep',
  observationChips: ['Nothing to note'],
  note: 'A steady visit.',
  beforeNextVisit: 'Keep to the same bedtime.',
};
const PROGRESS_EN: ProgressReportContent = {
  ...PROGRESS,
  goals: [{ ...PROGRESS.goals[0]!, description: 'Sleep through the night', movement: 'Better.' }],
  summary: 'Settling faster.',
  suggestion: 'Three more sessions.',
};

function report(
  locale: 'en' | 'ar',
  content: SessionReportContent | ProgressReportContent,
): ReportDocument {
  return {
    kind: content.kind,
    locale,
    practice: PRACTICE,
    signer: {
      name: 'Hazel Harbour',
      certification: 'bcia_bcn',
      certifyingBody: 'BCIA',
      certificateNumber: 'SYN-0001',
    },
    recipient: { name: 'Dahlia Meadow', recordNumber: 'MW-000099' },
    reference: 'RPT-000001',
    issuedOn: '2026-09-06',
    version: 2,
    amendmentReason: locale === 'ar' ? 'تصحيح التاريخ' : 'The date corrected',
    content,
  };
}

const textsOf = (document_: ReportDocument): Extract<Op, { kind: 'text' }>[] =>
  layout(document_, fonts).flatMap((page) =>
    page.ops.filter((op): op is Extract<Op, { kind: 'text' }> => op.kind === 'text'),
  );

/** An op's text with everything a person typed in Latin letters taken out. */
const withoutTyped = (text: string): string =>
  TYPED_LATIN.reduce((left, typed) => left.split(typed).join(''), text);

describe.each([
  ['session', SESSION_EN, SESSION],
  ['progress', PROGRESS_EN, PROGRESS],
] as const)('a %s report in one language', (_kind, english, arabic) => {
  it('in English carries no Arabic letter anywhere on the page', () => {
    const arabicOps = textsOf(report('en', english)).filter((op) => ARABIC.test(op.text));
    expect(arabicOps.map((op) => op.text)).toEqual([]);
  });

  it('in Arabic carries no English word but what a person typed', () => {
    const english = textsOf(report('ar', arabic)).filter((op) => LATIN.test(withoutTyped(op.text)));
    expect(english.map((op) => op.text)).toEqual([]);
  });

  it('in Arabic carries the standing sentences in Arabic only', () => {
    const drawn = extractText(renderReport(report('ar', arabic), fonts)).join('');
    for (const phrase of [NOT_A_CLINIC, NOT_A_DIAGNOSIS, REFERENCE_BASIS]) {
      const firstWord = phrase.en.split(' ').slice(0, 3).join(' ');
      expect(drawn).not.toContain(firstWord);
    }
    const texts = textsOf(report('ar', arabic))
      .map((op) => op.text)
      .join(' ');
    expect(texts).toContain(NOT_A_CLINIC.ar.split(' ').slice(0, 4).join(' '));
  });

  it('in Arabic sets every label against the right margin, right to left', () => {
    const client = textsOf(report('ar', arabic)).find((op) => op.text === WORDS.client.ar);
    expect(client).toMatchObject({ x: MIRROR(48), align: 'end', rtl: true });
  });

  it('in English sets every label against the left margin', () => {
    const client = textsOf(report('en', english)).find((op) => op.text === WORDS.client.en);
    expect(client?.x).toBe(48);
    expect(client?.rtl).toBeUndefined();
  });

  it('in Arabic sets the value to the left of its label, ending at the value column', () => {
    const ops = textsOf(report('ar', arabic));
    const name = ops.find((op) => op.text === 'Dahlia Meadow');
    expect(name).toMatchObject({ x: MIRROR(48 + 170), align: 'end' });
  });

  it('in Arabic names the practice by its Arabic legal name only', () => {
    const texts = textsOf(report('ar', arabic)).map((op) => op.text);
    expect(texts).toContain(PRACTICE.legalNameAr);
    expect(texts).not.toContain(PRACTICE.legalName);
  });

  it('in Arabic falls back to the English legal name when the practice has no Arabic one', () => {
    const texts = textsOf({
      ...report('ar', arabic),
      practice: { ...PRACTICE, legalNameAr: null },
    }).map((op) => op.text);
    expect(texts).toContain(PRACTICE.legalName);
  });
});

describe('the Arabic session report’s table', () => {
  it('mirrors its columns: the question on the right, before and after to its left', () => {
    const ops = textsOf(report('ar', SESSION));
    const question = ops.find((op) => op.text === WORDS.question.ar);
    const before = ops.find((op) => op.text === WORDS.before.ar);
    expect(question).toMatchObject({ x: MIRROR(48), align: 'end' });
    expect(before).toMatchObject({ x: MIRROR(48 + 330), align: 'start' });
    expect(ops.some((op) => op.text === WORDS.question.en)).toBe(false);
  });
});

describe('the Arabic progress report', () => {
  it('writes its dates with Arabic month names', () => {
    const texts = textsOf(report('ar', PROGRESS)).map((op) => op.text);
    expect(texts.some((text) => text.includes('سبتمبر'))).toBe(true);
    expect(texts.some((text) => text.includes('September'))).toBe(false);
  });

  it('prints the comparison’s own sentence in Arabic only', () => {
    const texts = textsOf(report('ar', PROGRESS))
      .map((op) => op.text)
      .join(' ');
    expect(texts).toContain(COMPARISON_NOT_A_DIAGNOSIS.ar.split(' ').slice(0, 3).join(' '));
    expect(texts).not.toContain('This is a comparison');
  });

  it('runs the ribbon from the right, as the page is read', () => {
    const slices = layout(report('ar', PROGRESS), fonts)
      .flatMap((page) => page.ops)
      .filter(
        (op): op is Extract<Op, { kind: 'rule' }> => op.kind === 'rule' && op.rgb !== undefined,
      );
    // The first session's slice is the rightmost.
    expect(slices[0]!.x).toBeGreaterThan(slices[1]!.x);
  });
});

describe('a report issued before the decision', () => {
  it('still draws both languages, so it renders to the bytes it was filed as', () => {
    const legacy = { ...report('en', SESSION_EN), bilingual: true };
    const texts = textsOf(legacy).map((op) => op.text);
    expect(texts).toContain(WORDS.client.en);
    expect(texts).toContain(WORDS.client.ar);
  });
});
