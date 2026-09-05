import { shapeFor, questionnaireMaximum } from './shapes';
import type { QuestionnaireAnswer, Validated } from './types';

/**
 * The total a person's own answers produce, and the most they could have
 * produced (docs/SPEC/assessment.md section 5, rule 2).
 *
 * **And only that.** Never a category, never a cut-off, never a word. A
 * questionnaire is a self-report measure: it records what somebody said about
 * themselves on a particular day, and a label put beside that score would be a
 * judgement about a person written into a field nobody signed.
 *
 * Every question the shape declares must be answered exactly once, on the
 * scale it declares. An answer to a question the shape does not have, a
 * question left out, an answer off the scale and an answer given twice are all
 * refused with the field named, because a total computed over a set of answers
 * that is not the set the instrument asks for is not that instrument's score.
 */
export function scoreQuestionnaire(
  instrument: string,
  answers: readonly QuestionnaireAnswer[],
): Validated<{ total: number; maximum: number }> {
  const shape = shapeFor(instrument);
  if (shape === null || shape.kind !== 'questionnaire') {
    return { ok: false, field: 'instrument', reason: 'unknown_instrument' };
  }

  const seen = new Map<string, number>();
  for (const [index, answer] of answers.entries()) {
    const question = shape.questions.find((q) => q.key === answer.key);
    if (question === undefined) {
      return { ok: false, field: `answers.${index}.key`, reason: 'unknown_question' };
    }
    if (seen.has(answer.key)) {
      return { ok: false, field: `answers.${index}.key`, reason: 'duplicate_figure' };
    }
    if (typeof answer.value !== 'number' || Number.isNaN(answer.value)) {
      return { ok: false, field: `answers.${index}.value`, reason: 'not_a_number' };
    }
    if (!Number.isFinite(answer.value)) {
      return { ok: false, field: `answers.${index}.value`, reason: 'not_finite' };
    }
    if (!Number.isInteger(answer.value)) {
      return { ok: false, field: `answers.${index}.value`, reason: 'not_an_integer' };
    }
    if (answer.value < question.min || answer.value > question.max) {
      return { ok: false, field: `answers.${index}.value`, reason: 'out_of_scale' };
    }
    seen.set(answer.key, answer.value);
  }

  for (const question of shape.questions) {
    if (!seen.has(question.key)) {
      return { ok: false, field: `answers.${question.key}`, reason: 'missing_question' };
    }
  }

  let total = 0;
  for (const value of seen.values()) {
    total += value;
  }
  return { ok: true, value: { total, maximum: questionnaireMaximum(shape) } };
}
