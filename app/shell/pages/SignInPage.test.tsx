// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProviderBoundary } from '../auth/AuthContext';
import type { AuthProvider } from '../auth/types';
import { SignInPage } from './SignInPage';

afterEach(cleanup);

function provider(overrides: Partial<AuthProvider> = {}): AuthProvider {
  return {
    kind: 'development',
    signIn: vi.fn(async () => undefined),
    signOut: vi.fn(async () => undefined),
    getAccessToken: vi.fn(async () => null),
    onChange: () => () => undefined,
    ...overrides,
  };
}

function mount(p: AuthProvider) {
  return render(
    <AuthProviderBoundary provider={p} fetchImpl={vi.fn() as unknown as typeof fetch}>
      <MemoryRouter initialEntries={['/sign-in']}>
        <SignInPage />
      </MemoryRouter>
    </AuthProviderBoundary>,
  );
}

describe('SignInPage', () => {
  it('submits the email and password to the provider', async () => {
    const p = provider();
    mount(p);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'owner@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'not-a-real-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() =>
      expect(p.signIn).toHaveBeenCalledWith('owner@example.com', 'not-a-real-password'),
    );
  });

  it('shows the seeded people on a laptop and signs in as one', async () => {
    const signInAs = vi.fn(async () => undefined);
    const p = provider({
      signInAs,
      seededPeople: async () => [
        {
          authId: '00000003-0000-4000-8000-000000000001',
          displayName: 'Hazel Harbour',
          roles: ['owner'],
        },
      ],
    });
    mount(p);
    const button = await screen.findByRole('button', { name: 'Sign in as Hazel Harbour' });
    fireEvent.click(button);
    await waitFor(() =>
      expect(signInAs).toHaveBeenCalledWith('00000003-0000-4000-8000-000000000001'),
    );
  });

  it('names the problem when sign-in fails', async () => {
    const p = provider({
      signIn: vi.fn(async () => {
        throw new Error('That email and password did not match. Try again.');
      }),
    });
    mount(p);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'owner@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'That email and password did not match. Try again.',
    );
  });
});
