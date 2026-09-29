/**
 * The panel at the head of a report: who the report is about, and when and
 * how the recording was made, in two columns inside a rounded panel.
 *
 * **One paragraph a line.** Each line is its label (the colon handed in with
 * it) and its value joined by one space, set as ONE paragraph that reads the
 * way its report does. A value in the other script, an Arabic name in an
 * English report, is a run inside that paragraph, and `bidi.ts` sets it the
 * way it reads; a figure inside an Arabic line stays a Latin figure.
 *
 * **A draft is previewed before it is filled.** A line whose value is empty
 * is still drawn, with its label, so the panel shows what is still to fill.
 * A line with neither label nor value draws nothing and takes no room.
 *
 * **A value is plain words.** The line reads the way its report does,
 * whoever wrote the value, so whether a person typed it is not asked.
 *
 * **The gaps are the practice's.** `PANEL.headGap` under a column's title
 * when a line follows it, and `PANEL.lineGap` under every line, the last
 * included, as the practice's panel has it.
 */

import { beside, boxed, stack } from '../block';
import type { Block, Box } from '../block';
import { columns } from '../frame';
import type { Frame } from '../frame';
import { PANEL, panelColumnWidth } from '../geometry';
import { finite } from '../metrics';
import { PANEL_EDGE, PANEL_FILL } from '../palette';
import { typeset } from '../typeset';
import type { Drawing } from '../typeset';

export type InfoLine = { readonly label: string; readonly value: string };
export type InfoColumn = { readonly title: string; readonly lines: readonly InfoLine[] };
export type InfoPanelInput = { readonly first: InfoColumn; readonly second: InfoColumn };

const BOX: Box = {
  padH: PANEL.padH,
  padV: PANEL.padV,
  radius: PANEL.radius,
  fill: PANEL_FILL,
  edge: { ...PANEL_EDGE, width: PANEL.edge },
};

function columnOf(column: InfoColumn, width: number, drawing: Drawing): Block {
  const head = typeset('panelHead', column.title, width, drawing);
  const lines = column.lines
    .map((line) => typeset('panel', `${line.label} ${line.value}`, width, drawing))
    .filter((line) => line.height > 0)
    .flatMap((line) => [line, PANEL.lineGap]);
  const titled = head.height > 0 ? (lines.length > 0 ? [head, PANEL.headGap] : [head]) : [];
  return stack(width, [...titled, ...lines]);
}

export function infoPanel(input: InfoPanelInput, width: number, drawing: Drawing): Block {
  finite('infoPanel', 'width', width);
  if (width < 0) {
    throw new RangeError(`infoPanel needs a width of zero or more, and was given ${width}.`);
  }
  const each = panelColumnWidth(width);
  const inner = width - 2 * PANEL.padH;
  const frame: Frame = { direction: drawing.direction, left: 0, width: inner };
  const [first, second] = columns(frame, 2, PANEL.gutter);
  return boxed(
    beside(inner, [
      { block: columnOf(input.first, each, drawing), left: first?.left ?? 0 },
      { block: columnOf(input.second, each, drawing), left: second?.left ?? 0 },
    ]),
    width,
    BOX,
  );
}
