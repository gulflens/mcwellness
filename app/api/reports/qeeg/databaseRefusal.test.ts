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

  it('answers a rule the picture breaks with 422', () => {
    expect(databaseRefusal(refusal('23514'))).toMatchObject({
      status: 422,
      body: { code: 'not_accepted', sentence: FIGURE_SENTENCES.not_accepted },
    });
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
