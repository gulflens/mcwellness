import { describe, expect, it } from 'vitest';
import { blankFollowUp, blankInitial } from './blank';
import { QEEG_ONLY } from './catalogue/ids';
import { missingForIssue } from './complete';
import { approachLine, programmeAgreed } from './sentences';
import { validateQeegContent } from './shape';
import { toFollowUp } from './switchEdition';
import type { ComparedWith, QeegInitial } from './types';
import { phrase } from './wording';

/**
 * A brain map with no training programme after it (the practice's request of
 * 30 September 2026). A client may come for the brain map alone. The
 * practitioner then chooses "Not applicable / QEEG only" where the number of
 * sessions is chosen, and the report prints neither the programme length nor
 * the initial training approach, because no programme has been agreed.
 */

const EARLIER: ComparedWith = {
  reportId: '00000001-0000-4000-8000-000000000001',
  reference: 'RPT-000001',
  recordedOn: '2026-06-01',
  origin: 'issued',
  relation: 'initial',
};

function qeegOnly(): QeegInitial {
  const blank = blankInitial();
  return { ...blank, plan: { sessions: QEEG_ONLY, approach: null } };
}

describe('a first report for a brain map only', () => {
  it('is a shape the report accepts', () => {
    expect(validateQeegContent(qeegOnly()).ok).toBe(true);
  });

  it('refuses a training approach beside it, by the approach', () => {
    const both = { ...qeegOnly(), plan: { sessions: QEEG_ONLY, approach: 'calming' } };
    const result = validateQeegContent(both);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusals.map((refusal) => refusal.path)).toContain('plan.approach');
  });

  it('refuses any other word where a number of sessions goes', () => {
    const result = validateQeegContent({
      ...qeegOnly(),
      plan: { sessions: 'none', approach: null },
    });
    expect(result.ok).toBe(false);
  });

  it('asks for neither a number of sessions nor a training approach before it is signed', () => {
    const missing = missingForIssue(qeegOnly()).map((item) => item.what);
    expect(missing).not.toContain('label.sessions');
    expect(missing).not.toContain('heading.approach');
  });

  it('still asks for the training approach when a number of sessions is chosen', () => {
    const programme = { ...blankInitial(), plan: { sessions: 20, approach: null } };
    expect(missingForIssue(programme).map((item) => item.what)).toContain('heading.approach');
  });

  it('has no programme agreed, and no approach line to print', () => {
    expect(programmeAgreed(qeegOnly())).toBe(false);
    expect(approachLine(qeegOnly(), 'en')).toBeNull();
    expect(approachLine(qeegOnly(), 'ar')).toBeNull();
  });

  it('has a programme agreed when a number of sessions is chosen, or none yet', () => {
    expect(programmeAgreed({ ...blankInitial(), plan: { sessions: 20, approach: null } })).toBe(
      true,
    );
    expect(programmeAgreed(blankInitial())).toBe(true);
    expect(programmeAgreed(blankFollowUp(EARLIER, 'follow_up'))).toBe(true);
  });

  it('names the choice in both languages', () => {
    expect(phrase('label.qeeg_only', 'initial', 'en')).toBe('Not applicable / QEEG only');
    expect(phrase('label.qeeg_only', 'initial', 'ar').length).toBeGreaterThan(0);
  });
});

describe('a follow-up', () => {
  it('does not offer the choice: a follow-up comes after training', () => {
    const followUp = blankFollowUp(EARLIER, 'follow_up');
    const result = validateQeegContent({ ...followUp, plan: { sessions: QEEG_ONLY, next: null } });
    expect(result.ok).toBe(false);
  });

  it('sets the choice aside when a brain-map-only report is turned into one', () => {
    const turned = toFollowUp(qeegOnly(), EARLIER, 'follow_up');
    expect(turned.ok).toBe(true);
    if (!turned.ok) return;
    expect(turned.content.plan.sessions).toBeNull();
    expect(turned.setAside).toContainEqual({ at: 'plan.sessions', was: QEEG_ONLY });
  });
});
