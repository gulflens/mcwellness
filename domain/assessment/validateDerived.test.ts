import { describe, expect, it } from 'vitest';
import { INTERPRETATION_FIELDS, validateDerived } from './validateDerived';

/**
 * What the declared shapes recognise, and what they refuse with the field
 * named (docs/SPEC/assessment.md section 5, rule 1; section 11's "a payload
 * with a missing unit"). Every branch is here.
 */

const PROVENANCE = { software: 'Synthetic Mapping Suite', softwareVersion: '3.2.1' };

function brainMap(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'brain-map',
    provenance: PROVENANCE,
    condition: 'eyes-closed',
    figures: [
      { site: 'Fz', band: 'alpha', value: 12.5, unit: 'uV2' },
      { site: 'Cz', band: 'theta', value: 8, unit: 'uV2' },
    ],
    ...overrides,
  };
}

function questionnaire(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'questionnaire',
    provenance: PROVENANCE,
    answers: [
      { key: 'q1', value: 1 },
      { key: 'q2', value: 2 },
      { key: 'q3', value: 3 },
    ],
    total: 6,
    maximum: 12,
    ...overrides,
  };
}

describe('validating a brain map', () => {
  it('accepts a payload the shape recognises and hands it back typed', () => {
    const result = validateDerived('qeeg', '1', brainMap());
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.kind).toBe('brain-map');
    expect(result.ok && result.value.provenance).toEqual(PROVENANCE);
  });

  it('refuses an instrument the platform has no shape for', () => {
    expect(validateDerived('not-an-instrument', '1', brainMap())).toEqual({
      ok: false,
      field: 'instrument',
      reason: 'unknown_instrument',
    });
  });

  it('refuses an edition of the instrument the shape does not describe', () => {
    expect(validateDerived('qeeg', '99', brainMap())).toEqual({
      ok: false,
      field: 'instrumentVersion',
      reason: 'unknown_instrument_version',
    });
  });

  it('refuses a payload that is not an object at all', () => {
    expect(validateDerived('qeeg', '1', 'figures')).toEqual({
      ok: false,
      field: 'derived',
      reason: 'not_an_object',
    });
    expect(validateDerived('qeeg', '1', null)).toEqual({
      ok: false,
      field: 'derived',
      reason: 'not_an_object',
    });
    expect(validateDerived('qeeg', '1', [])).toEqual({
      ok: false,
      field: 'derived',
      reason: 'not_an_object',
    });
  });

  it("refuses a payload whose kind is not the shape's", () => {
    expect(validateDerived('qeeg', '1', brainMap({ kind: 'questionnaire' }))).toEqual({
      ok: false,
      field: 'kind',
      reason: 'wrong_kind',
    });
  });

  it('refuses a figure without its unit, and names the figure', () => {
    const figures = [{ site: 'Fz', band: 'alpha', value: 12.5 }];
    expect(validateDerived('qeeg', '1', brainMap({ figures }))).toEqual({
      ok: false,
      field: 'figures.0.unit',
      reason: 'missing_unit',
    });
  });

  it('refuses a unit the shape does not declare', () => {
    const figures = [{ site: 'Fz', band: 'alpha', value: 12.5, unit: 'furlongs' }];
    expect(validateDerived('qeeg', '1', brainMap({ figures }))).toEqual({
      ok: false,
      field: 'figures.0.unit',
      reason: 'unknown_unit',
    });
  });

  it('refuses a site outside the ten-twenty system', () => {
    const figures = [{ site: 'Zz', band: 'alpha', value: 1, unit: 'uV2' }];
    expect(validateDerived('qeeg', '1', brainMap({ figures }))).toEqual({
      ok: false,
      field: 'figures.0.site',
      reason: 'unknown_site',
    });
  });

  it('refuses a band the design brief does not name', () => {
    const figures = [{ site: 'Fz', band: 'mu', value: 1, unit: 'uV2' }];
    expect(validateDerived('qeeg', '1', brainMap({ figures }))).toEqual({
      ok: false,
      field: 'figures.0.band',
      reason: 'unknown_band',
    });
  });

  it('refuses a figure whose value is not a number', () => {
    const figures = [{ site: 'Fz', band: 'alpha', value: '12.5', unit: 'uV2' }];
    expect(validateDerived('qeeg', '1', brainMap({ figures }))).toEqual({
      ok: false,
      field: 'figures.0.value',
      reason: 'not_a_number',
    });
  });

  it('refuses a figure that runs off to infinity', () => {
    const figures = [{ site: 'Fz', band: 'alpha', value: Number.POSITIVE_INFINITY, unit: 'uV2' }];
    expect(validateDerived('qeeg', '1', brainMap({ figures }))).toEqual({
      ok: false,
      field: 'figures.0.value',
      reason: 'not_finite',
    });
  });

  it('refuses a figure that is not an object', () => {
    expect(validateDerived('qeeg', '1', brainMap({ figures: [12.5] }))).toEqual({
      ok: false,
      field: 'figures.0',
      reason: 'not_an_object',
    });
  });

  it('refuses the same site and band recorded twice', () => {
    const figures = [
      { site: 'Fz', band: 'alpha', value: 1, unit: 'uV2' },
      { site: 'Fz', band: 'alpha', value: 2, unit: 'uV2' },
    ];
    expect(validateDerived('qeeg', '1', brainMap({ figures }))).toEqual({
      ok: false,
      field: 'figures.1.site',
      reason: 'duplicate_figure',
    });
  });

  it('refuses a map with no figures in it', () => {
    expect(validateDerived('qeeg', '1', brainMap({ figures: [] }))).toEqual({
      ok: false,
      field: 'figures',
      reason: 'missing',
    });
    expect(validateDerived('qeeg', '1', brainMap({ figures: 'none' }))).toEqual({
      ok: false,
      field: 'figures',
      reason: 'missing',
    });
  });

  it('refuses a recording that does not say whether the eyes were open', () => {
    expect(validateDerived('qeeg', '1', brainMap({ condition: 'resting' }))).toEqual({
      ok: false,
      field: 'condition',
      reason: 'unknown_condition',
    });
  });

  it('refuses a payload that does not say what produced it', () => {
    expect(validateDerived('qeeg', '1', brainMap({ provenance: undefined }))).toEqual({
      ok: false,
      field: 'provenance',
      reason: 'missing',
    });
  });

  it('refuses provenance that names the software but not its version', () => {
    const provenance = { software: 'Synthetic Mapping Suite', softwareVersion: '  ' };
    expect(validateDerived('qeeg', '1', brainMap({ provenance }))).toEqual({
      ok: false,
      field: 'provenance.softwareVersion',
      reason: 'missing',
    });
  });

  it('refuses provenance that names a version but not the software', () => {
    const provenance = { softwareVersion: '3.2.1' };
    expect(validateDerived('qeeg', '1', brainMap({ provenance }))).toEqual({
      ok: false,
      field: 'provenance.software',
      reason: 'missing',
    });
  });

  it('refuses a field the shape does not declare, anywhere it appears', () => {
    expect(validateDerived('qeeg', '1', brainMap({ notes: 'anything' }))).toEqual({
      ok: false,
      field: 'notes',
      reason: 'unknown_field',
    });
    const figures = [{ site: 'Fz', band: 'alpha', value: 1, unit: 'uV2', percentile: 80 }];
    expect(validateDerived('qeeg', '1', brainMap({ figures }))).toEqual({
      ok: false,
      field: 'figures.0.percentile',
      reason: 'unknown_field',
    });
    const provenance = { ...PROVENANCE, machine: 'anything' };
    expect(validateDerived('qeeg', '1', brainMap({ provenance }))).toEqual({
      ok: false,
      field: 'provenance.machine',
      reason: 'unknown_field',
    });
  });

  it('refuses every field that would attach a word to a figure, by name', () => {
    // Rule 1: storing a word beside a score puts a label on a person in a
    // field nobody signed. It is refused rather than quietly dropped, so the
    // person who typed it is told where a judgement actually goes.
    for (const field of INTERPRETATION_FIELDS) {
      expect(validateDerived('qeeg', '1', brainMap({ [field]: 'anything' }))).toEqual({
        ok: false,
        field,
        reason: 'interpretation_not_stored',
      });
      const figures = [{ site: 'Fz', band: 'alpha', value: 1, unit: 'uV2', [field]: 'anything' }];
      expect(validateDerived('qeeg', '1', brainMap({ figures }))).toEqual({
        ok: false,
        field: `figures.0.${field}`,
        reason: 'interpretation_not_stored',
      });
    }
  });

  it('keeps what the software reported against its own reference database', () => {
    // Section 3.4: the platform keeps what the software reported and computes
    // no comparison of its own. The figure carries the unit and no word.
    const figures = [{ site: 'Fz', band: 'alpha', value: -1.4, unit: 'sd' }];
    const result = validateDerived('qeeg', '1', brainMap({ figures }));
    expect(result.ok && result.value.kind === 'brain-map' && result.value.figures[0]).toEqual({
      site: 'Fz',
      band: 'alpha',
      value: -1.4,
      unit: 'sd',
    });
  });
});

describe('validating a questionnaire', () => {
  it('accepts a payload whose total follows from its answers', () => {
    const result = validateDerived('questionnaire.sample', '1', questionnaire());
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.kind === 'questionnaire' && result.value.total).toBe(6);
  });

  it('refuses a total that does not follow from the answers beside it', () => {
    expect(validateDerived('questionnaire.sample', '1', questionnaire({ total: 9 }))).toEqual({
      ok: false,
      field: 'total',
      reason: 'total_disagrees',
    });
  });

  it('refuses a maximum that is not the scale the shape declares', () => {
    expect(validateDerived('questionnaire.sample', '1', questionnaire({ maximum: 15 }))).toEqual({
      ok: false,
      field: 'maximum',
      reason: 'maximum_disagrees',
    });
  });

  it('passes an answer the shape does not ask for back through the scorer', () => {
    const answers = [
      { key: 'q1', value: 1 },
      { key: 'q2', value: 2 },
      { key: 'q3', value: 3 },
      { key: 'q4', value: 1 },
    ];
    expect(validateDerived('questionnaire.sample', '1', questionnaire({ answers }))).toEqual({
      ok: false,
      field: 'answers.3.key',
      reason: 'unknown_question',
    });
  });

  it('refuses answers that are not a list', () => {
    expect(validateDerived('questionnaire.sample', '1', questionnaire({ answers: 6 }))).toEqual({
      ok: false,
      field: 'answers',
      reason: 'missing',
    });
  });

  it('refuses an answer that is not an object', () => {
    expect(validateDerived('questionnaire.sample', '1', questionnaire({ answers: [1] }))).toEqual({
      ok: false,
      field: 'answers.0',
      reason: 'not_an_object',
    });
  });

  it('refuses an answer with no question key', () => {
    const answers = [{ value: 1 }];
    expect(validateDerived('questionnaire.sample', '1', questionnaire({ answers }))).toEqual({
      ok: false,
      field: 'answers.0.key',
      reason: 'missing',
    });
  });

  it('refuses an answer whose value is not a number', () => {
    const answers = [{ key: 'q1', value: 'one' }];
    expect(validateDerived('questionnaire.sample', '1', questionnaire({ answers }))).toEqual({
      ok: false,
      field: 'answers.0.value',
      reason: 'not_a_number',
    });
  });

  it('refuses a field beside an answer that the shape does not declare', () => {
    const answers = [{ key: 'q1', value: 1, note: 'anything' }];
    expect(validateDerived('questionnaire.sample', '1', questionnaire({ answers }))).toEqual({
      ok: false,
      field: 'answers.0.note',
      reason: 'unknown_field',
    });
  });

  it('refuses a band label stored beside a total', () => {
    expect(
      validateDerived('questionnaire.sample', '1', questionnaire({ severity: 'anything' })),
    ).toEqual({ ok: false, field: 'severity', reason: 'interpretation_not_stored' });
  });

  it('refuses a questionnaire payload sent as a brain map', () => {
    expect(validateDerived('questionnaire.sample', '1', brainMap())).toEqual({
      ok: false,
      field: 'kind',
      reason: 'wrong_kind',
    });
  });
});
