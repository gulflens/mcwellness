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

  it('is written in both languages', () => {
    const message = draftMessage(INVOICE);
    expect(message.text).toContain('Your invoice INV-000001');
    expect(message.text).toContain('فاتورتك');
  });

  it('says receipt for a receipt, in both languages', () => {
    const message = draftMessage({ ...INVOICE, kind: 'receipt', reference: 'RCP-000004' });
    expect(message.text).toContain('Your receipt RCP-000004');
    expect(message.text).toContain('إيصالك');
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
