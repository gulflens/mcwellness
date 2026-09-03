import { describe, expect, it } from 'vitest';
import { draftMessage, whatsAppHandoff } from '../../domain/billing/sending';
import { shareSheetSender, documentSender } from '../../app/api/billing/sending';

/**
 * The message a family receives, and the hand-off that carries it.
 *
 * The forced-fallback proof for this seam (CLAUDE.md's seam rule,
 * docs/SEAMS.md) is the last block: with no email vendor configured — which is
 * the state today and will be until one is approved — sending still works, and
 * works by handing the person the link to share themselves.
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

describe('the sending seam with no vendor behind it', () => {
  it('is what the platform chooses when nothing names one', () => {
    expect(documentSender({}).name).toBe('share sheet');
    expect(documentSender({ DOCUMENT_EMAIL_VENDOR: '  ' }).name).toBe('share sheet');
  });

  it('refuses at startup when something names a vendor that does not exist', () => {
    // Rather than on the first send, weeks later, to a family that never got it.
    expect(() => documentSender({ DOCUMENT_EMAIL_VENDOR: 'not-a-vendor' })).toThrow(
      /approved in docs\/COMPLIANCE/,
    );
  });

  it('sends nothing and says so, so the person shares the link themselves', async () => {
    const outcome = await shareSheetSender().sendDocument({
      to: 'nobody@example.com',
      message: draftMessage(INVOICE),
    });
    expect(outcome.delivered).toBe(false);
    expect(outcome.channel).toBe('email');
  });
});
