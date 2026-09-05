import { describe, expect, it } from 'vitest';
import { currentVersions } from './currentVersions';
import type { Assessment } from './types';

/**
 * Which measurement stands, and what it replaced (docs/SPEC/assessment.md
 * section 5, rule 4).
 */

const CLIENT = '00000006-0000-4000-8000-000000000001';
const PROVENANCE = { software: 'Synthetic Mapping Suite', softwareVersion: '3.2.1' };

function id(n: number): string {
  return `0000000f-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function assessment(overrides: Partial<Assessment> & { id: string }): Assessment {
  return {
    clientId: CLIENT,
    instrument: 'qeeg',
    instrumentVersion: '1',
    performedAt: '2026-03-01T06:00:00.000Z',
    derived: {
      kind: 'brain-map',
      provenance: PROVENANCE,
      condition: 'eyes-closed',
      figures: [{ site: 'Fz', band: 'alpha', value: 10, unit: 'uV2' }],
    },
    version: 1,
    supersedesId: null,
    referenceAgeYears: 9,
    referenceSex: 'female',
    ...overrides,
  };
}

describe('the version that stands', () => {
  it('is the one nothing supersedes, with what it replaced beneath it', () => {
    const first = assessment({ id: id(1) });
    const second = assessment({ id: id(2), version: 2, supersedesId: id(1) });
    const third = assessment({ id: id(3), version: 3, supersedesId: id(2) });
    const chains = currentVersions([first, second, third]);
    expect(chains).toHaveLength(1);
    expect(chains[0]?.current.id).toBe(id(3));
    expect(chains[0]?.superseded.map((a) => a.id)).toEqual([id(2), id(1)]);
  });

  it('gives a measurement recorded once an empty chain', () => {
    const chains = currentVersions([assessment({ id: id(1) })]);
    expect(chains).toEqual([{ current: expect.objectContaining({ id: id(1) }), superseded: [] }]);
  });

  it('answers nothing for nothing', () => {
    expect(currentVersions([])).toEqual([]);
  });

  it('keeps two measurements of one client apart', () => {
    const baseline = assessment({ id: id(1) });
    const remap = assessment({ id: id(2), performedAt: '2026-05-30T06:00:00.000Z' });
    const chains = currentVersions([baseline, remap]);
    expect(chains.map((chain) => chain.current.id)).toEqual([id(2), id(1)]);
  });

  it('puts the newest measurement first, and breaks a tie the same way twice', () => {
    const a = assessment({ id: id(1) });
    const b = assessment({ id: id(2) });
    expect(currentVersions([b, a]).map((c) => c.current.id)).toEqual([id(1), id(2)]);
    expect(currentVersions([a, b]).map((c) => c.current.id)).toEqual([id(1), id(2)]);
  });

  it('puts the higher version first when two versions share a day', () => {
    const first = assessment({ id: id(9) });
    const second = assessment({ id: id(1), version: 2, supersedesId: id(8) });
    expect(currentVersions([first, second]).map((c) => c.current.id)).toEqual([id(1), id(9)]);
  });

  it('ends a chain where the row it replaced is not in the list', () => {
    // A page of results whose window does not reach the version it replaced.
    const second = assessment({ id: id(2), version: 2, supersedesId: id(1) });
    const chains = currentVersions([second]);
    expect(chains).toHaveLength(1);
    expect(chains[0]?.superseded).toEqual([]);
  });

  it('stops rather than looping on a chain that points back at itself', () => {
    const a = assessment({ id: id(1), version: 2, supersedesId: id(2) });
    const b = assessment({ id: id(2), version: 2, supersedesId: id(1) });
    // Both are superseded by the other, so neither stands: the answer is
    // empty rather than a loop that never ends.
    expect(currentVersions([a, b])).toEqual([]);
  });

  it('stops a chain that reaches a row twice', () => {
    const a = assessment({ id: id(1), version: 3, supersedesId: id(2) });
    const b = assessment({ id: id(2), version: 2, supersedesId: id(2) });
    const chains = currentVersions([a, b]);
    expect(chains).toHaveLength(1);
    expect(chains[0]?.current.id).toBe(id(1));
    expect(chains[0]?.superseded.map((x) => x.id)).toEqual([id(2)]);
  });
});
