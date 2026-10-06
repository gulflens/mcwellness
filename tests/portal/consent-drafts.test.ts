import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadConsentTexts } from '../../db/seed/consent-text';

/**
 * A wording not yet approved lives in `docs/CONSENT/drafts/` and is never
 * filed (docs/CONSENT/README.md; round 72's review, finding 7.2). The loader
 * files every top-level `.md` in `docs/CONSENT` as a wording a household may
 * be shown, so this proves by path, not only by purpose, that nothing in the
 * drafts folder reaches it — and that every draft says it is one.
 */

const DRAFTS = fileURLToPath(new URL('../../docs/CONSENT/drafts/', import.meta.url));
const drafts = readdirSync(DRAFTS).filter((name) => name.endsWith('.md'));

describe('the consent drafts', () => {
  it('exist, so this guard is guarding something', () => {
    expect(drafts).toEqual(['marketing.ar.md', 'marketing.en.md']);
  });

  it('are never read by the seed', () => {
    const seeded = loadConsentTexts();
    for (const draft of drafts) {
      const bytes = readFileSync(`${DRAFTS}${draft}`);
      expect(
        seeded.some((text) => text.bytes.equals(bytes)),
        draft,
      ).toBe(false);
    }
    expect(seeded.some((text) => text.status === 'draft')).toBe(false);
  });

  it('each say they are a draft, at a draft version', () => {
    for (const draft of drafts) {
      const text = readFileSync(`${DRAFTS}${draft}`, 'utf8');
      expect(text, draft).toMatch(/^status: draft$/m);
      expect(text, draft).toMatch(/^version: 0\.\d+-draft$/m);
    }
  });

  it('never say "treat" in the English, in a wording whose point is no medical claim', () => {
    expect(readFileSync(`${DRAFTS}marketing.en.md`, 'utf8')).not.toMatch(/\btreat/i);
  });
});
