import { describe, expect, it } from 'vitest';
import { databaseRefusal } from './databaseRefusal';
import { FIGURE_SENTENCES } from './figureSchema';

/**
 * What the picture doors answer when the database functions refuse
 * (migration 604): each refusal an answer with a sentence, never a 500.
 */

const refusal = (code: string) => Object.assign(new Error('refused'), { code });

describe('databaseRefusal', () => {
  it('answers a refusal of who is asking with 403', () => {
    expect(databaseRefusal(refusal('42501'))).toEqual({
      status: 403,
      body: { error: 'forbidden', code: 'not_permitted', sentence: FIGURE_SENTENCES.not_permitted },
    });
  });

  it('answers a report that has left draft with 422', () => {
    expect(databaseRefusal(refusal('23001'))).toMatchObject({
      status: 422,
      body: { code: 'not_a_draft', sentence: FIGURE_SENTENCES.not_a_draft },
    });
  });

  it('answers a ninth picture with 422', () => {
    expect(databaseRefusal(refusal('54000'))).toMatchObject({
      status: 422,
      body: { code: 'too_many_maps', sentence: FIGURE_SENTENCES.too_many_maps },
    });
  });

  it.each([
    'report_figure_brain_map_only',
    'report_figure_digest_matches',
    'report_figure_is_a_map',
  ])('answers the rule %s, which 604 raises by name, with 422', (constraint) => {
    expect(databaseRefusal(Object.assign(refusal('23514'), { constraint }))).toMatchObject({
      status: 422,
      body: { code: 'not_accepted', sentence: FIGURE_SENTENCES.not_accepted },
    });
  });

  it('leaves any other broken rule to the error handler, which logs it as a fault', () => {
    expect(databaseRefusal(refusal('23514'))).toBeNull();
    expect(
      databaseRefusal(Object.assign(refusal('23514'), { constraint: 'document_sha256_check' })),
    ).toBeNull();
    expect(
      databaseRefusal(Object.assign(refusal('23514'), { constraint: 'report_figure_size' })),
    ).toBeNull();
  });

  it('answers something that is not there with 404', () => {
    expect(databaseRefusal(refusal('P0002'))).toMatchObject({
      status: 404,
      body: { error: 'not_found', code: 'no_such_map', sentence: FIGURE_SENTENCES.no_such_map },
    });
  });

  it('leaves anything else to the error handler', () => {
    expect(databaseRefusal(refusal('40001'))).toBeNull();
    expect(databaseRefusal(new Error('no code'))).toBeNull();
    expect(databaseRefusal('not an error')).toBeNull();
  });
});
