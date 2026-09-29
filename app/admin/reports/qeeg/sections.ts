import { missingForIssue } from '../../../../domain/reports/qeeg/complete';
import type { SetAside } from '../../../../domain/reports/qeeg/switchEdition';
import type { Edition, Missing, QeegContent } from '../../../../domain/reports/qeeg/types';
import { phrase } from '../../../../domain/reports/qeeg/wording';

/**
 * The sections of the brain-map form, in the order of the report, and what
 * each still needs (docs/SPEC/reports-qeeg.md section 15).
 *
 * **How much is left is the domain's answer, grouped.** `missingForIssue` is
 * the one list of what a report needs before it can be signed; the issue
 * route refuses on it. This file only says which section of the form each
 * item belongs to, by the heading key the domain already gives it, so the
 * count a section shows and the refusal a signature meets cannot disagree.
 * Nothing here decides whether a thing is filled.
 *
 * **Eleven sections, and two more for a follow-up.** The report's own
 * sections, from the client to the programme. A follow-up adds what it is
 * compared with at the top and the page of what has changed at the end. The
 * brain maps' own section (the twelfth) arrives with the pictures; until then
 * "Brain maps" is counted where the domain puts it, under the bands, whose
 * heading it prints beneath.
 *
 * The section titles are the console's words for its own form, in English
 * (tests/lint/console-is-english.test.ts). What a section asks for is named
 * in the report's own words, through the wording.
 */

export type SectionId =
  | 'compared'
  | 'client'
  | 'overview'
  | 'findings'
  | 'focus'
  | 'bands'
  | 'connectivity'
  | 'dashboard'
  | 'recommendations'
  | 'summary'
  | 'benefits'
  | 'programme'
  | 'change';

export const SECTION_TITLES: Readonly<Record<SectionId, string>> = Object.freeze({
  compared: 'Compared with',
  client: 'Client and recording',
  overview: 'Overview',
  findings: 'Key findings',
  focus: 'Areas of focus',
  bands: 'Frequency bands',
  connectivity: 'Connectivity',
  dashboard: 'Performance dashboard',
  recommendations: 'Recommendations',
  summary: 'Summary',
  benefits: 'Benefits',
  programme: 'Programme',
  change: 'What has changed',
});

const COMMON: readonly SectionId[] = [
  'client',
  'overview',
  'findings',
  'focus',
  'bands',
  'connectivity',
  'dashboard',
  'recommendations',
  'summary',
  'benefits',
  'programme',
];

export function sectionsFor(edition: Edition): readonly SectionId[] {
  switch (edition) {
    case 'initial':
      return COMMON;
    case 'follow-up':
      return ['compared', ...COMMON, 'change'];
    default: {
      const unknown: never = edition;
      return unknown;
    }
  }
}

/** The domain's heading key for what is missing, to the form's section. */
const BY_HEADING: Readonly<Record<string, SectionId>> = Object.freeze({
  'heading.client': 'client',
  'heading.recording': 'client',
  'heading.findings': 'findings',
  'heading.focus': 'focus',
  'heading.brain': 'bands',
  'label.findings': 'connectivity',
  'heading.dashboard': 'dashboard',
  'heading.recommendations': 'recommendations',
  'heading.summary': 'summary',
  'heading.benefits': 'benefits',
  'heading.programme': 'programme',
  'heading.approach': 'programme',
});

function emptyGroups(): Record<SectionId, Missing[]> {
  return {
    compared: [],
    client: [],
    overview: [],
    findings: [],
    focus: [],
    bands: [],
    connectivity: [],
    dashboard: [],
    recommendations: [],
    summary: [],
    benefits: [],
    programme: [],
    change: [],
  };
}

/**
 * What each section still needs. A heading the form does not know throws: it
 * would be a thing the signature refuses and no section shows, and a test
 * should meet it before she does.
 */
export function leftBySection(content: QeegContent): Record<SectionId, Missing[]> {
  const groups = emptyGroups();
  for (const missing of missingForIssue(content)) {
    const section = BY_HEADING[missing.section];
    if (section === undefined) {
      throw new Error(`The form has no section for ${missing.section}.`);
    }
    groups[section].push(missing);
  }
  return groups;
}

/** A heading of the report as a label: its trailing colon dropped. */
function asLabel(words: string): string {
  return words.replace(/:\s*$/, '');
}

/** What is missing, named in the report's own words. */
export function missingWords(missing: Missing, edition: Edition): string {
  return asLabel(phrase(missing.what, edition, 'en'));
}

/**
 * A choice an edition switch cleared (`switchEdition.ts`), in words: where it
 * was and what it had been, each from the wording of the edition it was made
 * in.
 */
export function setAsideWords(item: SetAside, from: Edition): string {
  const [part, name] = item.at.split('.');
  const en = (key: string) => asLabel(phrase(key, from, 'en'));
  if (part === 'bands' && name) {
    const was =
      from === 'initial' ? `level.band.${item.was}.label` : `change.band.${item.was}.label`;
    return `${en(`band.${name}.name`)}: ${en(was)}`;
  }
  if (part === 'connectivity' && name) {
    const was =
      from === 'initial' ? `level.${name}.${item.was}.label` : `change.${name}.${item.was}.label`;
    return `${en(`connectivity.${name}.title`)}: ${en(was)}`;
  }
  if (item.at === 'plan.approach') {
    return `${en('heading.approach')}: ${en(`approach.${item.was}.label`)}`;
  }
  if (item.at === 'plan.next') {
    return `${en('heading.approach')}: ${en(`next.${item.was}.label`)}`;
  }
  if (item.at === 'plan.sessions') {
    return `${en('label.sessions')}: ${en('label.qeeg_only')}`;
  }
  return item.at;
}

/** The first part of a dotted path the server refused, to the section it sits in. */
const BY_FIELD: Readonly<Record<string, SectionId>> = Object.freeze({
  comparedWith: 'compared',
  stage: 'compared',
  recording: 'client',
  findings: 'findings',
  focus: 'focus',
  bands: 'bands',
  maps: 'bands',
  connectivity: 'connectivity',
  dashboard: 'dashboard',
  recommendations: 'recommendations',
  summary: 'summary',
  benefits: 'benefits',
  plan: 'programme',
  change: 'change',
});

export function sectionOfField(path: string): SectionId | null {
  const first = path.split('.')[0] ?? '';
  return Object.hasOwn(BY_FIELD, first) ? (BY_FIELD[first] ?? null) : null;
}
