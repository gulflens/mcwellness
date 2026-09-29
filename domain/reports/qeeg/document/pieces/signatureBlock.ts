/**
 * The signature at the foot of a report: clear room, a rule in ink, and the
 * signer's details under it, at the start edge.
 *
 * **No picture.** The old tool printed a scanned signature. Here the room
 * over the rule is left clear for a hand to sign a printed copy, and who
 * signed is said in words: the caller takes the signer's details from their
 * credential and hands them over as lines, each drawn on a line of its own.
 *
 * **Drawn before it has a signer.** A draft is previewed before anyone signs
 * it, so a signature with no line filled is drawn all the same: the room,
 * the rule and the label (contract, ruling R6). A line or a label that is
 * empty once trimmed is left out and takes no room; with no words at all,
 * the block is the room and the rule.
 */

import { stack } from '../block';
import type { Block } from '../block';
import { boxLeft } from '../frame';
import type { Frame } from '../frame';
import { SIGNATURE } from '../geometry';
import { finite } from '../metrics';
import { INK } from '../palette';
import { translateOps } from '../scale';
import type { LayoutOp } from '../scale';
import { typeset } from '../typeset';
import type { Drawing } from '../typeset';
import type { Words } from './words';

export type SignatureBlockInput = {
  /** The report's words over the signer's details. */
  readonly label: string;
  readonly lines: readonly Words[];
};

export function signatureBlock(input: SignatureBlockInput, width: number, drawing: Drawing): Block {
  finite('signatureBlock', 'width', width);
  if (width < SIGNATURE.width) {
    throw new RangeError(
      `signatureBlock needs a width of at least ${SIGNATURE.width}, and was given ${width}.`,
    );
  }
  const lines = input.lines.filter((line) => line.text.trim() !== '');

  const frame: Frame = { direction: drawing.direction, left: 0, width };
  const left = boxLeft(frame, 0, SIGNATURE.width);
  const words = stack(SIGNATURE.width, [
    typeset('signatureLabel', input.label, SIGNATURE.width, drawing),
    ...lines.map((line) =>
      typeset('signature', line.text, SIGNATURE.width, drawing, { typed: line.typed }),
    ),
  ]);
  const rule: LayoutOp = {
    kind: 'rule',
    x: left,
    y: -(SIGNATURE.room + SIGNATURE.rule / 2),
    width: SIGNATURE.width,
    thickness: SIGNATURE.rule,
    ...INK,
  };
  // A line takes no room: the rule is drawn inside the upper edge of the gap.
  // With no words under it there is no gap, and the rule is the foot.
  const top = SIGNATURE.room + SIGNATURE.gap;
  return {
    width,
    height: words.height > 0 ? top + words.height : SIGNATURE.room + SIGNATURE.rule,
    overhang: words.overhang,
    baseline: words.baseline === null ? null : top + words.baseline,
    ops: [rule, ...translateOps(words.ops, left, -top)],
  };
}
