import { describe, expect, it } from 'vitest';
import { validateContent } from './validateContent';
import type { ProgressReportContent, SessionReportContent } from './types';

/** Rule 2 (docs/SPEC/reports-v1.md section 8): refused with the field named. */

const SESSION = '00000003-0000-4000-8000-000000000001';
const ASSESSMENT_A = '00000000-0000-4000-8000-0000000005a1';
const ASSESSMENT_B = '00000000-0000-4000-8000-0000000005a2';

function session(over: Partial<SessionReportContent> = {}): SessionReportContent {
  return {
    kind: 'session',
    sessionId: SESSION,
    visitDate: '2026-09-01',
    serviceName: 'Neurofeedback session',
    serviceNameAr: 'جلسة نيوروفيدباك',
    practitionerName: 'Hazel Harbour',
    durationMinutes: 60,
    goalArea: 'Sleep',
    ratings: [{ key: 'calm', label: 'How calm do you feel?', labelAr: null, before: 4, after: 7 }],
    observationChips: ['settled quickly'],
    tolerance: 8,
    engagement: 7,
    note: 'A steady visit.',
    beforeNextVisit: 'Keep to the same bedtime.',
    ...over,
  };
}

function progress(over: Partial<ProgressReportContent> = {}): ProgressReportContent {
  return {
    kind: 'progress',
    coverageFrom: '2026-06-01',
    coverageTo: '2026-09-01',
    sessionsDelivered: 12,
    sessionsEntitled: 15,
    goals: [
      {
        id: '00000009-0000-4000-8000-000000000001',
        description: 'Sleep through the night',
        status: 'active',
        movement: 'Two hours longer.',
      },
    ],
    ribbon: {
      slices: [{ index: 1, quality: 0.82, band: 'alpha', mapMark: true }],
      remaining: 3,
    },
    comparison: {
      instrument: 'qeeg',
      earlierOn: '2026-06-02',
      laterOn: '2026-08-30',
      earlierAssessmentId: ASSESSMENT_A,
      laterAssessmentId: ASSESSMENT_B,
      referenceAgeYears: 9,
      referenceSex: 'female',
      lines: [
        {
          label: 'Frontal ratio',
          labelAr: null,
          unit: 'ratio',
          earlier: 2.4,
          later: 2.1,
          difference: -0.3,
        },
      ],
    },
    summary: 'Sleeping longer and settling faster.',
    suggestion: 'Three more sessions, then a re-map.',
    ...over,
  };
}

describe('validateContent', () => {
  it('accepts a session body and a progress body', () => {
    expect(validateContent('session', session()).ok).toBe(true);
    expect(validateContent('progress', progress()).ok).toBe(true);
  });

  it('refuses a body that is not a set of fields', () => {
    for (const value of [null, 'a report', 42, ['a']]) {
      const answer = validateContent('session', value);
      expect(answer.ok).toBe(false);
    }
  });

  it('refuses a body whose kind is not the report’s, and names the field', () => {
    const answer = validateContent('session', progress());
    expect(answer).toMatchObject({ ok: false, field: 'kind' });
  });

  it('names the missing field rather than saying "invalid"', () => {
    const without: Record<string, unknown> = { ...session() };
    delete without.visitDate;
    const answer = validateContent('session', without);
    expect(answer).toMatchObject({ ok: false, field: 'visitDate' });
  });

  it('names a field deep inside a list', () => {
    const answer = validateContent(
      'session',
      session({ ratings: [{ key: 'calm', label: 'Calm?', labelAr: null, before: 44, after: 7 }] }),
    );
    expect(answer).toMatchObject({ ok: false, field: 'ratings.0.before' });
  });

  it('refuses a field the shape does not know, so nothing is silently dropped', () => {
    // `content` is what a report is re-rendered from years later; a field the
    // renderer never reads would be a promise the document does not keep.
    const answer = validateContent('session', { ...session(), electrodeSite: 'Cz' });
    expect(answer).toMatchObject({ ok: false, field: 'electrodeSite' });
  });

  it('refuses a coverage that ends before it begins, and says which field', () => {
    const answer = validateContent(
      'progress',
      progress({ coverageFrom: '2026-09-01', coverageTo: '2026-06-01' }),
    );
    expect(answer).toMatchObject({ ok: false, field: 'coverageTo' });
  });

  it('refuses a date that is not a date', () => {
    expect(validateContent('session', session({ visitDate: '1 September' }))).toMatchObject({
      ok: false,
      field: 'visitDate',
    });
  });

  it('refuses a rating outside nought to ten, and a quality outside nought to one', () => {
    expect(validateContent('session', session({ tolerance: 11 }))).toMatchObject({
      ok: false,
      field: 'tolerance',
    });
    expect(
      validateContent(
        'progress',
        progress({
          ribbon: {
            slices: [{ index: 1, quality: 1.4, band: null, mapMark: false }],
            remaining: 0,
          },
        }),
      ),
    ).toMatchObject({ ok: false, field: 'ribbon.slices.0.quality' });
  });

  it('refuses a band that is not one of the five', () => {
    expect(
      validateContent(
        'progress',
        progress({
          ribbon: {
            slices: [{ index: 1, quality: 0.5, band: 'mu' as never, mapMark: false }],
            remaining: 0,
          },
        }),
      ),
    ).toMatchObject({ ok: false, field: 'ribbon.slices.0.band' });
  });

  it('accepts a progress report with no comparison, which is the ordinary case', () => {
    // The assessment table lives in another stream's range and may not be on
    // this database at all (section 6, no foreign key).
    expect(validateContent('progress', progress({ comparison: null })).ok).toBe(true);
  });

  it('accepts an empty narrative, because a draft is written a piece at a time', () => {
    expect(validateContent('progress', progress({ summary: '', suggestion: '' })).ok).toBe(true);
  });

  it('answers the parsed body, so a caller never re-reads the value it passed', () => {
    const answer = validateContent('session', session());
    expect(answer.ok).toBe(true);
    if (answer.ok) expect(answer.content.kind).toBe('session');
  });
});
