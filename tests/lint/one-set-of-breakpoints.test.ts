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

function stylesheets(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      stylesheets(path, found);
    } else if (entry.endsWith('.css')) {
      found.push(path);
    }
  }
  return found;
}

/** Every width a stylesheet's media queries name, in pixels. */
function widthsIn(css: string): number[] {
  const pixels = [...css.matchAll(/@media[^{]*?\b(?:min|max)-width:\s*(\d+(?:\.\d+)?)px/g)].map(
    (match) => Number(match[1]),
  );
  const rems = [...css.matchAll(/@media[^{]*?\b(?:min|max)-width:\s*(\d+(?:\.\d+)?)rem/g)].map(
    (match) => Number(match[1]) * 16,
  );
  // The range syntax, `@media (width < 40rem)`, says the same thing again.
  const ranges = [...css.matchAll(/@media[^{]*?\bwidth\s*[<>]=?\s*(\d+(?:\.\d+)?)(px|rem)/g)].map(
    (match) => (match[2] === 'rem' ? Number(match[1]) * 16 : Number(match[1])),
  );
  return [...pixels, ...rems, ...ranges];
}

describe('one set of breakpoints', () => {
  it('lets no stylesheet invent a width of its own', () => {
    const offenders: string[] = [];
    for (const path of stylesheets('app')) {
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

  it('states each exception in the stylesheet that takes it', () => {
    for (const path of EXCEPTIONS.keys()) {
      expect(readFileSync(path, 'utf8'), path).toContain('Kept deliberately');
    }
  });
});
