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
 * **Both languages, always**, English first with the Arabic beneath, exactly
 * as the invoice's hand-off is composed — a household reads whichever it
 * reads, and the practice does not have to choose for them.
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
  /** "RPT-000001". */
  reference: string;
  /** The practice's own name, as the report itself carries it. */
  practiceName: string;
  /** A short-lived signed link to the bytes. */
  url: string;
};

const WHAT: Record<ReportKind, Record<ReportLocale, string>> = {
  session: { en: 'session report', ar: 'تقرير الجلسة' },
  progress: { en: 'progress report', ar: 'تقرير التقدّم' },
};

export function draftReportMessage(report: SendableReport): DraftedReportMessage {
  const english = WHAT[report.kind].en;
  const arabic = WHAT[report.kind].ar;

  return {
    subject: `${report.practiceName} — ${english} ${report.reference}`,
    text:
      `Your ${english} ${report.reference} from ${report.practiceName} is ready. ` +
      `You can open it here: ${report.url}` +
      '\n\n' +
      `${arabic} ${report.reference} من ${report.practiceName} جاهز. يمكنك فتحه هنا: ${report.url}`,
  };
}
