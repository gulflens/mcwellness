import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The rail lists the sections of Billing and Books by hand
 * (app/shell/components/Rail.tsx), because the shell otherwise knows nothing
 * about either screen and importing their constants would give the rail a
 * bundle dependency on two pages it never renders.
 *
 * The cost of that choice is drift, and this is the guard that makes drift
 * loud: rename a section on the page and the rail would keep linking the old
 * name — the page would fall back to its first section, the rail would mark
 * nothing, and one rail row would open the wrong view. Nothing else would fail.
 */
const rail = readFileSync('app/shell/components/Rail.tsx', 'utf8');

function railRows(path: string): string[] {
  return [...rail.matchAll(new RegExp(`to: '${path}#([a-z]+)'`, 'g'))].map((m) => m[1] ?? '');
}

function pageSections(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  const block = /const SECTIONS = \[([\s\S]*?)\] as const;/.exec(source);
  if (!block?.[1]) throw new Error(`No SECTIONS block in ${file}`);
  return [...block[1].matchAll(/key: '([a-z]+)'/g)].map((m) => m[1] ?? '');
}

describe('the rail lists the sections each page actually has', () => {
  it('matches Billing, in the page’s own order', () => {
    expect(railRows('/admin/billing')).toEqual(pageSections('app/admin/billing/BillingPage.tsx'));
  });

  it('matches Books, in the page’s own order', () => {
    expect(railRows('/admin/books')).toEqual(pageSections('app/admin/accounting/BooksPage.tsx'));
  });
});

describe('the rail icon token', () => {
  it('is the size the icons are actually drawn at', () => {
    // --rail-icon indents a page row so its label lines up with its section's
    // label. Nothing makes the icons read the token, so the two are pinned
    // here: change one and this says so.
    const tokens = readFileSync('app/shell/tokens.css', 'utf8');
    const icons = readFileSync('app/shell/components/Icons.tsx', 'utf8');
    const token = /--rail-icon:\s*(\d+)px/.exec(tokens)?.[1];
    expect(token).toBeDefined();
    expect(icons).toContain(`width="${token}"`);
    expect(icons).toContain(`height="${token}"`);
  });
});
