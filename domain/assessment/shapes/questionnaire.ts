/**
 * The questionnaire mechanism, and the one synthetic instrument that
 * exercises it (docs/SPEC/assessment.md section 10, decision 5).
 *
 * A questionnaire is a shape declared by its questions, each answered on a
 * declared scale, totalled to a maximum. That is the whole of it. Adding the
 * one the practice licenses is one more entry in `QUESTIONNAIRE_SHAPES` — a
 * list of questions and their scales — and nothing else: no branch, no second
 * validator, no scoring function of its own.
 *
 * **No real questionnaire is named here.** `00-data-model.md` section 9 named
 * seven before any was licensed and before this practice used one; several are
 * somebody else's property and the licence is the operator's to hold. Until
 * the operator names one, `questionnaire.sample` is the only questionnaire
 * this platform has, its three questions say nothing about anybody, and its
 * scale is a plain nought-to-four.
 *
 * **The total is the whole of the answer.** There is no cut-off here, no band
 * and no word: `scoreQuestionnaire` returns the total the person's own answers
 * produce and the most they could have produced, and a payload carrying an
 * interpretation is refused (`validateDerived`).
 */

/** One question, and the scale it is answered on. */
export type QuestionnaireQuestion = {
  /** Stable: an answer is recorded against this, never against the wording. */
  key: string;
  /** What the person is asked, in the two languages the app speaks. */
  labelEn: string;
  labelAr: string;
  /** The lowest and highest an answer may be. Whole numbers, inclusive. */
  min: number;
  max: number;
};

export type QuestionnaireShape = {
  kind: 'questionnaire';
  instrument: string;
  versions: readonly string[];
  /**
   * The service whose credential is required to record one. Null here, and
   * deliberately: a questionnaire is a form a person fills in and the practice
   * files, and there is no service in the catalogue that is the taking of one.
   * The route reads null as "a valid credential to execute any of this
   * practice's services", which is the honest floor — the person recording it
   * is a practising practitioner — rather than an invented service code.
   */
  serviceCode: string | null;
  questions: readonly QuestionnaireQuestion[];
};

export const SAMPLE_QUESTIONNAIRE: QuestionnaireShape = {
  kind: 'questionnaire',
  instrument: 'questionnaire.sample',
  versions: ['1'],
  serviceCode: null,
  questions: [
    {
      key: 'q1',
      labelEn: 'How well did you sleep in the past week?',
      labelAr: 'كيف كان نومك في الأسبوع الماضي؟',
      min: 0,
      max: 4,
    },
    {
      key: 'q2',
      labelEn: 'How easy was it to settle to a task in the past week?',
      labelAr: 'ما مدى سهولة انصرافك إلى مهمة في الأسبوع الماضي؟',
      min: 0,
      max: 4,
    },
    {
      key: 'q3',
      labelEn: 'How rested did you feel in the past week?',
      labelAr: 'إلى أي مدى شعرت بالراحة في الأسبوع الماضي؟',
      min: 0,
      max: 4,
    },
  ],
};

export const QUESTIONNAIRE_SHAPES: readonly QuestionnaireShape[] = [SAMPLE_QUESTIONNAIRE];

/** The most a person could score on this questionnaire: every question at its own top. */
export function questionnaireMaximum(shape: QuestionnaireShape): number {
  return shape.questions.reduce((total, question) => total + question.max, 0);
}
