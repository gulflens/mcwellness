import { describe, expect, it } from 'vitest';
import { draftReportMessage } from './message';

/**
 * The report's own drafted sentence (docs/SPEC/reports-v1.md section 7.2), in
 * the report's one language (the operator's decision of 15 October 2026).
 */

const URL = 'https://storage.example.com/tenant/x/client/y/z?signature=abc';
const ARABIC = /\p{Script=Arabic}/u;

describe('draftReportMessage', () => {
  it('names the document, the practice and the link, in English for an English report', () => {
    const message = draftReportMessage({
      kind: 'progress',
      locale: 'en',
      reference: 'RPT-000004',
      practiceName: 'Synthetic Wellness',
      url: URL,
    });
    expect(message.text).toBe(
      `Your progress report RPT-000004 from Synthetic Wellness is ready. You can open it here: ${URL}`,
    );
    expect(message.text).not.toMatch(ARABIC);
    expect(message.subject).toBe('Synthetic Wellness — progress report RPT-000004');
  });

  it('is in Arabic alone for an Arabic report', () => {
    const message = draftReportMessage({
      kind: 'session',
      locale: 'ar',
      reference: 'RPT-000005',
      practiceName: 'استوديو العافية التجريبي',
      url: URL,
    });
    expect(message.text).toBe(
      `تقرير الجلسة RPT-000005 من استوديو العافية التجريبي جاهز. يمكنك فتحه هنا: ${URL}`,
    );
    expect(message.text).not.toContain('Your');
    expect(message.subject).toBe('استوديو العافية التجريبي — تقرير الجلسة RPT-000005');
  });

  it('names a brain-map report as one, in either language', () => {
    const english = draftReportMessage({
      kind: 'qeeg',
      locale: 'en',
      reference: 'RPT-000007',
      practiceName: 'Synthetic Wellness',
      url: URL,
    });
    const arabic = draftReportMessage({
      kind: 'qeeg',
      locale: 'ar',
      reference: 'RPT-000007',
      practiceName: 'Synthetic Wellness',
      url: URL,
    });
    expect(english.subject).toBe('Synthetic Wellness — brain map report RPT-000007');
    expect(arabic.text).toContain('تقرير خريطة الدماغ');
  });

  it('says nothing about the visit, the practitioner or a figure', () => {
    // A message sits in a notification on a lock screen somebody else may be
    // looking at. The reference, the practice and the link, and nothing else.
    const message = draftReportMessage({
      kind: 'session',
      locale: 'en',
      reference: 'RPT-000006',
      practiceName: 'Synthetic Wellness',
      url: URL,
    });
    for (const word of ['sleep', 'goal', 'rating', 'brain', 'session number']) {
      expect(message.text.toLowerCase()).not.toContain(word);
    }
    expect(message.text).not.toMatch(/AED/);
  });
});
