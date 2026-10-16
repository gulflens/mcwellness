// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MarketingResponse } from '../../app/api/portal/schema';
import { AgreementsScreen } from '../../app/client/AgreementsScreen';
import { MoneyScreen } from '../../app/client/MoneyScreen';
import { AGREEMENTS, HOME, MONEY } from './fixtures';
import { forgetLanguage, json, mountPortal } from './harness';

/**
 * A document the household opens says nothing failed when it opened
 * (docs/CHANGE-REQUESTS/docfix-02.md).
 *
 * Each screen asked `window.open` for "noopener" and read a null answer as a
 * failure. A browser following the HTML standard answers null to that
 * request whether or not the tab opened, so every invoice, receipt and
 * wording a household opened was followed by "That document could not be
 * opened." The browser below behaves as the standard says.
 */

const FAILED = 'That document could not be opened.';
const WORDING = {
  id: '00000001-0000-4000-8000-0000000000a1',
  purpose: 'marketing',
  locale: 'en',
  version: '1.0',
  status: 'approved',
  mimeType: 'text/plain',
  textUrl: 'https://storage.example.com/wording',
  expiresInSeconds: 300,
};

let tab: Window;
beforeEach(() => {
  forgetLanguage();
  tab = { opener: {} } as unknown as Window;
  vi.stubGlobal(
    'open',
    vi.fn((_url: string, _target?: string, features?: string) =>
      features?.includes('noopener') ? null : tab,
    ),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('a household opening what the practice filed', () => {
  it('opens an invoice from Money and says nothing failed', async () => {
    mountPortal(<MoneyScreen />, {
      answers: {
        '/api/portal/money': () => json(MONEY),
        '/api/portal/documents': () =>
          json({ url: 'https://storage.example.com/invoice', expiresInSeconds: 300 }),
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Open' }));
    await waitFor(() => expect(tab.opener).toBeNull());
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  it('opens the wording behind an agreement and says nothing failed', async () => {
    mountPortal(<AgreementsScreen />, {
      answers: {
        '/api/portal/home': () => json(HOME),
        '/api/portal/agreements': () => json(AGREEMENTS),
        '/api/portal/consents/': () => json(WORDING),
      },
    });
    fireEvent.click(
      (await screen.findAllByRole('button', { name: 'Read the wording' }))[0] as HTMLElement,
    );
    await waitFor(() => expect(tab.opener).toBeNull());
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  it('opens the offers wording and says nothing failed', async () => {
    const marketing: MarketingResponse = {
      offered: true,
      state: 'never',
      since: null,
      wordings: { en: { id: WORDING.id, version: '1.0' }, ar: null },
    };
    mountPortal(<AgreementsScreen />, {
      answers: {
        '/api/portal/home': () => json(HOME),
        '/api/portal/agreements': () => json(AGREEMENTS),
        '/api/portal/marketing/wording/': () => json(WORDING),
        '/api/portal/marketing': () => json(marketing),
      },
    });
    const offers = await screen.findByRole('region', { name: 'Offers on your phone' });
    fireEvent.click(within(offers).getByRole('button', { name: 'Read the wording' }));
    await waitFor(() => expect(tab.opener).toBeNull());
    expect(screen.queryByText(FAILED)).toBeNull();
  });
});
