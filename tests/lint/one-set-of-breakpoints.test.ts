import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * One set of breakpoints (docs/SPEC/responsive-console.md section 9).
 *
 * A screen may fold at a tier boundary wherever it needs to; what it may not
 * do is invent a width of its own. Five had grown before this was written —
 * 640px, 40rem, 48rem and two more — each a different idea of the same phone,
 * so the console changed shape at four different places as a window narrowed.
 *
 * The tiers are 768px and 1200px, and 767px is the same pair seen from below,
 * for a rule that belongs to the compact tier alone.
 */
const TIERS = [767, 768, 1200];

/**
 * The two rules that ask a question the tiers cannot, each with a comment
 * beside it in its own stylesheet saying so.
 */
const EXCEPTIONS = new Map([
  // Whether seven columns still fit their own content, not which tier we are in.
  ['app/admin/schedule/schedule.css', [1100]],
  // The household's portal keeps its own phone layout by the operator's
  // decision: a parent reading at night should not have to pinch and pan.
  ['app/client/portal.css', [720]],
]);

/**
 * Stylesheets, and the modules that ask the same question through
 * `matchMedia`: a width written in TypeScript drifts from the tiers exactly as
 * easily as one written in CSS, and the clients page's autofocus had.
 */
function sources(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      sources(path, found);
    } else if (/\.(?:css|ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      found.push(path);
    }
  }
  return found;
}

/**
 * Every width a source names, in pixels: `@media` in a stylesheet, the range
 * syntax `(width < 40rem)` that says the same thing again, and the query
 * strings a module hands to `matchMedia`.
 */
function widthsIn(source: string): number[] {
  const declared = [...source.matchAll(/\b(?:min|max)-width:\s*(\d+(?:\.\d+)?)(px|rem)/g)].map(
    (match) => (match[2] === 'rem' ? Number(match[1]) * 16 : Number(match[1])),
  );
  const ranges = [
    ...source.matchAll(/@media[^{]*?\bwidth\s*[<>]=?\s*(\d+(?:\.\d+)?)(px|rem)/g),
  ].map((match) => (match[2] === 'rem' ? Number(match[1]) * 16 : Number(match[1])));
  return [...declared, ...ranges];
}

describe('one set of breakpoints', () => {
  it('lets no stylesheet invent a width of its own', () => {
    const offenders: string[] = [];
    for (const path of sources('app')) {
      const allowed = [...TIERS, ...(EXCEPTIONS.get(path) ?? [])];
      for (const width of widthsIn(readFileSync(path, 'utf8'))) {
        if (!allowed.includes(width)) {
          offenders.push(`${path} folds at ${width}px`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('opens both tiers in the shell and nowhere else', () => {
    const shell = widthsIn(readFileSync('app/shell/shell.css', 'utf8'));
    expect([...new Set(shell)].sort((a, b) => a - b)).toEqual(TIERS);
  });

  it('keeps the widths written in TypeScript in step with the tiers', () => {
    // The shell decides three things in TypeScript that the stylesheet decides
    // in CSS, and nothing but this test stops the two drifting apart: the
    // screen below which the console is shown zoomed out, the width it lays
    // itself out at there, and the tier at which the rail opens by itself.
    const named = (source: string, constant: string): number => {
      const match = new RegExp(`(?:const|export const) ${constant}(?::[^=]+)? = (\\d+)`).exec(
        source,
      );
      expect(match, `${constant} is declared`).not.toBeNull();
      return Number(match?.[1]);
    };
    const viewport = readFileSync('app/shell/viewport.ts', 'utf8');
    const rail = readFileSync('app/shell/railState.ts', 'utf8');
    // The tablet tier: below it the console is shown whole and zoomed out.
    expect(named(viewport, 'SMALL_SCREEN')).toBe(768);
    // The desk tier: at it the rail opens itself.
    expect(named(rail, 'DESK')).toBe(1200);
    // The width a phone lays the console out at. Not a tier, but it must stay
    // at or above the tablet tier or the zoomed-out page would render the
    // compact tier and defeat the point.
    expect(named(viewport, 'DESK_WIDTH')).toBeGreaterThanOrEqual(768);
  });

  it('states each exception in the stylesheet that takes it', () => {
    for (const path of EXCEPTIONS.keys()) {
      expect(readFileSync(path, 'utf8'), path).toContain('Kept deliberately');
    }
  });
});
