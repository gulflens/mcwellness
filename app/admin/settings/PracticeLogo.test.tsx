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

async function chooseFile(chosen: File): Promise<void> {
  const input = await screen.findByLabelText(/logo/i);
  fireEvent.change(input, { target: { files: [chosen] } });
}

describe('with no logo yet', () => {
  it('says the wordmark stands in its place', async () => {
    mount();
    expect(await screen.findByText(/No logo yet/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Remove logo' })).toBeNull();
  });

  it('names the two formats and the cap it will accept', async () => {
    mount();
    expect(await screen.findByText(/A PNG or a JPEG, up to 512 KB/)).toBeTruthy();
  });
});

describe('choosing a file', () => {
  it('sends it as base64 with its media type, and shows what came back', async () => {
    const { calls } = mount((call) =>
      call.init?.method === 'POST' ? json({ logo: LOGO }) : notFound(),
    );
    await screen.findByText(/No logo yet/);

    await chooseFile(file('mark.png', 'image/png', PNG_BYTES));

    await waitFor(() => expect(screen.getByText(/The logo is saved/)).toBeTruthy());
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
    await screen.findByText(/No logo yet/);

    await chooseFile(file('brochure.pdf', 'application/pdf', [0x25, 0x50, 0x44, 0x46]));

    await waitFor(() =>
      expect(screen.getByText('The logo has to be a PNG or a JPEG.')).toBeTruthy(),
    );
    expect(calls.some((call) => call.init?.method === 'POST')).toBe(false);
  });

  it('says what the server refused, in words rather than a code', async () => {
    mount((call) =>
      call.init?.method === 'POST'
        ? json({ error: 'bad_request', code: 'bytes_do_not_match_type' }, 400)
        : notFound(),
    );
    await screen.findByText(/No logo yet/);

    await chooseFile(file('mark.png', 'image/png', PNG_BYTES));

    await waitFor(() =>
      expect(screen.getByText(/not the kind of image it says it is/)).toBeTruthy(),
    );
  });
});

describe('with a logo', () => {
  it('offers to remove it, and says the wordmark comes back', async () => {
    const { calls } = mount((call) =>
      call.init?.method === 'DELETE' ? new Response(null, { status: 204 }) : json({ logo: LOGO }),
    );

    const remove = await screen.findByRole('button', { name: 'Remove logo' });
    fireEvent.click(remove);

    await waitFor(() => expect(screen.getByText(/The logo is removed/)).toBeTruthy());
    expect(calls.some((call) => call.init?.method === 'DELETE')).toBe(true);
    expect(screen.getByText(/No logo yet/)).toBeTruthy();
  });

  it('shows it through the short-lived link the route signed', async () => {
    mount(() => json({ logo: LOGO }));
    const image = await screen.findByRole('img', { name: /logo/i });
    expect(image).toHaveProperty('src', expect.stringContaining('token='));
  });
});
