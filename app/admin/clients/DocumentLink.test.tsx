// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProviderBoundary } from '../../shell/auth/AuthContext';
import { DocumentLink } from './DocumentLink';
import { ADMIN, signedInProvider } from './testActors';

/**
 * Opening a filed document (./DocumentLink.tsx).
 *
 * The link is asked for at the moment somebody presses the button, and what
 * happens next is not always in this app's gift: a popup blocker returns null
 * from `window.open` and says nothing at all. That silence is the case worth
 * testing, because the person on the other side of it concludes the file is
 * missing rather than that their browser stopped it.
 */

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const CLIENT_ID = '0000000a-0000-4000-8000-000000000001';
const DOCUMENT_ID = '0000000a-0000-4000-8000-000000000002';
const SIGNED = 'https://example.test/signed?token=x';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function mount(linkResponse: Response = json({ url: SIGNED, expiresInSeconds: 300 })) {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/me') return json(ADMIN);
    if (url.endsWith('/link')) return linkResponse;
    return json({ error: 'not_found' }, 404);
  }) as unknown as typeof fetch;
  vi.stubGlobal('fetch', fetchImpl);
  render(
    <AuthProviderBoundary provider={signedInProvider} fetchImpl={fetchImpl}>
      <DocumentLink clientId={CLIENT_ID} documentId={DOCUMENT_ID} label="Open" />
    </AuthProviderBoundary>,
  );
}

describe('DocumentLink', () => {
  it('says where it is going before anybody presses it', async () => {
    mount();
    // The link opens somewhere else: a person using a screen reader is told so
    // before they press, not after the focus has gone.
    expect(await screen.findByRole('button', { name: 'Open, opens in a new tab' })).toBeTruthy();
  });

  it('opens the signed link in a new tab', async () => {
    const open = vi.fn(() => ({}) as Window);
    vi.stubGlobal('open', open);
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Open, opens in a new tab' }));
    await waitFor(() => {
      expect(open).toHaveBeenCalledWith(SIGNED, '_blank', 'noopener,noreferrer');
    });
    // Nothing is left on screen: the tab is open and the link is not kept.
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('hands the link over when the browser blocks the tab', async () => {
    // A blocked popup is null and silent, and a button that appears to do
    // nothing reads as a missing file.
    vi.stubGlobal(
      'open',
      vi.fn(() => null),
    );
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Open, opens in a new tab' }));
    const link = await screen.findByRole('link', { name: 'Open it in a new tab' });
    expect(link.getAttribute('href')).toBe(SIGNED);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(screen.getByText(/Your browser stopped the file opening/)).toBeTruthy();
  });

  it('says plainly when the store cannot be reached', async () => {
    mount(json({ error: 'storage_unavailable' }, 503));
    fireEvent.click(await screen.findByRole('button', { name: 'Open, opens in a new tab' }));
    const said = await screen.findByText('The document store cannot be reached.');
    // Announced, not only shown: a refusal nobody hears is a refusal nobody acts on.
    expect(said.getAttribute('role')).toBe('alert');
  });
});
