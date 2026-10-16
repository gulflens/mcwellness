import { describe, expect, it } from 'vitest';
import { mirrorPages } from './mirror';
import { PAGE_WIDTH, type Page } from './pdf';

/**
 * A page laid out left to right, turned into the same page right to left
 * (docs/CHANGE-REQUESTS/docfix-03.md): what a single-language Arabic document
 * is, drawn once in the English page's own geometry and mirrored.
 */

const page = (...ops: Page['ops']): Page[] => [{ ops }];

describe('mirrorPages', () => {
  it('sets text that started at the left margin against the right one', () => {
    const [mirrored] = mirrorPages(
      page({
        kind: 'text',
        x: 48,
        y: 700,
        text: 'العميل',
        style: { font: 'regular', size: 9 },
        rtl: true,
        align: 'start',
      }),
    );
    expect(mirrored?.ops[0]).toMatchObject({ x: PAGE_WIDTH - 48, align: 'end' });
  });

  it('turns an end into a start, keeps a centre, and reads a missing align as the writer does', () => {
    const [mirrored] = mirrorPages(
      page(
        {
          kind: 'text',
          x: 400,
          y: 700,
          text: '700.00',
          style: { font: 'regular', size: 9 },
          align: 'end',
        },
        {
          kind: 'text',
          x: 300,
          y: 690,
          text: 'AED',
          style: { font: 'regular', size: 9 },
          align: 'centre',
        },
        { kind: 'text', x: 100, y: 680, text: 'Latin', style: { font: 'regular', size: 9 } },
        {
          kind: 'text',
          x: 500,
          y: 670,
          text: 'عربي',
          style: { font: 'regular', size: 9 },
          rtl: true,
        },
      ),
    );
    expect(mirrored?.ops.map((op) => (op.kind === 'text' ? [op.x, op.align] : null))).toEqual([
      [PAGE_WIDTH - 400, 'start'],
      [PAGE_WIDTH - 300, 'centre'],
      [PAGE_WIDTH - 100, 'end'],
      [PAGE_WIDTH - 500, 'start'],
    ]);
  });

  it('moves a box to the other side without changing its size, and a rule with it', () => {
    const [mirrored] = mirrorPages(
      page(
        { kind: 'rect', x: 48, y: 100, width: 150, height: 40, fill: { grey: 0.9 } },
        { kind: 'image', image: 'logo', x: 48, y: 760, width: 165, height: 40 },
        { kind: 'rule', x: 48, y: 500, width: 100, thickness: 4 },
      ),
    );
    expect(mirrored?.ops).toEqual([
      { kind: 'rect', x: PAGE_WIDTH - 198, y: 100, width: 150, height: 40, fill: { grey: 0.9 } },
      { kind: 'image', image: 'logo', x: PAGE_WIDTH - 213, y: 760, width: 165, height: 40 },
      { kind: 'rule', x: PAGE_WIDTH - 148, y: 500, width: 100, thickness: 4 },
    ]);
  });

  it('mirrors every point of a path', () => {
    const [mirrored] = mirrorPages(
      page({
        kind: 'path',
        segments: [['M', 10, 20], ['L', 30, 40], ['C', 1, 2, 3, 4, 5, 6], ['Z']],
        fill: {},
      }),
    );
    expect(mirrored?.ops[0]).toMatchObject({
      segments: [
        ['M', PAGE_WIDTH - 10, 20],
        ['L', PAGE_WIDTH - 30, 40],
        ['C', PAGE_WIDTH - 1, 2, PAGE_WIDTH - 3, 4, PAGE_WIDTH - 5, 6],
        ['Z'],
      ],
    });
  });

  it('is its own inverse', () => {
    const pages = page(
      {
        kind: 'text',
        x: 48,
        y: 700,
        text: 'a',
        style: { font: 'regular', size: 9 },
        align: 'start',
      },
      { kind: 'rect', x: 48, y: 100, width: 150, height: 40 },
    );
    expect(mirrorPages(mirrorPages(pages))).toEqual(pages);
  });
});
