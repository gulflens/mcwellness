/**
 * The assessment module's public surface (docs/SPEC/assessment.md section 5).
 *
 * Browser-safe, like every domain barrel (docs/SPEC/OWNERSHIP.md): pure types
 * and pure functions, no Node built-in, no I/O, no clock read inside.
 *
 * **`compare` and its `Comparison` are the module's contract with the reports
 * stream.** A report quotes a comparison into its own snapshot through the
 * assessment ids the value carries, never through a foreign key to this
 * stream's table, because a 600-range migration may not assume a 500-range one
 * is on the database (docs/SPEC/reports-v1.md section 6, OWNERSHIP.md). So
 * `Comparison` is plain data — no class, no date object, no function —
 * and it survives `JSON.stringify` and comes back the same.
 */

export {
  BANDS,
  BRAIN_MAP_CONDITIONS,
  INSTRUMENTS,
  MAX_CONDITION_NOTE_LENGTH,
  MAX_SUPERSEDE_REASON_LENGTH,
  REFERENCE_SEXES,
  SITES,
  UNITS,
  isInstrument,
  type Assessment,
  type Band,
  type BandFigure,
  type BrainMapCondition,
  type BrainMapPayload,
  type DerivedPayload,
  type FieldRefusal,
  type Instrument,
  type Provenance,
  type QuestionnaireAnswer,
  type QuestionnairePayload,
  type ReferenceSex,
  type RefusalReason,
  type Site,
  type Unit,
  type Validated,
} from './types';

export {
  BRAIN_MAP_SHAPE,
  QUESTIONNAIRE_SHAPES,
  SAMPLE_QUESTIONNAIRE,
  SHAPES,
  figureKey,
  questionnaireMaximum,
  serviceCodeFor,
  shapeFor,
  shapeKnowsVersion,
  type BrainMapShape,
  type QuestionnaireQuestion,
  type QuestionnaireShape,
  type Shape,
} from './shapes';

export { INTERPRETATION_FIELDS, validateDerived } from './validateDerived';
export { scoreQuestionnaire } from './scoreQuestionnaire';
export {
  compare,
  type ComparedFigure,
  type Comparison,
  type ComparisonRefusal,
  type ComparisonSide,
  type CompareResult,
  type UnpairedFigure,
} from './compare';
export { currentVersions, type VersionChain } from './currentVersions';
export {
  canSupersede,
  type SupersedeDecision,
  type SupersedeRefusal,
  type SupersedeTarget,
} from './canSupersede';
