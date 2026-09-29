import { describe, expect, it } from 'vitest';
import { ACCENT, INK, MUTED } from './palette';
import { ARABIC_FLOOR, ROLES, styleOf } from './styles';
import type { Role } from './styles';

const CARD_ROLES = ROLES.filter((role) => role.startsWith('card'));
const PAGE_ROLES = ROLES.filter((role) => !role.startsWith('card'));

describe('the type of the brain-map report', () => {
  it('has a style for every role, in both directions', () => {
    expect(ROLES.length).toBe(24);
    for (const role of ROLES) {
      for (const direction of ['ltr', 'rtl'] as const) {
        const { style } = styleOf(role, direction);
        expect(Number.isFinite(style.size), role).toBe(true);
        expect(Number.isFinite(style.lineHeight), role).toBe(true);
      }
    }
  });

  it('keeps the sizes of the report a household knows', () => {
    const size = (role: Role) => styleOf(role, 'ltr').style.size;
    expect(size('body')).toBe(10.2);
    expect(size('heading')).toBe(14);
    expect(size('subheading')).toBe(11.5);
    expect(size('cardTitle')).toBe(10);
    expect(size('cardBullet')).toBe(8.4);
    expect(size('footer')).toBe(6.8);
    for (const role of ROLES) {
      expect(size(role), role).toBeGreaterThanOrEqual(6.6);
      expect(size(role), role).toBeLessThanOrEqual(14);
    }
  });

  it('keeps its line heights in English', () => {
    const height = (role: Role) => styleOf(role, 'ltr').style.lineHeight;
    expect(height('body')).toBe(1.5);
    expect(height('band')).toBe(1.42);
    expect(height('cardTitle')).toBe(1.16);
    expect(height('cardAdvice')).toBe(1.38);
    expect(height('footer')).toBe(1.45);
  });

  it('never sets Arabic tighter than its face is tall: 1.5 on the page, 1.45 in a card', () => {
    expect(ARABIC_FLOOR).toEqual({ page: 1.5, card: 1.45 });
    for (const role of PAGE_ROLES) {
      expect(styleOf(role, 'rtl').style.lineHeight, role).toBeGreaterThanOrEqual(1.5);
    }
    for (const role of CARD_ROLES) {
      expect(styleOf(role, 'rtl').style.lineHeight, role).toBeGreaterThanOrEqual(1.45);
    }
    expect(styleOf('cardTitle', 'rtl').style.lineHeight).toBe(1.45);
    expect(styleOf('band', 'rtl').style.lineHeight).toBe(1.5);
  });

  it('never sets Arabic tighter than the English of the same role', () => {
    for (const role of ROLES) {
      expect(styleOf(role, 'rtl').style.lineHeight, role).toBeGreaterThanOrEqual(
        styleOf(role, 'ltr').style.lineHeight,
      );
    }
  });

  it('changes nothing but the line height with the direction', () => {
    for (const role of ROLES) {
      const english = styleOf(role, 'ltr');
      const arabic = styleOf(role, 'rtl');
      expect(arabic.style.size).toBe(english.style.size);
      expect(arabic.style.weight).toBe(english.style.weight);
      expect(arabic.paint).toEqual(english.paint);
      expect(arabic.underline).toBe(english.underline);
    }
  });

  it('underlines a title and nothing else', () => {
    const underlined = ROLES.filter((role) => styleOf(role, 'ltr').underline);
    expect(underlined).toEqual(['heading', 'subheading', 'panelHead']);
  });

  it('sets titles, the number of a row and the number of sessions in the accent', () => {
    const accented = ROLES.filter((role) => styleOf(role, 'ltr').paint === ACCENT);
    expect(accented).toEqual(['heading', 'subheading', 'panelHead', 'rowNumber', 'pill']);
  });

  it('leaves one colour to its caller: a card’s category takes the hue of its score', () => {
    const open = ROLES.filter((role) => styleOf(role, 'ltr').paint === null);
    expect(open).toEqual(['cardCategory']);
  });

  it('sets everything else in the ink or the muted grey', () => {
    for (const role of ROLES) {
      const { paint } = styleOf(role, 'ltr');
      if (paint === null || paint === ACCENT) continue;
      expect([INK, MUTED], role).toContain(paint);
    }
  });

  it('sets a title, a label and a name in the heavier weight', () => {
    const bold = ROLES.filter((role) => styleOf(role, 'ltr').style.weight === 'bold');
    expect(bold).toEqual([
      'heading',
      'subheading',
      'panelHead',
      'cardCategory',
      'cardTitle',
      'cardLabel',
      'rowNumber',
      'rowName',
      'pill',
    ]);
  });

  it('cannot be changed by whoever holds it', () => {
    const held = styleOf('body', 'ltr');
    expect(Object.isFrozen(held)).toBe(true);
    expect(Object.isFrozen(held.style)).toBe(true);
    expect(styleOf('body', 'ltr')).toBe(held);
  });
});
