import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

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

  it('never takes zooming away from anybody', () => {
    // A viewport that forbids zoom is the one thing the phone treatment must
    // never become: the console starts small there by design, and pinching in
    // is how a person reads it. The viewport module is not read as text here —
    // it names both words in its own comment explaining that it never writes
    // them — and app/shell/viewport.test.ts asserts the same thing about every
    // string it actually produces.
    for (const source of [shell, tokens, html]) {
      expect(source).not.toContain('user-scalable');
      expect(source).not.toContain('maximum-scale=');
    }
  });

  it('keeps the sections scrolling inside the rail', () => {
    expect(shell).toMatch(/\.rail__list\s*\{[^}]*overflow-y:\s*auto/);
  });
});
