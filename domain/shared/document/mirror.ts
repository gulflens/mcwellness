import { PAGE_WIDTH, type Align, type Op, type Page, type PathSegment } from './pdf';

/**
 * A page laid out left to right, turned into the same page right to left.
 *
 * **Why mirror a page rather than lay out a second one.** On 15 October 2026
 * the operator decided that a document the app produces is set in one
 * language, the client's, and never in both
 * (docs/CHANGE-REQUESTS/docfix-03.md). An Arabic document is then the English
 * document's own design read from the other side: the labels against the
 * right margin, the values to their left, the table's first column on the
 * right, the card that stood on the left standing on the right. Laying that
 * out twice would be two layouts to keep in step. Instead a document is laid
 * out once, left to right, in the words of its own language, and an Arabic one
 * is this page turned over on the page's vertical centre line.
 *
 * **What turns and what does not.** Every position turns: a point at `x` moves
 * to `PAGE_WIDTH - x`, and a box keeps its width and moves so that its right
 * edge stands where its left edge stood. A line of text keeps its own
 * direction — the caller has already said which lines are Arabic — and its
 * alignment turns with the page, so text that began at a column's left edge
 * ends at the mirrored column's right edge. Nothing inside a glyph, an image or
 * a figure is flipped: a logo is moved, never reversed, and "AED 700.00" still
 * reads "AED 700.00".
 *
 * The margins are equal (`LEFT` and `RIGHT` in each module's sheet are
 * `MARGIN` from either edge), so the mirrored page keeps every margin.
 *
 * Pure: pages in, pages out, nothing shared between them.
 */
export function mirrorPages(pages: readonly Page[]): Page[] {
  return pages.map((page) => ({ ops: page.ops.map(mirrorOp) }));
}

const turn = (x: number): number => PAGE_WIDTH - x;

/** Where text is anchored once the page is turned. Absent is the writer's own default. */
function turnAlign(align: Align | undefined, rtl: boolean): Align {
  const given: Align = align ?? (rtl ? 'end' : 'start');
  if (given === 'centre') return 'centre';
  return given === 'start' ? 'end' : 'start';
}

function turnSegment(segment: PathSegment): PathSegment {
  switch (segment[0]) {
    case 'M':
      return ['M', turn(segment[1]), segment[2]];
    case 'L':
      return ['L', turn(segment[1]), segment[2]];
    case 'C':
      return [
        'C',
        turn(segment[1]),
        segment[2],
        turn(segment[3]),
        segment[4],
        turn(segment[5]),
        segment[6],
      ];
    case 'Z':
      return ['Z'];
  }
}

function mirrorOp(op: Op): Op {
  switch (op.kind) {
    case 'text':
      return { ...op, x: turn(op.x), align: turnAlign(op.align, op.rtl === true) };
    case 'rect':
    case 'image':
      return { ...op, x: turn(op.x) - op.width };
    case 'rule': {
      // A rule runs from (x, y) to (x + width, y + dy). Turned, it runs from
      // the turned far end back to the turned near end, so it starts where
      // the old one finished and rises the other way.
      const dy = op.dy ?? 0;
      if (dy === 0) return { ...op, x: turn(op.x) - op.width };
      return { ...op, x: turn(op.x) - op.width, y: op.y + dy, dy: -dy };
    }
    case 'path':
      return { ...op, segments: op.segments.map(turnSegment) };
  }
}
