import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// Runs the repository's real eslint.config.js against small snippets at
// virtual paths, so both the rule and the paths it applies to are tested.
const eslint = new ESLint({ cwd: fileURLToPath(new URL('../../', import.meta.url)) });

const RULE = 'mcwellness/no-hex-colour';

async function rulesReported(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).map((message) => message.ruleId ?? '');
}

describe(RULE, () => {
  it('reports a hex colour in a string literal in app code', async () => {
    expect(await rulesReported("export const c = '#1a2b3c';", 'app/shell/probe.ts')).toContain(
      RULE,
    );
  });

  it('reports a short hex colour', async () => {
    expect(await rulesReported("export const c = '#fff';", 'app/shell/probe.ts')).toContain(RULE);
  });

  it('reports a hex colour inside a template literal', async () => {
    expect(
      await rulesReported('export const c = `color: #1a2b3c;`;', 'app/shell/probe.ts'),
    ).toContain(RULE);
  });

  it('reports a hex colour in a JSX attribute', async () => {
    expect(
      await rulesReported('export const P = () => <div color="#fff" />;', 'app/shell/Probe.tsx'),
    ).toContain(RULE);
  });

  it('leaves a five-digit hash alone', async () => {
    expect(await rulesReported("export const c = '#abcde';", 'app/shell/probe.ts')).not.toContain(
      RULE,
    );
  });

  it('leaves app test files alone', async () => {
    expect(
      await rulesReported("export const c = '#1a2b3c';", 'app/shell/probe.test.ts'),
    ).not.toContain(RULE);
  });

  it('does not apply outside app', async () => {
    expect(await rulesReported("export const c = '#1a2b3c';", 'db/probe.ts')).not.toContain(RULE);
  });
});
