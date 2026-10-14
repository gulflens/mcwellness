import { describe, expect, it } from 'vitest';
import { compare, type Assessment, type BandFigure } from '../../domain/assessment';
import { compareBrainMaps, type AssessmentRow } from '../../domain/reports';

/**
 * The comparison view and the progress report give the same answer.
 *
 * A progress report prints "the same figures and the same 'not a diagnosis'
 * sentence the comparison view shows" (docs/SPEC/reports-v1.md section 5).
 * The view's arithmetic is `compare` (domain/assessment, docs/SPEC/assessment.md
 * section 5, rule 3); the report's is `compareBrainMaps` (domain/reports),
 * quoted rather than imported because one module may not import another's
 * `domain/` (docs/SPEC/OWNERSHIP.md rule 3). A test may import both, so this
 * one holds the two to one answer: the same differences, rounded the same
 * way, and a refusal where the units disagree.
 */

const CLIENT = '00000006-0000-4000-8000-000000000001';
const EARLIER = '0000000f-0000-4000-8000-000000000001';
const LATER = '0000000f-0000-4000-8000-000000000002';

function assessment(id: string, performedAt: string, figures: readonly BandFigure[]): Assessment {
  return {
    id,
    clientId: CLIENT,
    instrument: 'qeeg',
    instrumentVersion: '1',
    performedAt,
    derived: {
      kind: 'brain-map',
      provenance: { software: 'Synthetic Mapping Suite', softwareVersion: '3.2.1' },
      condition: 'eyes-closed',
      figures,
    },
    version: 1,
    supersedesId: null,
    referenceAgeYears: 9,
    referenceSex: 'female',
  };
}

/** The same assessment as the report's route reads it: a figure per site and band. */
function rowOf(source: Assessment): AssessmentRow {
  const figures = source.derived.kind === 'brain-map' ? source.derived.figures : [];
  return {
    id: source.id,
    performedOn: source.performedAt.slice(0, 10),
    instrument: source.instrument,
    figures: figures.map((figure) => ({
      label: `${figure.site} ${figure.band}`,
      labelAr: null,
      unit: figure.unit,
      value: figure.value,
    })),
    referenceAgeYears: source.referenceAgeYears,
    referenceSex: source.referenceSex,
  };
}

describe('the report’s comparison and the comparison view', () => {
  it('give the same differences, rounded the same way', () => {
    const first = assessment(EARLIER, '2026-03-01T06:00:00.000Z', [
      { site: 'Fz', band: 'alpha', value: 10.1234561, unit: 'uV2' },
      { site: 'Cz', band: 'theta', value: 0.1, unit: 'uV2' },
      { site: 'Pz', band: 'beta', value: 1.0001, unit: 'uV2' },
    ]);
    const second = assessment(LATER, '2026-06-01T06:00:00.000Z', [
      { site: 'Fz', band: 'alpha', value: 9.9, unit: 'uV2' },
      { site: 'Cz', band: 'theta', value: 0.3, unit: 'uV2' },
      { site: 'Pz', band: 'beta', value: 1.0003, unit: 'uV2' },
    ]);
    const view = compare(first, second);
    const report = compareBrainMaps([rowOf(first), rowOf(second)]);
    if (!view.ok) throw new Error('the view refused a comparison it should make');
    expect(report?.lines.map((line) => line.difference)).toEqual(
      view.value.figures.map((figure) => figure.difference),
    );
  });

  it('both refuse where a figure’s units disagree', () => {
    const first = assessment(EARLIER, '2026-03-01T06:00:00.000Z', [
      { site: 'Fz', band: 'alpha', value: 10, unit: 'uV2' },
      { site: 'Cz', band: 'theta', value: 8, unit: 'uV2' },
    ]);
    const second = assessment(LATER, '2026-06-01T06:00:00.000Z', [
      { site: 'Fz', band: 'alpha', value: 11, unit: 'percent' },
      { site: 'Cz', band: 'theta', value: 9, unit: 'uV2' },
    ]);
    expect(compare(first, second)).toMatchObject({ ok: false, reason: 'unit_mismatch' });
    expect(compareBrainMaps([rowOf(first), rowOf(second)])).toBeNull();
  });
});
