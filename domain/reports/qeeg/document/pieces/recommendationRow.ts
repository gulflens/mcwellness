/**
 * One recommendation: its number, its name and its text side by side, over
 * a hairline along the foot of the row.
 *
 * **One first baseline.** The three are set in three sizes, so each is
 * lowered until its first baseline is level with the lowest of them, as the
 * practice's layout has it. Each block says where its own first baseline
 * stands (`Block.baseline`), which is what makes this exact even when a name
 * typed in the other script has a taller line box than the English beside
 * it.
 *
 * **The number is two figures**, `01` to `99`, Latin in both languages. A
 * row's number is the builder's to count, so anything else is a slip and is
 * refused by name.
 *
 * **With no text**, or text that is empty once trimmed, the name takes the
 * room of both columns and nothing is left for the text.
 */

import { beside } from '../block';
import type { Block, Cell } from '../block';
import { boxLeft } from '../frame';
import type { Frame } from '../frame';
import { ROW } from '../geometry';
import { finite } from '../metrics';
import { HAIRLINE } from '../palette';
import type { LayoutOp } from '../scale';
import { typeset } from '../typeset';
import type { Drawing } from '../typeset';
import type { Words } from './words';

export type RecommendationRowInput = {
  /** Its place in the list, from 1. */
  readonly number: number;
  readonly name: Words;
  readonly text: Words | null;
};

const LAST_NUMBER = 99;

function checked(input: RecommendationRowInput, width: number): void {
  finite('recommendationRow', 'width', width);
  if (width < 0) {
    throw new RangeError(
      `recommendationRow needs a width of zero or more, and was given ${width}.`,
    );
  }
  const { number } = input;
  if (!Number.isInteger(number) || number < 1 || number > LAST_NUMBER) {
    throw new RangeError(
      `recommendationRow needs a number that is a whole number from 1 to ${LAST_NUMBER}, and was given ${String(number)}.`,
    );
  }
}

export function recommendationRow(
  input: RecommendationRowInput,
  width: number,
  drawing: Drawing,
): Block {
  checked(input, width);
  const frame: Frame = { direction: drawing.direction, left: 0, width };
  const text = input.text !== null && input.text.text.trim() !== '' ? input.text : null;

  const nameAt = ROW.number + ROW.gutter;
  const nameWidth = text ? ROW.name : width - nameAt;
  const textAt = nameAt + ROW.name + ROW.gutter;
  const textWidth = text ? width - textAt : 0;
  if (nameWidth <= 0 || (text && textWidth <= 0)) {
    throw new RangeError(`recommendationRow is left no room for its words by a width of ${width}.`);
  }

  const figures = String(input.number).padStart(2, '0');
  const parts: readonly { block: Block; at: number }[] = [
    { block: typeset('rowNumber', figures, ROW.number, drawing), at: 0 },
    {
      block: typeset('rowName', input.name.text, nameWidth, drawing, {
        typed: input.name.typed,
      }),
      at: nameAt,
    },
    ...(text
      ? [
          {
            block: typeset('rowText', text.text, textWidth, drawing, { typed: text.typed }),
            at: textAt,
          },
        ]
      : []),
  ];

  const line = Math.max(0, ...parts.map(({ block }) => block.baseline ?? 0));
  const cells: Cell[] = parts.map(({ block, at }) => ({
    block,
    left: boxLeft(frame, at, block.width),
    down: ROW.padV + (block.baseline === null ? 0 : line - block.baseline),
  }));
  const content = beside(width, cells);
  // The hairline stands under the padding and adds its thickness, as a
  // border does on the practice's page.
  const height = content.height + ROW.padV + ROW.rule;
  const hairline: LayoutOp = {
    kind: 'rule',
    x: 0,
    y: -height + ROW.rule / 2,
    width,
    thickness: ROW.rule,
    ...HAIRLINE,
  };
  return {
    width,
    height,
    overhang: Math.max(0, content.height + content.overhang - height),
    baseline: ROW.padV + line,
    ops: [...content.ops, hairline],
  };
}
