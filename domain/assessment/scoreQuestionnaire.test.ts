import { describe, expect, it } from 'vitest';
import { scoreQuestionnaire } from './scoreQuestionnaire';
import { SAMPLE_QUESTIONNAIRE } from './shapes';

/**
 * The total, and only the total (docs/SPEC/assessment.md section 5, rule 2).
 * Every branch of the function is here, including each way a set of answers
 * can fail to be the set the instrument actually asks for.
 */

const answers = (q1: number, q2: number, q3: number) => [
  { key: 'q1', value: q1 },
  { key: 'q2', value: q2 },
  { key: 'q3', value: q3 },
];

describe('scoring a questionnaire', () => {
  it('adds the answers up and says the most they could have been', () => {
    const scored = scoreQuestionnaire('questionnaire.sample', answers(1, 2, 3));
    expect(scored).toEqual({ ok: true, value: { total: 6, maximum: 12 } });
  });

  it('scores every question at nought as nought, not as nothing', () => {
    const scored = scoreQuestionnaire('questionnaire.sample', answers(0, 0, 0));
    expect(scored.ok && scored.value.total).toBe(0);
  });

  it('refuses an instrument the platform has no shape for', () => {
    expect(scoreQuestionnaire('not-an-instrument', answers(1, 1, 1))).toEqual({
      ok: false,
      field: 'instrument',
      reason: 'unknown_instrument',
    });
  });

  it('refuses the brain map, which is not scored to a total', () => {
    expect(scoreQuestionnaire('qeeg', answers(1, 1, 1))).toEqual({
      ok: false,
      field: 'instrument',
      reason: 'unknown_instrument',
    });
  });

  it('refuses an answer to a question this questionnaire does not ask', () => {
    expect(
      scoreQuestionnaire('questionnaire.sample', [...answers(1, 1, 1), { key: 'q9', value: 1 }]),
    ).toEqual({ ok: false, field: 'answers.3.key', reason: 'unknown_question' });
  });

  it('refuses the same question answered twice', () => {
    expect(
      scoreQuestionnaire('questionnaire.sample', [...answers(1, 1, 1), { key: 'q1', value: 4 }]),
    ).toEqual({ ok: false, field: 'answers.3.key', reason: 'duplicate_figure' });
  });

  it('refuses a question left unanswered, naming it', () => {
    expect(
      scoreQuestionnaire('questionnaire.sample', [
        { key: 'q1', value: 1 },
        { key: 'q2', value: 1 },
      ]),
    ).toEqual({ ok: false, field: 'answers.q3', reason: 'missing_question' });
  });

  it('refuses an answer that is not a number', () => {
    expect(
      scoreQuestionnaire('questionnaire.sample', [
        { key: 'q1', value: 'two' as unknown as number },
        { key: 'q2', value: 1 },
        { key: 'q3', value: 1 },
      ]),
    ).toEqual({ ok: false, field: 'answers.0.value', reason: 'not_a_number' });
  });

  it('refuses an answer that is not a number even when it is typed as one', () => {
    expect(scoreQuestionnaire('questionnaire.sample', answers(Number.NaN, 1, 1))).toEqual({
      ok: false,
      field: 'answers.0.value',
      reason: 'not_a_number',
    });
  });

  it('refuses an answer that runs off to infinity', () => {
    expect(
      scoreQuestionnaire('questionnaire.sample', answers(1, Number.POSITIVE_INFINITY, 1)),
    ).toEqual({ ok: false, field: 'answers.1.value', reason: 'not_finite' });
  });

  it('refuses an answer between two points on the scale', () => {
    expect(scoreQuestionnaire('questionnaire.sample', answers(1, 1, 2.5))).toEqual({
      ok: false,
      field: 'answers.2.value',
      reason: 'not_an_integer',
    });
  });

  it('refuses an answer above the top of the scale', () => {
    expect(scoreQuestionnaire('questionnaire.sample', answers(1, 1, 5))).toEqual({
      ok: false,
      field: 'answers.2.value',
      reason: 'out_of_scale',
    });
  });

  it('refuses an answer below the bottom of the scale', () => {
    expect(scoreQuestionnaire('questionnaire.sample', answers(-1, 1, 1))).toEqual({
      ok: false,
      field: 'answers.0.value',
      reason: 'out_of_scale',
    });
  });

  it('names no real questionnaire and attaches no word to a score', () => {
    // Decision 5: the mechanism, exercised by one synthetic instrument. A
    // licensed questionnaire's name, questions or scoring appears nowhere.
    expect(SAMPLE_QUESTIONNAIRE.instrument).toBe('questionnaire.sample');
    expect(SAMPLE_QUESTIONNAIRE.questions).toHaveLength(3);
    const scored = scoreQuestionnaire('questionnaire.sample', answers(4, 4, 4));
    expect(scored.ok && Object.keys(scored.value).sort()).toEqual(['maximum', 'total']);
  });
});
