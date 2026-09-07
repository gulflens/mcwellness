import { readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The staff screens are English only (the operator's decision of 7 September
 * 2026, docs/DESIGN-BRIEF.md section 10 item 4).
 *
 * "Everything in app.mcwellnessuae.com should be English only, no need to show
 * the Arabic fields; Arabic is made only to communicate with clients." The
 * console and the practitioner app are the practice's own tools; the portal,
 * the invoices and receipts, the reports, the consent wording, the erasure
 * letter and the messages the practice sends stay bilingual, and the Arabic
 * columns are still stored, still served and still printed.
 *
 * Nothing in the code says that. A screen added next month would carry an
 * Arabic line beneath its English because every screen used to, and nobody
 * would notice until the operator did. So this walks `app/admin` and
 * `app/therapist` and fails on the two marks an Arabic string is always
 * written with here — `lang="ar"` and `dir="rtl"`, in JSX or as an object
 * property — which is the whole of how Arabic reaches a staff screen.
 *
 * Not walked: `app/shell` (its Arabic font import serves the portal and the
 * consent wording), `app/client`, `app/api`, `domain` and `db`. Test files are
 * skipped: a fixture carrying an Arabic name is the proof that Arabic data on
 * the wire breaks nothing, and must stay.
 *
 * Fails closed: the visited-file count is asserted, so a walk that resolved
 * nothing cannot report zero violations and pass.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const WALKED_DIRECTORIES = ['app/admin', 'app/therapist'] as const;

/**
 * The one screen that may render Arabic, and why: the consent wording is the
 * household's own text, read aloud and signed in its own language on the
 * practice's screen (docs/CONSENT/*.ar.md). It is not console copy — it is the
 * agreement, and the household must see it as it was written.
 */
const ALLOWED = new Set(['app/admin/clients/RecordConsentForm.tsx']);

const CODE_EXTENSIONS = new Set(['.ts', '.tsx']);

/**
 * A walk this shallow could not have covered the two directories: it would
 * mean the walk itself broke rather than the screens genuinely being English.
 */
const MIN_VISITED_FILES = 40;

/** The marks. JSX attribute or object property; single or double quotes. */
const MARKS: ReadonlyArray<{ readonly label: string; readonly pattern: RegExp }> = [
  { label: 'lang="ar"', pattern: /\blang\s*=\s*["']ar["']/ },
  { label: "lang: 'ar'", pattern: /\blang\s*:\s*["']ar["']/ },
  { label: 'dir="rtl"', pattern: /\bdir\s*=\s*["']rtl["']/ },
  { label: "dir: 'rtl'", pattern: /\bdir\s*:\s*["']rtl["']/ },
];

export type Violation = { file: string; line: number; mark: string; text: string };

/** Every mark a file's source text carries, with the line it sits on. Pure. */
export function findMarks(source: string, file: string): Violation[] {
  const violations: Violation[] = [];
  source.split('\n').forEach((text, index) => {
    for (const { label, pattern } of MARKS) {
      if (pattern.test(text)) {
        violations.push({ file, line: index + 1, mark: label, text: text.trim() });
      }
    }
  });
  return violations;
}

function isTestFile(name: string): boolean {
  return /\.test\.tsx?$/.test(name);
}

/** Every non-test `.ts`/`.tsx` file under a directory, as repository-relative paths. */
function walk(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(join(ROOT, directory), { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...walk(path));
    } else if (CODE_EXTENSIONS.has(extname(entry.name)) && !isTestFile(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

const visited = WALKED_DIRECTORIES.flatMap((directory) => walk(directory));

const violations = visited
  .filter((file) => !ALLOWED.has(file))
  .flatMap((file) => findMarks(readFileSync(join(ROOT, file), 'utf8'), file));

describe('the console and the practitioner app are English only', () => {
  it('walks every screen in both directories', () => {
    expect(visited.length).toBeGreaterThanOrEqual(MIN_VISITED_FILES);
    // Both directories, not one of them twice over.
    for (const directory of WALKED_DIRECTORIES) {
      expect(visited.some((file) => file.startsWith(`${directory}/`))).toBe(true);
    }
  });

  it('renders no Arabic on a staff screen', () => {
    const lines = violations.map(
      ({ file, line, mark, text }) => `${file}:${line} carries ${mark} — ${text}`,
    );
    expect(lines).toEqual([]);
  });

  it('names the one file that may carry the household’s own language', () => {
    // The allowlist is a decision, not a leftover: every entry must exist, and
    // must still be the thing it was allowed for.
    for (const file of ALLOWED) {
      expect(visited, `${file} is allowed but was not walked`).toContain(file);
      expect(findMarks(readFileSync(join(ROOT, file), 'utf8'), file).length).toBeGreaterThan(0);
    }
  });

  it('reads a mark wherever it is written', () => {
    // Fixture-free: the shapes the walk must catch, and one it must not.
    expect(findMarks('<p lang="ar" dir="rtl">x</p>', 'probe.tsx')).toHaveLength(2);
    expect(findMarks("{ lang: 'ar', dir: 'rtl' }", 'probe.ts')).toHaveLength(2);
    expect(findMarks('<p lang="en" dir="ltr">x</p>', 'probe.tsx')).toEqual([]);
  });

  it('does not walk the shell, the portal or the API', () => {
    const outside = visited.filter(
      (file) => !WALKED_DIRECTORIES.some((directory) => file.startsWith(`${directory}/`)),
    );
    expect(outside).toEqual([]);
    // Guards against a path separator surprise on the way to that assertion.
    expect(relative(ROOT, join(ROOT, 'app/admin')).split(sep)).toEqual(['app', 'admin']);
  });
});
