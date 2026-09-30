import { describe, expect, it } from 'vitest';
import { reportFonts } from '../../app/api/billing/fonts';
import { retype, toggleMark } from '../../app/admin/reports/qeeg/richEdit';
import { layoutQeegReport } from '../../domain/reports/qeeg/document/index';
import { withOtherLanguageFrom } from '../../domain/reports/qeeg/otherLanguage';
import { factsFor, fullReport, pictureOf } from '../../domain/reports/qeeg/testing/reports';
import type { QeegInitial, RichText } from '../../domain/reports/qeeg/types';

/**
 * Fix round 1 of brief Q, finding 10: bold and underline set in the Arabic
 * box reach the Arabic half of the summary and print on the Arabic report.
 * The marks are made as the form makes them (`retype`, then `toggleMark`), and
 * the Arabic report is made as the server makes it (`withOtherLanguageFrom`).
 */

const WORDS = 'تظهر الخريطة نشاطا أبطأ في المقدمة';

type TextOp = { kind: 'text'; text: string; style: { font: string } };
type RuleOp = { kind: 'rule' };

function opsOf(value: unknown): Array<TextOp | RuleOp> {
  if (Array.isArray(value)) return value.flatMap(opsOf);
  if (typeof value !== 'object' || value === null) return [];
  const kind = (value as { kind?: unknown }).kind;
  if (kind === 'text' || kind === 'rule') return [value as TextOp | RuleOp];
  return Object.values(value).flatMap(opsOf);
}

function arabicReport(summary: RichText): QeegInitial {
  const first: QeegInitial = {
    ...fullReport(),
    summary: { en: fullReport().summary.en, ar: null },
  };
  const sent: QeegInitial = { ...first, summary: { ...first.summary, ar: summary } };
  return withOtherLanguageFrom(first, sent, 'ar') as QeegInitial;
}

function laidText(content: QeegInitial): TextOp[] {
  const facts = factsFor(content);
  const pictures = Object.fromEntries(Object.keys(facts.pictures).map((id) => [id, pictureOf()]));
  const laid = layoutQeegReport(
    { content, locale: 'ar', facts: { ...facts, logo: pictureOf(), pictures } },
    reportFonts(),
  );
  return opsOf(laid.pages).filter((op): op is TextOp => op.kind === 'text');
}

describe('bold and underline in the Arabic summary', () => {
  const typed = retype({ text: '', marks: [] }, WORDS);
  const bold = toggleMark(typed, 5, 12, 'bold');
  const marked = toggleMark(bold, 19, 23, 'underline');

  it('reach the Arabic half, as the form sets them', () => {
    const report = arabicReport(marked);
    expect(report.summary.ar).toEqual(marked);
    expect(marked.marks).toEqual([
      { from: 5, to: 12, bold: true },
      { from: 19, to: 23, underline: true },
    ]);
  });

  it('print the bold words bold on the Arabic report, and nothing bold without them', () => {
    const boldWord = WORDS.slice(5, 12);
    const withMarks = laidText(arabicReport(marked)).filter((op) => op.text.includes(boldWord));
    expect(withMarks.some((op) => op.style.font === 'bold')).toBe(true);
    const plain = laidText(arabicReport(typed)).filter((op) => op.text.includes(boldWord));
    expect(plain.length).toBeGreaterThan(0);
    expect(plain.some((op) => op.style.font === 'bold')).toBe(false);
  });
});
