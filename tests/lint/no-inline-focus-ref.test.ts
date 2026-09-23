import { readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Round 63: a heading was focused with an inline `ref={(node) => {
 * node?.focus(); }}`. React runs an inline ref callback on every render, so
 * every keystroke into a field beneath the heading re-rendered the form,
 * re-ran the callback, and moved focus straight back to the heading — a
 * person typing their name into `RecordConsentForm.tsx` or `SignAllForm.tsx`
 * kept only the last letter typed, and the same shape sat in `ConsentTab.tsx`
 * and `ErasureSection.tsx`. `useFocusOnOpen` (app/shell/components) replaced
 * all four: it runs the focus once, in a `useEffect` with an empty dependency
 * list, and hands back a stable ref object instead of a fresh function every
 * render.
 *
 * This walks `app` for the shape that caused it, so a future heading (or any
 * other element that wants focus on mount) cannot bring it back by copying
 * what looks like the obvious way to focus a ref.
 *
 * Test files are skipped: several carry the buggy shape verbatim inside a
 * comment, describing the bug they now guard against
 * (`ErasureSection.test.tsx`, `SignAllForm.test.tsx`,
 * `ConsentCapture.test.tsx`, `useFocusOnOpen.test.tsx`) — real code to flag,
 * not a comment quoting history.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const WALKED_DIRECTORY = 'app';

/**
 * `ref={...}` is JSX-only syntax, so only `.tsx` files can carry it.
 */
const CODE_EXTENSION = '.tsx';

/**
 * A walk this shallow could not have covered the app tree: it would mean the
 * walk itself broke rather than the pattern genuinely being gone. 137 files
 * qualify as of round 63; this leaves headroom to shrink or grow.
 */
const MIN_VISITED_FILES = 100;

/**
 * The shape: an inline arrow function passed straight to `ref`, whose body —
 * with or without braces — calls `.focus()` on the node it was handed. Matches
 * across the newline a formatted callback wraps onto, so it catches
 *
 *   ref={(node) => {
 *     node?.focus();
 *   }}
 *
 * as well as the one-line form. It does not match `ref={heading}` (no
 * function literal) or a ref callback that only stores the node, such as
 * `Tabs.tsx`'s `ref={(el) => { if (el) refs.current.set(...); ... }}`, which
 * never calls `.focus()` at all.
 */
const PATTERN = /ref=\{\s*\(\s*\w+\s*\)\s*=>\s*\{?\s*\w+\??\.focus\(\)/;

function isTestFile(name: string): boolean {
  return /\.test\.tsx?$/.test(name);
}

/** Every non-test `.tsx` file under a directory, as repository-relative paths. */
function walk(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(join(ROOT, directory), { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...walk(path));
    } else if (extname(entry.name) === CODE_EXTENSION && !isTestFile(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

/** The line the pattern starts on, and the text of that line, for a readable failure. */
function findOffense(source: string): { line: number; text: string } | null {
  const match = PATTERN.exec(source);
  if (!match) return null;
  const line = source.slice(0, match.index).split('\n').length;
  return { line, text: source.split('\n')[line - 1]?.trim() ?? match[0].trim() };
}

const visited = walk(WALKED_DIRECTORY);

describe('focus on open', () => {
  it('walks the app tree', () => {
    expect(visited.length).toBeGreaterThanOrEqual(MIN_VISITED_FILES);
  });

  it('does not walk test files, which quote the old bug in comments', () => {
    expect(visited.some((file) => isTestFile(file))).toBe(false);
  });

  it('is never an inline ref callback that calls focus() on every render', () => {
    const offenders = visited
      .map((file) => ({ file, offense: findOffense(readFileSync(join(ROOT, file), 'utf8')) }))
      .filter(
        (entry): entry is { file: string; offense: { line: number; text: string } } =>
          entry.offense !== null,
      );

    const lines = offenders.map(({ file, offense }) => `${file}:${offense.line} — ${offense.text}`);
    expect(lines).toEqual([]);
  });

  it('reads the pattern wherever it is written, and only where it is written', () => {
    // The exact shape round 63 shipped, wrapped the way prettier formats it.
    expect(PATTERN.test('ref={(node) => {\n        node?.focus();\n      }}')).toBe(true);
    // The same bug, written on one line.
    expect(PATTERN.test('ref={(node) => node?.focus()}')).toBe(true);
    // useFocusOnOpen's own call sites: a stable ref object, not a function.
    expect(PATTERN.test('ref={heading}')).toBe(false);
    // Tabs.tsx: an inline ref callback that only stores the node — it never
    // calls .focus(), so it must not match.
    expect(
      PATTERN.test(
        'ref={(el) => {\n            if (el) refs.current.set(tab.id, el);\n            else refs.current.delete(tab.id);\n          }}',
      ),
    ).toBe(false);
  });
});
