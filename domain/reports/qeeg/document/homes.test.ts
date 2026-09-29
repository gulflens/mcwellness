/**
 * One home for each name the page modules share, and read-only shapes.
 *
 * The two halves of the page round each declared `Direction`, `Paint` and
 * the millimetre, identical today and free to drift tomorrow. Each now lives
 * in one file and the others import it; and every exported shape is
 * read-only, so a caller holding an answer cannot change it for anyone
 * else. Most of what this file checks is checked by the type checker: each
 * `@ts-expect-error` below fails `pnpm typecheck` the day a field it names
 * stops being read-only.
 */

import { describe, expect, it } from 'vitest';
import { mirror } from './frame';
import type { Frame } from './frame';
import type { Direction } from './direction';
import { MM, mm } from './metrics';
import type { Face, LineBox, TextStyle } from './metrics';
import { placeImage } from './mapPlacement';
import type { PlacedImage } from './mapPlacement';
import { limitsFor } from './paginate';
import type { Fit, Limits, Placement, Flow } from './paginate';
import type { Laid, ParagraphInput, Span } from './paragraph';
import type { Paint, PathOp, Stroke } from './shapes';
import type { Run, Token } from './bidi';
import type { Crop, Pixels } from '../image/trim';

describe('one home for each shared name', () => {
  it('reads a direction from its own module, whichever module uses it', () => {
    const direction: Direction = 'rtl';
    const frame: Frame = { direction, left: 0, width: 10 };
    expect(mirror(frame).direction).toBe('ltr');
  });

  it('keeps the millimetre in metrics', () => {
    expect(mm(1)).toBe(MM);
  });

  it('names a placed map a PlacedImage, apart from the engine’s own Placed', () => {
    const placed: PlacedImage = placeImage(
      { width: 96, height: 96 },
      { maxWidth: 72, maxHeight: 72 },
    );
    expect(placed.width).toBe(72);
  });
});

describe('read-only shapes', () => {
  it('refuses, at compile time, a write to any exported shape', () => {
    const limits: Limits = limitsFor(100, 100);
    const writes = (): void => {
      const face = {} as Face;
      const style = {} as TextStyle;
      const box = {} as LineBox;
      const fit = {} as Fit;
      const placement = {} as Placement<Flow>;
      const frame = {} as Frame;
      const placed = {} as PlacedImage;
      const paint = {} as Paint;
      const stroke = {} as Stroke;
      const path = {} as PathOp;
      const span = {} as Span;
      const input = {} as ParagraphInput;
      const laid = {} as Laid;
      const token = {} as Token;
      const run = {} as Run;
      const pixels = {} as Pixels;
      const crop = {} as Crop;
      // @ts-expect-error Limits is read-only.
      limits.bodyHeight = 1;
      // @ts-expect-error Face is read-only.
      face.ascent = 1;
      // @ts-expect-error TextStyle is read-only.
      style.size = 1;
      // @ts-expect-error LineBox is read-only.
      box.advance = 1;
      // @ts-expect-error Fit is read-only.
      fit.scale = 1;
      // @ts-expect-error Placement is read-only.
      placement.y = 1;
      // @ts-expect-error Frame is read-only.
      frame.left = 1;
      // @ts-expect-error PlacedImage is read-only.
      placed.dpi = 1;
      // @ts-expect-error Paint is read-only.
      paint.grey = 1;
      // @ts-expect-error Stroke is read-only.
      stroke.width = 1;
      // @ts-expect-error PathOp is read-only.
      path.segments = [];
      // @ts-expect-error Span is read-only.
      span.text = '';
      // @ts-expect-error ParagraphInput is read-only.
      input.width = 1;
      // @ts-expect-error Laid is read-only.
      laid.height = 1;
      // @ts-expect-error Token is read-only.
      token.text = '';
      // @ts-expect-error Run is read-only.
      run.direction = 'ltr';
      // @ts-expect-error Pixels is read-only.
      pixels.width = 1;
      // @ts-expect-error Crop is read-only.
      crop.left = 1;
    };
    expect(typeof writes).toBe('function');
    expect(limits.bodyHeight).toBe(100);
  });
});
