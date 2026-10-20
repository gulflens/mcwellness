import { describe, expect, it } from 'vitest';
import { nextVersionCode, planPackageEdit, type EditablePackage } from './packageEdit';

// Ids in the billing catalogue's reserved form (.claude/rules/testing.md).
const CONSULTATION = '00000004-0000-4000-8000-000000000002';
const BRAIN_MAP = '00000004-0000-4000-8000-000000000003';
const NF_SESSION = '00000004-0000-4000-8000-000000000005';

const TODAY = '2026-10-20';

const gold: EditablePackage = {
  listPriceFils: 1_997_500,
  term: null,
  components: [
    { serviceTypeId: CONSULTATION, quantity: 1 },
    { serviceTypeId: BRAIN_MAP, quantity: 2 },
    { serviceTypeId: NF_SESSION, quantity: 20 },
  ],
};

describe('planPackageEdit', () => {
  it('edits a package in place when its contents stay the same, sold or not', () => {
    const edit = {
      ...gold,
      listPriceFils: 2_100_000,
      term: { amount: 12, unit: 'month' as const },
    };
    expect(
      planPackageEdit(gold, edit, { sold: true, validFrom: '2026-11-01', today: TODAY }),
    ).toEqual({ ok: true, kind: 'in_place', componentsChanged: false });
  });

  it('reads the same contents in another order as unchanged', () => {
    const edit = { ...gold, components: [...gold.components].reverse() };
    expect(planPackageEdit(gold, edit, { sold: true, validFrom: TODAY, today: TODAY })).toEqual({
      ok: true,
      kind: 'in_place',
      componentsChanged: false,
    });
  });

  it('changes the contents in place when nobody has bought the package yet', () => {
    const edit = {
      ...gold,
      components: [
        { serviceTypeId: CONSULTATION, quantity: 1 },
        { serviceTypeId: NF_SESSION, quantity: 25 },
      ],
    };
    expect(planPackageEdit(gold, edit, { sold: false, validFrom: TODAY, today: TODAY })).toEqual({
      ok: true,
      kind: 'in_place',
      componentsChanged: true,
    });
  });

  it('makes a new version when the contents of a sold package change', () => {
    const edit = {
      ...gold,
      components: gold.components.map((c) =>
        c.serviceTypeId === NF_SESSION ? { ...c, quantity: 25 } : c,
      ),
    };
    expect(planPackageEdit(gold, edit, { sold: true, validFrom: TODAY, today: TODAY })).toEqual({
      ok: true,
      kind: 'new_version',
    });
  });

  it('starts a new version today, so the package is never off sale between the two', () => {
    const edit = { ...gold, components: [{ serviceTypeId: NF_SESSION, quantity: 30 }] };
    expect(
      planPackageEdit(gold, edit, { sold: true, validFrom: '2026-11-01', today: TODAY }),
    ).toEqual({ ok: false, code: 'version_starts_today' });
  });
});

describe('nextVersionCode', () => {
  it('suffixes the version to the code a package started with', () => {
    expect(nextVersionCode('gold', 2)).toBe('gold-v2');
    expect(nextVersionCode('gold-v2', 3)).toBe('gold-v3');
  });

  it('keeps within the forty characters a code may have', () => {
    const long = 'a'.repeat(40);
    const code = nextVersionCode(long, 12);
    expect(code).toHaveLength(40);
    expect(code.endsWith('-v12')).toBe(true);
  });

  it('never leaves a hyphen before the suffix doubled', () => {
    expect(nextVersionCode(`${'a'.repeat(36)}-bcd`, 2)).toBe(`${'a'.repeat(36)}-v2`);
  });
});
