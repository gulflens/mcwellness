import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The page's section switcher may only be styled by a stylesheet the shell
 * always loads.
 *
 * **The defect this exists to prevent, which actually happened.** The rules
 * lived in `app/admin/billing/billing.css`, which only `BillingPage.tsx`
 * imports. Screens are code-split (PR 152), so a reader who opened Books
 * directly — `BooksPage` renders `.sections` and imports only its own
 * stylesheet — got five unstyled browser buttons, while a reader who had
 * opened Billing first saw them styled. Measured in a browser on 2026-09-12:
 * on a fresh load of `/admin/books`, no stylesheet in the document defined
 * `.sections__tab` at all.
 *
 * So: every selector below is defined once, in `app/shell/shell.css`, which
 * `app/shell/main.tsx` imports at start-up and no split can strand.
 */
const SWITCHER = [
  '.sections',
  '.sections__tab',
  '.settings-nav',
  '.settings-nav__link',
  '.tabs',
  '.tabs__tab',
  '.schedule__week-link',
];

/**
 * Whether a stylesheet declares a rule for this class.
 *
 * A matcher over each rule's selector list rather than a substring search,
 * because the review of pull request 163 probed the substring version and found
 * it porous: it missed `.sections__tab{` with no space before the brace, a
 * newline before it, a selector list, a compound like `.sections__tab.is-x`,
 * and — the one that mattered — the modifier alone, so
 * `.sections__tab--current { background: red }` could be re-added to a module
 * stylesheet with this guard still green and Books diverging again on a fresh
 * load.
 *
 * A modifier counts as the class, being the same rule's other half; a longer
 * name that merely starts the same does not, so `.tabs__panel` stays where it
 * belongs in the client record's own stylesheet.
 */
function declares(css: string, className: string): boolean {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const token = new RegExp(`${className.replace('.', '\\.')}(?:--[\\w-]+)?(?![\\w-])`);
  return [...withoutComments.matchAll(/([^{}]+)\{[^{}]*\}/g)].some((rule) =>
    token.test(rule[1] ?? ''),
  );
}

/** The stylesheets `main.tsx` imports, which are therefore always present. */
function alwaysLoaded(): string[] {
  const main = readFileSync('app/shell/main.tsx', 'utf8');
  return [...main.matchAll(/import '\.\/([\w-]+\.css)'/g)].map((m) => `app/shell/${m[1]}`);
}

function everyStylesheet(dir = 'app'): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return everyStylesheet(path);
    return path.endsWith('.css') ? [path] : [];
  });
}

describe('the page switcher', () => {
  const always = alwaysLoaded();

  it('is loaded at start-up, not behind a screen that may never open', () => {
    expect(always).toContain('app/shell/shell.css');
  });

  it('is defined in an always-loaded stylesheet and nowhere else', () => {
    const offenders = everyStylesheet()
      .filter((file) => !always.includes(file))
      .filter((file) =>
        SWITCHER.some((selector) => declares(readFileSync(file, 'utf8'), selector)),
      );
    expect(offenders).toEqual([]);
  });

  it('gives the one you are on the brand violet', () => {
    // The operator's instruction of 2026-09-12. On the page's light paper this
    // is legible where the rail's violet ground is not (spec section 4.2).
    const shell = readFileSync('app/shell/shell.css', 'utf8');
    const current = /\.sections__tab--current[^{]*\{[^}]*\}/.exec(shell)?.[0] ?? '';
    expect(current).toContain('background: var(--brand)');
    expect(current).toContain('color: var(--surface)');
  });
});
