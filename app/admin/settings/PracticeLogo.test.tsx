// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProviderBoundary } from '../../shell/auth/AuthContext';
import type { AuthProvider } from '../../shell/auth/types';
import { PracticeLogo } from './PracticeLogo';

/**
 * Settings › Practice › Logo. Synthetic throughout: the practice's real mark
 * is uploaded by the operator and never written into a fixture.
 *
 * What is worth proving is what the section says when there is no logo, that
 * a chosen file is sent as base64 with its media type, that a file the
 * browser can already see is the wrong kind never leaves the page, and that
 * removing one says so.
 */

afterEach(cleanup);

const provider: AuthProvider = {
  kind: 'development',
  signIn: async () => undefined,
  signOut: async () => undefined,
  getAccessToken: async () => 'token',
  onChange: () => () => undefined,
};

const LOGO = {
  documentId: '00000000-0000-4000-8000-000000000909',
  mimeType: 'image/png',
  url: '/api/storage/tenant/t/practice/d?expires=1&token=t',
  expiresInSeconds: 300,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const notFound = () => json({ error: 'not_found', requestId: null }, 404);

type Call = { url: string; init?: RequestInit };

function mount(answer: (call: Call) => Response = notFound) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), init };
    calls.push(call);
    if (call.url === '/api/me') {
      return json({
        userId: '00000002-0000-4000-8000-000000000010',
        displayName: 'Hazel Harbour',
        tenantId: '00000001-0000-4000-8000-000000000001',
        roles: ['admin'],
        capabilities: [],
      });
    }
    return answer(call);
  }) as unknown as typeof fetch;

  render(
    <AuthProviderBoundary provider={provider} fetchImpl={fetchImpl}>
      <PracticeLogo />
    </AuthProviderBoundary>,
  );
  return { calls };
}

/** A file the browser reports as `type`, with the bytes a test wants in it. */
function file(name: string, type: string, bytes: number[]): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

const PNG_BYTES = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3];

/** The input itself is off the screen; its label is what names it. */
function chooserInput(): HTMLInputElement {
  return screen.getByLabelText(/logo/i) as HTMLInputElement;
}

async function chooseFile(chosen: File): Promise<void> {
  await screen.findByLabelText(/logo/i);
  fireEvent.change(chooserInput(), { target: { files: [chosen] } });
}

describe('with no logo yet', () => {
  it('says the wordmark stands until the renderer draws one', async () => {
    // The renderer is billing's and is unwritten, so nothing here claims the
    // logo is printed on anything yet.
    mount();
    expect(await screen.findByText(/No logo filed/)).toBeTruthy();
    expect(screen.getByText(/until the renderer draws one/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Remove logo' })).toBeNull();
  });

  it('names the two formats and the cap it will accept, in the unit it means', async () => {
    mount();
    expect(await screen.findByText(/A PNG or a JPEG, up to 500 KB/)).toBeTruthy();
  });

  it('offers the practice’s own words rather than the browser’s file chrome', async () => {
    mount();
    // The native control is off the screen and reachable by keyboard; the
    // button beside it opens the same dialogue and says what we would say.
    const button = await screen.findByRole('button', { name: 'Choose a logo file' });
    expect(button).toBeTruthy();
    expect(chooserInput().className).toContain('visually-hidden');
  });

  it('describes the control with the hint rather than leaving it a loose paragraph', async () => {
    mount();
    await screen.findByText(/A PNG or a JPEG/);
    const described = chooserInput().getAttribute('aria-describedby');
    expect(described).toBe('practice-logo-hint');
    expect(document.getElementById(String(described))?.textContent).toContain('A PNG or a JPEG');
  });
});

describe('choosing a file', () => {
  it('sends it as base64 with its media type, and shows what came back', async () => {
    const { calls } = mount((call) =>
      call.init?.method === 'POST' ? json({ logo: LOGO }) : notFound(),
    );
    await screen.findByText(/No logo filed/);

    await chooseFile(file('mark.png', 'image/png', PNG_BYTES));

    await waitFor(() => expect(screen.getByText('The logo is saved.')).toBeTruthy());
    const post = calls.find((call) => call.init?.method === 'POST');
    expect(post?.url).toBe('/api/practice/logo');
    expect(JSON.parse(String(post?.init?.body))).toEqual({
      mimeType: 'image/png',
      bytesBase64: Buffer.from(new Uint8Array(PNG_BYTES)).toString('base64'),
    });
    expect(screen.getByRole('img', { name: /logo/i })).toHaveProperty(
      'src',
      expect.stringContaining('/api/storage/'),
    );
  });

  it('refuses a kind the browser already knows is wrong, without asking the server', async () => {
    const { calls } = mount();
    await screen.findByText(/No logo filed/);

    await chooseFile(file('brochure.pdf', 'application/pdf', [0x25, 0x50, 0x44, 0x46]));

    await waitFor(() =>
      expect(screen.getByText('The logo has to be a PNG or a JPEG.')).toBeTruthy(),
    );
    expect(calls.some((call) => call.init?.method === 'POST')).toBe(false);
  });

  it('empties the control after a refusal, so the same file can be chosen again', async () => {
    // The control keeps what it was given and choosing the same file twice
    // fires no change event, so a person who fixes the file on disk and picks
    // it again would otherwise get nothing at all.
    mount();
    await screen.findByText(/No logo filed/);

    await chooseFile(file('brochure.pdf', 'application/pdf', [0x25, 0x50, 0x44, 0x46]));

    await waitFor(() => expect(screen.getByText(/PNG or a JPEG/)).toBeTruthy());
    expect(chooserInput().value).toBe('');
  });

  it('says what the server refused, in words rather than a code', async () => {
    mount((call) =>
      call.init?.method === 'POST'
        ? json({ error: 'bad_request', code: 'bytes_do_not_match_type' }, 400)
        : notFound(),
    );
    await screen.findByText(/No logo filed/);

    await chooseFile(file('mark.png', 'image/png', PNG_BYTES));

    await waitFor(() =>
      expect(screen.getByText(/not the kind of image it says it is/)).toBeTruthy(),
    );
  });
});

describe('with a logo', () => {
  it('offers to remove it, and says what the documents carry afterwards', async () => {
    const { calls } = mount((call) =>
      call.init?.method === 'DELETE' ? new Response(null, { status: 204 }) : json({ logo: LOGO }),
    );

    const remove = await screen.findByRole('button', { name: 'Remove logo' });
    fireEvent.click(remove);

    await waitFor(() => expect(screen.getByText(/The logo is removed/)).toBeTruthy());
    expect(calls.some((call) => call.init?.method === 'DELETE')).toBe(true);
    expect(screen.getByText(/No logo filed/)).toBeTruthy();
  });

  it('puts focus on the control that replaces the button it just removed', async () => {
    // The Remove button leaves the page with the logo, and focus would
    // otherwise fall to the body.
    mount((call) =>
      call.init?.method === 'DELETE' ? new Response(null, { status: 204 }) : json({ logo: LOGO }),
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Remove logo' }));

    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Choose a logo file' }),
      ),
    );
  });

  it('shows it through the short-lived link the route signed', async () => {
    mount(() => json({ logo: LOGO }));
    const image = await screen.findByRole('img', { name: /logo/i });
    expect(image).toHaveProperty('src', expect.stringContaining('token='));
  });

  it('fetches a fresh link when the signed one has expired, once and no more', async () => {
    // A signed link lives five minutes. Left open longer than that the box
    // shows a broken image, which reads as a lost file rather than a stale
    // link. Once per link, so a genuinely missing object does not loop.
    const { calls } = mount(() => json({ logo: LOGO }));
    const image = await screen.findByRole('img', { name: /logo/i });
    const before = calls.filter((call) => call.url === '/api/practice/logo').length;

    fireEvent.error(image);
    await waitFor(() =>
      expect(calls.filter((call) => call.url === '/api/practice/logo').length).toBe(before + 1),
    );

    fireEvent.error(await screen.findByRole('img', { name: /logo/i }));
    await waitFor(() => expect(screen.getByRole('img', { name: /logo/i })).toBeTruthy());
    expect(calls.filter((call) => call.url === '/api/practice/logo').length).toBe(before + 1);
  });
});
