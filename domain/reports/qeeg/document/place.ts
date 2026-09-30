/**
 * The parts of a brain-map report set on A4 pages: broken into pages,
 * spare room shared out, the dashboard fitted to its page, and the practice's
 * header and footer drawn on every page.
 *
 * **The footer is measured first.** Its height decides the height of the
 * body, and the body's height is the room a brain map fills, so the order is
 * fixed: the footer, then the parts (`buildQeegReport`), then the pages
 * (`paginate`, `breathe`). The footer piece keeps one height whatever page
 * it counts, so measuring it once is measuring it on every page.
 *
 * **A fitted part is laid wider and drawn smaller.** The dashboard fitted at
 * a scale `s` is laid at the body's width over `s` and each of its numbers
 * multiplied by `s` (`scaleOps`), so it fills the width of the page and
 * takes less of its depth; nothing is drawn through a transform, and a test
 * can say where every card prints.
 *
 * **What runs over is said, not hidden.** A part that runs past the foot of
 * its page, or a fitted part that did not fit at the smallest scale allowed,
 * is named in `overflowing`. Whoever renders the file refuses to while that
 * holds anything (`docs/SPEC/reports-qeeg.md` section 12, known limit 1).
 *
 * **What the editor is told** is returned beside the pages: how many there
 * are, the scale the dashboard was drawn at, what ran over, and how sharply
 * each map will print where it is drawn: a follow-up's maps are drawn twice,
 * on a page of their own and smaller in a pair, and each place is told
 * (`docs/SPEC/reports-qeeg.md` section 9, point 4).
 *
 * `y` is measured down from the top of the page body, in points, as
 * `paginate.ts` measures it; the ops are the page's own, `y` up from its foot.
 */

import { PAGE_HEIGHT } from '@domain/shared/document';
import type { Page } from '@domain/shared/document';
import { drawn } from './block';
import { buildQeegReport, footerOf, LOGO_IMAGE, mapImageKey } from './build';
import { PAIR_ORDER } from './changePage';
import type { Part, ReportInput } from './build';
import { BODY_WIDTH, bodyHeight, bodyTop, PAD } from './geometry';
import { placeImage, printQualityOf } from './mapPlacement';
import type { PrintQuality } from './mapPlacement';
import type { Condition } from '../types';
import { breathe, limitsFor, overflowing, paginate } from './paginate';
import type { Placement } from './paginate';
import { pageFooter } from './pieces/pageFooter';
import { pageHeader } from './pieces/pageHeader';
import { scaleOps } from './scale';
import type { LayoutOp } from './scale';
import type { Drawing } from './typeset';

/** A part where it landed: its page's `y`, its height there, the scale it was drawn at, its ops. */
export type PlacedPart = {
  readonly id: string;
  readonly y: number;
  readonly height: number;
  /** The scale a fitted part was drawn at; null for any other. */
  readonly scale: number | null;
  readonly ops: readonly LayoutOp[];
};

/** One page: its header, its parts, its footer. */
export type Sheet = {
  readonly header: readonly LayoutOp[];
  readonly parts: readonly PlacedPart[];
  readonly footer: readonly LayoutOp[];
};

export type MapPrint = {
  readonly figureId: string;
  readonly dpi: number;
  readonly quality: PrintQuality;
};

/** A map of a follow-up's before-and-after pair: which pair, which side, and how it prints there. */
export type PairPrint = MapPrint & {
  readonly condition: Condition;
  readonly side: 'earlier' | 'later';
};

export type Laid = {
  readonly sheets: readonly Sheet[];
  /** The writer's pages: each sheet's header, parts and footer, in that order. */
  readonly pages: readonly Page[];
  readonly bodyHeight: number;
  readonly footerHeight: number;
  /** The scale the dashboard was drawn at, 1 when it fitted whole. */
  readonly dashboardScale: number;
  /** The id of every part that runs over. Empty when the report may be rendered. */
  readonly overflowing: readonly string[];
  readonly maps: readonly MapPrint[];
  /** A follow-up's pairs, eyes closed first, the earlier map before the later. None on a first report. */
  readonly pairs: readonly PairPrint[];
};

/** A split part's ops: the part it came from, laid at the width asked. */
function splitOf(part: Part, room: number): readonly [Part, Part] | null {
  const cut = part.at(BODY_WIDTH).split?.(room);
  if (!cut) return null;
  const [first, second] = cut;
  const half = (block: typeof first): Part => ({
    ...part,
    height: block.height + block.overhang,
    at: () => block,
  });
  return [half(first), half(second)];
}

/** The ops of one part, where its placement puts it on the page. */
function opsOf(placement: Placement<Part>): LayoutOp[] {
  const { block: part, fit, y } = placement;
  const at = { left: PAD.side, top: bodyTop() - y };
  if (fit === null) return drawn(part.at(BODY_WIDTH), at);
  const block = part.at(fit.laidWidth);
  return drawn({ ...block, ops: scaleOps(block.ops, fit.scale, { x: 0, y: 0 }) }, at);
}

/** How sharply a picture of `pixels` prints at the size an image op draws it. */
function printOf(
  figureId: string,
  pixels: { width: number; height: number },
  op: LayoutOp | undefined,
): MapPrint {
  // Asked again of the size it was drawn at, so the figure is the one the
  // screen gives for the same map in the same place.
  const { dpi } =
    op?.kind === 'image'
      ? placeImage(pixels, { maxWidth: op.width, maxHeight: op.height })
      : { dpi: 0 };
  return { figureId, dpi, quality: printQualityOf(dpi) };
}

/** The pages of a report, and what the editor is told of them. */
export function placeQeegReport(input: ReportInput, drawing: Drawing): Laid {
  const footer = footerOf(input);
  const footerAt = (page: number, total: number) =>
    pageFooter({ lines: footer.lines, page: footer.page(page, total) }, BODY_WIDTH, drawing);
  const measured = footerAt(1, 1);
  const footerHeight = measured.height + measured.overhang;
  const room = bodyHeight(footerHeight);
  const limits = limitsFor(BODY_WIDTH, room);

  const parts = buildQeegReport(input, drawing, room);
  const heightAt = (part: Part, width: number) => {
    const block = part.at(width);
    return block.height + block.overhang;
  };
  const pages = breathe(paginate(parts, limits, heightAt, splitOf), limits, heightAt);

  const header =
    input.facts.logo === null
      ? []
      : drawn(pageHeader({ image: LOGO_IMAGE }, BODY_WIDTH, drawing), {
          left: PAD.side,
          top: PAGE_HEIGHT - PAD.top,
        });
  const sheets: Sheet[] = pages.map((page, index) => ({
    header,
    parts: page.map((placement) => ({
      id: placement.block.id,
      y: placement.y,
      height: placement.height,
      scale: placement.fit === null ? null : placement.fit.scale,
      ops: opsOf(placement),
    })),
    footer: drawn(footerAt(index + 1, pages.length), {
      left: PAD.side,
      top: PAD.bottom + footerHeight,
    }),
  }));

  const grid = pages.flat().find((placement) => placement.block.fit);
  /** The image ops of the part with this id, as it was laid at the body's width. */
  const imagesOf = (id: string) =>
    pages
      .flat()
      .flatMap((placement) => (placement.block.id === id ? placement.block.at(BODY_WIDTH).ops : []))
      .filter((op) => op.kind === 'image');
  const maps: MapPrint[] = Object.values(input.content.maps)
    .sort((one, other) => one.position - other.position)
    .map((map) =>
      printOf(
        map.figureId,
        { width: map.widthPx, height: map.heightPx },
        imagesOf(`map.${map.position}`).find(
          (op) => op.kind === 'image' && op.image === mapImageKey(map.figureId),
        ),
      ),
    );
  const { content } = input;
  const pairs: PairPrint[] =
    content.edition === 'follow-up'
      ? PAIR_ORDER.flatMap((condition) => {
          const pair = content.change.pairs[condition];
          const drawn = imagesOf(`change.pair.${condition}`);
          return (['earlier', 'later'] as const).flatMap((side) => {
            const figure = pair[side];
            if (figure === null) return [];
            const op = drawn.find(
              (each) => each.kind === 'image' && each.image === mapImageKey(figure.figureId),
            );
            const print = printOf(
              figure.figureId,
              { width: figure.widthPx, height: figure.heightPx },
              op,
            );
            return [{ ...print, condition, side }];
          });
        })
      : [];

  return {
    sheets,
    pages: sheets.map((sheet) => ({
      ops: [...sheet.header, ...sheet.parts.flatMap((part) => part.ops), ...sheet.footer],
    })),
    bodyHeight: room,
    footerHeight,
    dashboardScale: grid?.fit?.scale ?? 1,
    overflowing: overflowing(pages, limits).map((placement) => placement.block.id),
    maps,
    pairs,
  };
}
