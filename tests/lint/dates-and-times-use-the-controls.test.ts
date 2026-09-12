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
 * on either type outside `DateField`, the one control still allowed to hold
 * one — `TimeField` is a masked text field throughout and holds none.
 *
 * Fails closed: the visited-file count is asserted, so a walk that resolved
 * nothing cannot report zero violations and pass.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const WALKED = ['app'] as const;

/**
 * The controls allowed to hold a native date or time input. `TimeField.tsx`
 * is deliberately not here: it is a masked text field throughout, with no
 * hidden native input and no calendar-style picker to open one from — an
 * exemption written for a control that was never built (fix round finding 7,
 * 2026-09-12; see the self-check below, in the manner of
 * `console-is-english.test.ts`'s own).
 */
const ALLOWED = new Set(['app/shell/components/DateField.tsx']);

const OFFENCE = /type=["'](date|time)["']/;

/** A line the walk's own comment-skip would count, so the self-check judges allowlisted files exactly as the walk does. */
function ownsANativeInput(file: string): boolean {
  const source = readFileSync(join(ROOT, file), 'utf8');
  return source.split('\n').some((line) => !line.trimStart().startsWith('*') && OFFENCE.test(line));
}

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

  it('names only controls that actually hold a native date or time input', () => {
    // The allowlist is a decision, not a leftover: an entry that no longer
    // carries what it was exempted for is a hole the next removed input
    // would fall through unnoticed (fix round finding 7, 2026-09-12).
    for (const file of ALLOWED) {
      expect(ownsANativeInput(file), `${file} is allowed but holds no native date/time input`).toBe(
        true,
      );
    }
  });
});
