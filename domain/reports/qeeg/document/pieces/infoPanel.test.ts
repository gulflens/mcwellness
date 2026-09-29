import { describe, expect, it } from 'vitest';
import type { Op } from '@domain/shared/document';
import { extentOf } from '../block';
import { BODY_WIDTH, PANEL, panelColumnWidth } from '../geometry';
import { PANEL_EDGE, PANEL_FILL } from '../palette';
import type { LayoutOp } from '../scale';
import type { PathOp } from '../shapes';
import { typeset } from '../typeset';
import type { Drawing } from '../typeset';
import { ARABIC, ENGLISH, measure, outside, unmirrored } from './checks';
import { infoPanel } from './infoPanel';
import type { InfoColumn } from './infoPanel';
import { fixed, typed } from './words';

const WIDTH = BODY_WIDTH;
const COLUMN = panelColumnWidth(WIDTH);

const texts = (ops: readonly LayoutOp[]) =>
  ops.filter((op): op is Extract<Op, { kind: 'text' }> => op.kind === 'text');
const paths = (ops: readonly LayoutOp[]) => ops.filter((op): op is PathOp => op.kind === 'path');

const PERSON: InfoColumn = {
  title: 'About you:',
  lines: [
    { label: 'Name:', value: typed('Amber Dune') },
    { label: 'Age:', value: typed('34') },
    { label: 'Hand used:', value: fixed('Right') },
  ],
};
const RECORDING: InfoColumn = {
  title: 'Recording:',
  lines: [
    { label: 'Date:', value: fixed('12/09/2026') },
    { label: 'Kind:', value: fixed('Initial') },
  ],
};
const ARABIC_PERSON: InfoColumn = {
  title: 'عنك أنت:',
  lines: [
    { label: 'الاسم:', value: typed('عنبر كثيب') },
    { label: 'العمر:', value: typed('34') },
    { label: 'اليد:', value: fixed('اليمنى') },
  ],
};
const ARABIC_RECORDING: InfoColumn = {
  title: 'التسجيل:',
  lines: [
    { label: 'التاريخ:', value: fixed('12/09/2026') },
    { label: 'النوع:', value: fixed('أولي') },
  ],
};

function columnHeight(column: InfoColumn, drawing: Drawing): number {
  const head = typeset('panelHead', column.title, COLUMN, drawing);
  return (
    head.height +
    Math.max(PANEL.headGap, head.overhang) +
    column.lines.reduce(
      (total, line) =>
        total +
        typeset('panel', `${line.label} ${line.value.text}`, COLUMN, drawing).height +
        PANEL.lineGap,
      0,
    )
  );
}

describe('infoPanel', () => {
  it('keeps every part inside its box, in either language', () => {
    expect(
      outside(infoPanel({ first: PERSON, second: RECORDING }, WIDTH, ENGLISH), measure),
    ).toEqual([]);
    expect(
      outside(
        infoPanel({ first: ARABIC_PERSON, second: ARABIC_RECORDING }, WIDTH, ARABIC),
        measure,
      ),
    ).toEqual([]);
  });

  it('draws the Arabic panel as the mirror of the English one, its words too', () => {
    // Up and down the Arabic lines stand on a taller floor, so the panel's
    // foot is lower: the mirror is asked across the page.
    for (const [first, second] of [
      [PERSON, RECORDING],
      [ARABIC_PERSON, ARABIC_RECORDING],
    ] as const) {
      const en = infoPanel({ first, second }, WIDTH, ENGLISH);
      const ar = infoPanel({ first, second }, WIDTH, ARABIC);
      expect(unmirrored(en, ar, measure)).toEqual([]);
    }
  });

  it('draws the panel first, in the violet’s wash with its pale edge', () => {
    const block = infoPanel({ first: PERSON, second: RECORDING }, WIDTH, ENGLISH);
    const [panel] = paths(block.ops);
    expect(block.ops[0]).toBe(panel);
    expect(panel?.fill).toEqual(PANEL_FILL);
    expect(panel?.stroke).toEqual({ ...PANEL_EDGE, width: PANEL.edge });
  });

  it('sets the first column at the start and the second the gutter after it', () => {
    const en = texts(infoPanel({ first: PERSON, second: RECORDING }, WIDTH, ENGLISH).ops);
    expect(en.find((op) => op.text === 'About you:')?.x).toBeCloseTo(PANEL.padH, 9);
    expect(en.find((op) => op.text === 'Recording:')?.x).toBeCloseTo(
      PANEL.padH + COLUMN + PANEL.gutter,
      9,
    );
    const ar = infoPanel({ first: ARABIC_PERSON, second: ARABIC_RECORDING }, WIDTH, ARABIC);
    const first = texts(ar.ops).filter((op) => op.text.includes('عنك'));
    expect(extentOf(first, measure).right).toBeCloseTo(WIDTH - PANEL.padH, 9);
    const second = texts(ar.ops).filter((op) => op.text.includes('التسجيل'));
    expect(extentOf(second, measure).right).toBeCloseTo(
      WIDTH - PANEL.padH - COLUMN - PANEL.gutter,
      9,
    );
  });

  it('sets each line as one paragraph: the label, one space, the value', () => {
    const ops = texts(infoPanel({ first: PERSON, second: RECORDING }, WIDTH, ENGLISH).ops);
    expect(ops.some((op) => op.text === 'Name: Amber Dune')).toBe(true);
    expect(ops.find((op) => op.text === 'Name: Amber Dune')?.style.size).toBe(10.2);
    expect(ops.find((op) => op.text === 'About you:')?.style.font).toBe('bold');
  });

  it('reads an Arabic value in an English panel the English way, the Arabic inside it right to left', () => {
    const first: InfoColumn = {
      title: 'About you:',
      lines: [{ label: 'Name:', value: typed('عنبر كثيب') }],
    };
    const ops = texts(infoPanel({ first, second: RECORDING }, WIDTH, ENGLISH).ops);
    const label = ops.find((op) => op.text.startsWith('Name:'));
    const value = ops.find((op) => op.text.includes('عنبر'));
    expect(label?.x).toBeCloseTo(PANEL.padH, 9);
    expect(value?.rtl).toBe(true);
    expect(value?.x ?? 0).toBeGreaterThan(label?.x ?? 0);
  });

  it('reads an age in an Arabic panel the Arabic way, its figures left to right', () => {
    const ops = texts(
      infoPanel({ first: ARABIC_PERSON, second: ARABIC_RECORDING }, WIDTH, ARABIC).ops,
    );
    const age = ops.find((op) => op.text === '34');
    const label = ops.find((op) => op.text.includes('العمر'));
    expect(age?.rtl ?? false).toBe(false);
    expect(label?.rtl).toBe(true);
    // The label reads first, so it stands at the start: to the right of the age.
    expect(extentOf(label ? [label] : [], measure).left).toBeGreaterThan(
      extentOf(age ? [age] : [], measure).right,
    );
  });

  it('draws a line whose value is empty, with its label', () => {
    const first: InfoColumn = { ...PERSON, lines: [{ label: 'Name:', value: typed('  ') }] };
    const ops = texts(infoPanel({ first, second: RECORDING }, WIDTH, ENGLISH).ops);
    expect(ops.some((op) => op.text === 'Name:')).toBe(true);
  });

  it('stands as tall as its taller column and its padding', () => {
    for (const [first, second, drawing] of [
      [PERSON, RECORDING, ENGLISH],
      [ARABIC_PERSON, ARABIC_RECORDING, ARABIC],
    ] as const) {
      const block = infoPanel({ first, second }, WIDTH, drawing);
      expect(block.height).toBeCloseTo(
        2 * PANEL.padV + Math.max(columnHeight(first, drawing), columnHeight(second, drawing)),
        9,
      );
    }
  });

  it('draws a column with no lines as its title alone', () => {
    const block = infoPanel(
      { first: { title: 'About you:', lines: [] }, second: { title: 'Recording:', lines: [] } },
      WIDTH,
      ENGLISH,
    );
    const head = typeset('panelHead', 'About you:', COLUMN, ENGLISH);
    expect(block.height).toBeCloseTo(2 * PANEL.padV + head.height + head.overhang, 9);
  });

  it('draws a word wider than its column, and a line of 400 characters, inside its box', () => {
    const first: InfoColumn = {
      ...PERSON,
      lines: [
        { label: 'Name:', value: typed('a'.repeat(120)) },
        { label: 'Note:', value: typed('b '.repeat(200)) },
      ],
    };
    for (const drawing of [ENGLISH, ARABIC]) {
      const block = infoPanel({ first, second: RECORDING }, WIDTH, drawing);
      expect(outside(block, measure)).toEqual([]);
      expect(block.height).toBeGreaterThan(
        infoPanel({ first: PERSON, second: RECORDING }, WIDTH, drawing).height,
      );
    }
  });

  it('refuses a width that is no width, or leaves no column, by name', () => {
    const input = { first: PERSON, second: RECORDING };
    expect(() => infoPanel(input, Number.NaN, ENGLISH)).toThrow(/infoPanel needs a finite width/);
    expect(() => infoPanel(input, -1, ENGLISH)).toThrow(/infoPanel needs a width of zero or more/);
    expect(() => infoPanel(input, 10, ENGLISH)).toThrow(/panelColumnWidth is left no column/);
  });

  it('changes nothing it was given', () => {
    const column = (each: InfoColumn): InfoColumn =>
      Object.freeze({
        title: each.title,
        lines: Object.freeze(
          each.lines.map((line) =>
            Object.freeze({ label: line.label, value: Object.freeze({ ...line.value }) }),
          ),
        ),
      });
    const input = Object.freeze({ first: column(PERSON), second: column(RECORDING) });
    const before = JSON.stringify(input);
    expect(() => infoPanel(input, WIDTH, ENGLISH)).not.toThrow();
    expect(JSON.stringify(input)).toBe(before);
  });
});
