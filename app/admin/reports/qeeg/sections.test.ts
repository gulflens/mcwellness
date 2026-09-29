import { describe, expect, it } from 'vitest';
import { blankFollowUp, blankInitial } from '../../../../domain/reports/qeeg/blank';
import { missingForIssue } from '../../../../domain/reports/qeeg/complete';
import type { ComparedWith } from '../../../../domain/reports/qeeg/types';
import {
  SECTION_TITLES,
  leftBySection,
  missingWords,
  sectionOfField,
  sectionsFor,
  setAsideWords,
} from './sections';

/**
 * The form's sections, and how much of each is left: read from the domain's
 * `missingForIssue`, grouped, never worked out again here.
 */

const COMPARED: ComparedWith = {
  reportId: '00000006-0000-4000-8000-000000000001',
  recordedOn: '2026-06-01',
  relation: 'initial',
  origin: 'issued',
  reference: 'RPT-000001',
};

describe('the sections of the brain-map form', () => {
  it('are the report’s eleven in its order for a first report', () => {
    expect(sectionsFor('initial')).toEqual([
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
    ]);
  });

  it('add what a follow-up is compared with at the top and the page of what has changed', () => {
    const sections = sectionsFor('follow-up');
    expect(sections[0]).toBe('compared');
    expect(sections.at(-1)).toBe('change');
    expect(sections).toHaveLength(13);
  });

  it('give every missing thing of a blank report, of either edition, a section', () => {
    for (const content of [blankInitial(), blankFollowUp(COMPARED, 'follow_up')]) {
      const grouped = leftBySection(content);
      const total = Object.values(grouped).reduce((sum, list) => sum + list.length, 0);
      expect(total).toBe(missingForIssue(content).length);
      expect(total).toBe(26);
    }
  });

  it('count a blank first report’s client and recording as four', () => {
    // Date, eyes, handedness, and the age the record gives.
    expect(leftBySection(blankInitial()).client).toHaveLength(4);
  });

  it('name what is missing in the report’s own words, without a trailing colon', () => {
    expect(missingWords({ section: 'heading.findings', what: 'heading.findings' }, 'initial')).toBe(
      'Key Findings',
    );
    expect(missingWords({ section: 'heading.brain', what: 'band.delta.name' }, 'initial')).toBe(
      'Delta',
    );
  });

  it('have a plain title each', () => {
    for (const edition of ['initial', 'follow-up'] as const) {
      for (const section of sectionsFor(edition)) {
        expect(SECTION_TITLES[section]).toMatch(/^[A-Z][a-z ,]+$/);
      }
    }
  });
});

describe('what an edition switch set aside, in words', () => {
  it('names a band and the level it had', () => {
    expect(setAsideWords({ at: 'bands.theta', was: 'increased' }, 'initial')).toBe(
      'Theta: Increased',
    );
  });

  it('names the approach, and the brain-map-only choice', () => {
    expect(setAsideWords({ at: 'plan.approach', was: 'calming' }, 'initial')).toBe(
      'Initial Training Approach: Calming',
    );
    expect(setAsideWords({ at: 'plan.sessions', was: 'qeeg_only' }, 'initial')).toBe(
      'Number of sessions: Not applicable / QEEG only',
    );
  });

  it('names a follow-up’s change and its next stage', () => {
    expect(setAsideWords({ at: 'connectivity.asymmetry', was: 'improved' }, 'follow-up')).toMatch(
      /^Amplitude Asymmetry: /,
    );
    expect(setAsideWords({ at: 'plan.next', was: 'continue_current' }, 'follow-up')).toMatch(
      /^Next Stage of Training: /,
    );
  });
});

describe('where a refused field sits', () => {
  it('finds the section from the path the server names', () => {
    expect(sectionOfField('recording.recordedOn')).toBe('client');
    expect(sectionOfField('findings.custom.c0.label.en')).toBe('findings');
    expect(sectionOfField('plan.approach')).toBe('programme');
    expect(sectionOfField('change.tiles.t0.caption.en')).toBe('change');
    expect(sectionOfField('comparedWith.reportId')).toBe('compared');
    expect(sectionOfField('')).toBeNull();
  });
});
