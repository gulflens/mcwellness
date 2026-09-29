/**
 * The vertical measure of a line of type, as a browser's line box has it.
 *
 * **Why a browser's arithmetic.** The report was designed as a web page and
 * the practice's original tool reproduced CSS `line-height` so its PDF
 * matched the page: a paragraph of `n` lines stands exactly `n` line advances
 * tall, with half the leading above the first line's ascent. The original
 * recovered `n` by rounding a height back from its layout engine; here the
 * line count is known exactly, so nothing is rounded.
 *
 * **Units.** A `Face` is in ems. `readFont` (`domain/shared/document/
 * truetype.ts`) has already scaled a font's ascent and descent to thousandths
 * of an em, whatever grid the font was drawn on, so `faceOf` divides by a
 * thousand and never by `unitsPerEm`: dividing again would shrink a
 * 2048-unit face's line box by half.
 *
 * Pure arithmetic.
 */

/** A face's ascent and descent in em; the descent is negative. */
export type Face = { ascent: number; descent: number };

export type TextStyle = { size: number; lineHeight: number; weight: 'regular' | 'bold' };

/** One line's box: its advance, the leading on each side, and where the first baseline falls. */
export type LineBox = { advance: number; halfLeading: number; firstBaseline: number };

/** Points in a millimetre. */
export const MM = 72 / 25.4;

export function mm(value: number): number {
  return value * MM;
}

/** A parsed font's ascent and descent, in em. `unitsPerEm` is already folded in by `readFont`. */
export function faceOf(font: { ascent: number; descent: number; unitsPerEm: number }): Face {
  return { ascent: font.ascent / 1000, descent: font.descent / 1000 };
}

/**
 * The line box for a style on a strut face. The half leading may be negative
 * when the line height is tighter than the face: the glyphs then overhang
 * the box, as they do in a browser, and nothing below needs to know.
 */
export function lineBox(style: TextStyle, strut: Face): LineBox {
  const advance = style.lineHeight * style.size;
  const halfLeading = (advance - (strut.ascent - strut.descent) * style.size) / 2;
  return { advance, halfLeading, firstBaseline: halfLeading + strut.ascent * style.size };
}

export function paragraphHeight(lines: number, box: LineBox): number {
  return lines * box.advance;
}
