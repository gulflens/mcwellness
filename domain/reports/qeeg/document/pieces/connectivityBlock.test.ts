import { describe, expect, it } from 'vitest';
import type { Op } from '@domain/shared/document';
import { extentOf } from '../block';
import type { Block } from '../block';
import { CONNECTIVITY } from '../geometry';
import { ACCENT, MUTED } from '../palette';
import type { Measure, Span } from '../paragraph';
import type { LayoutOp } from '../scale';
import { boundsOf } from '../shapes';
import type { PathOp } from '../shapes';
import { typeset } from '../typeset';
import type { Drawing } from '../typeset';
import { connectivityBlock } from './connectivityBlock';
import type { ConnectivityInput } from './connectivityBlock';

/** Every character is half its size wide, so every width in a test is exact. */
const measure: Measure = (text, _weight, size) => [...text].length * size * 0.5;
const FACE = { ascent: 1, descent: -0.25 };
const english: Drawing = { direction: 'ltr', measure, faces: { latin: FACE, arabic: FACE } };
const arabic: Drawing = { ...english, direction: 'rtl' };

const WIDTH = 300;
const ROOM = WIDTH - CONNECTIVITY.inset;

const texts = (ops: readonly LayoutOp[]) =>
  ops.filter((op): op is Extract<Op, { kind: 'text' }> => op.kind === 'text');
const paths = (ops: readonly LayoutOp[]) => ops.filter((op): op is PathOp => op.kind === 'path');
const shapes = (ops: readonly LayoutOp[]) => ops.filter((op) => op.kind !== 'text');

const FINDING: readonly Span[] = [
  { text: 'Findings: ', bold: true },
  { text: 'the link between the two sides was steady.' },
];
const ENGLISH: ConnectivityInput = {
  title: 'Coherence',
  description: 'How closely two regions keep time with each other during rest.',
  finding: FINDING,
};
const ARABIC: ConnectivityInput = {
  title: 'الترابطات',
  description: 'مدى توافق منطقتين في الإيقاع أثناء الراحة.',
  finding: [{ text: 'النتائج: ', bold: true }, { text: 'كان الترابط ثابتا.' }],
};

function inside(block: Block, width: number): void {
  const extent = extentOf(block.ops, measure);
  expect(extent.left).toBeGreaterThanOrEqual(-1e-9);
  expect(extent.right).toBeLessThanOrEqual(width + 1e-9);
  expect(extent.top).toBeLessThanOrEqual(1e-9);
  expect(extent.bottom).toBeGreaterThanOrEqual(-(block.height + block.overhang) - 1e-9);
}

describe('connectivityBlock', () => {
  it('keeps every part inside its box, in either language', () => {
    inside(connectivityBlock(ENGLISH, WIDTH, english), WIDTH);
    inside(connectivityBlock(ARABIC, WIDTH, arabic), WIDTH);
  });

  it('draws the Arabic block as the mirror of the English one, across the page', () => {
    // Up and down the two differ by what an Arabic line's taller floor adds
    // to the words, so the underline is compared across, and the bar across
    // and by its top. The two titles are the same number of letters.
    const en = shapes(connectivityBlock(ENGLISH, WIDTH, english).ops);
    const ar = shapes(connectivityBlock(ARABIC, WIDTH, arabic).ops);
    expect(ar).toHaveLength(en.length);
    en.forEach((op, index) => {
      const a = extentOf([op], measure);
      const b = extentOf(ar[index] ? [ar[index]] : [], measure);
      expect(b.left).toBeCloseTo(WIDTH - a.right, 9);
      expect(b.right).toBeCloseTo(WIDTH - a.left, 9);
      if (op.kind === 'path') expect(b.top).toBeCloseTo(a.top, 9);
    });
  });

  it('draws a bar in the accent down the start edge, as tall as the block', () => {
    for (const [input, drawing] of [
      [ENGLISH, english],
      [ARABIC, arabic],
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
    const en = extentOf(texts(connectivityBlock(ENGLISH, WIDTH, english).ops), measure);
    expect(en.left).toBeCloseTo(CONNECTIVITY.inset, 9);
    const ar = extentOf(texts(connectivityBlock(ARABIC, WIDTH, arabic).ops), measure);
    expect(ar.right).toBeCloseTo(WIDTH - CONNECTIVITY.inset, 9);
  });

  it('sets the title, the description and the finding in their roles, the gap between', () => {
    const block = connectivityBlock(ENGLISH, WIDTH, english);
    const title = typeset('subheading', ENGLISH.title, ROOM, english);
    const description = typeset('bandMuted', ENGLISH.description, ROOM, english);
    const finding = typeset('band', FINDING, ROOM, english);
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
    const title = typeset('subheading', ENGLISH.title, ROOM, english);
    const block = connectivityBlock(ENGLISH, WIDTH, english);
    const [underline] = block.ops.filter((op) => op.kind === 'rule');
    expect(underline).toBeDefined();
    const lowest = extentOf(underline ? [underline] : [], measure).bottom;
    const descriptionTop = -(title.height + Math.max(CONNECTIVITY.gap, title.overhang));
    expect(lowest).toBeGreaterThanOrEqual(descriptionTop);
  });

  it('leaves out a part with no words, and the gap that went with it', () => {
    const full = connectivityBlock(ENGLISH, WIDTH, english);
    const noDescription = connectivityBlock({ ...ENGLISH, description: ' ' }, WIDTH, english);
    expect(full.height - noDescription.height).toBeCloseTo(
      typeset('bandMuted', ENGLISH.description, ROOM, english).height + CONNECTIVITY.gap,
      9,
    );
    const noFinding = connectivityBlock({ ...ENGLISH, finding: [] }, WIDTH, english);
    expect(full.height - noFinding.height).toBeCloseTo(
      typeset('band', FINDING, ROOM, english).height + CONNECTIVITY.gap,
      9,
    );
  });

  it('draws nothing, and takes no room, when it is handed no words at all', () => {
    const block = connectivityBlock({ title: '', description: '', finding: [] }, WIDTH, english);
    expect(block.height).toBe(0);
    expect(block.ops).toEqual([]);
  });

  it('draws a word wider than its column, and a line of 400 characters, inside its box', () => {
    const wide = { ...ENGLISH, title: 'a'.repeat(80), description: 'b '.repeat(200) };
    for (const drawing of [english, arabic]) {
      const block = connectivityBlock(wide, WIDTH, drawing);
      inside(block, WIDTH);
      expect(block.height).toBeGreaterThan(connectivityBlock(ENGLISH, WIDTH, drawing).height);
    }
  });

  it('refuses a width that is no width, or leaves no room for the words, by name', () => {
    expect(() => connectivityBlock(ENGLISH, Number.NaN, english)).toThrow(
      /connectivityBlock needs a finite width/,
    );
    expect(() => connectivityBlock(ENGLISH, -1, english)).toThrow(
      /connectivityBlock needs a width of zero or more/,
    );
    expect(() => connectivityBlock(ENGLISH, CONNECTIVITY.inset, english)).toThrow(
      /connectivityBlock is left no room for its words/,
    );
  });

  it('changes nothing it was given', () => {
    const input: ConnectivityInput = Object.freeze({
      ...ENGLISH,
      finding: Object.freeze(FINDING.map((span) => Object.freeze({ ...span }))),
    });
    const before = JSON.stringify(input);
    expect(() => connectivityBlock(input, WIDTH, english)).not.toThrow();
    expect(JSON.stringify(input)).toBe(before);
  });
});
