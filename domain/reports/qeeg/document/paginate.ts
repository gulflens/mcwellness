/**
 * Where each block of a brain-mapping report falls: which page, and how far
 * down it.
 *
 * **Plain arithmetic over plain data.** A block arrives as a height and a few
 * flags; nothing here knows about fonts, the PDF engine or an `Op`. The
 * caller measures (through `heightAt`) and draws; this decides. That split is
 * what makes the rules testable to the point, and what lets the same
 * pagination serve an English and an Arabic report without either knowing.
 *
 * **Ported from the practice's original tool, with its faults left behind.**
 * The Dart version kept a heading's top margin at a page top, carried every
 * block but the first when a page was one kept chain (stranding a heading),
 * replaced a margin when it shared out spare room (so a gap could shrink),
 * let a map shrink to a third of its size, and changed its blocks in place.
 * Here a page top is `y = 0`, a kept chain that fills a page stays put and is
 * reported by `overflowing`, breathing only ever widens a gap, a fit block
 * stops at `minScale` and says how far over it runs, and every function
 * returns new values.
 *
 * `y` is measured down from the top of the page body, in points.
 */

import { mm } from './metrics';

/** One block to be placed: its natural height and how it behaves at a break. */
export type Flow = {
  readonly id: string;
  readonly height: number;
  readonly marginTop: number;
  readonly marginBottom: number;
  /** Stay with the block that follows. */
  readonly keep: boolean;
  readonly newPage: boolean;
  readonly gapBefore: boolean;
  readonly sectionStart: boolean;
  readonly pinBottom: boolean;
  /** Scale to fit the room left on its page. */
  readonly fit: boolean;
};

/** How a fit block was fitted: its scale, the width it was laid at, its drawn height. */
export type Fit = { scale: number; laidWidth: number; height: number; overflow: number };

export type Placement<B extends Flow> = { block: B; y: number; height: number; fit: Fit | null };

export type Limits = {
  bodyWidth: number;
  bodyHeight: number;
  sectionGap: number;
  tolerance: number;
  fitThreshold: number;
  minScale: number;
  breatheShare: number;
  breatheCap: number;
  breatheFloor: number;
  pinBelowShare: number;
  pinBelowCap: number;
};

/**
 * The page body and the defaults the original tool settled on. The two caps
 * were pixel values there (45 px and 34 px at three quarters of a point each).
 */
export function limitsFor(bodyWidth: number, bodyHeight: number): Limits {
  return {
    bodyWidth,
    bodyHeight,
    sectionGap: mm(3),
    tolerance: 0.75,
    fitThreshold: 0.55,
    minScale: 0.75,
    breatheShare: 0.5,
    breatheCap: 33.75,
    breatheFloor: 3,
    pinBelowShare: 0.25,
    pinBelowCap: 25.5,
  };
}

/** Margin collapse as a browser does it: the larger positive plus the more negative. */
export function gap(marginBottomOfPrevious: number, marginTopOfNext: number): number {
  const positive = Math.max(Math.max(marginBottomOfPrevious, 0), Math.max(marginTopOfNext, 0));
  const negative = Math.min(Math.min(marginBottomOfPrevious, 0), Math.min(marginTopOfNext, 0));
  return positive + negative;
}

/** The top margin a block is set with: an override, or its own, lifted for a section start. */
export function effectiveMarginTop(
  b: Flow,
  override: number | undefined,
  sectionGap: number,
): number {
  if (override !== undefined) return override;
  return b.sectionStart ? Math.max(b.marginTop, sectionGap) : b.marginTop;
}

/** A block already sized: what `stack` needs to give it a `y`. */
type Sized<B extends Flow> = { block: B; height: number; fit: Fit | null };

/** Positions sized blocks down one page. The first sits at the top, whatever its margin. */
function stack<B extends Flow>(
  sized: readonly Sized<B>[],
  overrides: ReadonlyMap<string, number>,
  limits: Limits,
): Placement<B>[] {
  const out: Placement<B>[] = [];
  let bottom = 0;
  let previous: B | null = null;
  for (const each of sized) {
    const y =
      previous === null
        ? 0
        : bottom +
          gap(
            previous.marginBottom,
            effectiveMarginTop(each.block, overrides.get(each.block.id), limits.sectionGap),
          );
    out.push({ block: each.block, y, height: each.height, fit: each.fit });
    bottom = y + each.height;
    previous = each.block;
  }
  return out;
}

/** Positions the blocks of one page, in order. */
export function reflow<B extends Flow>(
  blocks: readonly B[],
  heightOf: (b: B) => number,
  overrides: ReadonlyMap<string, number>,
  limits: Limits,
): Placement<B>[] {
  return stack(
    blocks.map((block) => ({ block, height: heightOf(block), fit: null })),
    overrides,
    limits,
  );
}

/** Where the last block on a page ends; 0 for an empty page. */
export function pageBottom(page: readonly Placement<Flow>[]): number {
  const last = page[page.length - 1];
  return last ? last.y + last.height : 0;
}

/**
 * Enough halvings to pin a scale in [0.75, 1] far below a hundredth of a
 * point on any page, and a fixed count so the answer never depends on when
 * the loop happened to stop.
 */
const FIT_STEPS = 30;

/**
 * The largest scale, down to `minScale`, at which a block fits `room`.
 *
 * Laid at a scale `s`, a block is laid out `bodyWidth / s` wide and drawn at
 * `s` of that height, so a map or a table grows no wider on the page but
 * takes less of its depth. Bisection rather than the original's guess-then-
 * refine: the heights are often step-shaped (whole lines), and bisection is
 * the search that is right on a step.
 */
export function fitBlock(heightAt: (width: number) => number, room: number, limits: Limits): Fit {
  const natural = heightAt(limits.bodyWidth);
  if (room <= 0 || natural <= room) {
    return {
      scale: 1,
      laidWidth: limits.bodyWidth,
      height: natural,
      overflow: Math.max(0, natural - room),
    };
  }
  const drawn = (scale: number): number => scale * heightAt(limits.bodyWidth / scale);
  const floor = drawn(limits.minScale);
  if (floor > room) {
    return {
      scale: limits.minScale,
      laidWidth: limits.bodyWidth / limits.minScale,
      height: floor,
      overflow: floor - room,
    };
  }
  let fits = limits.minScale;
  let over = 1;
  for (let step = 0; step < FIT_STEPS; step += 1) {
    const middle = (fits + over) / 2;
    if (drawn(middle) <= room) fits = middle;
    else over = middle;
  }
  return { scale: fits, laidWidth: limits.bodyWidth / fits, height: drawn(fits), overflow: 0 };
}

/**
 * The run of kept blocks at the end of a page, which must travel with the
 * block after them. When that run is the whole page, carrying it would only
 * set the same page again one sheet later, so nothing is carried.
 */
function carryOf<B extends Flow>(page: readonly Sized<B>[]): number {
  let count = 0;
  for (let at = page.length - 1; at >= 0 && page[at]?.block.keep === true; at -= 1) count += 1;
  return count < page.length ? count : 0;
}

/** A non-empty page made of nothing but kept blocks, each holding on to the next. */
function isOneKeptChain<B extends Flow>(page: readonly Sized<B>[]): boolean {
  return page.length > 0 && page.every((each) => each.block.keep);
}

/**
 * Breaks the blocks into pages.
 *
 * A split's second part always opens a page of its own: the first part was
 * cut to the room there was, so the room is spent, and starting the second
 * part fresh keeps a split part (which inherits its block's `keep`) from
 * dragging its first half along with it.
 */
export function paginate<B extends Flow>(
  blocks: readonly B[],
  limits: Limits,
  heightAt: (b: B, width: number) => number,
  split?: (b: B, room: number) => readonly [B, B] | null,
): Placement<B>[][] {
  const pages: Sized<B>[][] = [[]];
  const none = new Map<string, number>();
  const current = (): Sized<B>[] => pages[pages.length - 1] ?? [];
  const startPage = (carried: readonly Sized<B>[]): void => {
    pages.push([...carried]);
  };
  /** Where a block would sit if it were added to the current page now. */
  const yFor = (block: B): number => {
    const placed = stack([...current(), { block, height: 0, fit: null }], none, limits);
    return placed[placed.length - 1]?.y ?? 0;
  };
  /** Takes the trailing kept run off the current page and opens a page with it. */
  const moveOn = (): void => {
    const page = current();
    const count = carryOf(page);
    const carried = page.slice(page.length - count);
    pages[pages.length - 1] = page.slice(0, page.length - count);
    startPage(carried);
  };

  const queue: { block: B; continued: boolean }[] = blocks.map((block) => ({
    block,
    continued: false,
  }));
  while (queue.length > 0) {
    const next = queue.shift();
    if (!next) break;
    const { block } = next;
    if ((block.newPage || next.continued) && current().length > 0) startPage([]);

    if (block.fit) {
      let y = yFor(block);
      const page = current();
      if (
        page.length > 0 &&
        limits.bodyHeight - y < limits.fitThreshold * limits.bodyHeight &&
        !isOneKeptChain(page)
      ) {
        moveOn();
        y = yFor(block);
      }
      const fit = fitBlock((width) => heightAt(block, width), limits.bodyHeight - y, limits);
      current().push({ block, height: fit.height, fit });
      continue;
    }

    const height = heightAt(block, limits.bodyWidth);
    const y = yFor(block);
    if (y + height <= limits.bodyHeight + limits.tolerance) {
      current().push({ block, height, fit: null });
      continue;
    }

    const parts = split ? split(block, limits.bodyHeight - y) : null;
    if (parts) {
      const [first, second] = parts;
      current().push({ block: first, height: heightAt(first, limits.bodyWidth), fit: null });
      queue.unshift({ block: second, continued: true });
      continue;
    }

    const page = current();
    // An empty page, or a page that is nothing but the kept chain leading up
    // to this block: moving would set the same thing again, so it stays and
    // `overflowing` reports it.
    if (page.length === 0 || isOneKeptChain(page)) {
      page.push({ block, height, fit: null });
      continue;
    }
    moveOn();
    current().push({ block, height, fit: null });
  }

  return pages.filter((page) => page.length > 0).map((page) => stack(page, none, limits));
}

/**
 * Shares a page's spare room out before its sections, then lowers a pinned
 * last block towards the foot.
 *
 * Only ever widens: a mark is given the larger of its own margin and its
 * share, so a heading that already had room never loses any.
 */
export function breathe<B extends Flow>(
  pages: readonly Placement<B>[][],
  limits: Limits,
  heightAt: (b: B, width: number) => number,
): Placement<B>[][] {
  return pages.map((page) => {
    let placed = stack(page, new Map(), limits);
    const overrides = new Map<string, number>();
    const marks = placed.slice(1).filter((p) => p.block.sectionStart || p.block.gapBefore);

    if (marks.length > 0) {
      const slack = limits.bodyHeight - pageBottom(placed);
      const each = Math.min((slack * limits.breatheShare) / marks.length, limits.breatheCap);
      if (each > limits.breatheFloor) {
        for (const mark of marks) {
          const natural = effectiveMarginTop(mark.block, undefined, limits.sectionGap);
          overrides.set(mark.block.id, Math.max(natural, each));
        }
        placed = stack(placed, overrides, limits);
      }
    }

    // A refit can only be given less room than the block was fitted to, so it
    // only ever shrinks, and whatever follows it moves up.
    if (placed.some((p) => p.block.fit)) {
      const refitted: Sized<B>[] = [];
      for (const [index, p] of placed.entries()) {
        if (!p.block.fit) {
          refitted.push(p);
          continue;
        }
        const y = stack([...refitted, p], overrides, limits)[index]?.y ?? p.y;
        const fit = fitBlock((width) => heightAt(p.block, width), limits.bodyHeight - y, limits);
        refitted.push({ block: p.block, height: fit.height, fit });
      }
      placed = stack(refitted, overrides, limits);
    }

    const last = placed[placed.length - 1];
    if (placed.length > 1 && last?.block.pinBottom) {
      const spare = limits.bodyHeight - pageBottom(placed);
      const below = Math.min(spare * limits.pinBelowShare, limits.pinBelowCap);
      const pad = spare - below;
      if (pad > limits.breatheFloor) {
        placed = [...placed.slice(0, -1), { ...last, y: last.y + pad }];
      }
    }
    return placed;
  });
}

/** Every placement that runs past the foot of its page, or was fitted and still does not fit. */
export function overflowing<B extends Flow>(
  pages: readonly Placement<B>[][],
  limits: Limits,
): Placement<B>[] {
  return pages.flatMap((page) =>
    page.filter(
      (p) =>
        p.y + p.height > limits.bodyHeight + limits.tolerance ||
        (p.fit !== null && p.fit.overflow > 0),
    ),
  );
}
