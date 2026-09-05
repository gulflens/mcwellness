import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

/**
 * Every file in .github/workflows is valid YAML and says the few things a
 * workflow must say.
 *
 * A workflow is not run by `pnpm verify`, so a typo in one is discovered by
 * GitHub, at the moment it matters, and for the release workflow that moment is
 * a tag push nobody wants to repeat. This is the cheapest possible guard
 * against that: it does not judge what a workflow does, only that it parses and
 * has a name, a trigger and at least one job.
 */

const DIR = fileURLToPath(new URL('../../.github/workflows/', import.meta.url));
const files = readdirSync(DIR).filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'));

type Workflow = { name?: unknown; on?: unknown; jobs?: Record<string, unknown> };

describe('.github/workflows', () => {
  it('holds the workflows this repository expects', () => {
    // Named rather than counted, so adding one is free and losing one is not.
    expect(files).toEqual(expect.arrayContaining(['audit.yml', 'release.yml', 'verify.yml']));
  });

  it.each(files)('%s parses as YAML and declares a name, a trigger and jobs', (file) => {
    const parsed = parse(readFileSync(`${DIR}${file}`, 'utf8')) as Workflow;

    expect(typeof parsed.name).toBe('string');
    // YAML reads a bare `on:` as the boolean true, which is how GitHub's own
    // schema is written; either shape means the workflow declares a trigger.
    expect(parsed.on === true || typeof parsed.on === 'object').toBe(true);
    expect(Object.keys(parsed.jobs ?? {}).length).toBeGreaterThan(0);
  });
});

describe('the release workflow', () => {
  const release = parse(readFileSync(`${DIR}release.yml`, 'utf8')) as {
    on?: { push?: { tags?: string[] }; [key: string]: unknown };
    jobs?: Record<string, { environment?: { name?: string } }>;
  };

  it('is triggered by a version tag and by nothing else', () => {
    // Pushing a tag is the act that proposes a release. No branch deploys
    // itself and there is no button (docs/SPEC/hosting.md section 4.1).
    expect(Object.keys(release.on ?? {})).toEqual(['push']);
    expect(release.on?.push?.tags).toEqual(['v*']);
    expect(Object.keys(release.on?.push ?? {})).toEqual(['tags']);
  });

  it('puts the deploy job in the production environment, where a person approves it', () => {
    expect(release.jobs?.deploy?.environment?.name).toBe('production');
  });
});
