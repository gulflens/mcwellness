import { describe, expect, it } from 'vitest';
import { documentFonts, reportFonts } from '../../app/api/billing/fonts';
import { extractText, measure, renderPdf, type Page } from '../../domain/shared/document';

/**
 * The fourth face, loaded for real: the brain-map report's set carries a bold
 * Arabic face, and the set every invoice is rendered with does not
 * (docs/CHANGE-REQUESTS/reports-02.md, request 2).
 */
describe('the report faces', () => {
  it('are the document faces and a bold Arabic one', () => {
    const report = reportFonts();
    const document = documentFonts();
    expect(report.regular).toBe(document.regular);
    expect(report.bold).toBe(document.bold);
    expect(report.arabic).toBe(document.arabic);
    expect(report.arabicBold?.name).toBe('IBMPlexSansArabic-SemiBold');
    expect(report.arabicBold?.arabic).toBe(true);
  });

  it('leave the document faces at three', () => {
    expect(documentFonts().arabicBold).toBeUndefined();
    expect(Object.keys(documentFonts()).sort()).toEqual(['arabic', 'bold', 'regular']);
  });

  it('are read once', () => {
    expect(reportFonts()).toBe(reportFonts());
  });

  it('set bold Arabic wider than regular, and render it so it reads back', () => {
    const fonts = reportFonts();
    const word = 'الفاتورة';
    expect(measure(word, { font: 'bold', size: 12 }, fonts, true)).toBeGreaterThan(
      measure(word, { font: 'regular', size: 12 }, fonts, true),
    );
    const pageIn = (font: 'regular' | 'bold'): Page => ({
      ops: [{ kind: 'text', x: 500, y: 700, text: word, style: { font, size: 12 }, rtl: true }],
    });
    const bold = renderPdf([pageIn('bold')], fonts, 'Report');
    expect(new TextDecoder('latin1').decode(bold)).toContain(
      '/BaseFont /IBMPlexSansArabic-SemiBold',
    );
    // The fourth face's /ToUnicode map is written as the third's is, so a
    // bold word copies off the page exactly as the regular one does.
    expect(extractText(bold)).toEqual(extractText(renderPdf([pageIn('regular')], fonts, 'Report')));
  });
});
