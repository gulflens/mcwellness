import { describe, expect, it } from 'vitest';
import { nextVersionCode, planPackageEdit, type EditablePackage } from './packageEdit';

// Ids in the billing catalogue's reserved form (.claude/rules/testing.md).
const CONSULTATION = '00000004-0000-4000-8000-000000000002';
const BRAIN_MAP = '00000004-0000-4000-8000-000000000003';
const NF_SESSION = '00000004-0000-4000-8000-000000000005';

const TODAY = '2026-10-20';

/** A package still on the list: not replaced, not withdrawn. */
const OPEN = { replaced: false, withdrawn: false };

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
      planPackageEdit(gold, edit, { ...OPEN, sold: true, validFrom: '2026-11-01', today: TODAY }),
    ).toEqual({ ok: true, kind: 'in_place', componentsChanged: false });
  });

  it('reads the same contents in another order as unchanged', () => {
    const edit = { ...gold, components: [...gold.components].reverse() };
    expect(
      planPackageEdit(gold, edit, { ...OPEN, sold: true, validFrom: TODAY, today: TODAY }),
    ).toEqual({
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
    expect(
      planPackageEdit(gold, edit, { ...OPEN, sold: false, validFrom: TODAY, today: TODAY }),
    ).toEqual({
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
    expect(
      planPackageEdit(gold, edit, { ...OPEN, sold: true, validFrom: TODAY, today: TODAY }),
    ).toEqual({
      ok: true,
      kind: 'new_version',
    });
  });

  it('starts a new version today, so the package is never off sale between the two', () => {
    const edit = { ...gold, components: [{ serviceTypeId: NF_SESSION, quantity: 30 }] };
    expect(
      planPackageEdit(gold, edit, { ...OPEN, sold: true, validFrom: '2026-11-01', today: TODAY }),
    ).toEqual({ ok: false, code: 'version_starts_today' });
  });

  it('changes an unsold package in place from a later date, as any price may', () => {
    const edit = { ...gold, components: [{ serviceTypeId: NF_SESSION, quantity: 30 }] };
    expect(
      planPackageEdit(gold, edit, { ...OPEN, sold: false, validFrom: '2026-11-01', today: TODAY }),
    ).toEqual({ ok: true, kind: 'in_place', componentsChanged: true });
  });

  it('refuses a version a later one replaced, before anything else', () => {
    expect(
      planPackageEdit(gold, gold, {
        replaced: true,
        withdrawn: true,
        sold: true,
        validFrom: TODAY,
        today: TODAY,
      }),
    ).toEqual({ ok: false, code: 'superseded' });
  });

  it('refuses a withdrawn package until it is reinstated', () => {
    expect(
      planPackageEdit(gold, gold, {
        ...OPEN,
        withdrawn: true,
        sold: false,
        validFrom: TODAY,
        today: TODAY,
      }),
    ).toEqual({ ok: false, code: 'withdrawn' });
  });

  it('refuses the same service twice: the quantity says how many', () => {
    const edit = {
      ...gold,
      components: [
        { serviceTypeId: NF_SESSION, quantity: 10 },
        { serviceTypeId: NF_SESSION, quantity: 5 },
      ],
    };
    expect(
      planPackageEdit(gold, edit, { ...OPEN, sold: false, validFrom: TODAY, today: TODAY }),
    ).toEqual({ ok: false, code: 'duplicate_component' });
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

  it('keeps a first code that happens to end like a version, adding its own', () => {
    expect(nextVersionCode('gold-v2', 2)).toBe('gold-v2-v2');
  });

  it('never leaves a hyphen before the suffix doubled', () => {
    expect(nextVersionCode(`${'a'.repeat(36)}-bcd`, 2)).toBe(`${'a'.repeat(36)}-v2`);
  });
});
