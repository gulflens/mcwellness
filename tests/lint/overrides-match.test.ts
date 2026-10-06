import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

/**
 * A dependency override is written twice, and the two say the same thing.
 *
 * This laptop and CI install with pnpm, which reads `overrides` from
 * pnpm-workspace.yaml. The host installs with npm, which cannot read pnpm's
 * lockfile or its workspace file and reads `overrides` from package.json. An
 * override written only for pnpm is a fix every test sees and production does
 * not: the shell-quote floor of 2026-10-06 is the case in point, since
 * concurrently pins the vulnerable version exactly and only an override moves
 * it.
 */

const read = (path: string): string =>
  readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');

const forPnpm = (parse(read('pnpm-workspace.yaml')) as { overrides?: Record<string, string> })
  .overrides;
const forNpm = (JSON.parse(read('package.json')) as { overrides?: Record<string, string> })
  .overrides;

describe('dependency overrides', () => {
  it('npm on the host gets every override pnpm gets, and no other', () => {
    expect(forNpm ?? {}).toEqual(forPnpm ?? {});
  });

  it('floors shell-quote above the advisory concurrently pins it into', () => {
    expect(forPnpm?.['shell-quote']).toBe('^1.11.0');
  });
});
