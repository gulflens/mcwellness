import { describe, expect, it } from 'vitest';
import { PAGE_HEIGHT, PAGE_WIDTH } from '@domain/shared/document';
import { CASES, factsFor, fullReport } from '../testing/reports';
import type { CaseName } from '../testing/reports';
import type { Locale } from '../types';
import { extentOf } from './block';
import { buildQeegReport } from './build';
import type { ReportInput } from './build';
import { bodyTop, PAD } from './geometry';
import { ARABIC, ENGLISH, across } from './pieces/checks';
import { placeQeegReport } from './place';
import type { Laid, PlacedPart } from './place';
import type { Drawing } from './typeset';

/**
 * docs/SPEC/reports-qeeg.md section 12, points 1 and 2, and plan note N10:
 * the parts of a first report set on A4 pages, with the practice's header
 * and footer on each, as the invariants of the layout say. The test measure
 * makes every number exact; `tests/reports/qeeg-pages.test.ts` asks the same
 * of the installed faces.
 */

const LOCALES: readonly Locale[] = ['en', 'ar'];
const drawingOf = (locale: Locale): Drawing => (locale === 'en' ? ENGLISH : ARABIC);

/** What two lengths that should be equal may differ by: the writer keeps two decimals. */
const SLACK = 0.01;

function inputOf(name: CaseName, locale: Locale): ReportInput {
  const content = CASES[name]();
  return { content, locale, facts: factsFor(content) };
}

function laid(name: CaseName, locale: Locale): Laid {
  return placeQeegReport(inputOf(name, locale), drawingOf(locale));
}

const CASE_NAMES = Object.keys(CASES) as CaseName[];

/** Where a split part came from: `summary.1/2` is part of `summary.1`. */
const baseOf = (id: string) => id.replace(/\/[0-9]+$/, '');

describe('the pages of a first report', () => {
  it('set every part, in the order it was built, each once', () => {
    for (const name of CASE_NAMES) {
      const input = inputOf(name, 'en');
      const built = buildQeegReport(input, ENGLISH, laid(name, 'en').bodyHeight).map(
        (part) => part.id,
      );
      const placed = laid(name, 'en')
        .sheets.flatMap((sheet) => sheet.parts.map((part) => part.id))
        .filter((id) => baseOf(id) === id);
      expect(placed, name).toEqual(built);
    }
  });

  it('start a page with every part that asks for one', () => {
    for (const name of CASE_NAMES) {
      for (const locale of LOCALES) {
        const { sheets } = laid(name, locale);
        const parts = buildQeegReport(inputOf(name, locale), drawingOf(locale), 600);
        const starting = new Set(parts.filter((part) => part.newPage).map((part) => part.id));
        for (const sheet of sheets) {
          sheet.parts.slice(1).forEach((part) => {
            expect(starting.has(part.id), `${name} ${locale} ${part.id}`).toBe(false);
          });
        }
        const firsts = sheets.map((sheet) => sheet.parts[0]?.id);
        for (const id of starting) expect(firsts, `${name} ${locale}`).toContain(id);
      }
    }
  });

  it('pin the signature last on the last page, and never alone there', () => {
    for (const name of CASE_NAMES) {
      for (const locale of LOCALES) {
        const { sheets, bodyHeight } = laid(name, locale);
        const last = sheets[sheets.length - 1]?.parts ?? [];
        const signature = last[last.length - 1];
        expect(signature?.id, `${name} ${locale}`).toBe('signature');
        expect(last.length, `${name} ${locale}`).toBeGreaterThan(1);
        const standing = last.find((part) => part.id === 'final.standing');
        expect(standing, `${name} ${locale}`).toBeDefined();
        // Lowered towards the foot, and not past it.
        expect((signature?.y ?? 0) + (signature?.height ?? 0)).toBeLessThanOrEqual(
          bodyHeight + SLACK,
        );
        expect(signature?.y ?? 0).toBeGreaterThan(
          (standing?.y ?? 0) + (standing?.height ?? 0) + SLACK,
        );
      }
    }
  });

  it('run nothing over the foot of a page', () => {
    for (const name of CASE_NAMES) {
      for (const locale of LOCALES) {
        expect(laid(name, locale).overflowing, `${name} ${locale}`).toEqual([]);
      }
    }
  });

  it('overlap no part with another, on any page, in either language', () => {
    for (const name of CASE_NAMES) {
      for (const locale of LOCALES) {
        for (const [index, sheet] of laid(name, locale).sheets.entries()) {
          const found = overlaps(sheet.parts);
          expect(found, `${name} ${locale} page ${index + 1}`).toEqual([]);
        }
      }
    }
  });

  it('keep every part inside its own place and inside the margins', () => {
    for (const name of CASE_NAMES) {
      for (const locale of LOCALES) {
        const drawing = drawingOf(locale);
        const result = laid(name, locale);
        const foot = PAD.bottom + result.footerHeight;
        for (const [index, sheet] of result.sheets.entries()) {
          for (const part of sheet.parts) {
            if (part.ops.length === 0) continue;
            const reach = extentOf(part.ops, drawing.measure);
            const where = `${name} ${locale} page ${index + 1} ${part.id}`;
            expect(reach.left, where).toBeGreaterThanOrEqual(PAD.side - SLACK);
            expect(reach.right, where).toBeLessThanOrEqual(PAGE_WIDTH - PAD.side + SLACK);
            expect(reach.top, where).toBeLessThanOrEqual(bodyTop() - part.y + SLACK);
            expect(reach.bottom, where).toBeGreaterThanOrEqual(
              bodyTop() - part.y - part.height - SLACK,
            );
            expect(reach.bottom, where).toBeGreaterThanOrEqual(foot - SLACK);
          }
        }
      }
    }
  });

  it('draw the header and the footer on every page, inside the margins', () => {
    for (const locale of LOCALES) {
      const drawing = drawingOf(locale);
      const result = laid('full', locale);
      for (const sheet of result.sheets) {
        const header = extentOf(sheet.header, drawing.measure);
        expect(sheet.header.some((op) => op.kind === 'image')).toBe(true);
        expect(header.top).toBeLessThanOrEqual(PAGE_HEIGHT - PAD.top + SLACK);
        expect(header.bottom).toBeGreaterThanOrEqual(bodyTop() - SLACK);
        const footer = extentOf(sheet.footer, drawing.measure);
        expect(footer.top).toBeLessThanOrEqual(PAD.bottom + result.footerHeight + SLACK);
        expect(footer.bottom).toBeGreaterThanOrEqual(PAD.bottom - SLACK);
        expect(footer.left).toBeGreaterThanOrEqual(PAD.side - SLACK);
        expect(footer.right).toBeLessThanOrEqual(PAGE_WIDTH - PAD.side + SLACK);
      }
    }
  });

  it('count the pages at the foot of each', () => {
    const { sheets } = laid('full', 'en');
    sheets.forEach((sheet, index) => {
      expect(across(sheet.footer, ENGLISH.measure)).toContain(
        `Page ${index + 1} of ${sheets.length}`,
      );
    });
  });

  it('leave the header clear when the practice has no logo, and keep its room', () => {
    const content = fullReport();
    const facts = { ...factsFor(content), logo: null };
    const result = placeQeegReport({ content, locale: 'en', facts }, ENGLISH);
    expect(result.sheets.every((sheet) => sheet.header.length === 0)).toBe(true);
    expect(result.bodyHeight).toBe(laid('full', 'en').bodyHeight);
  });

  it('are the pages, the header, the parts and the footer in that order', () => {
    const { sheets, pages } = laid('full', 'en');
    expect(pages).toHaveLength(sheets.length);
    sheets.forEach((sheet, index) => {
      expect(pages[index]?.ops).toEqual([
        ...sheet.header,
        ...sheet.parts.flatMap((part) => part.ops),
        ...sheet.footer,
      ]);
    });
  });

  it('say the scale the dashboard was drawn at', () => {
    const { dashboardScale, sheets } = laid('full', 'en');
    const grid = sheets
      .flatMap((sheet) => sheet.parts)
      .find((part) => part.id === 'dashboard.grid');
    expect(dashboardScale).toBe(grid?.scale ?? 1);
    expect(dashboardScale).toBeGreaterThan(0);
    expect(dashboardScale).toBeLessThanOrEqual(1);
  });

  it('say how sharply each map will print', () => {
    const { maps } = laid('long', 'en');
    expect(maps).toHaveLength(8);
    for (const map of maps) {
      expect(map.dpi).toBeGreaterThan(0);
      expect(['good', 'fair', 'poor']).toContain(map.quality);
    }
  });

  it('lay out the same pages twice', () => {
    expect(laid('long', 'ar').pages).toEqual(laid('long', 'ar').pages);
  });
});

/** Each two parts of a page whose places, or whose ink, run into each other. */
function overlaps(parts: readonly PlacedPart[]): string[] {
  const found: string[] = [];
  parts.forEach((part, index) => {
    const next = parts[index + 1];
    if (!next) return;
    if (next.y < part.y + part.height - SLACK) {
      found.push(`${part.id} runs to ${part.y + part.height}, and ${next.id} starts at ${next.y}`);
    }
  });
  return found;
}
