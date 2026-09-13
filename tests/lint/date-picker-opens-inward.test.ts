import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The date picker's anchor must have the shape of the field it belongs to.
 *
 * **The defect this exists to prevent, which actually happened.** `DateField`
 * keeps a hidden native `<input type="date">` beside its text box, purely to
 * lend the browser's calendar to the button. A browser positions AND sizes that
 * calendar from the input's border box, so the hidden element is not a hiding
 * place — it is the anchor.
 *
 * It shipped as `inline-size: 1px; block-size: 1px; inset-inline-end: 0`. In a
 * drawer docked to the inline end of the screen that put the anchor against the
 * viewport's edge: measured in Chrome at a 1200px viewport, a 5x4px box at
 * x=1171 with the drawer's edge at 1200, leaving 24px of room. The picker opened
 * outward into that 24px and was clipped off the screen, and drew itself small
 * for want of an anchor to scale against. The operator hit it on the New
 * appointment drawer on 2026-09-13.
 *
 * The fix is not a magic number or a transform — it is giving the anchor the
 * visible field's own box, so the picker opens inward beneath the field. These
 * assertions pin the three properties that make that true, and refuse the two
 * that made it false.
 */
const RULE = /\.datefield__native\s*\{([^}]*)\}/;

function anchorRule(): string {
  const css = readFileSync('app/shell/shell.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const found = RULE.exec(css)?.[1];
  if (found === undefined) throw new Error('No .datefield__native rule in app/shell/shell.css');
  return found;
}

describe("the date picker's anchor", () => {
  it('spans the field, so the picker opens inward rather than off the screen edge', () => {
    expect(anchorRule()).toMatch(/inset-inline:\s*0/);
  });

  it('is as tall as the input, so the picker has a real box to scale against', () => {
    expect(anchorRule()).toMatch(/block-size:\s*var\(--row\)/);
  });

  it('is never pinned to one edge as a dot, which is what put it off the screen', () => {
    const rule = anchorRule();
    expect(rule).not.toMatch(/inset-inline-end:\s*0/);
    expect(rule).not.toMatch(/inline-size:\s*1px/);
    expect(rule).not.toMatch(/block-size:\s*1px/);
  });

  it('stays invisible and swallows no clicks, since it lies over the real input', () => {
    const rule = anchorRule();
    expect(rule).toMatch(/opacity:\s*0/);
    expect(rule).toMatch(/pointer-events:\s*none/);
  });
});
