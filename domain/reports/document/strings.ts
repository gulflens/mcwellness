/**
 * Every fixed word on a rendered report, in both languages
 * (docs/SPEC/reports-v1.md section 5).
 *
 * **Headings, labels, the identity block and every fixed sentence render in
 * English and Arabic together**, as the invoice already does. The
 * practitioner's own narrative does not: a paragraph a person wrote is not
 * something a renderer may translate, so it prints in the locale chosen at
 * issue and a household wanting both gets a second report of the same
 * coverage in the other language — a separate report, not a version, because
 * neither supersedes the other.
 *
 * **The two standing sentences are the consent's own words**, taken from
 * `docs/CONSENT/agreement.en.md` and its Arabic twin, so the report and the
 * document the household signed can never drift apart. They are
 * quoted rather than paraphrased for that reason, and they are the only place
 * in this folder where the word "diagnosis" appears at all.
 *
 * **And the draft line** (section 5, and section 10's decision 5): until the
 * practice's lawyer had approved the wording, every copy carried a visible
 * line saying so. The advisor approved it on 2026-09-09 and this round is the
 * pull request that carries the approved text, so the line is off and every
 * wording in `docs/CONSENT` reads `status: approved`.
 *
 * British English throughout, and no word here belongs to the trade that built
 * it: a family reads "Report", never "document id" or "record".
 */

export type Phrase = { en: string; ar: string };

export const WORDMARK = 'McWellness';

export const WORDS = {
  sessionReport: { en: 'Session report', ar: 'تقرير الجلسة' },
  progressReport: { en: 'Progress report', ar: 'تقرير التقدّم' },

  reference: { en: 'Reference', ar: 'الرقم المرجعي' },
  dateOfIssue: { en: 'Date of issue', ar: 'تاريخ الإصدار' },
  version: { en: 'Version', ar: 'الإصدار' },
  amendmentReason: { en: 'Why this version exists', ar: 'سبب هذا الإصدار' },

  client: { en: 'Client', ar: 'العميل' },
  recordNumber: { en: 'Record number', ar: 'رقم السجل' },

  licenceNumber: { en: 'Licence number', ar: 'رقم الرخصة' },
  licensingAuthority: { en: 'Licensing authority', ar: 'جهة الترخيص' },

  // The session report.
  visitDate: { en: 'Date of visit', ar: 'تاريخ الزيارة' },
  service: { en: 'Service', ar: 'الخدمة' },
  practitioner: { en: 'Practitioner', ar: 'الممارس' },
  duration: { en: 'Duration', ar: 'المدة' },
  minutes: { en: 'minutes', ar: 'دقيقة' },
  goalArea: { en: 'Goal worked on', ar: 'الهدف الذي جرى العمل عليه' },
  howItWent: { en: 'How the session went', ar: 'كيف سارت الجلسة' },
  question: { en: 'Question', ar: 'السؤال' },
  before: { en: 'Before', ar: 'قبل' },
  after: { en: 'After', ar: 'بعد' },
  whatWasNoticed: { en: 'What the practitioner noticed', ar: 'ما لاحظه الممارس' },
  tolerance: { en: 'Comfort through the session', ar: 'الراحة خلال الجلسة' },
  engagement: { en: 'Engagement', ar: 'التفاعل' },
  practitionerNote: { en: "The practitioner's note", ar: 'ملاحظة الممارس' },
  beforeNextVisit: { en: 'Before the next visit', ar: 'قبل الزيارة القادمة' },

  // The progress report.
  coverage: { en: 'Period covered', ar: 'الفترة المشمولة' },
  to: { en: 'to', ar: 'إلى' },
  sessions: { en: 'Sessions', ar: 'الجلسات' },
  sessionsDelivered: { en: 'Sessions delivered', ar: 'الجلسات المنفّذة' },
  sessionsEntitled: { en: 'Sessions on the programme', ar: 'جلسات البرنامج' },
  theProgramme: { en: 'The programme so far', ar: 'البرنامج حتى الآن' },
  ribbonLegend: {
    en: 'One mark per session delivered. Taller is a cleaner recording; a hairline marks a brain map.',
    ar: 'علامة واحدة لكل جلسة منفّذة. كلما ارتفعت كان التسجيل أنقى؛ ويشير الخط الرفيع إلى خريطة دماغ.',
  },
  goals: { en: 'Goals', ar: 'الأهداف' },
  goalStatus: { en: 'Status', ar: 'الحالة' },
  whatHasMoved: { en: 'What has moved', ar: 'ما الذي تغيّر' },
  brainMaps: { en: 'Brain maps compared', ar: 'مقارنة خرائط الدماغ' },
  measurement: { en: 'Measurement', ar: 'القياس' },
  earlier: { en: 'Earlier', ar: 'الأسبق' },
  later: { en: 'Later', ar: 'الأحدث' },
  difference: { en: 'Difference', ar: 'الفرق' },
  comparedAgainst: { en: 'Compared against', ar: 'قورنت مع' },
  years: { en: 'years', ar: 'سنة' },
  summary: { en: 'Summary', ar: 'الخلاصة' },
  suggestion: { en: 'What the practice suggests next', ar: 'ما يقترحه المركز بعد ذلك' },

  // The signature block.
  signedBy: { en: 'Signed by', ar: 'وقّعه' },
  certification: { en: 'Certification', ar: 'الشهادة' },
  certifyingBody: { en: 'Certifying body', ar: 'الجهة المانحة' },
  certificateNumber: { en: 'Certificate number', ar: 'رقم الشهادة' },
} as const satisfies Record<string, Phrase>;

/**
 * The reference is the practice's own and nothing else. Said on the page,
 * because a number in a box on a document from a business in the UAE is read
 * as a tax number unless it says otherwise, and this one is not (section 10,
 * decision 4).
 */
export const REFERENCE_BASIS: Phrase = {
  en: "The practice's own reference for this report. It is not a tax number.",
  ar: 'الرقم المرجعي الخاص بالمركز لهذا التقرير، وهو ليس رقماً ضريبياً.',
};

/**
 * The first standing sentence, word for word from `docs/CONSENT/agreement.en.md`
 * section "What we do" and its Arabic twin.
 *
 * Re-pointed on 2026-09-09, when the approved wording replaced the drafts this
 * used to quote. The words changed because the document changed; the rule did
 * not, and it is the whole reason this constant exists rather than a
 * paraphrase — a report and the page a household actually signed say the same
 * thing about what the practice is, or the guarantee is worthless. A test in
 * this folder reads the file and fails if the two ever drift.
 */
export const NOT_A_CLINIC: Phrase = {
  en:
    'We are a wellness practice, not a clinic. We do not diagnose or treat medical or ' +
    'psychological conditions, and we are not an emergency service. Keep seeing your doctor. ' +
    'People respond differently and we cannot promise a result.',
  ar:
    'نحن مركز عافية ولسنا عيادة. لا نشخّص ولا نعالج أي حالة طبية أو نفسية، ولسنا خدمة طوارئ. ' +
    'استمر في مراجعة طبيبك. تختلف استجابة الأشخاص ولا يمكننا أن نعدك بنتيجة.',
};

/**
 * The second, also the consent's own, and from the same page as the first:
 * `docs/CONSENT/agreement.en.md` section "What we do" and its Arabic twin. It
 * is what makes a measurement readable as a measurement — this report
 * describes training and measurement, and a change between two days is a
 * difference between two days.
 *
 * Re-pointed on 2026-09-09 with `NOT_A_CLINIC` above it. Both are quoted from
 * the approved agreement and both are guarded by the drift test in
 * `tests/reports/document.test.ts`, which reads the file: the first was moved
 * and the second was not, and only a test that reads both would have said so.
 */
export const NOT_A_DIAGNOSIS: Phrase = {
  en: 'A brain map (qEEG) is a recording made the same way; it shows patterns and is not a diagnosis.',
  ar: 'وخريطة الدماغ (qEEG) تسجيل يُجرى بالطريقة نفسها؛ تُظهر أنماطًا وليست تشخيصًا.',
};

/**
 * The comparison's own, printed beneath the figures rather than the frame's.
 * Word for word the sentence the Compare screen carries
 * (`app/admin/assessments/copy.ts`, `NOT_A_DIAGNOSIS`), because
 * `docs/SPEC/assessment.md` section 3.3 names that one as the sentence sitting
 * "on the comparison and on anything printed from it": a report that prints
 * the screen's figures owes the reader the screen's sentence, and the frame's
 * standing line about what a brain map is stays where it is, in the footer.
 * Quoted rather than imported: `domain/` may not read a screen's file, and a
 * sentence that must never drift is one a test compares, which
 * `tests/reports/document.test.ts` does in both languages.
 */
export const COMPARISON_NOT_A_DIAGNOSIS: Phrase = {
  en: 'This is a comparison of measurements taken on different days. It is not a diagnosis.',
  ar: 'هذه مقارنة بين قياسات أُخذت في أيام مختلفة. وهي ليست تشخيصاً.',
};

/**
 * The third line, on every copy until the wording is approved (section 10,
 * decision 5). Worded exactly as `docs/CONSENT` words it on every text a
 * person signs today, so a household meets the same sentence in the same
 * place.
 */
export const DRAFT_WORDING: Phrase = {
  en: "Draft wording, in use until the practice's lawyer approves a final version.",
  ar: 'صياغة أولية، تُستخدم إلى أن يعتمد محامي المركز النسخة النهائية.',
};

/**
 * Whether the draft line is printed. A constant rather than a setting: the
 * wording is approved by a person, once, and the pull request that carries the
 * approved text is what turns this off. A column would let a screen turn it off.
 *
 * **Off since 2026-09-09.** The practice's legal advisor approved the wording,
 * subject to four changes this same round carries
 * (docs/CONSENT/README.md). `DRAFT_WORDING` above is kept rather than deleted,
 * because this is a constant a future draft would turn back on and the
 * sentence it prints should not have to be re-invented to do it.
 */
export const WORDING_IS_DRAFT = false;

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const MONTHS_AR = [
  'يناير',
  'فبراير',
  'مارس',
  'أبريل',
  'مايو',
  'يونيو',
  'يوليو',
  'أغسطس',
  'سبتمبر',
  'أكتوبر',
  'نوفمبر',
  'ديسمبر',
];

/**
 * "2026-09-06" as "6 September 2026".
 *
 * Written out rather than left to `Intl`, for the reason billing's own
 * formatter gives: a filed document has to be byte-identical every time it is
 * produced from the same row, and a formatter whose output depends on the ICU
 * build the server happens to carry is not that.
 */
export function formatReportDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  const name = MONTHS[Number(month) - 1];
  if (!year || !day || name === undefined) return isoDate;
  return `${Number(day)} ${name} ${year}`;
}

/** The same day with an Arabic month name. Western digits, as the invoice sets them. */
export function arabicReportDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  const name = MONTHS_AR[Number(month) - 1];
  if (!year || !day || name === undefined) return isoDate;
  return `${Number(day)} ${name} ${year}`;
}

/** A figure a household reads: up to three places, and no trailing zeros. */
export function formatFigure(value: number): string {
  if (!Number.isFinite(value)) return '';
  const rounded = Math.round(value * 1000) / 1000;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

/** The same, signed, for a difference: "+1.4", "-0.7", "0". */
export function formatDifference(value: number): string {
  const text = formatFigure(value);
  return value > 0 ? `+${text}` : text;
}
