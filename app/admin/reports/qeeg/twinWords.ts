import type { ReportRow } from '../../../api/reports/schema';

/**
 * What the Reports tab and a report's own page say of a brain map's other
 * language (docs/SPEC/reports-qeeg.md section 8; brief Q, items 6 and 7).
 *
 * **Its language, and its twin, by reference.** Each language is signed as a
 * report of its own, so the list holds two rows for one recording; each says
 * which language it is in and names the other, so neither is taken for a
 * duplicate. A draft of the other language has no reference yet, and says so.
 *
 * **Out of step, in a sentence.** When the report a second language was made
 * from has been corrected since, the second no longer matches it (section 8,
 * point 5). The server works that out when the rows are read (`outOfStep`);
 * this only says it.
 *
 * In English, as every staff screen is: a language is named, never shown.
 */

const LANGUAGE: Readonly<Record<ReportRow['locale'], string>> = Object.freeze({
  en: 'English',
  ar: 'Arabic',
});

/** A brain map's language, in English; null for the kinds with one language. */
export function languageWord(report: ReportRow): string | null {
  return report.kind === 'qeeg' ? LANGUAGE[report.locale] : null;
}

function named(report: ReportRow | undefined, fallback: string): string {
  if (!report) return fallback;
  return report.reference ?? 'a draft';
}

/** The lines a row carries about its other language, in the order they are read. */
export function twinLines(report: ReportRow, reports: readonly ReportRow[]): string[] {
  const lines: string[] = [];
  if (report.twinId !== null) {
    const twin = reports.find((each) => each.id === report.twinId);
    const language = LANGUAGE[report.locale === 'en' ? 'ar' : 'en'];
    lines.push(`${language} version: ${named(twin, 'a report of its own')}`);
  }
  if (report.twinOfId !== null) {
    const first = reports.find((each) => each.id === report.twinOfId);
    const reference = named(first, 'a signed report');
    lines.push(`Made from ${reference}, in ${LANGUAGE[report.locale === 'en' ? 'ar' : 'en']}`);
    if (report.outOfStep) {
      lines.push(
        `Out of step: ${reference} has been corrected since, so this report no longer matches it.`,
      );
    }
  }
  return lines;
}
