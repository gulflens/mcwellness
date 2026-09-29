import { describe, expect, it } from 'vitest';
import { ACCENT, INK, MUTED } from './palette';
import { ARABIC_FLOOR, ROLES, styleOf } from './styles';
import type { Role } from './styles';
import type { Paint } from './shapes';

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

  it('never sets Arabic tighter than its face is tall, on the page or in a card', () => {
    // The installed Arabic face stands 1.5 em from the top of its tallest
    // letter to the foot of its deepest (an ascent of 1085 and a descent of
    // 415 in a thousand), as the review of the pieces measured it.
    expect(ARABIC_FLOOR).toBe(1.5);
    for (const role of ROLES) {
      expect(styleOf(role, 'rtl').style.lineHeight, role).toBeGreaterThanOrEqual(1.5);
    }
    expect(styleOf('cardTitle', 'rtl').style.lineHeight).toBe(1.5);
    expect(styleOf('cardSummary', 'rtl').style.lineHeight).toBe(1.5);
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

describe('the practice’s type, role by role', () => {
  /**
   * Written out, and not read back from the module, so that a number changed
   * there by a slip is a number that no longer agrees with this table. The
   * sizes and line heights are those of the report a household knows.
   */
  const TABLE: readonly (readonly [
    Role,
    number,
    number,
    'regular' | 'bold',
    Paint | null,
    boolean,
  ])[] = [
    ['body', 10.2, 1.5, 'regular', INK, false],
    ['lede', 10.2, 1.5, 'regular', MUTED, false],
    ['empty', 10.2, 1.5, 'regular', MUTED, false],
    ['heading', 14, 1.5, 'bold', ACCENT, true],
    ['subheading', 11.5, 1.5, 'bold', ACCENT, true],
    ['band', 10.2, 1.42, 'regular', INK, false],
    ['bandMuted', 10.2, 1.42, 'regular', MUTED, false],
    ['note', 7.6, 1.4, 'regular', MUTED, false],
    ['panel', 10.2, 1.5, 'regular', INK, false],
    ['panelHead', 10.2, 1.5, 'bold', ACCENT, true],
    ['cardCategory', 6.6, 1.5, 'bold', null, false],
    ['cardTitle', 10, 1.16, 'bold', INK, false],
    ['cardSummary', 8.6, 1.36, 'regular', MUTED, false],
    ['cardLabel', 6.8, 1.5, 'bold', MUTED, false],
    ['cardEvidence', 8.3, 1.35, 'regular', MUTED, false],
    ['cardBullet', 8.4, 1.34, 'regular', INK, false],
    ['cardAdvice', 8.4, 1.38, 'regular', INK, false],
    ['rowNumber', 11, 1.5, 'bold', ACCENT, false],
    ['rowName', 10.2, 1.5, 'bold', INK, false],
    ['rowText', 10.2, 1.5, 'regular', MUTED, false],
    ['pill', 11, 1.5, 'bold', ACCENT, false],
    ['signature', 9, 1.4, 'regular', INK, false],
    ['signatureLabel', 9, 1.4, 'regular', MUTED, false],
    ['footer', 6.8, 1.45, 'regular', MUTED, false],
  ];

  it('holds every role there is, once', () => {
    expect(TABLE.map(([role]) => role)).toEqual([...ROLES]);
  });

  it.each(TABLE)(
    'sets %s at %d points on a line of %d, %s',
    (role, size, line, weight, paint, underline) => {
      const english = styleOf(role, 'ltr');
      expect(english.style).toEqual({ size, lineHeight: line, weight });
      expect(english.paint).toBe(paint);
      expect(english.underline).toBe(underline);
      expect(styleOf(role, 'rtl').style).toEqual({
        size,
        lineHeight: Math.max(line, 1.5),
        weight,
      });
    },
  );
});
