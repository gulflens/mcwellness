import type { Instrument } from '../types';
import { BRAIN_MAP_SHAPE, type BrainMapShape } from './brain-map';
import { QUESTIONNAIRE_SHAPES, type QuestionnaireShape } from './questionnaire';

/**
 * The register of declared shapes (docs/SPEC/assessment.md section 5, rule 1).
 *
 * One place answers "does this platform know this instrument, and this edition
 * of it", so the drawer, the validator and the route all ask the same question
 * and get the same answer.
 */
export type Shape = BrainMapShape | QuestionnaireShape;

export const SHAPES: readonly Shape[] = [BRAIN_MAP_SHAPE, ...QUESTIONNAIRE_SHAPES];

/** The shape for an instrument, or null when the platform has none declared. */
export function shapeFor(instrument: string): Shape | null {
  return SHAPES.find((shape) => shape.instrument === instrument) ?? null;
}

/** Whether this edition of the instrument is one the shape describes. */
export function shapeKnowsVersion(shape: Shape, instrumentVersion: string): boolean {
  return shape.versions.includes(instrumentVersion);
}

/**
 * The service whose credential the recording practitioner must hold
 * (section 7.2). Null means the shape has no service of its own and the route
 * asks only that the person may execute something.
 */
export function serviceCodeFor(instrument: Instrument): string | null {
  return shapeFor(instrument)?.serviceCode ?? null;
}

export { BRAIN_MAP_SHAPE, figureKey, type BrainMapShape } from './brain-map';
export {
  QUESTIONNAIRE_SHAPES,
  SAMPLE_QUESTIONNAIRE,
  questionnaireMaximum,
  type QuestionnaireQuestion,
  type QuestionnaireShape,
} from './questionnaire';
