import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadConsentTexts } from '../../db/seed/consent-text';

/**
 * A wording not yet approved lives in `docs/CONSENT/drafts/` and is never
 * filed (docs/CONSENT/README.md; round 72's review, finding 7.2). The loader
 * files every top-level `.md` in `docs/CONSENT` as a wording a household may
 * be shown, so this proves by path, not only by purpose, that nothing in the
 * drafts folder reaches it — and that every draft says it is one.
 *
 * The folder is empty of drafts since 6 October 2026, when the practice
 * approved the marketing consent and it moved up one folder at 1.0. The guard
 * stays, for the next draft, and proves the move: the approved files are
 * filed and nothing is left behind here.
 */

const CONSENT = fileURLToPath(new URL('../../docs/CONSENT/', import.meta.url));
const DRAFTS = `${CONSENT}drafts/`;
const drafts = readdirSync(DRAFTS).filter((name) => name.endsWith('.md') && name !== 'README.md');

describe('the consent drafts', () => {
  it('keep a folder of their own, which says what it is for', () => {
    expect(existsSync(`${DRAFTS}README.md`)).toBe(true);
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
    // Every file the loader reads is a top-level file, by its own name.
    for (const text of seeded) {
      expect(text.file, text.file).not.toContain('/');
      expect(existsSync(`${CONSENT}${text.file}`), text.file).toBe(true);
    }
  });

  it('each say they are a draft, at a draft version', () => {
    for (const draft of drafts) {
      const text = readFileSync(`${DRAFTS}${draft}`, 'utf8');
      expect(text, draft).toMatch(/^status: draft$/m);
      expect(text, draft).toMatch(/^version: 0\.\d+-draft$/m);
    }
  });

  it('no longer hold the marketing wording, which the practice approved on 6 October 2026', () => {
    expect(drafts).not.toContain('marketing.en.md');
    expect(drafts).not.toContain('marketing.ar.md');
    const marketing = loadConsentTexts().filter((text) => text.purpose === 'marketing');
    expect(marketing.map((text) => [text.locale, text.version, text.status]).sort()).toEqual([
      ['ar', '1.0', 'approved'],
      ['en', '1.0', 'approved'],
    ]);
  });

  it('never say "treat" in the marketing English, a wording whose point is no medical claim', () => {
    expect(readFileSync(`${CONSENT}marketing.en.md`, 'utf8')).not.toMatch(/\btreat/i);
  });
});
