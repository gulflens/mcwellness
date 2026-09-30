import { describe, expect, it } from 'vitest';
import type { RichText } from '../../../../domain/reports/qeeg/types';
import { retype, stylesAt, toggleMark } from './richEdit';

/**
 * The summary box's bold and underline, kept on the letters they were set on
 * while she types around them (docs/SPEC/reports-qeeg.md section 4: marks
 * count UTF-16 units of the text, are in order and never overlap).
 */

const rich = (text: string, marks: RichText['marks'] = []): RichText => ({ text, marks });

describe('toggling a style on a stretch of the summary', () => {
  it('makes a stretch bold', () => {
    expect(toggleMark(rich('calm and steady'), 0, 4, 'bold')).toEqual(
      rich('calm and steady', [{ from: 0, to: 4, bold: true }]),
    );
  });

  it('takes the style off again when the whole stretch already has it', () => {
    const bold = rich('calm and steady', [{ from: 0, to: 4, bold: true }]);
    expect(toggleMark(bold, 0, 4, 'bold')).toEqual(rich('calm and steady'));
  });

  it('adds underline beside bold without either overlapping the other', () => {
    const bold = rich('calm and steady', [{ from: 0, to: 8, bold: true }]);
    expect(toggleMark(bold, 5, 15, 'underline').marks).toEqual([
      { from: 0, to: 5, bold: true },
      { from: 5, to: 8, bold: true, underline: true },
      { from: 8, to: 15, underline: true },
    ]);
  });

  it('sets the style over the whole stretch when only part of it has it', () => {
    const part = rich('calm and steady', [{ from: 0, to: 2, bold: true }]);
    expect(toggleMark(part, 0, 8, 'bold').marks).toEqual([{ from: 0, to: 8, bold: true }]);
  });

  it('does nothing with an empty selection', () => {
    const text = rich('calm');
    expect(toggleMark(text, 2, 2, 'bold')).toBe(text);
  });

  it('never changes what it was given', () => {
    const text = rich('calm', [{ from: 0, to: 2, bold: true }]);
    const before = structuredClone(text);
    toggleMark(text, 0, 4, 'underline');
    expect(text).toEqual(before);
  });
});

describe('typing around a mark', () => {
  it('moves a mark along when text is typed before it', () => {
    const text = rich('calm', [{ from: 0, to: 4, bold: true }]);
    expect(retype(text, 'very calm')).toEqual(rich('very calm', [{ from: 5, to: 9, bold: true }]));
  });

  it('leaves text typed straight after a mark unstyled', () => {
    const text = rich('calm', [{ from: 0, to: 4, bold: true }]);
    expect(retype(text, 'calm now').marks).toEqual([{ from: 0, to: 4, bold: true }]);
  });

  it('grows a mark when text is typed inside it', () => {
    const text = rich('calm', [{ from: 0, to: 4, bold: true }]);
    expect(retype(text, 'caXlm').marks).toEqual([{ from: 0, to: 5, bold: true }]);
  });

  it('shrinks a mark when part of it is deleted, and drops one deleted whole', () => {
    const text = rich('calm and steady', [
      { from: 0, to: 4, bold: true },
      { from: 9, to: 15, underline: true },
    ]);
    expect(retype(text, 'ca and steady').marks).toEqual([
      { from: 0, to: 2, bold: true },
      { from: 7, to: 13, underline: true },
    ]);
    expect(retype(text, 'calm and ').marks).toEqual([{ from: 0, to: 4, bold: true }]);
  });

  it('keeps the marks as they were when the text did not change', () => {
    const text = rich('calm', [{ from: 0, to: 4, bold: true }]);
    expect(retype(text, 'calm')).toBe(text);
  });
});

describe('what style a stretch has', () => {
  it('says bold only when every letter of the stretch is bold', () => {
    const text = rich('calm and steady', [{ from: 0, to: 4, bold: true }]);
    expect(stylesAt(text, 0, 4)).toEqual({ bold: true, underline: false });
    expect(stylesAt(text, 0, 8)).toEqual({ bold: false, underline: false });
  });
});
