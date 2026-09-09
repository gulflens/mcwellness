// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProviderBoundary } from '../auth/AuthContext';
import type { AuthProvider } from '../auth/types';
import { PasswordPage } from './PasswordPage';

afterEach(cleanup);

function mount(updatePassword?: AuthProvider['updatePassword']) {
  const provider: AuthProvider = {
    kind: 'supabase',
    signIn: async () => undefined,
    signOut: async () => undefined,
    getAccessToken: async () => 'token',
    onChange: () => () => undefined,
    ...(updatePassword ? { updatePassword } : {}),
  };
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) =>
    String(input) === '/api/me'
      ? new Response(
          JSON.stringify({
            userId: '00000002-0000-4000-8000-000000000010',
            displayName: 'Iris Harbour',
            tenantId: '00000001-0000-4000-8000-000000000001',
            roles: ['admin'],
            capabilities: [],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      : new Response('{}', { status: 404 }),
  ) as unknown as typeof fetch;
  render(
    <MemoryRouter initialEntries={['/account/password']}>
      <AuthProviderBoundary provider={provider} fetchImpl={fetchImpl}>
        <PasswordPage />
      </AuthProviderBoundary>
    </MemoryRouter>,
  );
}

const fill = (a: string, b: string) => {
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: a } });
  fireEvent.change(screen.getByLabelText('The same again'), { target: { value: b } });
  fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
};

describe('PasswordPage', () => {
  it('refuses a short password and a mismatched pair before asking the provider', async () => {
    const update = vi.fn(async () => undefined);
    mount(update);
    await screen.findByLabelText('New password');
    fill('short', 'short');
    expect(await screen.findByText('At least 12 characters.')).toBeTruthy();
    fill('correct horse battery', 'correct horse battery staple');
    expect(await screen.findByText('The two do not match.')).toBeTruthy();
    expect(update).not.toHaveBeenCalled();
  });

  it('changes it through the provider and says so once', async () => {
    const update = vi.fn(async () => undefined);
    mount(update);
    await screen.findByLabelText('New password');
    fill('correct horse battery staple', 'correct horse battery staple');
    await waitFor(() => expect(update).toHaveBeenCalledWith('correct horse battery staple'));
    expect(
      await screen.findByText('Changed. Use the new one from your next sign-in.'),
    ).toBeTruthy();
  });

  it('says so when the sign-in has no password to change', async () => {
    mount();
    await screen.findByLabelText('New password');
    fill('correct horse battery staple', 'correct horse battery staple');
    expect(await screen.findByText('This sign-in has no password to change.')).toBeTruthy();
  });
});
