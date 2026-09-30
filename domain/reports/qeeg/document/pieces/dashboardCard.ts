/**
 * A card of the dashboard: one measure of the brain map, its score in a
 * ring, what the score says, the recording's evidence, what it may mean, and
 * the advice, in a panel with a bar in the score's hue down its start edge.
 *
 * **What is absent leaves no gap.** The gap under a part is left only when a
 * part follows it: evidence with no words, a line of the list with no words,
 * advice with none, are not drawn and take no room. A list with no lines
 * draws its label alone.
 *
 * **Why a height may be given.** A row of the dashboard is as tall as its
 * tallest card, and every card in it is drawn at that height with its advice
 * lowered to the foot, as the practice's cards stand level. Given a height
 * no taller than its own, a card keeps its own.
 *
 * **Why the bar is a path of its own.** It is drawn over the panel's edge,
 * and its outer corners follow the panel's rounded corners exactly: the bar
 * is the part of the panel's outline that lies within `CARD.accent` of the
 * start edge. It is built in terms of the start edge and turned into x by
 * the frame, so the Arabic card's bar is on its right with no second copy.
 *
 * **A follow-up's card** shows the earlier score under its title, "was 4",
 * after a triangle in the ink when the score moved (`figureLine`). Whether
 * it moved is the builder's to ask of `classifyScoreChange`; the card only
 * draws what it is told. A first report's card has none, and is drawn as it
 * always was.
 *
 * **The dash is a mark, not a letter.** The practice set an en dash before
 * each line of the list; here it is a short filled bar in the muted grey,
 * level with the middle of the small letters of its line, so it is the same
 * in both languages and needs no word handed in.
 */

import { beside, boxed, stack } from '../block';
import type { Block, Box } from '../block';
import { boxLeft, fromStart, pathFromStart } from '../frame';
import type { Frame } from '../frame';
import { CARD } from '../geometry';
import { finite } from '../metrics';
import { HAIRLINE, MUTED, PANEL_EDGE, PANEL_FILL, TIER_PAINT } from '../palette';
import type { Tier } from '../palette';
import type { Span } from '../paragraph';
import { translateOps } from '../scale';
import type { LayoutOp } from '../scale';
import { arc, bar } from '../shapes';
import type { Paint, PathSegment } from '../shapes';
import { typeset } from '../typeset';
import type { Drawing } from '../typeset';
import { figureLine } from './followup/figureLine';
import type { FigureLineInput } from './followup/figureLine';
import { scoreRing } from './scoreRing';
import type { Words } from './words';

export type CardInput = {
  readonly score: number | null;
  readonly tier: Tier | null;
  readonly outOf: string;
  readonly category: string;
  readonly title: string;
  readonly summary: string;
  readonly evidence: { readonly label: string; readonly words: Words } | null;
  readonly meaning: { readonly label: string; readonly items: readonly string[] };
  readonly advice: readonly Span[];
  /**
   * A follow-up's earlier score, "was 4", with the way the score moved; a
   * first report has none. Set under the title, beside the ring.
   */
  readonly earlier?: FigureLineInput | null;
};

export type CardOptions = {
  /** The height of the card's row. A card is never shorter than its own. */
  readonly height?: number;
};

const BOX: Box = {
  padH: CARD.padH,
  padV: CARD.padV,
  radius: CARD.radius,
  fill: PANEL_FILL,
  edge: { ...PANEL_EDGE, width: CARD.edge },
};

/** The parts that hold something, with `gap` between each two. */
function joined(parts: readonly Block[], gap: number): (Block | number)[] {
  return parts
    .filter((part) => part.height > 0)
    .flatMap((part, index) => (index === 0 ? [part] : [gap, part]));
}

/** The ring at the start, the category over the title beside it, centred. */
function headOf(input: CardInput, inner: number, drawing: Drawing): Block {
  const frame: Frame = { direction: drawing.direction, left: 0, width: inner };
  const column = inner - CARD.ring - CARD.ringGutter;
  const ring = scoreRing(input, CARD.ring, drawing);
  const category = input.tier
    ? typeset('cardCategory', input.category, column, drawing, { tier: input.tier })
    : typeset('cardLabel', input.category, column, drawing);
  const title = typeset('cardTitle', input.title, column, drawing);
  const earlier = input.earlier
    ? [figureLine(input.earlier, column, drawing, { size: 'card' })]
    : [];
  const words = stack(column, joined([category, title, ...earlier], CARD.titleTop));
  const height = Math.max(ring.height, words.height);
  return beside(inner, [
    { block: ring, left: boxLeft(frame, 0, CARD.ring), down: (height - ring.height) / 2 },
    {
      block: words,
      left: boxLeft(frame, CARD.ring + CARD.ringGutter, column),
      down: (height - words.height) / 2,
    },
  ]);
}

/** A line of the list: its dash at the start edge, its words the indent in. */
function itemOf(item: string, inner: number, drawing: Drawing): Block {
  const frame: Frame = { direction: drawing.direction, left: 0, width: inner };
  const room = inner - CARD.bulletIndent;
  const words = typeset('cardBullet', item, room, drawing);
  if (words.height === 0 || words.baseline === null) return words;
  const dash: LayoutOp = {
    kind: 'path',
    segments: bar(
      fromStart(frame, CARD.dash / 2),
      -(words.baseline - CARD.dashRise),
      CARD.dash,
      CARD.dashLine,
    ),
    fill: MUTED,
  };
  return {
    width: inner,
    height: words.height,
    overhang: words.overhang,
    baseline: words.baseline,
    ops: [dash, ...translateOps(words.ops, boxLeft(frame, CARD.bulletIndent, room), 0)],
  };
}

/**
 * The bar down the start edge: the part of the panel's rounded outline that
 * lies within `CARD.accent` of that edge, its inner side straight.
 */
function accentBar(frame: Frame, height: number, paint: Paint): LayoutOp {
  const width = CARD.accent;
  const radius = Math.min(CARD.radius, height / 2);
  // A corner wider than the bar is cut by the bar's inner side: `meet` is
  // the angle about the corner's centre where its circle crosses that side.
  // A corner no wider than the bar lies whole inside it, from the top.
  const cut = radius > width;
  const meet = cut ? Math.acos((width - radius) / radius) : Math.PI / 2;
  const upper = arc(radius, -radius, radius, meet, Math.PI - meet);
  const lower = arc(radius, -(height - radius), radius, Math.PI, Math.PI - meet).slice(1);
  const down: PathSegment = ['L', 0, -(height - radius)];
  const segments: PathSegment[] = cut
    ? [...upper, down, ...lower, ['Z']]
    : [
        ['M', width, 0],
        ['L', radius, 0],
        ...upper.slice(1),
        down,
        ...lower,
        ['L', width, -height],
        ['Z'],
      ];
  return { kind: 'path', segments: pathFromStart(frame, segments), fill: paint };
}

export function dashboardCard(
  input: CardInput,
  width: number,
  drawing: Drawing,
  options: CardOptions = {},
): Block {
  finite('dashboardCard', 'width', width);
  if (width < 0) {
    throw new RangeError(`dashboardCard needs a width of zero or more, and was given ${width}.`);
  }
  if (options.height !== undefined) {
    finite('dashboardCard', 'height', options.height);
    if (options.height < 0) {
      throw new RangeError(
        `dashboardCard needs a height of zero or more, and was given ${options.height}.`,
      );
    }
  }
  const inner = width - 2 * CARD.padH;
  if (inner - CARD.ring - CARD.ringGutter <= 0) {
    throw new RangeError(`dashboardCard is left no room for its words by a width of ${width}.`);
  }

  const evidence =
    input.evidence && input.evidence.words.text.trim() !== ''
      ? stack(
          inner,
          joined(
            [
              typeset('cardLabel', input.evidence.label, inner, drawing),
              typeset('cardEvidence', input.evidence.words.text, inner, drawing, {
                typed: input.evidence.words.typed,
              }),
            ],
            CARD.labelGap,
          ),
        )
      : null;
  const items = stack(
    inner,
    joined(
      input.meaning.items.map((item) => itemOf(item, inner, drawing)),
      CARD.bulletGap,
    ),
  );
  const meaning = stack(
    inner,
    joined([typeset('cardLabel', input.meaning.label, inner, drawing), items], CARD.labelGap),
  );
  const top = stack(
    inner,
    joined(
      [
        headOf(input, inner, drawing),
        typeset('cardSummary', input.summary, inner, drawing),
        ...(evidence ? [evidence] : []),
        meaning,
      ],
      CARD.gap,
    ),
  );

  const advice = typeset('cardAdvice', input.advice, inner, drawing);
  // A line takes no room: the hairline is drawn inside the upper edge of the
  // gap under it, a block of no height with the line hanging below its top.
  const rule: Block = {
    width: inner,
    height: 0,
    overhang: CARD.rule,
    baseline: null,
    ops: [
      { kind: 'rule', x: 0, y: -CARD.rule / 2, width: inner, thickness: CARD.rule, ...HAIRLINE },
    ],
  };
  const foot = advice.height > 0 ? stack(inner, [rule, CARD.ruleGap, advice]) : null;
  const inside = (lowered: number) =>
    stack(inner, foot ? [top, CARD.gap + lowered, foot] : [top, lowered]);

  const natural = boxed(inside(0), width, BOX).height;
  const lowered = Math.max(0, (options.height ?? 0) - natural);
  const card = boxed(inside(lowered), width, BOX);

  const frame: Frame = { direction: drawing.direction, left: 0, width };
  const hue: Paint = input.tier ? { rgb: TIER_PAINT[input.tier] } : HAIRLINE;
  const [panel, ...held] = card.ops;
  const edge = accentBar(frame, card.height, hue);
  return { ...card, ops: panel ? [panel, edge, ...held] : [edge, ...held] };
}
