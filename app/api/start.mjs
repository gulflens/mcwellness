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
import { existsSync } from 'node:fs';
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

// What `--import tsx` does. The API is TypeScript and stays TypeScript
// (decision 3): registering the loader here keeps one start command instead of
// a compiled build step that only production would use. `tsx/esm/api` is tsx's
// own documented way in; the registration is not undone, because the process
// goes on importing TypeScript for as long as it runs.
const tsx = await import('tsx/esm/api');
tsx.register();

await import('./server.ts');
