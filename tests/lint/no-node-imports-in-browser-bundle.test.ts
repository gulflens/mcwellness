import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Guards two doors onto the same landmine (docs/SPEC/OWNERSHIP.md's shared-zone
 * row): domain/shared/identity.ts opens with `import ... from 'node:crypto'` at
 * module scope, which a browser bundle cannot load. The first door was
 * domain/shared/index.ts re-exporting it — closed by no longer doing so. The
 * second was domain/client/index.ts re-exporting validateEmiratesId, which
 * value-imported domain/shared/identity for two pure string helpers it did not
 * need the crypto for — closed by moving those helpers to the browser-safe
 * domain/shared/emirates-id.ts and having identity.ts and validateEmiratesId.ts
 * both import them from there. Nothing stops a future edit from reopening
 * either door, or opening a new one in a stream barrel this file does not yet
 * know about, so this test walks the real import graph — from the browser
 * entry point, app/shell/main.tsx, and separately from every domain stream's
 * own barrel — and fails the moment a node: import or a direct import of
 * domain/shared/identity is reachable, instead of the blank screen and
 * console-only error scheduling-screen found.
 *
 * Fails closed: a relative or aliased specifier this walk cannot resolve to a
 * source file is reported as a violation, not silently skipped — a walk that
 * quietly stops following broken paths would pass green while covering less
 * and less of the graph. The minimum-visited-file assertion below exists for
 * the same reason: a walk that resolves nothing still reports zero
 * violations, and zero violations from zero files proves nothing.
 *
 * Not covered, by design: a bare package specifier (`react`, `hono`, …) —
 * node_modules is out of scope, the same as the original version of this
 * test. And a dynamic import whose specifier is not a plain string literal —
 * `import(`./locales/${lang}.ts`)` — the SPECIFIER pattern below only matches
 * a quoted literal, so an interpolated specifier is invisible to this walk.
 * Neither shape is used anywhere in this codebase today (grepped as part of
 * writing this test); if one is ever introduced on a path that also reaches
 * domain/shared/identity, this walk would not catch it.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TSCONFIG_PATH = join(ROOT, 'tsconfig.json');

const ENTRY_POINTS: ReadonlyArray<{ readonly label: string; readonly file: string }> = [
  { label: 'the browser entry point, app/shell/main.tsx', file: join(ROOT, 'app/shell/main.tsx') },
  { label: "domain/shared's own barrel", file: join(ROOT, 'domain/shared/index.ts') },
  { label: "domain/client's own barrel", file: join(ROOT, 'domain/client/index.ts') },
  { label: "domain/billing's own barrel", file: join(ROOT, 'domain/billing/index.ts') },
  { label: "domain/scheduling's own barrel", file: join(ROOT, 'domain/scheduling/index.ts') },
  { label: "domain/session's own barrel", file: join(ROOT, 'domain/session/index.ts') },
];

// A walk this shallow cannot be trusted: it would mean most of the graph
// silently failed to resolve rather than genuinely containing no violations.
const MIN_VISITED_FILES = 20;

const RESOLVABLE_EXTENSIONS = ['.ts', '.tsx'];
const CODE_EXTENSIONS = new Set(RESOLVABLE_EXTENSIONS);

// The one non-code extension this walk expects to meet and is allowed to stop
// at without following: a stylesheet import carries no specifiers this rule
// cares about. Recorded in the walk's result rather than silently dropped, so
// a test can assert exactly what was skipped and why.
const ASSET_EXTENSIONS = new Set(['.css']);

// Extensions this codebase's own relative specifiers are never written with
// as real files, but which Vite's bundler module resolution (tsconfig.json's
// moduleResolution: "bundler") maps back onto the .ts/.tsx source of the same
// base name — the compiled-output extension a specifier names, not the
// extension the file on disk actually has.
const COMPILED_EXTENSIONS = new Set(['.js', '.jsx']);

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

/**
 * Turns one `"@x/*": ["./y/*"]` entry of tsconfig.json's compilerOptions.paths
 * into an `[alias, absoluteTarget]` pair. Pure — takes the JSON text and the
 * root directory as arguments, so it is exercised fixture-free below without
 * touching the real tsconfig.json. Throws on a paths shape this walk does not
 * understand rather than silently ignoring it: an alias this walk cannot
 * follow is exactly the kind of gap that would let a violation hide.
 */
export function parseAliasesFromTsconfig(
  tsconfigJson: string,
  root: string,
): ReadonlyArray<readonly [string, string]> {
  const parsed = JSON.parse(tsconfigJson) as {
    compilerOptions?: { paths?: Record<string, string[]> };
  };
  const paths = parsed.compilerOptions?.paths ?? {};
  return Object.entries(paths).map(([key, targets]) => {
    const target = targets[0];
    if (
      !key.endsWith('/*') ||
      target === undefined ||
      targets.length !== 1 ||
      !target.endsWith('/*')
    ) {
      throw new Error(
        `Unsupported tsconfig.json "paths" entry ${JSON.stringify(key)}: ${JSON.stringify(targets)}. ` +
          'This walk only understands a single-target "prefix/*": ["./dir/*"] mapping.',
      );
    }
    return [key.slice(0, -2), normalize(join(root, target.slice(0, -2)))] as const;
  });
}

// Read once, from the real file, at test-collection time — not a hand-copied
// list. vite.shared.ts mirrors the same "paths" by hand for the bundler's own
// sake (its own comment says so); this walk reads the source of truth
// directly so the two can never drift apart from under it.
const ALIASES = parseAliasesFromTsconfig(readFileSync(TSCONFIG_PATH, 'utf8'), ROOT);

/** Resolves a relative or aliased specifier to an extensionless-or-not base path. Null for a bare package specifier — out of scope, see the file header. */
export function resolveSpecifierPath(specifier: string, fromFile: string): string | null {
  if (specifier.startsWith('.')) {
    return normalize(join(dirname(fromFile), specifier));
  }
  for (const [alias, target] of ALIASES) {
    if (specifier === alias || specifier.startsWith(`${alias}/`)) {
      return normalize(join(target, specifier.slice(alias.length)));
    }
  }
  return null;
}

/**
 * Finds the real .ts/.tsx source file a resolved base path names. Three
 * shapes: the base path is already a source file; it is extensionless and
 * resolves by appending an extension or finding an index file; or it ends in
 * a compiled extension (.js/.jsx) that Vite's bundler resolution maps onto
 * the .ts/.tsx source of the same base name, so that extension is stripped
 * before the same extension/index search runs. Returns null when nothing
 * resolves — the walk treats that as a violation, not a skip.
 */
export function findSourceFile(basePath: string): string | null {
  if (CODE_EXTENSIONS.has(extname(basePath)) && existsSync(basePath)) {
    return basePath;
  }
  const ext = extname(basePath);
  const base = COMPILED_EXTENSIONS.has(ext) ? basePath.slice(0, -ext.length) : basePath;
  for (const rext of RESOLVABLE_EXTENSIONS) {
    if (existsSync(base + rext)) return base + rext;
  }
  for (const rext of RESOLVABLE_EXTENSIONS) {
    const indexed = join(base, `index${rext}`);
    if (existsSync(indexed)) return indexed;
  }
  return null;
}

export type WalkResult = {
  violations: Violation[];
  visited: string[];
  skippedAssets: string[];
};

/**
 * Walks the real import graph from every file in `entries`, following only
 * relative and tsconfig-aliased specifiers through .ts/.tsx files (a bare
 * package specifier such as 'react' is left alone: node_modules is out of
 * scope). Fails on any node: specifier anywhere in that graph, on any
 * specifier that resolves to domain/shared/identity — that file is never
 * opened, so a violation there is reported without also needing to read it —
 * and, failing closed, on any other specifier this walk cannot resolve to a
 * real file. A .css specifier is the one shape this walk allows itself to
 * stop at deliberately; it is recorded in `skippedAssets`, not silently
 * dropped.
 */
export function walkImportGraph(entries: readonly string[]): WalkResult {
  const violations: Violation[] = [];
  const visited = new Set<string>();
  const skippedAssets = new Set<string>();
  const stack = [...entries];

  while (stack.length > 0) {
    const file = stack.pop();
    if (!file || visited.has(file)) continue;
    visited.add(file);

    const source = readFileSync(file, 'utf8');
    violations.push(...findDirectViolations(source, file));

    for (const specifier of extractSpecifiers(source)) {
      if (specifier.startsWith('node:')) continue; // already reported above

      const basePath = resolveSpecifierPath(specifier, file);
      if (basePath === null) continue; // bare package import; out of scope

      if (basePath.endsWith(IDENTITY_SUFFIX)) {
        violations.push({
          importer: file,
          specifier,
          reason: 'imports domain/shared/identity directly from browser-reachable code',
        });
        continue; // never open it: it is the file that pulls in node:crypto
      }

      if (ASSET_EXTENSIONS.has(extname(basePath))) {
        skippedAssets.add(basePath);
        continue; // allowed, explicitly — see the file header
      }

      const resolved = findSourceFile(basePath);
      if (resolved === null) {
        violations.push({
          importer: file,
          specifier,
          reason: `cannot resolve "${specifier}" to a source file — failing closed rather than silently skipping it`,
        });
        continue;
      }
      stack.push(resolved);
    }
  }

  return { violations, visited: [...visited], skippedAssets: [...skippedAssets] };
}

describe('tsconfig alias reading (fixture-free)', () => {
  it('turns a "prefix/*": ["./dir/*"] paths entry into an [alias, absoluteTarget] pair', () => {
    const tsconfig = JSON.stringify({
      compilerOptions: { paths: { '@domain/*': ['./domain/*'], '@app/*': ['./app/*'] } },
    });
    expect(parseAliasesFromTsconfig(tsconfig, '/repo')).toEqual([
      ['@domain', normalize('/repo/domain')],
      ['@app', normalize('/repo/app')],
    ]);
  });

  it('refuses a paths shape it does not understand rather than ignoring it', () => {
    const noTrailingStar = JSON.stringify({
      compilerOptions: { paths: { '@domain': ['./domain'] } },
    });
    expect(() => parseAliasesFromTsconfig(noTrailingStar, '/repo')).toThrow('Unsupported');

    const multiTarget = JSON.stringify({
      compilerOptions: { paths: { '@domain/*': ['./domain/*', './fallback/*'] } },
    });
    expect(() => parseAliasesFromTsconfig(multiTarget, '/repo')).toThrow('Unsupported');
  });

  it('reads the same two aliases from the real tsconfig.json that vite.shared.ts mirrors by hand', () => {
    expect(ALIASES).toEqual([
      ['@domain', normalize(join(ROOT, 'domain'))],
      ['@app', normalize(join(ROOT, 'app'))],
    ]);
  });
});

describe('specifier resolution', () => {
  it("maps a .js-suffixed specifier onto its .ts source, as Vite's bundler resolution does", () => {
    const importer = join(ROOT, 'domain/client/index.ts');
    const basePath = resolveSpecifierPath('./canActivate.js', importer);
    expect(basePath).not.toBeNull();
    expect(findSourceFile(basePath ?? '')).toBe(join(ROOT, 'domain/client/canActivate.ts'));
  });

  it('fails closed on a specifier that resolves to no real file, rather than skipping it', () => {
    const importer = join(ROOT, 'domain/client/index.ts');
    const basePath = resolveSpecifierPath('./this-module-does-not-exist', importer);
    expect(basePath).not.toBeNull();
    expect(findSourceFile(basePath ?? '')).toBeNull();
  });

  it('recognises a specifier resolving into domain/shared/identity by path shape alone', () => {
    const importer = join(ROOT, 'domain/client/example.ts');
    const basePath = resolveSpecifierPath('../shared/identity', importer);
    expect(basePath?.endsWith(IDENTITY_SUFFIX)).toBe(true);
  });
});

describe('browser bundle import graph', () => {
  for (const { label, file } of ENTRY_POINTS) {
    it(`reaches no node: import and no domain/shared/identity from ${label}`, () => {
      expect(walkImportGraph([file]).violations).toEqual([]);
    });
  }

  it(`walks at least ${MIN_VISITED_FILES} files across every entry point combined, so a broken walk cannot pass green`, () => {
    const result = walkImportGraph(ENTRY_POINTS.map((entry) => entry.file));
    expect(result.violations).toEqual([]);
    expect(result.visited.length).toBeGreaterThanOrEqual(MIN_VISITED_FILES);
  });

  it('records every .css specifier it deliberately does not follow, rather than dropping it silently', () => {
    const result = walkImportGraph([join(ROOT, 'app/shell/main.tsx')]);
    expect(result.skippedAssets).toEqual(
      expect.arrayContaining([
        join(ROOT, 'app/shell/tokens.css'),
        join(ROOT, 'app/shell/base.css'),
        join(ROOT, 'app/shell/shell.css'),
      ]),
    );
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
