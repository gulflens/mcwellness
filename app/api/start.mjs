// The entry file a host runs (docs/SPEC/hosting.md section 4.3, decision 3).
//
// Everywhere else the API is started by `node --env-file-if-exists=.env
// --import tsx app/api/server.ts` — flags on a command line we control. A
// managed Node.js host does not give us that command line: it runs
// `node <entry file>` and nothing else. This file is that entry file, and it
// does in JavaScript exactly what those two flags do, so the hosted start is
// the same start as the local one rather than a second way of running the API.
//
// It is deliberately the smallest thing that can work. Nothing about the API
// lives here: no settings are read, no defaults are applied, no errors are
// caught. server.ts remains the only place that decides how the API starts,
// including which settings it refuses to start without.

// Imported rather than taken from the global scope, so this file needs no
// lint configuration of its own: it is the only .mjs outside scripts/.
import { accessSync, chmodSync, constants, copyFileSync, existsSync, mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { URL, fileURLToPath } from 'node:url';

// What `--env-file-if-exists=.env` does. On a host there is no `.env` — it is
// git-ignored and never travels in a release archive — so this is a no-op
// there and the host's own injected settings are the only ones. On a laptop it
// is the same file every other command reads. Either way the environment wins:
// Node does not overwrite a variable that is already set, so a stray file can
// never quietly replace a setting the host injected.
const envFile = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

// What a managed host takes away, and this file gives back. tsx transforms
// TypeScript through esbuild, and esbuild runs as a child process started from
// a binary inside node_modules. Hostinger's deploy step copies the built tree
// into the runtime's own directory without the execute bit, so that spawn
// fails with EACCES and the API never gets as far as server.ts (the first
// hosted start, 6 September 2026; docs/PRODUCTION.md, the first live pass).
// So, before tsx is registered: find the binary the way esbuild itself does,
// and if it cannot be run, restore the bit; if the file system refuses to run
// anything in that tree at all, place a copy where running is allowed and tell
// esbuild where it is, through the variable esbuild documents for the purpose.
// On a laptop the binary is executable already and none of this runs.
function canExecute(path) {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// Resolved along the same chain the loader walks — this file to tsx, tsx to
// esbuild, esbuild to its platform package — so it is found wherever the
// package manager put it: hoisted by npm on the host, nested by pnpm on a
// laptop. Anything missing on that chain means esbuild is left to itself.
let esbuildBinary;
try {
  const fromHere = createRequire(import.meta.url);
  const fromTsx = createRequire(fromHere.resolve('tsx'));
  const fromEsbuild = createRequire(fromTsx.resolve('esbuild'));
  esbuildBinary = fromEsbuild.resolve(`@esbuild/${process.platform}-${process.arch}/bin/esbuild`);
} catch {
  esbuildBinary = undefined;
}
if (esbuildBinary !== undefined && !canExecute(esbuildBinary)) {
  try {
    chmodSync(esbuildBinary, 0o755);
  } catch {
    // The copy below is the answer when the bit cannot be set either.
  }
  if (!canExecute(esbuildBinary)) {
    const copy = join(mkdtempSync(join(tmpdir(), 'mcwellness-esbuild-')), 'esbuild');
    copyFileSync(esbuildBinary, copy);
    chmodSync(copy, 0o755);
    process.env.ESBUILD_BINARY_PATH = copy;
  }
}

// What `--import tsx` does. The API is TypeScript and stays TypeScript
// (decision 3): registering the loader here keeps one start command instead of
// a compiled build step that only production would use. `tsx/esm/api` is tsx's
// own documented way in; the registration is not undone, because the process
// goes on importing TypeScript for as long as it runs.
const tsx = await import('tsx/esm/api');
tsx.register();

await import('./server.ts');
