import { describe, expect, it } from 'vitest';

/**
 * The words of a clinic appear nowhere in the brain-map report's code
 * (CLAUDE.md rule 1), with two exceptions this file names exactly.
 *
 * **Why there are exceptions at all.** The old tool's file keeps the person a
 * report is about under a key this app does not use. Reading the file means
 * naming that key, so it is written once, as the value of
 * `LEGACY_SUBJECT_KEY` in `keys.ts`, and every other line says the constant.
 * The other exception is the guards themselves: the wording's guard in
 * `wording/wording.test.ts` and this file must spell the words to catch them.
 *
 * **Why every file under `domain/reports/qeeg/` and not only `legacy/`.** The
 * importer is where the old tool's words come closest to this app's code,
 * but the pages, the editor's rules and the wording sit beside it and are
 * written by other hands. One guard over all of them costs nothing.
 *
 * The sources are read through the bundler (`import.meta.glob` with `?raw`),
 * so the guard sees every `.ts` file in the tree without touching the disk
 * itself.
 */

const STEMS = /(patient|treat|therap|\bcure|symptom|clinic|diagnos)/i;

/** The one line of `keys.ts` that may hold the old file's key. */
const KEY_LINE = /^export const LEGACY_SUBJECT_KEY = '[a-z]+';$/;

/** Where the wording's guard begins, and the line that ends it. */
const WORDING_GUARD_START = "describe('what no sentence may say', () => {";
const WORDING_GUARD_END = '});';

const SOURCES = import.meta.glob<string>('../**/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** A source's path from `domain/reports/qeeg/`, whichever way the bundler wrote it. */
function fromQeeg(key: string): string {
  return key.replace(/^(\.\.\/)+/, '').replace(/^\.\//, 'legacy/');
}

const FILES: ReadonlyArray<readonly [string, string]> = Object.entries(SOURCES).map(
  ([key, source]) => [fromQeeg(key), source] as const,
);

/** Each line that holds a stem and is not one of the named exceptions, as `path:line`. */
function offences(path: string, source: string): string[] {
  if (path === 'legacy/vocabulary.test.ts') return [];
  const lines = source.split('\n');
  const found: string[] = [];
  let inWordingGuard = false;
  lines.forEach((line, index) => {
    if (path === 'wording/wording.test.ts') {
      if (line.trim() === WORDING_GUARD_START) inWordingGuard = true;
      if (inWordingGuard) {
        if (line === WORDING_GUARD_END) inWordingGuard = false;
        return;
      }
    }
    if (path === 'legacy/keys.ts' && KEY_LINE.test(line)) return;
    if (STEMS.test(line)) found.push(`${path}:${index + 1}`);
  });
  return found;
}

describe('the words of a clinic', () => {
  it('reads the whole of the report code, guards and all, except this file, which the bundler leaves out of its own glob', () => {
    const paths = FILES.map(([path]) => path);
    for (const expected of [
      'types.ts',
      'catalogue/ids.ts',
      'wording/v1.ts',
      'wording/wording.test.ts',
      'legacy/keys.ts',
      'legacy/read.ts',
    ]) {
      expect(paths).toContain(expected);
    }
  });

  it('appear nowhere but the one line of keys.ts and the guards own lists', () => {
    const found = FILES.flatMap(([path, source]) => offences(path, source));
    expect(found).toEqual([]);
  });

  it('are written in keys.ts exactly once', () => {
    const keys = FILES.find(([path]) => path === 'legacy/keys.ts')?.[1] ?? '';
    const lines = keys.split('\n').filter((line) => STEMS.test(line));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(KEY_LINE);
  });
});

describe('the guard itself', () => {
  it('catches each stem, in either case, in any file', () => {
    for (const line of [
      "const who = 'Patient';",
      '// a TREATMENT plan',
      'const kind = "therapist";',
      '/** to cure it */',
      'const symptoms = [];',
      "it('reads the Clinical note')",
      'const diagnostic = true;',
    ]) {
      expect(offences('legacy/probe.ts', `const a = 1;\n${line}\n`), line).toEqual([
        'legacy/probe.ts:2',
      ]);
    }
  });

  it('leaves alone a word that only contains the letters of cure', () => {
    expect(offences('legacy/probe.ts', 'const secure = accurate;\n')).toEqual([]);
  });

  it('catches a second line in keys.ts', () => {
    const keys = FILES.find(([path]) => path === 'legacy/keys.ts')?.[1] ?? '';
    expect(offences('legacy/keys.ts', `${keys}\n// the patient\n`)).toHaveLength(1);
  });

  it('catches the key written anywhere but keys.ts', () => {
    expect(offences('legacy/read.ts', "export const LEGACY_SUBJECT_KEY = 'patient';\n")).toEqual([
      'legacy/read.ts:1',
    ]);
  });

  it('catches a word in the wording test outside its own guard', () => {
    const wording = FILES.find(([path]) => path === 'wording/wording.test.ts')?.[1] ?? '';
    expect(offences('wording/wording.test.ts', `${wording}\n// a clinic\n`)).toHaveLength(1);
  });
});
