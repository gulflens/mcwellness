/**
 * A band's icon: a disc in the band's pale tint, a ring round it in the
 * band's hue, and a wave across it, slow and tall for a slow band and fast
 * and low for a fast one.
 *
 * **Why on a grid.** The practice drew the icon on a square of 48, and every
 * length of it is kept there (`BAND_ICON`, `BAND_WAVE`), so the icon is the
 * same drawing at whatever size it is asked for: each length is multiplied
 * by `size / BAND_ICON.box`, and `y` is turned over, the grid measuring down
 * and a block up.
 *
 * **Why not mirrored.** A wave is a figure, not a line of words: it rises
 * first on an Arabic page as on an English one, so the direction the piece
 * is handed is not asked.
 *
 * **Why a sine and not straight pieces.** The Dart tool drew the wave as 72
 * straight pieces; `sineWave` draws it as a few curves that keep to the
 * sine, lighter and smooth at any size.
 */

import type { Block } from '../block';
import { BAND_ICON, BAND_WAVE } from '../geometry';
import { finite } from '../metrics';
import { BAND_PAINT, bandDisc } from '../palette';
import type { ReportBand } from '../palette';
import type { LayoutOp } from '../scale';
import { circle, sineWave } from '../shapes';
import type { Drawing } from '../typeset';

export type BandIconInput = { readonly band: ReportBand };

/** The icon of a band, `size` on each side. It reads the same in either language. */
export function bandIcon(input: BandIconInput, size: number, drawing: Drawing): Block {
  finite('bandIcon', 'size', size);
  if (size < 0) {
    throw new RangeError(`bandIcon needs a size of zero or more, and was given ${size}.`);
  }
  // A figure is the same in both directions; the drawing is taken only so
  // that every piece is called alike.
  void drawing;

  const unit = size / BAND_ICON.box;
  const centreX = (BAND_ICON.box / 2) * unit;
  const centreY = -(BAND_ICON.box / 2) * unit;
  const hue = BAND_PAINT[input.band];
  const wave = BAND_WAVE[input.band];

  const ops: LayoutOp[] = [
    {
      kind: 'path',
      segments: circle(centreX, centreY, BAND_ICON.discRadius * unit),
      fill: { rgb: bandDisc(input.band) },
    },
    {
      kind: 'path',
      segments: circle(centreX, centreY, BAND_ICON.discRadius * unit),
      stroke: { rgb: hue, width: BAND_ICON.ringLine * unit },
    },
    {
      kind: 'path',
      segments: sineWave(
        BAND_ICON.waveFrom * unit,
        BAND_ICON.waveTo * unit,
        centreY,
        wave.amplitude * unit,
        wave.cycles,
      ),
      stroke: { rgb: hue, width: BAND_ICON.waveLine * unit, cap: 'round', join: 'round' },
    },
  ];
  return { width: size, height: size, overhang: 0, baseline: null, ops };
}
