import { describe, expect, it } from 'vitest';
import { inline, literal } from './render';

describe('the seed renderer', () => {
  it('writes every value the way pg would have sent it', () => {
    expect(literal(null)).toBe('null');
    expect(literal(true)).toBe('true');
    expect(literal(42)).toBe('42');
    expect(literal("O'Brien")).toBe("'O''Brien'");
    // pg prefixes a space before the E'...' form so it can be concatenated safely.
    expect(literal('back\\slash')).toBe(" E'back\\\\slash'");
    expect(literal(Buffer.from([0xde, 0xad]))).toBe("'\\xdead'::bytea");
    expect(literal(['home', 'remote'])).toBe('\'{"home","remote"}\'');
    expect(literal(['a,b', 'say "hi"', null])).toBe(' E\'{"a,b","say \\\\"hi\\\\"",NULL}\'');
  });

  it('refuses a value it has no rule for, rather than writing something else', () => {
    expect(() => literal(new Date(0))).toThrow('cannot write a [object Date]');
    expect(() => literal({ a: 1 })).toThrow('cannot write a [object Object]');
  });

  it('inlines placeholders in one pass, so a written literal is never rescanned', () => {
    expect(inline('values ($1, $2)', ['$1 and $2', 'x'])).toBe("values ('$1 and $2', 'x')");
    expect(inline('($1, $10)', ['one', 2, 3, 4, 5, 6, 7, 8, 9, 'ten'])).toBe("('one', 'ten')");
    expect(() => inline('($3)', ['a'])).toThrow('refers to $3 but 1 values');
  });
});
