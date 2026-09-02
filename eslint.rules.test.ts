import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, it } from 'vitest';
import { noDesignTells, noHexColour } from './eslint.config.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({
  languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
});

tester.run('no-hex-colour', noHexColour, {
  valid: [{ code: "const c = 'var(--ink)';" }, { code: "const id = '#abcde';" }],
  invalid: [{ code: "const c = '#16242A';", errors: [{ messageId: 'hex' }] }],
});

tester.run('no-design-tells', noDesignTells, {
  valid: [
    { code: "const s = { fontWeight: 500 }; const t = 'Interval'; const u = 'monotone';" },
    { code: 'const el = <button>Save</button>;' },
    { code: "const f = 'IBM Plex Sans';" },
  ],
  invalid: [
    { code: "const s = { textTransform: 'uppercase' };", errors: [{ messageId: 'caps' }] },
    { code: "const s = 'text-transform: uppercase';", errors: [{ messageId: 'caps' }] },
    { code: "const f = 'Inter';", errors: [{ messageId: 'font' }] },
    { code: "const f = 'font-family: ui-monospace, mono';", errors: [{ messageId: 'font' }] },
    { code: 'const el = <span>Dubai · 12 sessions</span>;', errors: [{ messageId: 'dot' }] },
    { code: 'const el = <button>Continue →</button>;', errors: [{ messageId: 'arrow' }] },
    { code: "const s = 'color: var(--ink) !important';", errors: [{ messageId: 'important' }] },
  ],
});
