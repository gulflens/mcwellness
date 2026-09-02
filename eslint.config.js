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

/**
 * docs/DESIGN-BRIEF.md sections 4.5 and 8: the tells of generated design, refused
 * mechanically. ALL-CAPS labels, Inter or a monospace face for data, a middle dot
 * joining metadata, an arrow appended to a control's text, and !important.
 * @type {import('eslint').Rule.RuleModule}
 */
export const noDesignTells = {
  meta: {
    type: 'problem',
    docs: { description: "The design brief's tells are refused in app code." },
    schema: [],
    messages: {
      caps: 'No ALL-CAPS labels: weight and size carry emphasis, not text-transform.',
      font: 'One typeface family from app/shell/tokens.css; never Inter, never monospace for data.',
      dot: 'No middle-dot-joined metadata. Use spacing and rules.',
      arrow: "No arrow appended to a control's text. The control says what it does.",
      important: 'No !important. Fix the cascade.',
    },
  },
  create(context) {
    const report = (node, messageId) => context.report({ node, messageId });
    const checkText = (node, text) => {
      if (/[\u00b7\u2022]/.test(text)) report(node, 'dot');
      if (/[\u2192\u2190]/.test(text)) report(node, 'arrow');
    };
    const checkLiteral = (node, text) => {
      checkText(node, text);
      if (/^uppercase$/i.test(text.trim()) || /text-transform\s*:\s*uppercase/i.test(text)) {
        report(node, 'caps');
      }
      if (
        /^(inter|monospace)$/i.test(text.trim()) ||
        /font-family[^;]*\b(inter|mono)\b/i.test(text)
      ) {
        report(node, 'font');
      }
      if (/!important/i.test(text)) report(node, 'important');
    };
    return {
      Literal(node) {
        if (typeof node.value === 'string') checkLiteral(node, node.value);
      },
      TemplateElement(node) {
        checkLiteral(node, node.value.raw);
      },
      JSXText(node) {
        checkText(node, node.value);
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
    plugins: {
      mcwellness: { rules: { 'no-hex-colour': noHexColour, 'no-design-tells': noDesignTells } },
    },
    rules: { 'mcwellness/no-hex-colour': 'error', 'mcwellness/no-design-tells': 'error' },
  },
  {
    files: ['app/**/*.test.{ts,tsx}'],
    rules: { 'mcwellness/no-hex-colour': 'off', 'mcwellness/no-design-tells': 'off' },
  },
  prettier,
]);
