import { describe, expect, it } from 'vitest';
import { movePackage, type OrderedPackage } from './packageOrder';

const silver: OrderedPackage = { id: 'silver', status: 'active' };
const gold: OrderedPackage = { id: 'gold', status: 'active' };
const platinum: OrderedPackage = { id: 'platinum', status: 'active' };
const complimentary: OrderedPackage = { id: 'complimentary', status: 'active' };
const withdrawn: OrderedPackage = { id: 'withdrawn', status: 'inactive' };

describe('movePackage', () => {
  it('moves a package one place up, swapping it with the one above', () => {
    expect(movePackage([silver, gold, platinum], 'platinum', 'up')).toEqual([
      { id: 'silver', position: 1 },
      { id: 'platinum', position: 2 },
      { id: 'gold', position: 3 },
    ]);
  });

  it('moves a package one place down, swapping it with the one below', () => {
    expect(movePackage([silver, gold, platinum], 'silver', 'down')).toEqual([
      { id: 'gold', position: 1 },
      { id: 'silver', position: 2 },
      { id: 'platinum', position: 3 },
    ]);
  });

  it('steps over a withdrawn package, which the list does not show among the rest', () => {
    expect(movePackage([silver, withdrawn, gold], 'gold', 'up')).toEqual([
      { id: 'gold', position: 1 },
      { id: 'withdrawn', position: 2 },
      { id: 'silver', position: 3 },
    ]);
  });

  it('refuses to move the first package up or the last one down', () => {
    expect(movePackage([silver, gold], 'silver', 'up')).toBeNull();
    expect(movePackage([silver, gold, withdrawn], 'gold', 'down')).toBeNull();
  });

  it('refuses to move a withdrawn package, or one that is not in the list', () => {
    expect(movePackage([silver, withdrawn, gold], 'withdrawn', 'up')).toBeNull();
    expect(movePackage([silver, gold], 'nowhere', 'down')).toBeNull();
  });

  it('numbers every package from one, so a gap or a tie left by an earlier write closes', () => {
    // The practice's order of 20 October 2026: Complimentary goes to the end.
    expect(movePackage([silver, gold, complimentary, platinum], 'complimentary', 'down')).toEqual([
      { id: 'silver', position: 1 },
      { id: 'gold', position: 2 },
      { id: 'platinum', position: 3 },
      { id: 'complimentary', position: 4 },
    ]);
  });
});
