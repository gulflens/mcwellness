import { scoreQuestionnaire } from './scoreQuestionnaire';
import { figureKey, shapeFor, shapeKnowsVersion } from './shapes';
import { BANDS, SITES, UNITS, BRAIN_MAP_CONDITIONS } from './types';
import type {
  Band,
  BandFigure,
  BrainMapCondition,
  BrainMapPayload,
  DerivedPayload,
  FieldRefusal,
  Provenance,
  QuestionnaireAnswer,
  QuestionnairePayload,
  Site,
  Unit,
  Validated,
} from './types';

/**
 * Whether a payload is one the declared shape recognises, and the payload
 * itself when it is (docs/SPEC/assessment.md section 5, rule 1).
 *
 * Every refusal names the field, because the drawer says which one is wrong
 * and "that payload is invalid" is not something a person can act on
 * (section 3.2). Fields are named as dotted paths into the payload —
 * `figures.3.unit`, `provenance.software` — so the screen can put the message
 * beside the input that produced it.
 *
 * **Every brain-map figure carries its unit.** A number with no unit is not a
 * measurement: it cannot be compared with next quarter's number and nobody
 * reading it later can say what it counted. That is rule 1's own example and
 * it is refused by name.
 *
 * **No payload carries an interpretation band.** Storing a word beside a score
 * puts a label on a person in a field nobody signed, so a payload carrying one
 * is refused rather than quietly stripped: a practitioner who meant to record
 * a judgement should be told where judgements go, which is a signed report.
 */

/**
 * Keys that would attach a word to a figure. Refused wherever they appear, at
 * any depth, by name rather than by the general "unknown field" rule, so the
 * refusal says what is actually wrong.
 */
export const INTERPRETATION_FIELDS = [
  'band_label',
  'category',
  'classification',
  'interpretation',
  'label',
  'rating',
  'severity',
] as const;

const PROVENANCE_FIELDS = ['software', 'softwareVersion'] as const;
const BRAIN_MAP_FIELDS = ['kind', 'provenance', 'condition', 'figures'] as const;
const FIGURE_FIELDS = ['site', 'band', 'value', 'unit'] as const;
const QUESTIONNAIRE_FIELDS = ['kind', 'provenance', 'answers', 'total', 'maximum'] as const;
const ANSWER_FIELDS = ['key', 'value'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function refuse(field: string, reason: FieldRefusal['reason']): FieldRefusal {
  return { ok: false, field, reason };
}

/** Refuses any key the shape does not declare, and names an interpretation as one. */
function onlyKnownFields(
  value: Record<string, unknown>,
  known: readonly string[],
  path: string,
): FieldRefusal | null {
  for (const key of Object.keys(value)) {
    if ((INTERPRETATION_FIELDS as readonly string[]).includes(key)) {
      return refuse(`${path}${key}`, 'interpretation_not_stored');
    }
    if (!known.includes(key)) {
      return refuse(`${path}${key}`, 'unknown_field');
    }
  }
  return null;
}

function readText(value: Record<string, unknown>, key: string, path: string): Validated<string> {
  const raw = value[key];
  if (typeof raw !== 'string' || raw.trim() === '') {
    return refuse(`${path}${key}`, 'missing');
  }
  return { ok: true, value: raw };
}

function readProvenance(value: unknown, path: string): Validated<Provenance> {
  if (!isRecord(value)) {
    return refuse(path.replace(/\.$/, ''), 'missing');
  }
  const unknown = onlyKnownFields(value, PROVENANCE_FIELDS, path);
  if (unknown) return unknown;
  const software = readText(value, 'software', path);
  if (!software.ok) return software;
  const softwareVersion = readText(value, 'softwareVersion', path);
  if (!softwareVersion.ok) return softwareVersion;
  return { ok: true, value: { software: software.value, softwareVersion: softwareVersion.value } };
}

function readFigure(value: unknown, path: string): Validated<BandFigure> {
  if (!isRecord(value)) {
    return refuse(path.replace(/\.$/, ''), 'not_an_object');
  }
  const unknown = onlyKnownFields(value, FIGURE_FIELDS, path);
  if (unknown) return unknown;

  const site = value.site;
  if (typeof site !== 'string' || !(SITES as readonly string[]).includes(site)) {
    return refuse(`${path}site`, 'unknown_site');
  }
  const band = value.band;
  if (typeof band !== 'string' || !(BANDS as readonly string[]).includes(band)) {
    return refuse(`${path}band`, 'unknown_band');
  }
  // The unit is asked for before the value, because a figure without its unit
  // is the refusal rule 1 names and a person reading the message should be
  // told about the unit rather than about whatever the number happened to be.
  const unit = value.unit;
  if (unit === undefined || unit === null || unit === '') {
    return refuse(`${path}unit`, 'missing_unit');
  }
  if (typeof unit !== 'string' || !(UNITS as readonly string[]).includes(unit)) {
    return refuse(`${path}unit`, 'unknown_unit');
  }
  const raw = value.value;
  if (typeof raw !== 'number' || Number.isNaN(raw)) {
    return refuse(`${path}value`, 'not_a_number');
  }
  if (!Number.isFinite(raw)) {
    return refuse(`${path}value`, 'not_finite');
  }
  return {
    ok: true,
    value: { site: site as Site, band: band as Band, value: raw, unit: unit as Unit },
  };
}

function readBrainMap(
  value: Record<string, unknown>,
  instrument: string,
): Validated<BrainMapPayload> {
  const unknown = onlyKnownFields(value, BRAIN_MAP_FIELDS, '');
  if (unknown) return unknown;

  const provenance = readProvenance(value.provenance, 'provenance.');
  if (!provenance.ok) return provenance;

  const condition = value.condition;
  if (
    typeof condition !== 'string' ||
    !(BRAIN_MAP_CONDITIONS as readonly string[]).includes(condition)
  ) {
    return refuse('condition', 'unknown_condition');
  }

  const figures = value.figures;
  if (!Array.isArray(figures) || figures.length === 0) {
    return refuse('figures', 'missing');
  }
  const read: BandFigure[] = [];
  const seen = new Set<string>();
  for (const [index, entry] of figures.entries()) {
    const figure = readFigure(entry, `figures.${index}.`);
    if (!figure.ok) return figure;
    const key = figureKey(figure.value);
    if (seen.has(key)) {
      return refuse(`figures.${index}.site`, 'duplicate_figure');
    }
    seen.add(key);
    read.push(figure.value);
  }
  // The instrument is checked by the caller; this reads as a guard so the
  // returned payload's kind can never disagree with the shape it came from.
  if (instrument !== 'qeeg') {
    return refuse('kind', 'wrong_kind');
  }
  return {
    ok: true,
    value: {
      kind: 'brain-map',
      provenance: provenance.value,
      condition: condition as BrainMapCondition,
      figures: read,
    },
  };
}

function readQuestionnaire(
  value: Record<string, unknown>,
  instrument: string,
): Validated<QuestionnairePayload> {
  const unknown = onlyKnownFields(value, QUESTIONNAIRE_FIELDS, '');
  if (unknown) return unknown;

  const provenance = readProvenance(value.provenance, 'provenance.');
  if (!provenance.ok) return provenance;

  const answers = value.answers;
  if (!Array.isArray(answers)) {
    return refuse('answers', 'missing');
  }
  const read: QuestionnaireAnswer[] = [];
  for (const [index, entry] of answers.entries()) {
    if (!isRecord(entry)) {
      return refuse(`answers.${index}`, 'not_an_object');
    }
    const unknownAnswer = onlyKnownFields(entry, ANSWER_FIELDS, `answers.${index}.`);
    if (unknownAnswer) return unknownAnswer;
    const key = entry.key;
    if (typeof key !== 'string' || key === '') {
      return refuse(`answers.${index}.key`, 'missing');
    }
    const answerValue = entry.value;
    if (typeof answerValue !== 'number') {
      return refuse(`answers.${index}.value`, 'not_a_number');
    }
    read.push({ key, value: answerValue });
  }

  // The total is not taken on trust: it is recomputed from the answers, and a
  // payload whose figure disagrees is refused rather than stored. A total that
  // does not follow from the answers beside it is a measurement nobody can
  // check.
  const scored = scoreQuestionnaire(instrument, read);
  if (!scored.ok) return scored;
  if (value.total !== scored.value.total) {
    return refuse('total', 'total_disagrees');
  }
  if (value.maximum !== scored.value.maximum) {
    return refuse('maximum', 'maximum_disagrees');
  }
  return {
    ok: true,
    value: {
      kind: 'questionnaire',
      provenance: provenance.value,
      answers: read,
      total: scored.value.total,
      maximum: scored.value.maximum,
    },
  };
}

export function validateDerived(
  instrument: string,
  instrumentVersion: string,
  payload: unknown,
): Validated<DerivedPayload> {
  const shape = shapeFor(instrument);
  if (shape === null) {
    return refuse('instrument', 'unknown_instrument');
  }
  if (!shapeKnowsVersion(shape, instrumentVersion)) {
    return refuse('instrumentVersion', 'unknown_instrument_version');
  }
  if (!isRecord(payload)) {
    return refuse('derived', 'not_an_object');
  }
  if (payload.kind !== shape.kind) {
    return refuse('kind', 'wrong_kind');
  }
  return shape.kind === 'brain-map'
    ? readBrainMap(payload, instrument)
    : readQuestionnaire(payload, instrument);
}
