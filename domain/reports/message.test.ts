import { describe, expect, it } from 'vitest';
import { draftReportMessage } from './message';

/** The report's own drafted sentence (docs/SPEC/reports-v1.md section 7.2). */

const URL = 'https://storage.example.com/tenant/x/client/y/z?signature=abc';

describe('draftReportMessage', () => {
  it('names the document, the practice and the link, in both languages', () => {
    const message = draftReportMessage({
      kind: 'progress',
      reference: 'RPT-000004',
      practiceName: 'Synthetic Wellness',
      url: URL,
    });
    expect(message.text).toContain('RPT-000004');
    expect(message.text).toContain('Synthetic Wellness');
    expect(message.text).toContain(URL);
    expect(message.text).toContain('progress report');
    expect(message.text).toContain('تقرير التقدّم');
    expect(message.subject).toBe('Synthetic Wellness — progress report RPT-000004');
  });

  it('says which kind of report it is, on both sides', () => {
    const message = draftReportMessage({
      kind: 'session',
      reference: 'RPT-000005',
      practiceName: 'Synthetic Wellness',
      url: URL,
    });
    expect(message.text).toContain('session report');
    expect(message.text).toContain('تقرير الجلسة');
  });

  it('says nothing about the visit, the practitioner or a figure', () => {
    // A message sits in a notification on a lock screen somebody else may be
    // looking at. The reference, the practice and the link, and nothing else.
    const message = draftReportMessage({
      kind: 'session',
      reference: 'RPT-000006',
      practiceName: 'Synthetic Wellness',
      url: URL,
    });
    for (const word of ['sleep', 'goal', 'rating', 'brain', 'session number']) {
      expect(message.text.toLowerCase()).not.toContain(word);
    }
    expect(message.text).not.toMatch(/AED/);
  });

  it('puts the English first and the Arabic beneath it', () => {
    const message = draftReportMessage({
      kind: 'session',
      reference: 'RPT-000007',
      practiceName: 'Synthetic Wellness',
      url: URL,
    });
    const [english, arabic] = message.text.split('\n\n');
    expect(english).toMatch(/^Your session report/);
    expect(arabic).toContain('تقرير الجلسة');
  });
});
