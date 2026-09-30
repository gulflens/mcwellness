/**
 * A row of a follow-up's change table, and the table's head: a measure,
 * then its figure with the eyes open, then its figure with the eyes closed
 * (`docs/SPEC/reports-qeeg.md` section 10), over a hairline.
 *
 * **Columns from the start edge.** The measure's column is
 * `CHANGE.measure` wide at the start; the two figures share what is left
 * equally, a gutter before each. The head and every row share the columns,
 * so the table reads down in either language, and the Arabic table is the
 * English one in a mirror.
 *
 * **One first baseline**, as a recommendation's row has: the measure is set
 * bold and the figures regular, and each cell is lowered until its first
 * baseline is level with the lowest.
 *
 * **A figure is optional.** A cell she left empty draws nothing and takes no
 * room; whether a row with no figure at all is printed is the builder's to
 * decide, and it is not. A figure that moved is marked by a shape in the ink
 * (`figureLine`), never by a colour.
 *
 * **A line takes no room** (contract, ruling R1): the hairline is drawn
 * inside the lower edge of the bottom padding.
 */

import { beside } from '../../block';
import type { Block, Cell } from '../../block';
import { boxLeft } from '../../frame';
import type { Frame } from '../../frame';
import { CHANGE, MARKER } from '../../geometry';
import { finite } from '../../metrics';
import { HAIRLINE } from '../../palette';
import type { LayoutOp } from '../../scale';
import { typeset } from '../../typeset';
import type { Drawing } from '../../typeset';
import { figureLine } from './figureLine';
import type { FigureLineInput } from './figureLine';

export type ChangeRowInput = {
  /** The measure and its range, as the wording writes it. */
  readonly measure: string;
  readonly eyesOpen: FigureLineInput | null;
  readonly eyesClosed: FigureLineInput | null;
};

export type ChangeHeadInput = {
  readonly measure: string;
  readonly eyesOpen: string;
  readonly eyesClosed: string;
};

type Columns = { readonly figure: number; readonly open: number; readonly closed: number };

/** Where each column starts, from the start edge, and how wide a figure's is. */
function columnsOf(fn: string, width: number): Columns {
  finite(fn, 'width', width);
  if (width < 0) {
    throw new RangeError(`${fn} needs a width of zero or more, and was given ${width}.`);
  }
  const figure = (width - CHANGE.measure - 2 * CHANGE.cellGutter) / 2;
  if (figure - MARKER.cell - MARKER.gutter <= 0) {
    throw new RangeError(`${fn} is left no room for a figure by a width of ${width}.`);
  }
  const open = CHANGE.measure + CHANGE.cellGutter;
  return { figure, open, closed: open + figure + CHANGE.cellGutter };
}

/** Cells on one first baseline, padded above and below, over a hairline. */
function row(
  parts: readonly { readonly block: Block; readonly at: number }[],
  width: number,
  drawing: Drawing,
): Block {
  const frame: Frame = { direction: drawing.direction, left: 0, width };
  const drawn = parts.filter(({ block }) => block.height > 0);
  const line = Math.max(0, ...drawn.map(({ block }) => block.baseline ?? 0));
  const cells: Cell[] = drawn.map(({ block, at }) => ({
    block,
    left: boxLeft(frame, at, block.width),
    down: CHANGE.cellPadV + (block.baseline === null ? 0 : line - block.baseline),
  }));
  const content = beside(width, cells);
  const height = content.height + CHANGE.cellPadV;
  const hairline: LayoutOp = {
    kind: 'rule',
    x: 0,
    y: -height + CHANGE.rule / 2,
    width,
    thickness: CHANGE.rule,
    ...HAIRLINE,
  };
  return {
    width,
    height,
    overhang: Math.max(0, content.height + content.overhang - height),
    baseline: CHANGE.cellPadV + line,
    ops: [...content.ops, hairline],
  };
}

export function changeRow(input: ChangeRowInput, width: number, drawing: Drawing): Block {
  const columns = columnsOf('changeRow', width);
  const figure = (given: FigureLineInput | null, at: number) =>
    given === null
      ? []
      : [{ block: figureLine(given, columns.figure, drawing, { size: 'cell' }), at }];
  return row(
    [
      { block: typeset('rowName', input.measure, CHANGE.measure, drawing), at: 0 },
      ...figure(input.eyesOpen, columns.open),
      ...figure(input.eyesClosed, columns.closed),
    ],
    width,
    drawing,
  );
}

export function changeHead(input: ChangeHeadInput, width: number, drawing: Drawing): Block {
  const columns = columnsOf('changeHead', width);
  return row(
    [
      { block: typeset('tableHead', input.measure, CHANGE.measure, drawing), at: 0 },
      { block: typeset('tableHead', input.eyesOpen, columns.figure, drawing), at: columns.open },
      {
        block: typeset('tableHead', input.eyesClosed, columns.figure, drawing),
        at: columns.closed,
      },
    ],
    width,
    drawing,
  );
}
