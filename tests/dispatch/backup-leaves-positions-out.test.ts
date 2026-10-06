import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * A practitioner's positions are kept two days (docs/SPEC/dispatch.md section
 * 15). The weekly dump is kept ninety days, so it must carry the positions
 * table's shape and none of its rows — or "two days" is not true.
 */

const WORKFLOW = readFileSync('.github/workflows/backup.yml', 'utf8');

/** Every pg_dump command line in the workflow, continuation lines joined. */
function dumpCommands(): string[] {
  return WORKFLOW.replace(/\\\n\s*/g, ' ')
    .split('\n')
    .filter((line) => /\bpg_dump\b/.test(line) && !line.trim().startsWith('#'));
}

describe('the weekly backup', () => {
  it('has a dump to check', () => {
    expect(dumpCommands().length).toBeGreaterThan(0);
  });

  it("leaves the positions' rows out of every dump, and keeps the table's shape", () => {
    for (const command of dumpCommands()) {
      expect(command).toContain('--exclude-table-data=public.practitioner_position');
      expect(command).not.toMatch(/--exclude-table(?!-data)[= ]\S*practitioner_position/);
    }
  });
});
