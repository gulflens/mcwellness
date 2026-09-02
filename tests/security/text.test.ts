import { describe, expect, it } from 'vitest';
import { cleanText } from '../../app/api/_middleware/text';

// Hostile characters are spelled as code points so this file holds none of them.
const cp = (n: number): string => String.fromCodePoint(n);

describe('cleanText', () => {
  it('strips control, invisible and bidirectional-override characters', () => {
    expect(cleanText(`a${cp(0x00)}b${cp(0x1b)}c${cp(0x200b)}d${cp(0xfeff)}e`, 100)).toBe('abcde');
    expect(cleanText(`${cp(0x202e)}evil${cp(0x202c)} text`, 100)).toBe('evil text');
    expect(cleanText(`${cp(0x2066)}isolated${cp(0x2069)}`, 100)).toBe('isolated');
  });

  it('collapses whitespace, trims and caps', () => {
    expect(cleanText('  too   many\n\nlines\t here  ', 100)).toBe('too many lines here');
    expect(cleanText('x'.repeat(50), 10)).toBe('x'.repeat(10));
  });

  it('normalises composed and decomposed forms to one', () => {
    expect(cleanText(`e${cp(0x0301)}`, 10)).toBe(cp(0xe9));
  });

  it('keeps Arabic and ordinary punctuation', () => {
    const arabic = [0x633, 0x623, 0x644, 0x62a].map(cp).join('');
    expect(cleanText(`${arabic} .`, 100)).toBe(`${arabic} .`);
  });
});
