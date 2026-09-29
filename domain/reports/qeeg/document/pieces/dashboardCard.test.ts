import { describe, expect, it } from 'vitest';
import type { Op } from '@domain/shared/document';
import { extentOf } from '../block';
import type { Block } from '../block';
import { BODY_WIDTH, CARD, cardWidth } from '../geometry';
import { HAIRLINE, MUTED, PANEL_EDGE, PANEL_FILL, TIER_PAINT } from '../palette';
import type { LayoutOp } from '../scale';
import { boundsOf } from '../shapes';
import type { PathOp } from '../shapes';
import { typeset } from '../typeset';
import type { Drawing } from '../typeset';
import { ARABIC, ENGLISH, measure, outside, unmirrored } from './checks';
import { dashboardCard } from './dashboardCard';
import type { CardInput } from './dashboardCard';
import { scoreRing } from './scoreRing';
import { typed } from './words';

const WIDTH = cardWidth(BODY_WIDTH);
const INNER = WIDTH - 2 * CARD.padH;
const COLUMN = INNER - CARD.ring - CARD.ringGutter;
const ITEM = INNER - CARD.bulletIndent;
/** How far below the top the panel's corner meets the bar's inner side. */
const DROP = CARD.radius - Math.sqrt(CARD.radius ** 2 - (CARD.radius - CARD.accent) ** 2);

const texts = (ops: readonly LayoutOp[]) =>
  ops.filter((op): op is Extract<Op, { kind: 'text' }> => op.kind === 'text');
const paths = (ops: readonly LayoutOp[]) => ops.filter((op): op is PathOp => op.kind === 'path');
const rules = (ops: readonly LayoutOp[]) =>
  ops.filter((op): op is Extract<Op, { kind: 'rule' }> => op.kind === 'rule');

const EN_INPUT: CardInput = {
  score: 6,
  tier: 'middle',
  outOf: '/10',
  unset: '-',
  category: 'Room to grow',
  title: 'Attention',
  summary: 'Focus held steady for short stretches.',
  evidence: { label: 'Recording evidence', words: typed('Frontal theta was raised.') },
  meaning: { label: 'What this may mean', items: ['Drifting in long tasks', 'Needing breaks'] },
  advice: [{ text: 'Advice: ', bold: true }, { text: 'short daily training blocks.' }],
};
const AR_INPUT: CardInput = {
  ...EN_INPUT,
  category: 'مجال للنمو',
  title: 'الانتباه',
  summary: 'بقي التركيز ثابتا لفترات قصيرة.',
  evidence: { label: 'دليل التسجيل', words: typed('ارتفعت موجات ثيتا الأمامية.') },
  meaning: {
    label: 'ماذا قد يعني هذا',
    items: ['التشتت في المهام الطويلة', 'الحاجة إلى فترات راحة'],
  },
  advice: [{ text: 'النصيحة: ', bold: true }, { text: 'تدريب يومي قصير.' }],
};

/** The height of the card's parts, set as the card sets them. */
function parts(input: CardInput, drawing: Drawing) {
  const category = typeset('cardCategory', input.category, COLUMN, drawing, { tier: 'low' });
  const title = typeset('cardTitle', input.title, COLUMN, drawing);
  const evidence = input.evidence;
  return {
    head: Math.max(CARD.ring, category.height + CARD.titleTop + title.height),
    summary: typeset('cardSummary', input.summary, INNER, drawing).height,
    evidence: evidence
      ? typeset('cardLabel', evidence.label, INNER, drawing).height +
        CARD.labelGap +
        typeset('cardEvidence', evidence.words.text, INNER, drawing, { typed: true }).height
      : 0,
    label: typeset('cardLabel', input.meaning.label, INNER, drawing).height,
    items: input.meaning.items.map((item) => typeset('cardBullet', item, ITEM, drawing).height),
    advice: typeset('cardAdvice', input.advice, INNER, drawing).height,
  };
}

describe('dashboardCard', () => {
  it('keeps every part inside its box, in either language, at its own height and a taller one', () => {
    for (const [input, drawing] of [
      [EN_INPUT, ENGLISH],
      [AR_INPUT, ARABIC],
    ] as const) {
      expect(outside(dashboardCard(input, WIDTH, drawing), measure)).toEqual([]);
      expect(outside(dashboardCard(input, WIDTH, drawing, { height: 400 }), measure)).toEqual([]);
    }
  });

  it('draws the Arabic card as the mirror of the English one, its words too', () => {
    // A score of 10 fills the ring, so its arc is the same either way round.
    for (const input of [EN_INPUT, AR_INPUT]) {
      const whole = { ...input, score: 10, tier: 'high' as const };
      for (const height of [undefined, 400]) {
        const en = dashboardCard(whole, WIDTH, ENGLISH, { height });
        const ar = dashboardCard(whole, WIDTH, ARABIC, { height });
        expect(unmirrored(en, ar, measure)).toEqual([]);
      }
    }
  });

  it('moves the ring’s arc with its ring and does not mirror it: it runs clockwise in both', () => {
    const en = dashboardCard(EN_INPUT, WIDTH, ENGLISH).ops.filter((op) => op.kind !== 'text');
    const ar = dashboardCard(EN_INPUT, WIDTH, ARABIC).ops.filter((op) => op.kind !== 'text');
    const ARC = 3;
    const moved = WIDTH - 2 * CARD.padH - CARD.ring;
    const enArc = extentOf(en[ARC] ? [en[ARC]] : [], measure);
    const arArc = extentOf(ar[ARC] ? [ar[ARC]] : [], measure);
    expect(arArc.left).toBeCloseTo(enArc.left + moved, 9);
    expect(arArc.right).toBeCloseTo(enArc.right + moved, 9);
  });

  it('draws the panel first, the bar over it, and what the card holds over both', () => {
    const block = dashboardCard(EN_INPUT, WIDTH, ENGLISH);
    const [panel, bar] = block.ops;
    expect(panel?.kind === 'path' && panel.fill).toEqual(PANEL_FILL);
    expect(panel?.kind === 'path' && panel.stroke).toEqual({ ...PANEL_EDGE, width: CARD.edge });
    expect(bar?.kind === 'path' && bar.fill).toEqual({ rgb: TIER_PAINT.middle });
  });

  it('runs the bar in the hue of the score down the start edge, the whole height', () => {
    for (const [input, drawing] of [
      [EN_INPUT, ENGLISH],
      [AR_INPUT, ARABIC],
    ] as const) {
      const block = dashboardCard(input, WIDTH, drawing);
      const bar = paths(block.ops)[1];
      const bounds = boundsOf(bar?.segments ?? []);
      const start = drawing.direction === 'ltr' ? bounds.left : WIDTH - bounds.right;
      const end = drawing.direction === 'ltr' ? bounds.right : WIDTH - bounds.left;
      expect(start).toBeCloseTo(0, 9);
      expect(end).toBeCloseTo(CARD.accent, 9);
      // Its inner side meets the panel's rounded corners, a little in from
      // the top and the foot.
      expect(bounds.top).toBeCloseTo(-DROP, 9);
      expect(bounds.bottom).toBeCloseTo(-block.height + DROP, 9);
    }
  });

  it('rounds the bar’s outer corners as the panel’s are rounded', () => {
    const block = dashboardCard(EN_INPUT, WIDTH, ENGLISH);
    const [first] = paths(block.ops)[1]?.segments ?? [];
    expect(first?.[0]).toBe('M');
    if (first?.[0] === 'M') {
      expect(first[1]).toBeCloseTo(CARD.accent, 9);
      expect(first[2]).toBeCloseTo(-DROP, 9);
    }
  });

  it('sets the ring at the start of the head, centred on the words beside it', () => {
    for (const [input, drawing] of [
      [EN_INPUT, ENGLISH],
      [AR_INPUT, ARABIC],
    ] as const) {
      const block = dashboardCard(input, WIDTH, drawing);
      const [track] = paths(scoreRing(input, CARD.ring, drawing).ops);
      const ringTrack = paths(block.ops)[2];
      expect(ringTrack?.stroke).toEqual(track?.stroke);
      const bounds = boundsOf(ringTrack?.segments ?? []);
      const middle = drawing.direction === 'ltr' ? bounds.left : WIDTH - bounds.right;
      const own = boundsOf(track?.segments ?? []);
      expect(middle).toBeCloseTo(CARD.padH + own.left, 9);
      const head = parts(input, drawing).head;
      const down = (head - CARD.ring) / 2;
      expect(bounds.top).toBeCloseTo(own.top - CARD.padV - down, 9);
    }
  });

  it('sets the category in the hue of the score, over the title', () => {
    const ops = texts(dashboardCard(EN_INPUT, WIDTH, ENGLISH).ops);
    const category = ops.find((op) => op.text === 'Room to grow');
    const title = ops.find((op) => op.text === 'Attention');
    expect(category?.style.rgb).toEqual(TIER_PAINT.middle);
    expect(category?.x).toBeCloseTo(CARD.padH + CARD.ring + CARD.ringGutter, 9);
    expect(title?.style.size).toBe(10);
    expect((category?.y ?? 0) > (title?.y ?? 0)).toBe(true);
  });

  it('stands as tall as its parts, their gaps and its padding', () => {
    for (const [input, drawing] of [
      [EN_INPUT, ENGLISH],
      [AR_INPUT, ARABIC],
    ] as const) {
      const p = parts(input, drawing);
      const [one = 0, two = 0] = p.items;
      const expected =
        2 * CARD.padV +
        p.head +
        CARD.gap +
        p.summary +
        CARD.gap +
        p.evidence +
        CARD.gap +
        p.label +
        CARD.labelGap +
        one +
        CARD.bulletGap +
        two +
        CARD.gap +
        CARD.rule +
        CARD.ruleGap +
        p.advice;
      expect(dashboardCard(input, WIDTH, drawing).height).toBeCloseTo(expected, 9);
    }
  });

  it('draws the evidence as a person typed it, in either direction', () => {
    const block = dashboardCard(
      { ...EN_INPUT, evidence: { label: 'Recording evidence', words: typed('كتب بالعربية') } },
      WIDTH,
      ENGLISH,
    );
    expect(texts(block.ops).some((op) => op.text.includes('كتب') && op.rtl === true)).toBe(true);
  });

  it('leaves out evidence that is absent or has no words, and its gap', () => {
    const full = dashboardCard(EN_INPUT, WIDTH, ENGLISH);
    const step = parts(EN_INPUT, ENGLISH).evidence + CARD.gap;
    expect(
      full.height - dashboardCard({ ...EN_INPUT, evidence: null }, WIDTH, ENGLISH).height,
    ).toBeCloseTo(step, 9);
    const blankWords = {
      ...EN_INPUT,
      evidence: { label: 'Recording evidence', words: typed('  ') },
    };
    expect(full.height - dashboardCard(blankWords, WIDTH, ENGLISH).height).toBeCloseTo(step, 9);
  });

  it('leaves out a line of the list with no words, and its gap', () => {
    const full = dashboardCard(EN_INPUT, WIDTH, ENGLISH);
    const fewer = dashboardCard(
      { ...EN_INPUT, meaning: { ...EN_INPUT.meaning, items: ['Drifting in long tasks', ' '] } },
      WIDTH,
      ENGLISH,
    );
    expect(full.height - fewer.height).toBeCloseTo(
      (parts(EN_INPUT, ENGLISH).items[1] ?? 0) + CARD.bulletGap,
      9,
    );
  });

  it('draws the label of a list with no lines, and nothing under it', () => {
    const full = dashboardCard(EN_INPUT, WIDTH, ENGLISH);
    const none = dashboardCard(
      { ...EN_INPUT, meaning: { ...EN_INPUT.meaning, items: [] } },
      WIDTH,
      ENGLISH,
    );
    const p = parts(EN_INPUT, ENGLISH);
    expect(full.height - none.height).toBeCloseTo(
      CARD.labelGap + (p.items[0] ?? 0) + CARD.bulletGap + (p.items[1] ?? 0),
      9,
    );
    expect(texts(none.ops).some((op) => op.text.includes('What this may mean'))).toBe(true);
    expect(paths(none.ops)).toHaveLength(4);
  });

  it('marks each line of the list with a dash at the start edge, level with its small letters', () => {
    for (const [input, drawing] of [
      [EN_INPUT, ENGLISH],
      [AR_INPUT, ARABIC],
    ] as const) {
      const block = dashboardCard(input, WIDTH, drawing);
      const dashes = paths(block.ops).slice(4);
      expect(dashes).toHaveLength(2);
      const firstWords = input.meaning.items[0] ?? '';
      const [line] = texts(block.ops).filter((op) => firstWords.includes(op.text));
      for (const dash of dashes) {
        expect(dash.fill).toEqual(MUTED);
        const bounds = boundsOf(dash.segments);
        const start = drawing.direction === 'ltr' ? bounds.left : WIDTH - bounds.right;
        expect(start).toBeCloseTo(CARD.padH, 9);
        expect(bounds.right - bounds.left).toBeCloseTo(CARD.dash, 9);
        expect(bounds.top - bounds.bottom).toBeCloseTo(CARD.dashLine, 9);
      }
      const middle =
        (boundsOf(dashes[0]?.segments ?? []).top + boundsOf(dashes[0]?.segments ?? []).bottom) / 2;
      expect(middle).toBeCloseTo((line?.y ?? 0) + CARD.dashRise, 9);
    }
  });

  it('sets the words of a line of the list the indent in from the start edge', () => {
    const ops = texts(dashboardCard(EN_INPUT, WIDTH, ENGLISH).ops);
    const line = ops.find((op) => op.text.startsWith('Needing'));
    expect(line?.x).toBeCloseTo(CARD.padH + CARD.bulletIndent, 9);
  });

  it('draws the advice under a hairline, the room between', () => {
    const block = dashboardCard(EN_INPUT, WIDTH, ENGLISH);
    const [rule] = rules(block.ops);
    expect(rule).toMatchObject({ x: CARD.padH, width: INNER, thickness: CARD.rule, ...HAIRLINE });
    const advice = parts(EN_INPUT, ENGLISH).advice;
    const ruleFoot = -(block.height - CARD.padV - advice - CARD.ruleGap);
    expect((rule?.y ?? 0) - CARD.rule / 2).toBeCloseTo(ruleFoot, 9);
  });

  it('leaves out the advice and its hairline when there are no words of advice', () => {
    const full = dashboardCard(EN_INPUT, WIDTH, ENGLISH);
    const none = dashboardCard({ ...EN_INPUT, advice: [] }, WIDTH, ENGLISH);
    expect(rules(none.ops)).toEqual([]);
    expect(full.height - none.height).toBeCloseTo(
      CARD.gap + CARD.rule + CARD.ruleGap + parts(EN_INPUT, ENGLISH).advice,
      9,
    );
  });

  it('stands as tall as a taller row, its hairline and advice lowered to its foot', () => {
    const own = dashboardCard(EN_INPUT, WIDTH, ENGLISH);
    const tall = dashboardCard(EN_INPUT, WIDTH, ENGLISH, { height: own.height + 40 });
    expect(tall.height).toBeCloseTo(own.height + 40, 9);
    expect((rules(tall.ops)[0]?.y ?? 0) - (rules(own.ops)[0]?.y ?? 0)).toBeCloseTo(-40, 9);
    const summary = (block: Block) => texts(block.ops).find((op) => op.text.startsWith('Focus'))?.y;
    expect(summary(tall)).toBe(summary(own));
    const bar = boundsOf(paths(tall.ops)[1]?.segments ?? []);
    expect(bar.bottom).toBeCloseTo(-tall.height + DROP, 9);
  });

  it('keeps its own height when the row is no taller', () => {
    const own = dashboardCard(EN_INPUT, WIDTH, ENGLISH);
    expect(dashboardCard(EN_INPUT, WIDTH, ENGLISH, { height: 10 }).height).toBe(own.height);
  });

  it('draws a card with no score with a grey bar and its category as a label', () => {
    const block = dashboardCard(
      { ...EN_INPUT, score: null, tier: null, category: 'Not yet scored' },
      WIDTH,
      ENGLISH,
    );
    expect(paths(block.ops)[1]?.fill).toEqual(HAIRLINE);
    const category = texts(block.ops).find((op) => op.text === 'Not yet scored');
    expect(category?.style.size).toBe(6.8);
    expect(category?.style.grey).toBe(MUTED.grey);
  });

  it('draws a word wider than its column, and a line of 400 characters, inside its box', () => {
    const wide: CardInput = {
      ...EN_INPUT,
      title: 'a'.repeat(60),
      summary: 'b '.repeat(200),
      meaning: { ...EN_INPUT.meaning, items: ['c'.repeat(90)] },
    };
    for (const drawing of [ENGLISH, ARABIC]) {
      const block = dashboardCard(wide, WIDTH, drawing);
      expect(outside(block, measure)).toEqual([]);
      expect(block.height).toBeGreaterThan(dashboardCard(EN_INPUT, WIDTH, drawing).height);
    }
  });

  it('refuses a width or a height that is no length, or too narrow a card, by name', () => {
    expect(() => dashboardCard(EN_INPUT, Number.NaN, ENGLISH)).toThrow(
      /dashboardCard needs a finite width/,
    );
    expect(() => dashboardCard(EN_INPUT, -1, ENGLISH)).toThrow(
      /dashboardCard needs a width of zero or more/,
    );
    expect(() => dashboardCard(EN_INPUT, WIDTH, ENGLISH, { height: Number.NaN })).toThrow(
      /dashboardCard needs a finite height/,
    );
    expect(() => dashboardCard(EN_INPUT, WIDTH, ENGLISH, { height: -1 })).toThrow(
      /dashboardCard needs a height of zero or more/,
    );
    expect(() => dashboardCard(EN_INPUT, 2 * CARD.padH + CARD.ring, ENGLISH)).toThrow(
      /dashboardCard is left no room for its words/,
    );
  });

  it('refuses a score with no tier by the ring’s name', () => {
    expect(() => dashboardCard({ ...EN_INPUT, tier: null }, WIDTH, ENGLISH)).toThrow(
      /scoreRing needs a tier for a score of 6/,
    );
  });

  it('changes nothing it was given', () => {
    const input: CardInput = Object.freeze({
      ...EN_INPUT,
      evidence: Object.freeze({
        label: 'Recording evidence',
        words: Object.freeze(typed('Frontal theta was raised.')),
      }),
      meaning: Object.freeze({
        label: EN_INPUT.meaning.label,
        items: Object.freeze([...EN_INPUT.meaning.items]),
      }),
      advice: Object.freeze(EN_INPUT.advice.map((span) => Object.freeze({ ...span }))),
    });
    const before = JSON.stringify(input);
    expect(() =>
      dashboardCard(input, WIDTH, ENGLISH, Object.freeze({ height: 300 })),
    ).not.toThrow();
    expect(JSON.stringify(input)).toBe(before);
  });
});
