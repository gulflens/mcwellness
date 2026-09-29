import { describe, expect, it } from 'vitest';
import { CANNOT_COMPARE, DRAFT_REFUSALS, refusalSentence } from './refusals';

/**
 * Every refusal the brain-map draft route answers has a sentence of its own
 * (app/api/reports/qeegDraft.ts), so a practitioner is told what happened and
 * never "something went wrong".
 */

describe('what the form says when a save is refused', () => {
  it('has a different sentence for every code the route answers', () => {
    const codes = [
      'invalid_request',
      'reason_required',
      'invalid_content',
      'route_owned',
      'wrong_kind',
      'already_issued',
      'imported_draft',
      'locale_fixed',
      'cannot_compare',
      'stale_draft',
    ];
    for (const code of codes) expect(DRAFT_REFUSALS[code]).toBeTruthy();
    expect(new Set(codes.map((code) => DRAFT_REFUSALS[code])).size).toBe(codes.length);
  });

  it('reads the code the route puts in `code`, or in `error` where it has no code', () => {
    expect(refusalSentence(409, { error: 'conflict', code: 'stale_draft' })).toBe(
      DRAFT_REFUSALS['stale_draft'],
    );
    expect(refusalSentence(400, { error: 'reason_required' })).toBe(
      DRAFT_REFUSALS['reason_required'],
    );
  });

  it('says who may not, and what cannot be found', () => {
    expect(refusalSentence(403, { error: 'forbidden' })).toMatch(/not allowed/);
    expect(refusalSentence(404, { error: 'not_found' })).toMatch(/could not be found/);
  });

  it('says why a comparison was refused, reason by reason', () => {
    for (const reason of Object.keys(CANNOT_COMPARE)) {
      expect(refusalSentence(422, { code: 'cannot_compare', reason })).toBe(CANNOT_COMPARE[reason]);
    }
    expect(new Set(Object.values(CANNOT_COMPARE)).size).toBe(Object.keys(CANNOT_COMPARE).length);
  });

  it('names the section and the reason of a field the shape refused', () => {
    const sentence = refusalSentence(400, {
      code: 'invalid_content',
      field: 'findings.custom.c0.label.en',
      refusals: [
        { path: 'findings.custom.c0.label.en', reason: 'A label she adds is never empty.' },
      ],
    });
    expect(sentence).toBe(
      'Something in Key findings is not what the report accepts: A label she adds is never empty.',
    );
  });

  it('falls back to a plain sentence for anything else', () => {
    expect(refusalSentence(500, null)).toBe(
      'The draft could not be saved. Check the connection and try again.',
    );
  });
});
