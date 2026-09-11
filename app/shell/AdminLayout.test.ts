import { describe, expect, it } from 'vitest';
import { visibleSections } from './AdminLayout';
import type { Actor } from './auth/AuthContext';

/**
 * The rail lists nothing a route would bounce the reader out of — the promise
 * it has always made for sections, now asked one level down of the pages under
 * them (docs/SPEC/coloured-shell.md section 7.1).
 *
 * Synthetic ids throughout, from the reserved test range (.claude/rules/testing.md).
 */
const TENANT_ID = '00000001-0000-4000-8000-000000000001';
const NOW = new Date('2026-09-12T08:00:00+04:00');

const OWNER: Actor = {
  userId: '00000002-0000-4000-8000-000000000021',
  displayName: 'Cedar Orchard',
  tenantId: TENANT_ID,
  roles: ['owner'],
  capabilities: [],
  preferredLocale: 'en',
};
const PRACTITIONER: Actor = {
  userId: '00000002-0000-4000-8000-000000000022',
  displayName: 'Rowan Meadow',
  tenantId: TENANT_ID,
  roles: ['practitioner'],
  capabilities: [],
  preferredLocale: 'en',
};

function pagesOf(actor: Actor, key: string): readonly string[] {
  const section = visibleSections(actor, NOW).find((entry) => entry.key === key);
  return (section?.children ?? []).map((page) => page.key);
}

describe('the pages a rail section lists', () => {
  it("gives the owner every Settings screen, and the schedule's board", () => {
    expect(pagesOf(OWNER, 'settings')).toEqual(['practice', 'practitioners', 'team']);
    expect(pagesOf(OWNER, 'schedule')).toContain('board');
  });

  it('gives a practitioner only the Settings screen they may open', () => {
    // Their own home base, and nothing of the practice's identity or its team:
    // the same rules SettingsNav asks on the page itself, so the rail and the
    // page agree about what exists.
    expect(pagesOf(PRACTITIONER, 'settings')).toEqual(['practitioners']);
  });

  it('leaves the pages of a section that is one screen behind one rule alone', () => {
    // Billing and Books are each one screen; a second gate per row would be a
    // rule that does not exist.
    expect(pagesOf(OWNER, 'billing')).toEqual([
      'prices',
      'packages',
      'balances',
      'invoices',
      'receipts',
    ]);
    expect(pagesOf(OWNER, 'books')).toEqual([
      'overview',
      'journal',
      'accounts',
      'statements',
      'settings',
    ]);
  });

  it('lists no pages under a section that has one screen', () => {
    expect(pagesOf(OWNER, 'clients')).toEqual([]);
    expect(pagesOf(OWNER, 'audit')).toEqual([]);
  });
});
