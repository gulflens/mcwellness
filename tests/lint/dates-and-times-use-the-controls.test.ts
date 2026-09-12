import { readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * A native `<input type="date">` or `type="time"` draws itself in the browser's
 * locale, not the practice's: on a machine set to English (United States) a
 * date of birth reads MM/DD/YYYY and a visit time carries a meridiem. Round 47
 * replaced all twenty-eight of them with `DateField` and `TimeField`, which
 * always read DD/MM/YYYY and a twenty-four hour clock.
 *
 * Nothing in the code says that. The next screen written would reach for the
 * native control because every screen used to. So this walks the app and fails
 * on either type outside the two controls that are allowed to hold one.
 *
 * Fails closed: the visited-file count is asserted, so a walk that resolved
 * nothing cannot report zero violations and pass.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const WALKED = ['app'] as const;

/** The two controls that own a native date input, and the comment that quotes one. */
const ALLOWED = new Set([
  'app/shell/components/DateField.tsx',
  'app/shell/components/TimeField.tsx',
]);

const OFFENCE = /type=["'](date|time)["']/;

function walk(directory: string, found: string[] = []): string[] {
  for (const entry of readdirSync(join(ROOT, directory), { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      walk(path, found);
      continue;
    }
    if (!['.ts', '.tsx'].includes(extname(entry.name))) continue;
    if (entry.name.includes('.test.')) continue;
    found.push(path);
  }
  return found;
}

describe('every date and time box is one of the two shared controls', () => {
  const files = WALKED.flatMap((directory) => walk(directory));

  it('visited the app, so a silent no-op cannot pass', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('finds no native date or time input outside the two controls', () => {
    const offenders: string[] = [];
    for (const file of files) {
      if (ALLOWED.has(file)) continue;
      const source = readFileSync(join(ROOT, file), 'utf8');
      for (const [index, line] of source.split('\n').entries()) {
        // A line inside a block comment is prose, not markup.
        if (line.trimStart().startsWith('*')) continue;
        if (OFFENCE.test(line)) offenders.push(`${relative('', file)}:${index + 1}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
