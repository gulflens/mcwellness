import { describe, expect, it } from 'vitest';
import {
  breathe,
  effectiveMarginTop,
  fitBlock,
  gap,
  limitsFor,
  overflowing,
  pageBottom,
  paginate,
  reflow,
  type Flow,
  type Limits,
  type Placement,
} from './paginate';

const WIDTH = 400;
const HEIGHT = 100;

function block(id: string, height: number, extra: Partial<Flow> = {}): Flow {
  return {
    id,
    height,
    marginTop: 0,
    marginBottom: 0,
    keep: false,
    newPage: false,
    gapBefore: false,
    sectionStart: false,
    pinBottom: false,
    fit: false,
    ...extra,
  };
}

/**
 * A block keeps its area when it is laid wider: twice the width, half the
 * height. So a fit block scaled by `s` stands `s * s * height` tall, which is
 * continuous and lets a test say exactly where the answer must land.
 */
function heightAt(b: Flow, width: number): number {
  return (b.height * WIDTH) / width;
}

function ids(pages: readonly (readonly Placement<Flow>[])[]): string[][] {
  return pages.map((page) => page.map((placed) => placed.block.id));
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value as Record<string, unknown>)) deepFreeze(inner);
  }
  return value;
}

const limits: Limits = limitsFor(WIDTH, HEIGHT);

describe('limitsFor', () => {
  it('carries the body and the documented defaults', () => {
    expect(limits.bodyWidth).toBe(WIDTH);
    expect(limits.bodyHeight).toBe(HEIGHT);
    expect(limits.sectionGap).toBeCloseTo(8.504, 3);
    expect(limits.tolerance).toBe(0.75);
    expect(limits.fitThreshold).toBe(0.55);
    expect(limits.minScale).toBe(0.75);
    expect(limits.breatheShare).toBe(0.5);
    expect(limits.breatheCap).toBe(33.75);
    expect(limits.breatheFloor).toBe(3);
    expect(limits.pinBelowShare).toBe(0.25);
    expect(limits.pinBelowCap).toBe(25.5);
  });
});

describe('gap', () => {
  it('takes the larger of two positive margins', () => {
    expect(gap(6, 10)).toBe(10);
    expect(gap(10, 6)).toBe(10);
  });

  it('lets a negative margin pull the gap in', () => {
    expect(gap(10, -4)).toBe(6);
    expect(gap(-3, -5)).toBe(-5);
  });
});

describe('effectiveMarginTop', () => {
  it('takes the override when there is one', () => {
    expect(effectiveMarginTop(block('a', 1, { marginTop: 4 }), 20, 8.5)).toBe(20);
  });

  it('gives a section start at least the section gap', () => {
    expect(
      effectiveMarginTop(block('a', 1, { marginTop: 2, sectionStart: true }), undefined, 8.5),
    ).toBe(8.5);
    expect(
      effectiveMarginTop(block('a', 1, { marginTop: 12, sectionStart: true }), undefined, 8.5),
    ).toBe(12);
    expect(effectiveMarginTop(block('a', 1, { marginTop: 2 }), undefined, 8.5)).toBe(2);
  });
});

describe('reflow', () => {
  const heightOf = (b: Flow): number => b.height;

  it('sets the first block on a page at the top whatever its margin', () => {
    const placed = reflow(
      [block('a', 10, { marginTop: 30, sectionStart: true })],
      heightOf,
      new Map(),
      limits,
    );
    expect(placed[0]?.y).toBe(0);
  });

  it('collapses the margins between neighbours', () => {
    const placed = reflow(
      [
        block('a', 10, { marginBottom: 6 }),
        block('b', 10, { marginTop: 4 }),
        block('c', 10, { marginTop: -2 }),
      ],
      heightOf,
      new Map(),
      limits,
    );
    expect(placed.map((p) => p.y)).toEqual([0, 16, 24]);
  });

  it('gives a section start at least the section gap', () => {
    const placed = reflow(
      [block('a', 10), block('b', 10, { sectionStart: true })],
      heightOf,
      new Map(),
      limits,
    );
    expect(placed[1]?.y).toBeCloseTo(10 + limits.sectionGap, 6);
  });

  it('uses an override in place of the natural margin', () => {
    const placed = reflow(
      [block('a', 10), block('b', 10, { marginTop: 2 })],
      heightOf,
      new Map([['b', 15]]),
      limits,
    );
    expect(placed[1]?.y).toBe(25);
  });

  it('measures the page bottom from the last placement', () => {
    const placed = reflow(
      [block('a', 10), block('b', 20, { marginTop: 5 })],
      heightOf,
      new Map(),
      limits,
    );
    expect(pageBottom(placed)).toBe(35);
    expect(pageBottom([])).toBe(0);
  });
});

describe('fitBlock', () => {
  const at = (natural: number) => (width: number) => (natural * WIDTH) / width;

  it('leaves a block that fits at full size', () => {
    expect(fitBlock(at(50), 60, limits)).toEqual({
      scale: 1,
      laidWidth: WIDTH,
      height: 50,
      overflow: 0,
    });
  });

  it('finds a scale within half a point of the room', () => {
    const fit = fitBlock(at(100), 80, limits);
    expect(fit.height).toBeLessThanOrEqual(80);
    expect(fit.height).toBeGreaterThanOrEqual(79.5);
    expect(fit.scale).toBeCloseTo(Math.sqrt(0.8), 2);
    expect(fit.laidWidth).toBeCloseTo(WIDTH / fit.scale, 6);
    expect(fit.overflow).toBe(0);
  });

  it('never goes below the floor, and says by how much it overflows', () => {
    const fit = fitBlock(at(100), 40, limits);
    expect(fit.scale).toBe(0.75);
    expect(fit.height).toBeCloseTo(56.25, 6);
    expect(fit.overflow).toBeCloseTo(16.25, 6);
  });

  it('takes the same fixed number of steps for any room it must search, so the answer never depends on when it stopped', () => {
    const calls = (room: number): number => {
      let count = 0;
      fitBlock(
        (width) => {
          count += 1;
          return at(137.3)(width);
        },
        room,
        limits,
      );
      return count;
    };
    // The natural height, the floor, thirty halvings and the height at the answer.
    expect(calls(91.7)).toBe(33);
    expect(calls(120)).toBe(33);
    expect(calls(100.05)).toBe(33);
  });

  it('holds a step-shaped height under the room', () => {
    // Lines of 12 points: a wider layout takes fewer of them.
    const lines = (width: number): number => Math.ceil(2400 / width) * 12;
    const fit = fitBlock(lines, 60, limits);
    expect(fit.height).toBeLessThanOrEqual(60);
    expect(fit.overflow).toBe(0);
  });
});

describe('paginate', () => {
  it('fills a page and starts the next when a block would pass the foot', () => {
    const pages = paginate([block('a', 60), block('b', 30), block('c', 30)], limits, heightAt);
    expect(ids(pages)).toEqual([['a', 'b'], ['c']]);
    expect(pages[1]?.[0]?.y).toBe(0);
  });

  it('allows the tolerance before calling a block over', () => {
    const pages = paginate([block('a', 60), block('b', 40.5)], limits, heightAt);
    expect(ids(pages)).toEqual([['a', 'b']]);
  });

  it('sets the first block on a new page at the top whatever its margin', () => {
    const pages = paginate(
      [block('a', 90), block('b', 30, { marginTop: 20, sectionStart: true })],
      limits,
      heightAt,
    );
    expect(pages[1]?.[0]?.y).toBe(0);
  });

  it('keeps a heading with the block that follows it', () => {
    const pages = paginate(
      [block('a', 60), block('h', 10, { keep: true }), block('b', 40)],
      limits,
      heightAt,
    );
    expect(ids(pages)).toEqual([['a'], ['h', 'b']]);
  });

  it('moves a run of kept blocks together', () => {
    const pages = paginate(
      [
        block('a', 50),
        block('h1', 10, { keep: true }),
        block('h2', 10, { keep: true }),
        block('b', 40),
      ],
      limits,
      heightAt,
    );
    expect(ids(pages)).toEqual([['a'], ['h1', 'h2', 'b']]);
  });

  it('does not leave its heading alone when the page is one kept chain', () => {
    const pages = paginate([block('h', 10, { keep: true }), block('b', 120)], limits, heightAt);
    expect(ids(pages)).toEqual([['h', 'b']]);
    expect(overflowing(pages, limits).map((p) => p.block.id)).toEqual(['b']);
  });

  it('starts a page for a block marked for one, and does not leave an empty page first', () => {
    const pages = paginate(
      [block('a', 10, { newPage: true }), block('b', 10), block('c', 10, { newPage: true })],
      limits,
      heightAt,
    );
    expect(ids(pages)).toEqual([['a', 'b'], ['c']]);
  });

  it('keeps a block too tall for any page where it is, and reports it', () => {
    const pages = paginate([block('big', 150), block('b', 10)], limits, heightAt);
    expect(ids(pages)).toEqual([['big'], ['b']]);
    expect(overflowing(pages, limits).map((p) => p.block.id)).toEqual(['big']);
  });

  it('leaves the first part of a split block and carries its second', () => {
    type Part = Flow & { lines: number };
    const lines = (id: string, count: number): Part => ({ ...block(id, count * 10), lines: count });
    const split = (b: Part, room: number): readonly [Part, Part] | null => {
      const fit = Math.floor(room / 10);
      if (fit < 2 || b.lines - fit < 2) return null;
      return [lines(`${b.id}.1`, fit), lines(`${b.id}.2`, b.lines - fit)];
    };
    const pages = paginate([lines('a', 5), lines('p', 12)], limits, (b) => b.height, split);
    expect(ids(pages)).toEqual([['a', 'p.1'], ['p.2']]);
    expect(pages[0]?.[1]?.height).toBe(50);
    expect(pages[1]?.[0]?.height).toBe(70);
    expect(overflowing(pages, limits)).toEqual([]);
  });

  it('splits again when the second part is still too tall for a page', () => {
    type Part = Flow & { lines: number };
    const lines = (id: string, count: number): Part => ({ ...block(id, count * 10), lines: count });
    const split = (b: Part, room: number): readonly [Part, Part] | null => {
      const fit = Math.floor(room / 10);
      if (fit < 2 || b.lines - fit < 2) return null;
      return [lines(`${b.id}a`, fit), lines(`${b.id}b`, b.lines - fit)];
    };
    const pages = paginate([lines('p', 25)], limits, (b) => b.height, split);
    expect(ids(pages)).toEqual([['pa'], ['pba'], ['pbb']]);
  });

  it('moves a fit block with too little room to a new page with its heading', () => {
    const pages = paginate(
      [block('a', 60), block('h', 10, { keep: true }), block('map', 200, { fit: true })],
      limits,
      heightAt,
    );
    expect(ids(pages)).toEqual([['a'], ['h', 'map']]);
    const map = pages[1]?.[1];
    expect(map?.y).toBe(10);
    expect(map?.fit?.scale).toBe(0.75);
    expect(map?.fit?.overflow).toBeGreaterThan(0);
  });

  it('fits a carried fit block to the room it has on its new page, and breathing keeps it so', () => {
    const pages = paginate(
      [block('a', 40), block('map', 100, { fit: true, keep: true }), block('c', 10)],
      limits,
      heightAt,
    );
    expect(ids(pages)).toEqual([['a'], ['map', 'c']]);
    const map = pages[1]?.[0];
    expect(map?.fit?.scale).toBe(1);
    expect(map?.height).toBe(100);
    expect(breathe(pages, limits, heightAt)).toEqual(pages);
    expect(overflowing(pages, limits).map((p) => p.block.id)).toEqual(['c']);
  });

  it('splits a block taller than a page on the page it is moved to', () => {
    type Part = Flow & { lines: number };
    const lines = (id: string, count: number): Part => ({ ...block(id, count * 10), lines: count });
    const split = (b: Part, room: number): readonly [Part, Part] | null => {
      const fit = Math.floor(room / 10);
      if (fit < 2 || b.lines - fit < 2) return null;
      return [lines(`${b.id}.1`, fit), lines(`${b.id}.2`, b.lines - fit)];
    };
    const pages = paginate(
      [block('a', 85) as Part, lines('p', 12)],
      limits,
      (b) => b.height,
      split,
    );
    expect(ids(pages)).toEqual([['a'], ['p.1'], ['p.2']]);
    expect(pages[1]?.[0]?.height).toBe(100);
    expect(pages[2]?.[0]?.height).toBe(20);
    expect(overflowing(pages, limits)).toEqual([]);
  });

  it('ends, and reports the block, when a split makes no progress', () => {
    let calls = 0;
    const stuck = (b: Flow): readonly [Flow, Flow] => {
      calls += 1;
      if (calls > 100) throw new Error('split was asked a hundred times');
      return [{ ...b, height: 0 }, b];
    };
    const pages = paginate([block('big', 150)], limits, (b) => b.height, stuck);
    expect(ids(pages)).toEqual([['big']]);
    expect(overflowing(pages, limits).map((p) => p.block.id)).toEqual(['big']);
  });

  it('counts a split only when its second part is shorter than the block', () => {
    let calls = 0;
    const same = (b: Flow): readonly [Flow, Flow] => {
      calls += 1;
      if (calls > 100) throw new Error('split was asked a hundred times');
      return [{ ...b, height: 10 }, b];
    };
    const pages = paginate([block('big', 150)], limits, (b) => b.height, same);
    expect(ids(pages)).toEqual([['big']]);
  });

  it('moves a fit block that would overflow at the floor to a fresh page that holds it', () => {
    const pages = paginate([block('a', 40), block('map', 170, { fit: true })], limits, heightAt);
    expect(ids(pages)).toEqual([['a'], ['map']]);
    const map = pages[1]?.[0];
    expect(map?.fit?.scale).toBeCloseTo(Math.sqrt(100 / 170), 2);
    expect(map?.height).toBeLessThanOrEqual(100);
    expect(map?.fit?.overflow).toBe(0);
    expect(overflowing(pages, limits)).toEqual([]);
  });

  it('fits a fit block into the room left when there is enough of it', () => {
    const pages = paginate([block('a', 20), block('map', 100, { fit: true })], limits, heightAt);
    expect(ids(pages)).toEqual([['a', 'map']]);
    const map = pages[0]?.[1];
    expect(map?.height).toBeLessThanOrEqual(80);
    expect(map?.height).toBeGreaterThanOrEqual(79.5);
    expect(map?.fit?.overflow).toBe(0);
  });

  it('mutates nothing it is given', () => {
    const blocks = deepFreeze([
      block('a', 60),
      block('h', 10, { keep: true }),
      block('map', 200, { fit: true }),
      block('s', 10, { pinBottom: true }),
    ]);
    const frozenLimits = deepFreeze({ ...limits });
    const pages = deepFreeze(paginate(blocks, frozenLimits, heightAt));
    expect(() => breathe(pages, frozenLimits, heightAt)).not.toThrow();
    expect(() => overflowing(pages, frozenLimits)).not.toThrow();
  });
});

describe('breathe', () => {
  it('never makes a gap smaller than it was', () => {
    const pages = paginate(
      // Slack 20 shares out 10 before `b`, which is less than its own margin.
      [block('a', 10), block('b', 10, { gapBefore: true, marginTop: 20 }), block('c', 40)],
      limits,
      heightAt,
    );
    const before = pages[0]?.[1]?.y ?? 0;
    const after = breathe(pages, limits, heightAt)[0]?.[1]?.y ?? 0;
    expect(before).toBe(30);
    expect(after).toBe(30);
  });

  it('shares the spare room before each section start', () => {
    const pages = paginate(
      [block('a', 10), block('b', 10, { sectionStart: true }), block('c', 10, { gapBefore: true })],
      limits,
      heightAt,
    );
    const breathed = breathe(pages, limits, heightAt)[0] ?? [];
    // Natural bottom: 10 + section gap + 10 + 0 + 10, and two marks share half the rest.
    const slack = HEIGHT - (30 + limits.sectionGap);
    const each = Math.min((slack * 0.5) / 2, 33.75);
    expect(breathed[1]?.y).toBeCloseTo(10 + each, 6);
    expect(breathed[2]?.y).toBeCloseTo(10 + each + 10 + each, 6);
    expect(pageBottom(breathed)).toBeLessThanOrEqual(HEIGHT);
  });

  it('leaves a full page alone', () => {
    // Slack 4, one mark with no margin of its own: a share of 2, under the floor.
    const pages = paginate([block('a', 45), block('b', 51, { gapBefore: true })], limits, heightAt);
    expect(breathe(pages, limits, heightAt)).toEqual(pages);
  });

  it('lowers the pinned block, and keeps a margin beneath it', () => {
    const pages = paginate([block('a', 20), block('s', 10, { pinBottom: true })], limits, heightAt);
    const breathed = breathe(pages, limits, heightAt)[0] ?? [];
    const spare = HEIGHT - 30;
    const below = Math.min(spare * 0.25, 25.5);
    expect(breathed[1]?.y).toBeCloseTo(20 + spare - below, 6);
    expect(HEIGHT - pageBottom(breathed)).toBeCloseTo(below, 6);
  });

  it('does not move a pinned block alone on its page', () => {
    const pages = paginate([block('s', 10, { pinBottom: true, newPage: true })], limits, heightAt);
    expect(breathe(pages, limits, heightAt)[0]?.[0]?.y).toBe(0);
  });

  /**
   * A map five lines of 20 tall at the body width, four lines when laid a
   * little wider: its height steps with the width it is laid at. Set after a
   * block with a negative top margin, breathing lowers it by more than the
   * page's slack, past the foot, unless it is fitted again.
   */
  const stepped = (b: Flow, width: number): number =>
    b.id === 'map' ? Math.ceil(1625 / width) * 20 : b.height;
  const steppedPage = () =>
    paginate(
      [
        block('a', 20),
        block('map', 100, { fit: true, gapBefore: true, marginTop: -10 }),
        block('c', 0.5),
      ],
      limits,
      stepped,
    );

  it('fits a fit block again when breathing lowers it past the foot', () => {
    const pages = steppedPage();
    expect(ids(pages)).toEqual([['a', 'map', 'c']]);
    const before = pages[0]?.[1];
    const after = breathe(pages, limits, stepped)[0]?.[1];
    expect(after?.y ?? 0).toBeGreaterThan(before?.y ?? 0);
    expect(after?.height ?? 0).toBeLessThan(before?.height ?? 0);
    expect((after?.y ?? 0) + (after?.height ?? 0)).toBeLessThanOrEqual(HEIGHT);
    expect(after?.fit?.overflow).toBe(0);
  });

  it('moves the block after a refitted one up to it, so nothing passes the foot', () => {
    const breathed = breathe(steppedPage(), limits, stepped)[0] ?? [];
    const [, map, c] = breathed;
    expect(c?.y).toBe((map?.y ?? 0) + (map?.height ?? 0));
    expect(overflowing([breathed], limits)).toEqual([]);
  });

  it('never makes a fit block taller than it came in', () => {
    // A map fitted at 0.775 to 60 points of room, as a page may hand it over.
    const map = block('map', 100, { fit: true, keep: true });
    const page: Placement<Flow>[] = [
      {
        block: map,
        y: 0,
        height: 60,
        fit: { scale: 0.775, laidWidth: WIDTH / 0.775, height: 60, overflow: 0 },
      },
      { block: block('c', 10), y: 60, height: 10, fit: null },
    ];
    const breathed = breathe([page], limits, heightAt)[0] ?? [];
    expect(breathed[0]?.height).toBe(60);
    expect(breathed[1]?.y).toBe(60);
    expect(overflowing([breathed], limits)).toEqual([]);
  });

  it('refits a fit block after breathing and reflows before pinning', () => {
    const pages = paginate(
      [
        block('a', 10),
        block('map', 30, { fit: true, sectionStart: true }),
        block('s', 10, { pinBottom: true }),
      ],
      limits,
      heightAt,
    );
    const breathed = breathe(pages, limits, heightAt)[0] ?? [];
    const map = breathed[1];
    const pin = breathed[2];
    expect(map?.fit).not.toBeNull();
    expect(pin?.y ?? 0).toBeGreaterThanOrEqual((map?.y ?? 0) + (map?.height ?? 0));
    expect(pageBottom(breathed)).toBeLessThanOrEqual(HEIGHT);
  });
});

describe('overflowing', () => {
  it('reports nothing on pages that fit', () => {
    const pages = paginate([block('a', 50), block('b', 50), block('c', 50)], limits, heightAt);
    expect(overflowing(pages, limits)).toEqual([]);
  });
});

describe('numbers that are not numbers', () => {
  it('refuses a body that is not a finite size', () => {
    expect(() => limitsFor(Number.NaN, HEIGHT)).toThrow(/bodyWidth/);
    expect(() => limitsFor(WIDTH, Number.POSITIVE_INFINITY)).toThrow(/bodyHeight/);
    expect(() => limitsFor(WIDTH, 0)).toThrow(RangeError);
  });

  it('refuses a block whose height is not a number, rather than placing it', () => {
    expect(() =>
      paginate([block('a', Number.NaN), block('b', 10), block('c', 200)], limits, heightAt),
    ).toThrow(/height/);
    expect(() => paginate([block('a', 10)], limits, () => Number.NaN)).toThrow(RangeError);
  });

  it('refuses a margin that is not a number', () => {
    expect(() => paginate([block('a', 10, { marginTop: Number.NaN })], limits, heightAt)).toThrow(
      /marginTop/,
    );
    expect(() =>
      reflow([block('a', 10, { marginBottom: Number.NaN })], (b) => b.height, new Map(), limits),
    ).toThrow(/marginBottom/);
  });

  it('refuses a fit whose height or room is not a number', () => {
    expect(() => fitBlock(() => Number.NaN, 50, limits)).toThrow(/height/);
    expect(() => fitBlock(() => 100, Number.NaN, limits)).toThrow(/room/);
  });

  it('refuses a limit that is not a number, and a floor outside (0, 1]', () => {
    expect(() => fitBlock(() => 100, 50, { ...limits, tolerance: Number.NaN })).toThrow(
      /tolerance/,
    );
    expect(() => fitBlock(() => 100, 50, { ...limits, minScale: 0 })).toThrow(/minScale/);
    expect(() => paginate([block('a', 10)], { ...limits, minScale: 1.5 }, heightAt)).toThrow(
      /minScale/,
    );
    expect(() => fitBlock(() => 100, 50, { ...limits, minScale: 1 })).not.toThrow();
  });

  it('refuses to breathe a page holding a placement that is not a number', () => {
    const page: Placement<Flow>[] = [
      { block: block('a', 10), y: 0, height: Number.NaN, fit: null },
    ];
    expect(() => breathe([page], limits, heightAt)).toThrow(/height/);
    expect(() => breathe([], { ...limits, breatheCap: Number.NaN }, heightAt)).toThrow(
      /breatheCap/,
    );
  });

  it('refuses a height from reflow that is not a number', () => {
    expect(() => reflow([block('a', 10)], () => Number.NaN, new Map(), limits)).toThrow(/height/);
  });
});

describe('the limits breathing and pinning keep to', () => {
  it('shares nothing out when each share would be the floor or less', () => {
    // Slack 6 over one mark: a share of exactly 3, which is the floor.
    const at = (tall: number) =>
      breathe(
        paginate([block('a', 10), block('b', tall, { gapBefore: true })], limits, heightAt),
        limits,
        heightAt,
      )[0]?.[1]?.y;
    expect(at(84)).toBe(10);
    expect(at(83.8)).toBeCloseTo(10 + 3.1, 9);
  });

  it('caps each share at breatheCap', () => {
    const pages = paginate([block('a', 10), block('b', 10, { gapBefore: true })], limits, heightAt);
    // Half of 80 is 40, over the cap of 33.75.
    expect(breathe(pages, limits, heightAt)[0]?.[1]?.y).toBe(10 + 33.75);
  });

  it('does not lower a pinned block when the lift would be the floor or less', () => {
    // Spare 4: a quarter, 1, stays below, and the lift of 3 is the floor.
    const pages = paginate([block('a', 86), block('s', 10, { pinBottom: true })], limits, heightAt);
    expect(breathe(pages, limits, heightAt)[0]?.[1]?.y).toBe(86);
  });

  it('keeps no more than pinBelowCap beneath a pinned block', () => {
    const tall = limitsFor(WIDTH, 200);
    const pages = paginate([block('a', 10), block('s', 10, { pinBottom: true })], tall, heightAt);
    const pinned = breathe(pages, tall, heightAt)[0]?.[1];
    // Spare 180: a quarter is 45, over the cap of 25.5.
    expect(pinned?.y).toBeCloseTo(200 - 25.5 - 10, 9);
  });
});

describe('the rules a fit block keeps to', () => {
  it('stays after a page that is one kept chain, however little room is left', () => {
    const pages = paginate(
      [block('h', 60, { keep: true }), block('map', 200, { fit: true })],
      limits,
      heightAt,
    );
    expect(ids(pages)).toEqual([['h', 'map']]);
    expect(pages[0]?.[1]?.fit?.scale).toBe(0.75);
    expect(overflowing(pages, limits).map((p) => p.block.id)).toEqual(['map']);
  });

  it('is reported when fitted and still over, even by less than the tolerance', () => {
    const map = block('map', 100, { fit: true });
    const page: Placement<Flow>[] = [
      {
        block: map,
        y: 0,
        height: 100.5,
        fit: { scale: 0.75, laidWidth: WIDTH / 0.75, height: 100.5, overflow: 0.5 },
      },
    ];
    expect(overflowing([page], limits).map((p) => p.block.id)).toEqual(['map']);
  });
});
