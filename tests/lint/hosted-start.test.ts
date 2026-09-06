import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The entry file a host runs (app/api/start.mjs, docs/SPEC/hosting.md section
 * 4.3 and decision 3).
 *
 * A managed Node.js host runs `node <entry file>` and gives us no command line
 * of our own, so the two flags every other start command carries — the loader
 * for the API's TypeScript, and the local `.env` — are written into that file
 * instead. Nothing else in the repository imports it, so nothing else would
 * notice it breaking; the first symptom would be a deploy that installs, builds
 * and then will not start.
 *
 * The test therefore runs it. It is a smoke test and not a walk of the API: it
 * asks only whether server.ts genuinely ran, which is what the wrapper is for.
 * Either answer proves that — the API says it is listening when it has its
 * settings, and refuses by name when it does not — and a wrapper whose loader
 * failed says neither, because Node cannot import a `.ts` file without one.
 */

const ROOT = new URL('../../', import.meta.url);
const START = fileURLToPath(new URL('app/api/start.mjs', ROOT));

const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('package.json', ROOT)), 'utf8')) as {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

describe('the hosted start file', () => {
  it('is what `start:hosted` runs', () => {
    expect(manifest.scripts?.['start:hosted']).toBe('node app/api/start.mjs');
  });

  it('can be installed on a host, because tsx is a production dependency', () => {
    // The API runs its TypeScript through tsx at runtime (decision 3). As a
    // development dependency it would be absent from a production install and
    // the process would not start.
    expect(manifest.dependencies?.tsx).toBeDefined();
    expect(manifest.devDependencies?.tsx).toBeUndefined();
  });

  it("registers the loader through tsx's own documented entry point", async () => {
    const api = (await import('tsx/esm/api')) as { register?: unknown };
    expect(typeof api.register).toBe('function');
  });

  it('starts the API', { timeout: 60_000 }, async () => {
    // PORT=0 asks the operating system for a free port, so this never argues
    // with a development server on the worktree's own port.
    const child = spawn(process.execPath, [START], {
      env: { ...process.env, PORT: '0', SERVE_APP: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const output = await new Promise<string>((resolve, reject) => {
      let text = '';
      const read = (chunk: Buffer) => {
        text += chunk.toString();
        // With its settings the API says it is listening; without them it names
        // the one it wants and stops. Both mean server.ts ran.
        if (/listening on|API_DATABASE_URL is not set/.test(text)) resolve(text);
      };
      child.stdout.on('data', read);
      child.stderr.on('data', read);
      child.on('error', reject);
      child.on('close', () => resolve(text));
    });

    child.kill();
    expect(output).toMatch(/listening on|API_DATABASE_URL is not set/);
    // What a missing loader looks like: Node refusing the `.ts` import.
    expect(output).not.toMatch(/ERR_UNKNOWN_FILE_EXTENSION/);
  });
});
