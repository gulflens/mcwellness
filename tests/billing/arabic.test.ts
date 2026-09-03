import { describe, expect, it } from 'vitest';
import { forDrawing, isArabic, shape, toVisualOrder } from '../../domain/billing/document';

/**
 * Arabic is set by choosing the shape each letter takes and then placing the
 * glyphs right to left (`domain/billing/document/arabic.ts`). Both halves are
 * pure arithmetic over code points, so both are tested without a font.
 *
 * The expectations are written as the presentation-form code points they should
 * produce, because that is the only unambiguous way to say "this letter is
 * drawn in its initial form" — the letters themselves look identical in a test
 * file whichever shape a renderer would choose.
 */

const codes = (text: string): number[] => [...text].map((c) => c.codePointAt(0) ?? 0);
const hex = (values: readonly number[]): string[] =>
  values.map((value) => value.toString(16).toUpperCase().padStart(4, '0'));

describe('choosing a letter’s shape', () => {
  it('leaves a single letter isolated', () => {
    // ب on its own is FE8F, its isolated form.
    expect(hex(shape(codes('ب')))).toEqual(['FE8F']);
  });

  it('joins a three-letter word: initial, medial, final', () => {
    // بحث — beh, hah, theh: FE91 initial, FEA4 medial, FE9A final.
    expect(hex(shape(codes('بحث')))).toEqual(['FE91', 'FEA4', 'FE9A']);
  });

  it('breaks the join after a letter that only joins to its right', () => {
    // در — dal joins only to the letter before it, so the reh that follows
    // cannot join onto it and takes its own isolated shape.
    expect(hex(shape(codes('در')))).toEqual(['FEA9', 'FEAD']);
  });

  it('draws lam followed by alef as the single glyph it is spelt with', () => {
    // لا is one ligature, FEFB, and not two letters side by side.
    expect(hex(shape(codes('لا')))).toEqual(['FEFB']);
  });

  it('draws lam-alef in its final form when the lam joins to what came before', () => {
    // بلا — the beh joins the lam, so the ligature takes its final shape.
    expect(hex(shape(codes('بلا')))).toEqual(['FE91', 'FEFC']);
  });

  it('looks past a vowel mark to find the letter a join belongs to', () => {
    // A fatha between two letters must not break the join: the beh is still
    // initial and the hah still final.
    expect(hex(shape(codes('بَح')))).toEqual(['FE91', '064E', 'FEA2']);
  });

  it('leaves a digit, a space and a full stop exactly as they are', () => {
    expect(hex(shape(codes('7 .')))).toEqual(['0037', '0020', '002E']);
  });
});

describe('putting a line into the order it is drawn', () => {
  it('reverses an Arabic run', () => {
    expect(toVisualOrder([0x0628, 0x062d, 0x062b])).toEqual([0x062b, 0x062d, 0x0628]);
  });

  it('keeps a Latin reference the right way round inside an Arabic phrase', () => {
    // The Arabic reverses; "INV" does not, because a reference is still read
    // left to right whatever surrounds it.
    const drawn = forDrawing('رقم INV');
    expect(String.fromCodePoint(...drawn).endsWith('INV')).toBe(false);
    expect(String.fromCodePoint(...drawn).startsWith('INV')).toBe(true);
  });

  it('keeps digits together and in order', () => {
    const drawn = String.fromCodePoint(...forDrawing('المبلغ 1,234.56'));
    expect(drawn.startsWith('1,234.56')).toBe(true);
  });

  it('puts a full stop that ends an Arabic sentence on the left, where it is read', () => {
    const drawn = forDrawing('نعم.');
    expect(drawn[0]).toBe(0x002e);
  });
});

describe('knowing what is Arabic', () => {
  it('recognises the Arabic block, its presentation forms, and nothing Latin', () => {
    expect(isArabic(0x0628)).toBe(true);
    expect(isArabic(0xfe91)).toBe(true);
    expect(isArabic(0x0041)).toBe(false);
    expect(isArabic(0x0037)).toBe(false);
  });
});
