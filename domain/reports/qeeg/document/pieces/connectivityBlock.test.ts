import { describe, expect, it } from 'vitest';
import type { Op } from '@domain/shared/document';
import { extentOf } from '../block';
import { CONNECTIVITY } from '../geometry';
import { ACCENT, MUTED } from '../palette';
import type { Span } from '../paragraph';
import type { LayoutOp } from '../scale';
import { boundsOf } from '../shapes';
import type { PathOp } from '../shapes';
import { typeset } from '../typeset';
import { ARABIC, ENGLISH, measure, outside, unmirrored } from './checks';
import { connectivityBlock } from './connectivityBlock';
import type { ConnectivityInput } from './connectivityBlock';

const WIDTH = 300;
const ROOM = WIDTH - CONNECTIVITY.inset;

const texts = (ops: readonly LayoutOp[]) =>
  ops.filter((op): op is Extract<Op, { kind: 'text' }> => op.kind === 'text');
const paths = (ops: readonly LayoutOp[]) => ops.filter((op): op is PathOp => op.kind === 'path');

const FINDING: readonly Span[] = [
  { text: 'Findings: ', bold: true },
  { text: 'the link between the two sides was steady.' },
];
const EN_INPUT: ConnectivityInput = {
  title: 'Coherence',
  description: 'How closely two regions keep time with each other during rest.',
  finding: FINDING,
};
const AR_INPUT: ConnectivityInput = {
  title: 'الترابطات',
  description: 'مدى توافق منطقتين في الإيقاع أثناء الراحة.',
  finding: [{ text: 'النتائج: ', bold: true }, { text: 'كان الترابط ثابتا.' }],
};

describe('connectivityBlock', () => {
  it('keeps every part inside its box, in either language', () => {
    expect(outside(connectivityBlock(EN_INPUT, WIDTH, ENGLISH), measure)).toEqual([]);
    expect(outside(connectivityBlock(AR_INPUT, WIDTH, ARABIC), measure)).toEqual([]);
  });

  it('draws the Arabic block as the mirror of the English one, its words too', () => {
    // Up and down differ: an Arabic line is taller, and the bar is as tall
    // as the words. So the mirror is asked across the page.
    for (const input of [EN_INPUT, AR_INPUT]) {
      const en = connectivityBlock(input, WIDTH, ENGLISH);
      const ar = connectivityBlock(input, WIDTH, ARABIC);
      expect(unmirrored(en, ar, measure)).toEqual([]);
    }
  });

  it('draws a bar in the accent down the start edge, as tall as the block', () => {
    for (const [input, drawing] of [
      [EN_INPUT, ENGLISH],
      [AR_INPUT, ARABIC],
    ] as const) {
      const block = connectivityBlock(input, WIDTH, drawing);
      const [bar] = paths(block.ops);
      expect(block.ops[0]).toBe(bar);
      expect(bar?.fill).toEqual(ACCENT);
      expect(bar?.stroke).toBeUndefined();
      const bounds = boundsOf(bar?.segments ?? []);
      const start = drawing.direction === 'ltr' ? bounds.left : WIDTH - bounds.right;
      expect(start).toBeCloseTo(0, 9);
      expect(bounds.right - bounds.left).toBeCloseTo(CONNECTIVITY.bar, 9);
      expect(bounds.top).toBeCloseTo(0, 9);
      expect(bounds.bottom).toBeCloseTo(-block.height, 9);
    }
  });

  it('sets the words in from the start edge', () => {
    const en = extentOf(texts(connectivityBlock(EN_INPUT, WIDTH, ENGLISH).ops), measure);
    expect(en.left).toBeCloseTo(CONNECTIVITY.inset, 9);
    const ar = extentOf(texts(connectivityBlock(AR_INPUT, WIDTH, ARABIC).ops), measure);
    expect(ar.right).toBeCloseTo(WIDTH - CONNECTIVITY.inset, 9);
  });

  it('sets the title, the description and the finding in their roles, the gap between', () => {
    const block = connectivityBlock(EN_INPUT, WIDTH, ENGLISH);
    const title = typeset('subheading', EN_INPUT.title, ROOM, ENGLISH);
    const description = typeset('bandMuted', EN_INPUT.description, ROOM, ENGLISH);
    const finding = typeset('band', FINDING, ROOM, ENGLISH);
    expect(block.height).toBeCloseTo(
      title.height +
        Math.max(CONNECTIVITY.gap, title.overhang) +
        description.height +
        CONNECTIVITY.gap +
        finding.height,
      9,
    );
    const ops = texts(block.ops);
    expect(ops.find((op) => op.text === 'Coherence')?.style.size).toBe(11.5);
    expect(ops.find((op) => op.text.startsWith('How'))?.style.grey).toBe(MUTED.grey);
    expect(ops.find((op) => op.text === 'Findings:')?.style.font).toBe('bold');
  });

  it('keeps the title’s underline clear of the description under it', () => {
    const title = typeset('subheading', EN_INPUT.title, ROOM, ENGLISH);
    const block = connectivityBlock(EN_INPUT, WIDTH, ENGLISH);
    const [underline] = block.ops.filter((op) => op.kind === 'rule');
    expect(underline).toBeDefined();
    const lowest = extentOf(underline ? [underline] : [], measure).bottom;
    const descriptionTop = -(title.height + Math.max(CONNECTIVITY.gap, title.overhang));
    expect(lowest).toBeGreaterThanOrEqual(descriptionTop);
  });

  it('leaves out a part with no words, and the gap that went with it', () => {
    const full = connectivityBlock(EN_INPUT, WIDTH, ENGLISH);
    const noDescription = connectivityBlock({ ...EN_INPUT, description: ' ' }, WIDTH, ENGLISH);
    expect(full.height - noDescription.height).toBeCloseTo(
      typeset('bandMuted', EN_INPUT.description, ROOM, ENGLISH).height + CONNECTIVITY.gap,
      9,
    );
    const noFinding = connectivityBlock({ ...EN_INPUT, finding: [] }, WIDTH, ENGLISH);
    expect(full.height - noFinding.height).toBeCloseTo(
      typeset('band', FINDING, ROOM, ENGLISH).height + CONNECTIVITY.gap,
      9,
    );
  });

  it('draws nothing, and takes no room, when it is handed no words at all', () => {
    const block = connectivityBlock({ title: '', description: '', finding: [] }, WIDTH, ENGLISH);
    expect(block.height).toBe(0);
    expect(block.ops).toEqual([]);
  });

  it('draws a word wider than its column, and a line of 400 characters, inside its box', () => {
    const wide = { ...EN_INPUT, title: 'a'.repeat(80), description: 'b '.repeat(200) };
    for (const drawing of [ENGLISH, ARABIC]) {
      const block = connectivityBlock(wide, WIDTH, drawing);
      expect(outside(block, measure)).toEqual([]);
      expect(block.height).toBeGreaterThan(connectivityBlock(EN_INPUT, WIDTH, drawing).height);
    }
  });

  it('refuses a width that is no width, or leaves no room for the words, by name', () => {
    expect(() => connectivityBlock(EN_INPUT, Number.NaN, ENGLISH)).toThrow(
      /connectivityBlock needs a finite width/,
    );
    expect(() => connectivityBlock(EN_INPUT, -1, ENGLISH)).toThrow(
      /connectivityBlock needs a width of zero or more/,
    );
    expect(() => connectivityBlock(EN_INPUT, CONNECTIVITY.inset, ENGLISH)).toThrow(
      /connectivityBlock is left no room for its words/,
    );
  });

  it('changes nothing it was given', () => {
    const input: ConnectivityInput = Object.freeze({
      ...EN_INPUT,
      finding: Object.freeze(FINDING.map((span) => Object.freeze({ ...span }))),
    });
    const before = JSON.stringify(input);
    expect(() => connectivityBlock(input, WIDTH, ENGLISH)).not.toThrow();
    expect(JSON.stringify(input)).toBe(before);
  });
});
