// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProviderBoundary } from '../../shell/auth/AuthContext';
import type { AuthProvider } from '../../shell/auth/types';
import { ClientDrawer } from './ClientDrawer';

afterEach(cleanup);

const provider: AuthProvider = {
  kind: 'development',
  signIn: async () => undefined,
  signOut: async () => undefined,
  getAccessToken: async () => null,
  onChange: () => () => undefined,
};

const client = {
  id: '00000008-0000-4000-8000-000000000005',
  mrn: 'MW-000005',
  givenName: 'Dahlia',
  familyName: 'Bay',
  givenNameAr: 'داليا',
  familyNameAr: 'خليج',
  age: 38,
  status: 'active' as const,
  contact: { relationship: 'self', phone: '+971500001105' },
  emirate: 'UAQ',
};

describe('ClientDrawer', () => {
  it('names the client, takes focus, and closes on the button and on Escape', () => {
    const onClose = vi.fn();
    render(
      <AuthProviderBoundary provider={provider} fetchImpl={vi.fn() as unknown as typeof fetch}>
        <ClientDrawer client={client} onClose={onClose} />
      </AuthProviderBoundary>,
    );
    expect(screen.getByRole('dialog', { name: 'Dahlia Bay' })).toBeTruthy();
    expect(screen.getByText('MW-000005')).toBeTruthy();
    const close = screen.getByRole('button', { name: 'Close' });
    expect(document.activeElement).toBe(close);
    fireEvent.click(close);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
