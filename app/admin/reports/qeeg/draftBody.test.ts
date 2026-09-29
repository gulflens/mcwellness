import { describe, expect, it } from 'vitest';
import { blankFollowUp, blankInitial } from '../../../../domain/reports/qeeg/blank';
import { routeOwnedIn } from '../../../../domain/reports/qeeg/draftRequest';
import type { ComparedWith, QeegFollowUp } from '../../../../domain/reports/qeeg/types';
import { requestBody, withServerParts } from './draftBody';

/**
 * What the form sends to `POST /api/reports/draft`, and what it takes back.
 * The route refuses a body carrying any part it owns (`routeOwnedIn`), so the
 * form leaves those out, and takes them back from the answer.
 */

const COMPARED: ComparedWith = {
  reportId: '00000006-0000-4000-8000-000000000001',
  recordedOn: '2026-06-01',
  relation: 'initial',
  origin: 'issued',
  reference: 'RPT-000001',
};

describe('the body a save sends', () => {
  it('carries nothing the route owns, in either edition', () => {
    expect(routeOwnedIn(requestBody(blankInitial()))).toEqual([]);
    expect(routeOwnedIn(requestBody(blankFollowUp(COMPARED, 'follow_up')))).toEqual([]);
  });

  it('names only which report a follow-up is compared with', () => {
    const body = requestBody(blankFollowUp(COMPARED, 'follow_up'));
    expect(body['comparedWith']).toEqual({ reportId: COMPARED.reportId });
  });

  it('cleans the summary before it is sent, marks and all', () => {
    const content = {
      ...blankInitial(),
      summary: {
        en: { text: '  calm​ now ', marks: [{ from: 2, to: 6, bold: true as const }] },
        ar: null,
      },
    };
    const body = requestBody(content) as { summary: { en: unknown } };
    expect(body.summary.en).toEqual({ text: 'calm now', marks: [{ from: 0, to: 4, bold: true }] });
  });

  it('cleans the follow-up page’s own summary too', () => {
    const blank = blankFollowUp(COMPARED, 'follow_up');
    const content: QeegFollowUp = {
      ...blank,
      change: { ...blank.change, summary: { en: { text: ' fewer ', marks: [] }, ar: null } },
    };
    const body = requestBody(content) as { change: { summary: { en: { text: string } } } };
    expect(body.change.summary.en.text).toBe('fewer');
  });
});

describe('what a save hands back', () => {
  it('takes the client, the comparison and the earlier scores from the server', () => {
    const local = blankFollowUp({ ...COMPARED, recordedOn: '', reference: 'RPT-000001' }, 'final');
    const saved: QeegFollowUp = {
      ...blankFollowUp(COMPARED, 'follow_up'),
      subject: { nameAr: null, ageYears: 9, sex: 'female' },
      dashboard: {
        ...local.dashboard,
        mental_energy: { score: null, evidence: null, earlierScore: 4 },
      },
    };
    const merged = withServerParts(local, saved) as QeegFollowUp;
    expect(merged.subject.ageYears).toBe(9);
    expect(merged.comparedWith.recordedOn).toBe('2026-06-01');
    expect(merged.dashboard.mental_energy.earlierScore).toBe(4);
    // What she chose stays hers.
    expect(merged.stage).toBe('final');
  });

  it('keeps what she typed while the save was on its way', () => {
    const local = { ...blankInitial(), summary: { en: { text: 'typing ', marks: [] }, ar: null } };
    const merged = withServerParts(local, blankInitial());
    expect(merged.summary.en.text).toBe('typing ');
  });
});
