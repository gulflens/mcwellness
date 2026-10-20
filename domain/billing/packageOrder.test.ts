import { describe, expect, it } from 'vitest';
import { movePackage, reorderPackages, type OrderedPackage } from './packageOrder';

// Ids in the billing catalogue's reserved form (.claude/rules/testing.md).
const SILVER = '00000004-0000-4000-8000-000000000401';
const GOLD = '00000004-0000-4000-8000-000000000402';
const PLATINUM = '00000004-0000-4000-8000-000000000403';
const COMPLIMENTARY = '00000004-0000-4000-8000-000000000404';
const WITHDRAWN = '00000004-0000-4000-8000-000000000405';
const NOWHERE = '00000004-0000-4000-8000-000000000406';

const silver: OrderedPackage = { id: SILVER, status: 'active' };
const gold: OrderedPackage = { id: GOLD, status: 'active' };
const platinum: OrderedPackage = { id: PLATINUM, status: 'active' };
const complimentary: OrderedPackage = { id: COMPLIMENTARY, status: 'active' };
const withdrawn: OrderedPackage = { id: WITHDRAWN, status: 'inactive' };

describe('movePackage', () => {
  it('moves a package one place up, swapping it with the one above', () => {
    expect(movePackage([silver, gold, platinum], PLATINUM, 'up')).toEqual([
      { id: SILVER, position: 1 },
      { id: PLATINUM, position: 2 },
      { id: GOLD, position: 3 },
    ]);
  });

  it('moves a package one place down, swapping it with the one below', () => {
    expect(movePackage([silver, gold, platinum], SILVER, 'down')).toEqual([
      { id: GOLD, position: 1 },
      { id: SILVER, position: 2 },
      { id: PLATINUM, position: 3 },
    ]);
  });

  it('steps over a withdrawn package, which the list does not show among the rest', () => {
    expect(movePackage([silver, withdrawn, gold], GOLD, 'up')).toEqual([
      { id: GOLD, position: 1 },
      { id: WITHDRAWN, position: 2 },
      { id: SILVER, position: 3 },
    ]);
  });

  it('refuses to move the first package up or the last one down', () => {
    expect(movePackage([silver, gold], SILVER, 'up')).toBeNull();
    expect(movePackage([silver, gold, withdrawn], GOLD, 'down')).toBeNull();
  });

  it('refuses to move a withdrawn package, or one that is not in the list', () => {
    expect(movePackage([silver, withdrawn, gold], WITHDRAWN, 'up')).toBeNull();
    expect(movePackage([silver, gold], NOWHERE, 'down')).toBeNull();
  });

  it('numbers the whole list from one on every move, the practice order of 20 October 2026 included', () => {
    // Complimentary, listed before Platinum by price, goes to the end.
    expect(movePackage([silver, gold, complimentary, platinum], COMPLIMENTARY, 'down')).toEqual([
      { id: SILVER, position: 1 },
      { id: GOLD, position: 2 },
      { id: PLATINUM, position: 3 },
      { id: COMPLIMENTARY, position: 4 },
    ]);
  });
});

describe('reorderPackages', () => {
  it('puts the packages on offer in the order given, in one go', () => {
    // Dragged from last to first: one request, not two moves.
    expect(reorderPackages([silver, gold, platinum], [PLATINUM, SILVER, GOLD])).toEqual([
      { id: PLATINUM, position: 1 },
      { id: SILVER, position: 2 },
      { id: GOLD, position: 3 },
    ]);
  });

  it('leaves a withdrawn package in its own slot, out of sight of the rest', () => {
    expect(reorderPackages([silver, withdrawn, gold, platinum], [GOLD, PLATINUM, SILVER])).toEqual([
      { id: GOLD, position: 1 },
      { id: WITHDRAWN, position: 2 },
      { id: PLATINUM, position: 3 },
      { id: SILVER, position: 4 },
    ]);
  });

  it('accepts the order it already has, numbering it from one', () => {
    expect(reorderPackages([silver, gold], [SILVER, GOLD])).toEqual([
      { id: SILVER, position: 1 },
      { id: GOLD, position: 2 },
    ]);
  });

  it('refuses an order that is not exactly the packages on offer', () => {
    // One missing, one extra, one twice, one withdrawn: each means the screen
    // that sent it was out of date, and the list is not guessed at.
    expect(reorderPackages([silver, gold, platinum], [GOLD, SILVER])).toBeNull();
    expect(reorderPackages([silver, gold], [GOLD, SILVER, NOWHERE])).toBeNull();
    expect(reorderPackages([silver, gold], [GOLD, GOLD])).toBeNull();
    expect(reorderPackages([silver, gold, withdrawn], [GOLD, WITHDRAWN, SILVER])).toBeNull();
  });
});
