import { describe, expect, it } from 'vitest';
import { draftMessage, whatsAppHandoff } from './sending';

/**
 * The message a family receives, and the hand-off that carries it.
 *
 * The pure half of the seam: what is written and where the link points, with
 * no vendor and no network anywhere near it. The forced-fallback proof — that
 * the platform sends documents with no email vendor configured, which is the
 * state today and will be until one is approved — is next to the
 * implementations, in `app/api/_middleware/sending/seam.test.ts`.
 */

const INVOICE = {
  kind: 'invoice' as const,
  locale: 'en' as const,
  reference: 'INV-000001',
  practiceName: 'Synthetic Wellness Studio',
  url: 'https://example.com/d/abc',
};

describe('the message that goes with a document', () => {
  it('names the document, the practice and where to open it', () => {
    const message = draftMessage(INVOICE);
    expect(message.text).toContain('INV-000001');
    expect(message.text).toContain('Synthetic Wellness Studio');
    expect(message.text).toContain('https://example.com/d/abc');
    expect(message.subject).toBe('Synthetic Wellness Studio — invoice INV-000001');
  });

  it('is written in the document’s one language: English alone for an English one', () => {
    // The operator's decision of 15 October 2026: nothing the practice sends
    // carries both languages.
    const message = draftMessage(INVOICE);
    expect(message.text).toContain('Your invoice INV-000001');
    expect(message.text).not.toMatch(/\p{Script=Arabic}/u);
  });

  it('is in Arabic alone for an Arabic document, subject and all', () => {
    const message = draftMessage({
      ...INVOICE,
      locale: 'ar',
      practiceName: 'استوديو العافية التجريبي',
    });
    expect(message.text).toBe(
      'فاتورتك INV-000001 من استوديو العافية التجريبي جاهزة. يمكنك فتحها هنا: https://example.com/d/abc',
    );
    expect(message.subject).toBe('استوديو العافية التجريبي — فاتورة INV-000001');
  });

  it('says receipt for a receipt, in either language', () => {
    const english = draftMessage({ ...INVOICE, kind: 'receipt', reference: 'RCP-000004' });
    const arabic = draftMessage({
      ...INVOICE,
      locale: 'ar',
      kind: 'receipt',
      reference: 'RCP-000004',
    });
    expect(english.text).toContain('Your receipt RCP-000004');
    expect(arabic.text).toContain('إيصالك RCP-000004');
    expect(arabic.text).not.toContain('Your');
  });

  it('asks for nothing back', () => {
    // Anti-engagement (CLAUDE.md): the message says what the document is and
    // stops. No reply wanted, no confirmation, nothing to come back for.
    const message = draftMessage(INVOICE).text.toLowerCase();
    expect(message).not.toContain('reply');
    expect(message).not.toContain('confirm');
    expect(message).not.toContain('please let us know');
  });

  it('says nothing about what the visit was for', () => {
    const message = draftMessage(INVOICE).text.toLowerCase();
    expect(message).not.toContain('session');
    expect(message).not.toContain('neurofeedback');
  });
});

describe('the WhatsApp hand-off', () => {
  it('opens WhatsApp on that number with the message already written', () => {
    // A synthetic number from the reserved range (.claude/rules/testing.md).
    const link = whatsAppHandoff('+971500000012', draftMessage(INVOICE));
    expect(link).toBe(
      `https://wa.me/971500000012?text=${encodeURIComponent(draftMessage(INVOICE).text)}`,
    );
  });

  it('refuses a number that is not E.164 rather than repairing it', () => {
    // A repaired telephone number is a message sent to somebody else.
    expect(whatsAppHandoff('050 000 0012', draftMessage(INVOICE))).toBeNull();
    expect(whatsAppHandoff('+0500000012', draftMessage(INVOICE))).toBeNull();
    expect(whatsAppHandoff('', draftMessage(INVOICE))).toBeNull();
  });
});
