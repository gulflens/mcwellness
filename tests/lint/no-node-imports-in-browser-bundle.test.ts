import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Guards the fix in domain/shared/index.ts (docs/CHANGE-REQUESTS/scheduling-02.md
 * item 3): domain/shared/identity.ts opens with `import ... from 'node:crypto'`
 * at module scope, which a browser bundle cannot load. The barrel no longer
 * re-exports it, but nothing stops a future edit from re-adding it, or from
 * some other file importing a Node built-in on a path a screen actually
 * reaches. This test walks the real import graph from the browser entry
 * point, app/shell/main.tsx, and fails the moment either happens — instead of
 * the blank screen and console-only error scheduling-screen found.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const ENTRY = join(ROOT, 'app/shell/main.tsx');
const SHARED_BARREL = join(ROOT, 'domain/shared/index.ts');

// vite.shared.ts and tsconfig.json's "paths" — kept in step with both by hand,
// same as that comment already asks of any other change to the aliases.
const ALIASES: ReadonlyArray<readonly [string, string]> = [
  ['@domain', join(ROOT, 'domain')],
  ['@app', join(ROOT, 'app')],
];

const RESOLVABLE_EXTENSIONS = ['.ts', '.tsx'];
const CODE_EXTENSIONS = new Set(RESOLVABLE_EXTENSIONS);
const IDENTITY_SUFFIX = normalize(join('domain', 'shared', 'identity'));

// A static or dynamic import/export specifier: `from '...'`, a bare
// `import '...'` side-effect import, or `import('...')`. This codebase's
// lint rules (verbatimModuleSyntax, isolatedModules) keep one specifier per
// statement, so a regex is enough without pulling in a TypeScript parser.
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s+)['"]([^'"]+)['"]/gm;

export type Violation = { importer: string; specifier: string; reason: string };

/** Every import/export specifier a module's source text names. Pure — no filesystem. */
export function extractSpecifiers(source: string): string[] {
  return [...source.matchAll(SPECIFIER)].map((match) => match[1] ?? '');
}

/**
 * The direct, resolution-free half of the rule: does this file's own source
 * name a Node built-in? Used per file by the graph walk below, and exercised
 * on its own, fixture-free, by the negative-case test — a small inline
 * module string is enough; nothing needs to touch disk.
 */
export function findDirectViolations(source: string, importer: string): Violation[] {
  return extractSpecifiers(source)
    .filter((specifier) => specifier === 'node:' || specifier.startsWith('node:'))
    .map((specifier) => ({
      importer,
      specifier,
      reason: `imports the Node built-in "${specifier}"`,
    }));
}

function resolveSpecifier(specifier: string, fromFile: string): string | null {
  if (specifier.startsWith('.')) {
    return normalize(join(dirname(fromFile), specifier));
  }
  for (const [alias, target] of ALIASES) {
    if (specifier === alias || specifier.startsWith(`${alias}/`)) {
      return normalize(join(target, specifier.slice(alias.length)));
    }
  }
  return null; // a bare package specifier — node_modules is out of scope for this walk
}

/** Finds an existing .ts/.tsx file for a resolved base path: itself, an extension, or an index. */
function findFile(basePath: string): string | null {
  if (CODE_EXTENSIONS.has(extname(basePath)) && existsSync(basePath)) {
    return basePath;
  }
  for (const ext of RESOLVABLE_EXTENSIONS) {
    if (existsSync(basePath + ext)) return basePath + ext;
  }
  for (const ext of RESOLVABLE_EXTENSIONS) {
    const indexed = join(basePath, `index${ext}`);
    if (existsSync(indexed)) return indexed;
  }
  return null;
}

/**
 * Walks the real import graph from `entry`, following only relative and
 * @domain/@app alias specifiers through .ts/.tsx files (a bare package
 * specifier such as 'react' is left alone: node_modules is out of scope).
 * Fails on any node: specifier anywhere in that graph, and on any specifier
 * that resolves to domain/shared/identity — that file is never opened, so a
 * violation there is reported without also needing to read it.
 */
export function walkForViolations(entry: string): Violation[] {
  const violations: Violation[] = [];
  const visited = new Set<string>();
  const stack = [entry];

  while (stack.length > 0) {
    const file = stack.pop();
    if (!file || visited.has(file)) continue;
    visited.add(file);

    const source = readFileSync(file, 'utf8');
    violations.push(...findDirectViolations(source, file));

    for (const specifier of extractSpecifiers(source)) {
      if (specifier.startsWith('node:')) continue; // already reported above

      const resolvedBase = resolveSpecifier(specifier, file);
      if (resolvedBase === null) continue; // bare package import; out of scope

      if (resolvedBase.endsWith(IDENTITY_SUFFIX)) {
        violations.push({
          importer: file,
          specifier,
          reason: 'imports domain/shared/identity directly from browser-reachable code',
        });
        continue; // never open it: it is the file that pulls in node:crypto
      }

      const resolved = findFile(resolvedBase);
      if (resolved) {
        stack.push(resolved);
      }
    }
  }

  return violations;
}

describe('browser bundle import graph', () => {
  it('reaches no node: import and no domain/shared/identity from app/shell/main.tsx', () => {
    expect(walkForViolations(ENTRY)).toEqual([]);
  });

  it("domain/shared's own barrel reaches no node: import (the fix this test guards)", () => {
    expect(walkForViolations(SHARED_BARREL)).toEqual([]);
  });

  it('detects a node: import in a small inline module string (fixture-free)', () => {
    const inline = "import { randomUUID } from 'node:crypto';\nexport const id = randomUUID();\n";
    expect(findDirectViolations(inline, '<inline fixture>')).toEqual([
      {
        importer: '<inline fixture>',
        specifier: 'node:crypto',
        reason: 'imports the Node built-in "node:crypto"',
      },
    ]);
  });
});
