/**
 * A drawn block of a brain-mapping report, and the few ways blocks are put
 * together: one under another, side by side, inside a box.
 *
 * **What a block is.** A width, a height and a list of ops, drawn in its OWN
 * box: the top-left corner is (0, 0), `x` grows to the right and `y` grows UP
 * the page as PDF has it, so everything a block draws sits between `y = 0`
 * and `y = -height`. A block knows nothing of the page it will land on.
 * `drawn` puts it there, by moving every op; nothing is laid out twice.
 *
 * **Why a value and not a widget.** The Dart tool nested widgets that
 * measured and painted themselves, so the only way to check a card was to
 * look at it. A block is numbers: a test can ask where anything is, and
 * `extentOf` gives the box that holds all of it. The pieces of the report
 * (`pieces/`) are functions from text and numbers to a block, and know
 * nothing of a finding or a score; joining a report's content to them is
 * the builder's business (`build.ts`), not theirs.
 *
 * **What hangs below.** An underline on a last line reaches under its line
 * box. `overhang` says how far, and `stack` never sets the next part closer
 * than that.
 *
 * **Refusals.** A part wider than its stack, two cells that overlap, a cell
 * that leaves its row: each is a slip in a piece and not data, so each is
 * refused with a `RangeError` that names it. Overlapping cells are the slip
 * a mirrored Arabic row makes most easily, and nothing else would notice.
 */

import { finite } from './metrics';
import { drawParagraph, layoutParagraph, splitParagraph } from './paragraph';
import type { Laid, Measure, ParagraphInput } from './paragraph';
import { ENGINE_RULE_THICKNESS, PDF_LINE_WIDTH, translateOps } from './scale';
import type { LayoutOp } from './scale';
import { boundsOf, roundedRect } from './shapes';
import type { Paint, Stroke } from './shapes';

export type Block = {
  readonly width: number;
  readonly height: number;
  /** How far ink reaches below the box, 0 when none does. */
  readonly overhang: number;
  /**
   * How far below its top the first baseline of its type stands, or null
   * when it holds no type or holds several side by side. What a row needs to
   * set its cells on one baseline.
   */
  readonly baseline: number | null;
  readonly ops: readonly LayoutOp[];
  /**
   * The block cut in two, the first part no taller than `room`, or null when
   * it cannot be cut there. Absent on a block that is never cut.
   */
  readonly split?: (room: number) => readonly [Block, Block] | null;
};

/** A block in a row: where its left edge is, and how far its top is lowered. */
export type Cell = { readonly block: Block; readonly left: number; readonly down?: number };

export type Box = {
  readonly padH: number;
  readonly padV: number;
  readonly radius: number;
  readonly fill?: Paint;
  readonly edge?: Stroke;
  /** The least height of the box, padding and all. What it holds may make it taller. */
  readonly height?: number;
};

export type Extent = {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
};

/** The room two numbers that should be equal may differ by: a rounding error, no more. */
const EPSILON = 1e-6;

function notNegative(fn: string, name: string, value: number): void {
  finite(fn, name, value);
  if (value < 0) {
    throw new RangeError(`${fn} needs a ${name} of zero or more, and was given ${value}.`);
  }
}

/** A part's own numbers, which a stack, a row and a box would otherwise take on trust. */
function checkedPart(fn: string, what: string, part: Block): void {
  notNegative(fn, `${what} width`, part.width);
  notNegative(fn, `${what} height`, part.height);
  notNegative(fn, `${what} overhang`, part.overhang);
}

/** Room, and nothing drawn in it. */
export function blank(width: number, height: number): Block {
  notNegative('blank', 'width', width);
  notNegative('blank', 'height', height);
  return { width, height, overhang: 0, baseline: null, ops: [] };
}

/** A block's ops with its top-left corner at `at`, `top` measured up from the foot of the page. */
export function drawn(block: Block, at: { left: number; top: number }): LayoutOp[] {
  finite('drawn', 'left', at.left);
  finite('drawn', 'top', at.top);
  return translateOps(block.ops, at.left, at.top);
}

/**
 * Parts one under another, from the top. A number is a gap in points, and
 * gaps that stand together add. A gap after a part is never less than what
 * hangs below that part.
 *
 * A part narrower than the stack is set at the stack's LEFT, in either
 * language: a stack knows nothing of reading direction. A piece that wants
 * a narrow part at its start edge asks a frame, and sets it with `beside`.
 */
export function stack(width: number, parts: readonly (Block | number)[]): Block {
  notNegative('stack', 'width', width);
  const ops: LayoutOp[] = [];
  let height = 0;
  let gap = 0;
  let hanging = 0;
  let baseline: number | null = null;
  let first = true;
  for (const part of parts) {
    if (typeof part === 'number') {
      notNegative('stack', 'gap', part);
      gap += part;
      continue;
    }
    checkedPart('stack', 'part', part);
    if (part.width > width + EPSILON) {
      throw new RangeError(`stack holds a part ${part.width} wide in ${width}.`);
    }
    height += Math.max(gap, hanging);
    if (first && part.baseline !== null) baseline = height + part.baseline;
    first = false;
    ops.push(...translateOps(part.ops, 0, -height));
    height += part.height;
    gap = 0;
    hanging = part.overhang;
  }
  return { width, height: height + gap, overhang: Math.max(0, hanging - gap), baseline, ops };
}

/**
 * Blocks side by side, their tops level unless a cell is lowered. Cells are
 * named in the order they are drawn, which need not be left to right.
 */
export function beside(width: number, cells: readonly Cell[]): Block {
  notNegative('beside', 'width', width);
  const ops: LayoutOp[] = [];
  let height = 0;
  let reach = 0;
  for (const { block, left, down = 0 } of cells) {
    finite('beside', 'left', left);
    notNegative('beside', 'down', down);
    checkedPart('beside', 'cell', block);
    const right = left + block.width;
    if (left < -EPSILON || right > width + EPSILON) {
      throw new RangeError(`beside holds a cell from ${left} to ${right} in a box ${width} wide.`);
    }
    ops.push(...translateOps(block.ops, left, -down));
    height = Math.max(height, down + block.height);
    reach = Math.max(reach, down + block.height + block.overhang);
  }
  const byLeft = [...cells].sort((a, b) => a.left - b.left);
  byLeft.forEach((cell, index) => {
    const before = byLeft[index - 1];
    if (!before) return;
    const edge = before.left + before.block.width;
    if (cell.left < edge - EPSILON) {
      throw new RangeError(`beside holds two cells that overlap, from ${cell.left} to ${edge}.`);
    }
  });
  return { width, height, overhang: reach - height, baseline: null, ops };
}

/**
 * A block inside a box with padding round it: a rounded panel, filled,
 * edged or both, drawn first so what it holds is drawn over it.
 *
 * An edge is drawn half to each side of its path, so the path is set in by
 * half the edge's width and the whole of the line stays inside the box.
 */
export function boxed(inside: Block, width: number, box: Box): Block {
  notNegative('boxed', 'width', width);
  notNegative('boxed', 'padH', box.padH);
  notNegative('boxed', 'padV', box.padV);
  notNegative('boxed', 'radius', box.radius);
  if (box.height !== undefined) notNegative('boxed', 'height', box.height);
  checkedPart('boxed', 'inside', inside);
  const edge = box.edge ? (box.edge.width ?? PDF_LINE_WIDTH) : 0;
  notNegative('boxed', 'edge width', edge);
  const padding = Math.min(box.padH, box.padV);
  if (edge > padding) {
    throw new RangeError(`boxed has an edge ${edge} wide over a padding of ${padding}.`);
  }
  const room = width - 2 * box.padH;
  if (inside.width > room + EPSILON) {
    throw new RangeError(
      `boxed holds an inside ${inside.width} wide in the ${room} its padding leaves.`,
    );
  }
  const height = Math.max(box.height ?? 0, inside.height + inside.overhang + 2 * box.padV);
  const inset = edge / 2;
  const panel: LayoutOp = {
    kind: 'path',
    segments: roundedRect(
      inset,
      -height + inset,
      Math.max(0, width - 2 * inset),
      Math.max(0, height - 2 * inset),
      Math.max(0, box.radius - inset),
    ),
    ...(box.fill ? { fill: box.fill } : {}),
    ...(box.edge ? { stroke: box.edge } : {}),
  };
  return {
    width,
    height,
    overhang: 0,
    baseline: null,
    ops: [panel, ...translateOps(inside.ops, box.padH, -box.padV)],
  };
}

function fromLaid(laid: Laid): Block {
  return {
    width: laid.input.width,
    height: laid.height,
    overhang: laid.overhang,
    baseline: laid.lines.length > 0 ? laid.box.firstBaseline : null,
    ops: drawParagraph(laid, { x: 0, top: 0 }),
    split: (room) => {
      const cut = splitParagraph(laid, room);
      return cut ? [fromLaid(cut[0]), fromLaid(cut[1])] : null;
    },
  };
}

/** A paragraph as a block: laid once, and cut between its lines when a page asks. */
export function paragraphBlock(input: ParagraphInput, measure: Measure): Block {
  return fromLaid(layoutParagraph(input, measure));
}

function extentOfOp(op: LayoutOp, measure: Measure): Extent {
  switch (op.kind) {
    case 'text': {
      const width = measure(
        op.text,
        op.style.font === 'bold' ? 'bold' : 'regular',
        op.style.size,
        op.rtl === true,
      );
      // An op that reads right to left and names no edge is anchored at its right.
      const align = op.align ?? (op.rtl === true ? 'end' : 'start');
      const left = align === 'end' ? op.x - width : align === 'centre' ? op.x - width / 2 : op.x;
      return { left, right: left + width, top: op.y, bottom: op.y };
    }
    case 'rule': {
      const half = (op.thickness ?? ENGINE_RULE_THICKNESS) / 2;
      const rise = op.dy ?? 0;
      // A line is widened across itself and not along itself: its ends are cut square.
      const across = op.width === 0 ? half : 0;
      const along = rise === 0 ? half : 0;
      const slant = op.width !== 0 && rise !== 0 ? half : 0;
      return {
        left: Math.min(op.x, op.x + op.width) - across - slant,
        right: Math.max(op.x, op.x + op.width) + across + slant,
        top: Math.max(op.y, op.y + rise) + along + slant,
        bottom: Math.min(op.y, op.y + rise) - along - slant,
      };
    }
    case 'image':
      return { left: op.x, right: op.x + op.width, top: op.y + op.height, bottom: op.y };
    case 'rect': {
      const half = op.stroke ? (op.stroke.thickness ?? ENGINE_RULE_THICKNESS) / 2 : 0;
      return {
        left: op.x - half,
        right: op.x + op.width + half,
        top: op.y + op.height + half,
        bottom: op.y - half,
      };
    }
    case 'path': {
      const bounds = boundsOf(op.segments);
      const half = op.stroke ? (op.stroke.width ?? PDF_LINE_WIDTH) / 2 : 0;
      return {
        left: bounds.left - half,
        right: bounds.right + half,
        top: bounds.top + half,
        bottom: bounds.bottom - half,
      };
    }
    default: {
      const unknown: never = op;
      throw new RangeError(`extentOf does not know the op ${String(unknown)}.`);
    }
  }
}

/**
 * The smallest box that holds every op. A text op is as wide as `measure`
 * says and is read from the edge it is anchored at; up and down it counts as
 * its baseline alone, since how far a letter rises is the face's to say and
 * a line box already allows for it. A stroked path is widened by half its
 * line all round, which is never too little.
 */
export function extentOf(ops: readonly LayoutOp[], measure: Measure): Extent {
  const [first, ...rest] = ops.map((op) => extentOfOp(op, measure));
  if (!first) return { left: 0, right: 0, top: 0, bottom: 0 };
  return rest.reduce(
    (all, each) => ({
      left: Math.min(all.left, each.left),
      right: Math.max(all.right, each.right),
      top: Math.max(all.top, each.top),
      bottom: Math.min(all.bottom, each.bottom),
    }),
    first,
  );
}
