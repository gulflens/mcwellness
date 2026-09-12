// @vitest-environment jsdom
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Every SVG this repository ships must parse.
 *
 * `public/icon.svg` did not, from the day it was written until 2026-09-12. Its
 * comment named two design tokens by their CSS spelling — two leading hyphens
 * — and a double hyphen is illegal inside an XML comment, which is what an SVG
 * document is parsed as. Nothing caught it: the console draws its own mark from
 * a PNG, so the only readers were the manifest and Safari's `apple-touch-icon`,
 * and a browser that cannot parse an icon simply shows none. The app was
 * installable the whole time with no icon of its own.
 */
const svgs = execFileSync('git', ['ls-files', '*.svg'], { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean);

describe('every SVG in the repository', () => {
  it('is a file worth having: there is at least one', () => {
    expect(svgs.length).toBeGreaterThan(0);
  });

  it.each(svgs)('parses as XML: %s', (file) => {
    const parsed = new DOMParser().parseFromString(readFileSync(file, 'utf8'), 'image/svg+xml');
    const error = parsed.querySelector('parsererror');
    expect(error?.textContent ?? null).toBeNull();
    expect(parsed.documentElement.nodeName).toBe('svg');
  });
});
