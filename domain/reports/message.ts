import type { ReportKind, ReportLocale } from './types';

/**
 * The sentence a report goes out with (docs/SPEC/reports-v1.md section 7.2).
 *
 * **Written here rather than in `domain/shared/sending.ts`**, which composes
 * the invoice's and the receipt's. That file is the shared zone and this is a
 * report's own wording, which is what the spec's own table asks for: "a
 * report's own drafted sentence, and a `report_delivery` row". The seam it
 * goes out through — the `wa.me` hand-off, the email implementation and its
 * share-sheet fallback — is shared and is used unchanged.
 *
 * **The message names the document and nothing else.** The reference, the
 * practice and a short-lived signed link. It never says what the visit was
 * about, never names the practitioner, and never carries a figure: a WhatsApp
 * message sits in a notification on a lock screen somebody else may be looking
 * at, and a household's report is not a thing to put there.
 *
 * **In the report's own language, and that one alone** — the operator's
 * decision of 15 October 2026 that nothing the practice sends a household
 * carries both. Until then it was English first with the Arabic beneath.
 *
 * Pure: nothing here touches a network. A person presses send in their own
 * WhatsApp or their own mail app.
 */

export type DraftedReportMessage = {
  text: string;
  subject: string;
};

/** Enough about a report to write a sentence about it. */
export type SendableReport = {
  kind: ReportKind;
  /** The report's own language, which the message is written in. */
  locale: ReportLocale;
  /** "RPT-000001". */
  reference: string;
  /** The practice's own name in that language, as the report itself carries it. */
  practiceName: string;
  /** A short-lived signed link to the bytes. */
  url: string;
};

const WHAT: Record<ReportKind, Record<ReportLocale, string>> = {
  session: { en: 'session report', ar: 'تقرير الجلسة' },
  progress: { en: 'progress report', ar: 'تقرير التقدّم' },
  // The practice's own words for it on the wording sheet: خريطة الدماغ is
  // what the brain-map report's pages call the assessment.
  qeeg: { en: 'brain map report', ar: 'تقرير خريطة الدماغ' },
  // A PDF made in another tool says what it is on its own pages; the message
  // calls it a report and no more, so it never names a kind it cannot vouch
  // for (migration 608). The Arabic wants a reader's check.
  external: { en: 'report', ar: 'تقرير' },
};

export function draftReportMessage(report: SendableReport): DraftedReportMessage {
  const what = WHAT[report.kind][report.locale];
  const subject = `${report.practiceName} — ${what} ${report.reference}`;
  if (report.locale === 'ar') {
    return {
      subject,
      text: `${what} ${report.reference} من ${report.practiceName} جاهز. يمكنك فتحه هنا: ${report.url}`,
    };
  }
  return {
    subject,
    text:
      `Your ${what} ${report.reference} from ${report.practiceName} is ready. ` +
      `You can open it here: ${report.url}`,
  };
}
