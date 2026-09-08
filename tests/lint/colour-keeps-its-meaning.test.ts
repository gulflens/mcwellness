import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Every source a browser ends up running, tests excluded. */
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

const BAND = /--(?:delta|theta|alpha|beta|gamma)\b/;
const BRAND = /--brand\b/;
const TOKENS = join('app', 'shell', 'tokens.css');

/**
 * Colour means one thing at a time (docs/SPEC/coloured-shell.md section 11).
 *
 * The console gained the practice's violet on 8 September 2026, and the rule
 * that keeps the five band hues meaningful afterwards is that the two never
 * meet: the brand never enters a chart's plotting area, and no band hue is
 * ever used for chrome. So a colour inside a figure is always a measurement,
 * and a colour outside one never is.
 *
 * The nearest collision was checked rather than assumed. `--delta-base` is
 * `#3b4a87`, an indigo, and measures 1.76 against `--brand` — close in hue and
 * close in lightness. It is safe only because delta appears solely inside a
 * labelled chart and the violet solely in the rail, on actions and on links.
 * This test is what keeps that true.
 */
describe('colour keeps its meaning', () => {
  const files = sources('app').filter((path) => path !== TOKENS);

  it('never puts the brand in a file that draws band data', () => {
    const both = files.filter((path) => {
      const text = readFileSync(path, 'utf8');
      return BAND.test(text) && BRAND.test(text);
    });
    expect(both).toEqual([]);
  });

  it('never puts a band hue in the shell, which is chrome and never a figure', () => {
    const shell = files.filter((path) => path.startsWith(join('app', 'shell')));
    const offenders = shell.filter((path) => BAND.test(readFileSync(path, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it("keeps the mark's second colour reserved until something needs it", () => {
    // --brand-magenta is declared so the mark's pink is written down beside its
    // violet. A colour with no use yet should not acquire one by accident; when
    // a screen genuinely wants it, this expectation is what gets changed, on
    // purpose and in the same commit.
    const used = files.filter((path) => /--brand-magenta/.test(readFileSync(path, 'utf8')));
    expect(used).toEqual([]);
  });
});
