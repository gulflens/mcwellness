import { describe, expect, it } from 'vitest';
import { amountCell, escapeCell, filsToDecimal, toCsv } from './csv';

describe('escapeCell', () => {
  it('opens a text field that would be a formula with a quotation of its own', () => {
    for (const opener of ['=', '+', '-', '@', '\t', '\r']) {
      expect(escapeCell(`${opener}SUM(A1)`, 'text')).toContain(`'${opener}`);
    }
    expect(escapeCell('=1+1', 'text')).toBe("'=1+1");
    expect(escapeCell('@import', 'text')).toBe("'@import");
  });

  it('guards a WhatsApp number as text so a spreadsheet never evaluates it', () => {
    // E.164 begins with a plus, which is a formula's opening too. The office
    // sees the quotation mark; the number itself is untouched.
    expect(escapeCell('+971500000099', 'text')).toBe("'+971500000099");
  });

  it('leaves an amount alone, however it begins', () => {
    expect(escapeCell(filsToDecimal(-5), 'amount')).toBe('-0.05');
    expect(escapeCell(filsToDecimal(-123_456), 'amount')).toBe('-1234.56');
    expect(escapeCell(filsToDecimal(0), 'amount')).toBe('0.00');
  });

  it('leaves ordinary text where it is', () => {
    expect(escapeCell('Bank, operating', 'text')).toBe('"Bank, operating"');
    expect(escapeCell('General expenses', 'text')).toBe('General expenses');
  });

  it('quotes what it has guarded, when the field needs quoting too', () => {
    expect(escapeCell('=1+1,2', 'text')).toBe('"\'=1+1,2"');
    expect(escapeCell('\tone\ttwo', 'text')).toBe("'\tone\ttwo");
  });
});

describe('toCsv', () => {
  it('separates rows with a carriage return and a line feed and ends with one', () => {
    expect(toCsv([['a', 'b'], ['c']])).toBe('a,b\r\nc\r\n');
  });

  it('guards a text field that would be a formula, and never an amount', () => {
    expect(toCsv([['=cmd|calc', amountCell(-5)]])).toBe("'=cmd|calc,-0.05\r\n");
    expect(toCsv([['-Reversed, by hand', amountCell(-123_456)]])).toBe(
      '"\'-Reversed, by hand",-1234.56\r\n',
    );
  });

  it('quotes a field holding a comma, a quotation mark or a line break', () => {
    expect(toCsv([['plain', 'has, comma']])).toBe('plain,"has, comma"\r\n');
    expect(toCsv([['say "hello"']])).toBe('"say ""hello"""\r\n');
    expect(toCsv([['two\nlines']])).toBe('"two\nlines"\r\n');
  });

  it('writes an empty table as nothing at all', () => {
    expect(toCsv([])).toBe('');
  });
});

describe('filsToDecimal', () => {
  it('writes fils as a plain decimal with no grouping', () => {
    expect(filsToDecimal(123_456)).toBe('1234.56');
    expect(filsToDecimal(0)).toBe('0.00');
    expect(filsToDecimal(-5)).toBe('-0.05');
    expect(filsToDecimal(-123_456)).toBe('-1234.56');
    expect(filsToDecimal(5)).toBe('0.05');
  });
});
