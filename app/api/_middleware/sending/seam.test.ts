import { describe, expect, it } from 'vitest';
import { draftMessage } from '../../../../domain/shared/sending';
import { documentSender, shareSheetSender } from './index';

/**
 * The forced-fallback proof for the sending seam (CLAUDE.md's seam rule,
 * docs/SEAMS.md), in the place the storage and routing seams keep theirs.
 *
 * With no email vendor configured — the state today, and the state until one
 * is approved in `docs/COMPLIANCE/approved-vendors.md` — sending still works,
 * and works by handing the person the link to share themselves.
 */

const INVOICE = {
  kind: 'invoice' as const,
  reference: 'INV-000001',
  practiceName: 'Synthetic Wellness Studio',
  url: 'https://example.com/d/abc',
};

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
