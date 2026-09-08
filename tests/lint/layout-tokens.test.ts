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

/**
 * The few rules the layout cannot lose without the console breaking somewhere
 * nobody is looking (docs/SPEC/responsive-console.md section 10).
 */
describe('layout tokens', () => {
  const shell = readFileSync('app/shell/shell.css', 'utf8');
  const tokens = readFileSync('app/shell/tokens.css', 'utf8');
  const html = readFileSync('index.html', 'utf8');

  it('keeps the content column able to shrink, so a wide table never widens the page', () => {
    expect(shell).toContain('grid-template-columns: var(--rail) minmax(0, 1fr)');
  });

  it('names both rail widths and lets the layout choose between them', () => {
    expect(tokens).toContain('--rail-open: 220px');
    expect(tokens).toContain('--rail-closed: 64px');
    expect(shell).toContain("[data-rail='closed']");
  });

  it('gives the drawer a share of the screen rather than a fixed width', () => {
    expect(tokens).toContain('--drawer: clamp(');
  });

  it('never takes zooming away from anybody, anywhere in the app', () => {
    // A viewport that forbids zoom is the one thing the phone treatment must
    // never become: the console starts small there by design, and pinching in
    // is how a person reads it. Every source is read, not only the shell's,
    // because any component could write a viewport element of its own.
    //
    // There are no exemptions. The one there was, app/shell/viewport.ts, went
    // with the phone's zoomed-out treatment on 8 September 2026
    // (docs/SPEC/coloured-shell.md section 8), so the rule is now absolute.
    const offenders: string[] = [];
    for (const path of [...sources('app'), 'index.html']) {
      const source = readFileSync(path, 'utf8');
      if (source.includes('user-scalable') || source.includes('maximum-scale=')) {
        offenders.push(path);
      }
    }
    expect(offenders).toEqual([]);
    expect(html).not.toContain('user-scalable');
  });

  it('keeps the sections scrolling inside the rail', () => {
    expect(shell).toMatch(/\.rail__list\s*\{[^}]*overflow-y:\s*auto/);
  });
});
