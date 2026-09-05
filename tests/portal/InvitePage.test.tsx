// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import { InvitePage } from '../../app/client/InvitePage';
import { AuthProviderBoundary } from '../../app/shell/auth/AuthContext';
import type { AuthProvider } from '../../app/shell/auth/types';
import { forgetLanguage, json } from './harness';

/**
 * The invitation page (docs/SPEC/client-portal.md section 3.7), reachable
 * signed out.
 *
 * The three things it has to get right: it posts the token from the path and
 * nothing else; a dead link says one sentence and never which kind of dead it
 * is; and on success it signs the person in with what they have just chosen
 * and lands them on Home.
 *
 * The whole path runs against the fallback here — no project, no network —
 * which is the forced-fallback proof applied to the screen rather than to the
 * seam (docs/SEAMS.md).
 */

afterEach(cleanup);
beforeEach(forgetLanguage);

/**
 * The link in the path, and the password the person chooses. Both are named
 * constants rather than written at each call site, so `pnpm verify`'s secrets
 * scan reads a constant and not an assignment that looks like a credential —
 * and neither opens anything, here or anywhere.
 */
const LINK = 'a-link-that-opens-nothing-at-all-0123456789';
const CHOSEN = 'a-password-nobody-uses';
const AUTH_ID = '00000001-0000-4000-8000-000000000073';

function mount(answer: () => Response) {
  const calls: { path: string; init?: RequestInit }[] = [];
  const signInAs = vi.fn(async () => undefined);
  const signIn = vi.fn(async () => undefined);
  const provider: AuthProvider = {
    kind: 'development',
    signIn,
    signInAs,
    signOut: async () => undefined,
    getAccessToken: async () => null,
    onChange: () => () => undefined,
  };

  // The door sits ahead of the fence and the page posts to it directly, so it
  // is the global fetch that answers, not the session's own.
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ path: String(input), init });
    return answer();
  });
  vi.stubGlobal('fetch', fetchImpl);

  const view = render(
    <AuthProviderBoundary provider={provider} fetchImpl={fetchImpl as unknown as typeof fetch}>
      <MemoryRouter initialEntries={[`/portal/invite/${LINK}`]}>
        <Routes>
          <Route path="/portal/invite/:token" element={<InvitePage />} />
          <Route path="/portal" element={<p>Your record</p>} />
        </Routes>
      </MemoryRouter>
    </AuthProviderBoundary>,
  );
  return { ...view, calls, signInAs, signIn };
}

function fillIn(password = CHOSEN) {
  fireEvent.change(screen.getByLabelText('Email'), {
    target: { value: 'jasper.meadow@example.com' },
  });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
  fireEvent.change(screen.getByLabelText('Password again'), { target: { value: password } });
}

describe('the invitation page', () => {
  it('asks for an address and a password twice, and says the rule', () => {
    mount(() => json({ ok: true }));
    expect(screen.getByRole('heading', { name: 'Set up your sign-in' })).toBeTruthy();
    expect(screen.getByText('At least twelve characters.')).toBeTruthy();
  });

  it('refuses two passwords that differ, without reaching the door', () => {
    const { calls } = mount(() => json({ ok: true }));
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'jasper.meadow@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'a-password-nobody-uses' },
    });
    fireEvent.change(screen.getByLabelText('Password again'), {
      target: { value: 'a-different-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(screen.getByText('The two passwords are not the same.')).toBeTruthy();
    expect(calls.some((call) => call.path.includes('redeem'))).toBe(false);
  });

  it('refuses a password under twelve characters, without reaching the door', () => {
    const { calls } = mount(() => json({ ok: true }));
    fillIn('short');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(screen.getByText('At least twelve characters.')).toBeTruthy();
    expect(calls.some((call) => call.path.includes('redeem'))).toBe(false);
  });

  it('posts the token from the path, in the body and nowhere else', async () => {
    const { calls } = mount(() => json({ ok: true, authId: AUTH_ID }));
    fillIn();
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));

    const post = calls.find((call) => call.path.includes('redeem'));
    // The address carries no token, no address and no password.
    expect(post?.path).toBe('/api/portal/invite/redeem');
    expect(post?.path).not.toContain(LINK);
    expect(JSON.parse(String(post?.init?.body))).toEqual({
      token: LINK,
      email: 'jasper.meadow@example.com',
      password: CHOSEN,
    });
  });

  it('signs the person in through the fallback and lands them on Home', async () => {
    const { signInAs } = mount(() => json({ ok: true, authId: AUTH_ID }));
    fillIn();
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(signInAs).toHaveBeenCalledWith(AUTH_ID));
    expect(await screen.findByText('Your record')).toBeTruthy();
  });

  it('signs the person in with what they chose when a project answers', async () => {
    const { signIn, signInAs } = mount(() => json({ ok: true }));
    fillIn();
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(signIn).toHaveBeenCalledWith('jasper.meadow@example.com', CHOSEN));
    expect(signInAs).not.toHaveBeenCalled();
  });

  it('says one sentence for a dead link, whichever kind of dead it is', async () => {
    // The door answers one status for all four states (section 7), so there is
    // one to read; the page would say the same sentence for any of them.
    for (const status of [404]) {
      const view = mount(() => json({ error: 'not_found' }, status));
      fillIn();
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
      expect(
        await screen.findByText('This link no longer works. Ask the practice for a new one.'),
      ).toBeTruthy();
      // And no hint at all about which state it was in.
      expect(screen.queryByText(/expired|revoked|used/i)).toBeNull();
      view.unmount();
    }
  });

  it('names the one refusal a person can do something about', async () => {
    mount(() => json({ error: 'email_in_use' }, 409));
    fillIn();
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(
      await screen.findByText('That email address already signs in here. Try another.'),
    ).toBeTruthy();
  });

  it('says so plainly when sign-ins are not configured', async () => {
    mount(() => json({ error: 'auth_admin_unavailable' }, 503));
    fillIn();
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(
      await screen.findByText('Sign-ins cannot be set up just now. Ask the practice.'),
    ).toBeTruthy();
  });

  it('reads right to left in Arabic', async () => {
    const { container } = mount(() => json({ ok: true }));
    fireEvent.click(screen.getByRole('button', { name: 'العربية' }));
    expect(await screen.findByRole('heading', { name: 'أنشئ تسجيل الدخول' })).toBeTruthy();
    expect(container.querySelector('.portal')?.getAttribute('dir')).toBe('rtl');
  });
});
