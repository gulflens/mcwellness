import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

// Matches #RGB, #RGBA, #RRGGBB and #RRGGBBAA. The lookahead refuses five- and
// seven-digit runs and anything followed by further word characters, so
// identifiers such as "#abcde" or "#12345" pass.
const HEX_COLOUR = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![0-9a-z_])/i;

/**
 * docs/DESIGN-BRIEF.md section 8: colour comes only from app/shell/tokens.css.
 * No component may contain a colour literal.
 * @type {import('eslint').Rule.RuleModule}
 */
export const noHexColour = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Colour comes only from app/shell/tokens.css; no hex literals in app code.',
    },
    schema: [],
    messages: {
      hex: 'Hex colour "{{value}}" is not allowed here. Use a token from app/shell/tokens.css.',
    },
  },
  create(context) {
    const check = (node, text) => {
      const match = HEX_COLOUR.exec(text);
      if (match) {
        context.report({ node, messageId: 'hex', data: { value: match[0] } });
      }
    };
    return {
      Literal(node) {
        if (typeof node.value === 'string') {
          check(node, node.value);
        }
      },
      TemplateElement(node) {
        check(node, node.value.raw);
      },
    };
  },
};

export default defineConfig([
  globalIgnores(['node_modules/', 'dist/', 'coverage/', '.claude/', 'docs/']),
  js.configs.recommended,
  tseslint.configs.recommended,
  { files: ['app/**/*.{ts,tsx}'], ...reactHooks.configs.flat.recommended },
  {
    files: ['app/**/*.{ts,tsx}'],
    plugins: { mcwellness: { rules: { 'no-hex-colour': noHexColour } } },
    rules: { 'mcwellness/no-hex-colour': 'error' },
  },
  { files: ['app/**/*.test.{ts,tsx}'], rules: { 'mcwellness/no-hex-colour': 'off' } },
  prettier,
]);
