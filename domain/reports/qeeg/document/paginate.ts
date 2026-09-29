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

import { finite, mm } from './metrics';

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
export type Fit = {
  readonly scale: number;
  readonly laidWidth: number;
  readonly height: number;
  readonly overflow: number;
};

export type Placement<B extends Flow> = {
  readonly block: B;
  readonly y: number;
  readonly height: number;
  readonly fit: Fit | null;
};

export type Limits = {
  readonly bodyWidth: number;
  readonly bodyHeight: number;
  readonly sectionGap: number;
  readonly tolerance: number;
  readonly fitThreshold: number;
  readonly minScale: number;
  readonly breatheShare: number;
  readonly breatheCap: number;
  readonly breatheFloor: number;
  readonly pinBelowShare: number;
  readonly pinBelowCap: number;
};

/**
 * The page body and the defaults the original tool settled on. The two caps
 * were pixel values there (45 px and 34 px at three quarters of a point each).
 */
export function limitsFor(bodyWidth: number, bodyHeight: number): Limits {
  return checkedLimits('limitsFor', {
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
  });
}

/**
 * Refuses limits that are not finite numbers, a body of no size, and a
 * floor for `minScale` outside (0, 1]: a bisection between a floor of 0 and
 * 1 would lay a block out infinitely wide.
 */
function checkedLimits(fn: string, limits: Limits): Limits {
  finite(fn, 'bodyWidth', limits.bodyWidth);
  finite(fn, 'bodyHeight', limits.bodyHeight);
  finite(fn, 'sectionGap', limits.sectionGap);
  finite(fn, 'tolerance', limits.tolerance);
  finite(fn, 'fitThreshold', limits.fitThreshold);
  finite(fn, 'minScale', limits.minScale);
  finite(fn, 'breatheShare', limits.breatheShare);
  finite(fn, 'breatheCap', limits.breatheCap);
  finite(fn, 'breatheFloor', limits.breatheFloor);
  finite(fn, 'pinBelowShare', limits.pinBelowShare);
  finite(fn, 'pinBelowCap', limits.pinBelowCap);
  if (limits.bodyWidth <= 0 || limits.bodyHeight <= 0) {
    throw new RangeError(
      `${fn} needs a body wider and taller than nothing, and was given ${limits.bodyWidth} by ${limits.bodyHeight}.`,
    );
  }
  if (limits.minScale <= 0 || limits.minScale > 1) {
    throw new RangeError(
      `${fn} needs a minScale above 0 and at most 1, and was given ${limits.minScale}.`,
    );
  }
  return limits;
}

/** Refuses a block whose height or margins are not finite numbers. */
function checkBlock(fn: string, b: Flow): void {
  finite(fn, 'height', b.height);
  finite(fn, 'marginTop', b.marginTop);
  finite(fn, 'marginBottom', b.marginBottom);
}

/** A caller's height, refused when it is not a finite number. */
function measured(fn: string, height: number): number {
  finite(fn, 'height', height);
  return height;
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
  checkedLimits('reflow', limits);
  for (const block of blocks) checkBlock('reflow', block);
  for (const value of overrides.values()) finite('reflow', 'override', value);
  return stack(
    blocks.map((block) => ({ block, height: measured('reflow', heightOf(block)), fit: null })),
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
  checkedLimits('fitBlock', limits);
  finite('fitBlock', 'room', room);
  const natural = measured('fitBlock', heightAt(limits.bodyWidth));
  if (room <= 0 || natural <= room) {
    return {
      scale: 1,
      laidWidth: limits.bodyWidth,
      height: natural,
      overflow: Math.max(0, natural - room),
    };
  }
  const drawn = (scale: number): number =>
    scale * measured('fitBlock', heightAt(limits.bodyWidth / scale));
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
  checkedLimits('paginate', limits);
  for (const block of blocks) checkBlock('paginate', block);
  const heightOf = (b: B, width: number): number => measured('paginate', heightAt(b, width));
  const pages: Sized<B>[][] = [[]];
  const none = new Map<string, number>();
  const current = (): Sized<B>[] => pages[pages.length - 1] ?? [];
  const startPage = (): void => {
    pages.push([]);
  };
  /** Where a block would sit if it were added to the current page now. */
  const yFor = (block: B): number => {
    const placed = stack([...current(), { block, height: 0, fit: null }], none, limits);
    return placed[placed.length - 1]?.y ?? 0;
  };
  const queue: { block: B; continued: boolean }[] = blocks.map((block) => ({
    block,
    continued: false,
  }));

  /**
   * Takes the trailing kept run off the current page, opens an empty page,
   * and puts the run and then `block` back at the head of the queue, in
   * order. Each is placed on the new page by the rules again, so a carried
   * fit block is fitted to the room it has there and a block taller than a
   * page is split there. It cannot move twice: on the new page everything
   * before it is the carried kept chain, or nothing.
   */
  const moveOn = (block: B): void => {
    const page = current();
    const count = carryOf(page);
    const carried = page.slice(page.length - count);
    pages[pages.length - 1] = page.slice(0, page.length - count);
    startPage();
    queue.unshift(...carried.map((each) => ({ block: each.block, continued: false })), {
      block,
      continued: false,
    });
  };
  while (queue.length > 0) {
    const next = queue.shift();
    if (!next) break;
    const { block } = next;
    if ((block.newPage || next.continued) && current().length > 0) startPage();

    if (block.fit) {
      const y = yFor(block);
      const page = current();
      const movable = page.length > 0 && !isOneKeptChain(page);
      if (movable && limits.bodyHeight - y < limits.fitThreshold * limits.bodyHeight) {
        moveOn(block);
        continue;
      }
      const fit = fitBlock((width) => heightAt(block, width), limits.bodyHeight - y, limits);
      // Still over at the floor, with room above it that a fresh page would
      // give back: move on and fit again there.
      if (movable && fit.overflow > 0) {
        moveOn(block);
        continue;
      }
      page.push({ block, height: fit.height, fit });
      continue;
    }

    const height = heightOf(block, limits.bodyWidth);
    const y = yFor(block);
    if (y + height <= limits.bodyHeight + limits.tolerance) {
      current().push({ block, height, fit: null });
      continue;
    }

    // A split counts only when it makes progress: a first part with some
    // height, and a second part shorter than the block. Anything else would
    // open page after page and never end.
    const parts = split ? split(block, limits.bodyHeight - y) : null;
    const firstHeight = parts ? heightOf(parts[0], limits.bodyWidth) : 0;
    if (parts && firstHeight > 0 && heightOf(parts[1], limits.bodyWidth) < height) {
      const [first, second] = parts;
      current().push({ block: first, height: firstHeight, fit: null });
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
    moveOn(block);
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
  checkedLimits('breathe', limits);
  for (const page of pages) {
    for (const p of page) {
      checkBlock('breathe', p.block);
      finite('breathe', 'y', p.y);
      finite('breathe', 'height', p.height);
    }
  }
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

    // Breathing lowers a fit block, and a lowered block has less room than it
    // was fitted to. Under the default share it still fits, but a negative
    // top margin can lower it by more than the page's slack, past the foot;
    // so each fit block is fitted again to the room it now has, and the page
    // is reflowed so what follows moves up to it. A refit never returns a
    // block taller than it came in: a block handed over at a scale it was
    // given elsewhere keeps that scale rather than growing over what follows.
    if (placed.some((p) => p.block.fit)) {
      const refitted: Sized<B>[] = [];
      for (const [index, p] of placed.entries()) {
        if (!p.block.fit) {
          refitted.push(p);
          continue;
        }
        const y = stack([...refitted, p], overrides, limits)[index]?.y ?? p.y;
        const fit = fitBlock((width) => heightAt(p.block, width), limits.bodyHeight - y, limits);
        refitted.push(fit.height < p.height ? { block: p.block, height: fit.height, fit } : p);
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
