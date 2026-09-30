/**
 * A part of a brain-map report's pages, named by the heading it prints under
 * (docs/SPEC/reports-qeeg.md section 12, point 10: "anything that ran over").
 *
 * **Why.** The layout names what runs over by its part id (`summary.1`,
 * `recommendation.2`), which is the layout's own bookkeeping and means nothing
 * to the practitioner. She shortens what ran over under the heading she can
 * see on the page, so the editor is told that heading, in the wording's own
 * words and without its colon. A part with no heading of its own (a map, the
 * closing paragraphs, the signature) is named by the heading it follows on
 * the page, or by the wording's name for the maps.
 *
 * Pure: a part id, an edition and a language in, words out. It never answers
 * the raw id, even for a part it does not know.
 */

import type { Edition, Locale } from '../types';
import { phrase } from '../wording';

/** The first segment of a part id, to the wording key of the heading it prints under. */
const HEADING_OF: Readonly<Record<string, string>> = Object.freeze({
  client: 'heading.client',
  overview: 'heading.overview',
  findings: 'heading.findings',
  focus: 'heading.focus',
  map: 'label.maps',
  maps: 'label.maps',
  brain: 'heading.brain',
  band: 'heading.brain',
  connectivity: 'heading.brain',
  dashboard: 'heading.dashboard',
  recommendations: 'heading.recommendations',
  recommendation: 'heading.recommendations',
  summary: 'heading.summary',
  benefits: 'heading.benefits',
  programme: 'heading.programme',
  approach: 'heading.approach',
  closing: 'heading.programme',
  final: 'heading.programme',
  signature: 'heading.programme',
  change: 'heading.change',
});

const UNKNOWN: Readonly<Record<Locale, string>> = Object.freeze({
  en: 'Another part of the report',
  ar: 'جزء آخر من التقرير',
});

export function partTitle(partId: string, edition: Edition, locale: Locale): string {
  const first = partId.split('.')[0] ?? '';
  const key = Object.hasOwn(HEADING_OF, first) ? HEADING_OF[first] : undefined;
  if (key === undefined) return UNKNOWN[locale];
  return phrase(key, edition, locale).replace(/:$/, '');
}

/** Each heading once, in the order its first part ran over. */
export function partTitles(partIds: readonly string[], edition: Edition, locale: Locale): string[] {
  return [...new Set(partIds.map((id) => partTitle(id, edition, locale)))];
}
