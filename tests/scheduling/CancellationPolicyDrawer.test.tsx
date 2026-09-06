// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CancellationPolicyDrawer } from '../../app/admin/schedule/CancellationPolicyDrawer';
import { AuthProviderBoundary } from '../../app/shell/auth/AuthContext';
import type { AuthProvider } from '../../app/shell/auth/types';

afterEach(cleanup);

/**
 * The practice's own cancellation policy, changed from the screen that quotes
 * it (db/migrations/202_scheduling_setting.sql; the operator's decisions of
 * 2026-09-03, twenty-four hours and AED 150, both of which they may move).
 */

const provider: AuthProvider = {
  kind: 'development',
  signIn: async () => undefined,
  signOut: async () => undefined,
  getAccessToken: async () => null,
  onChange: () => () => undefined,
};

function mount(fetchImpl: typeof fetch, onSaved = () => undefined) {
  return render(
    <AuthProviderBoundary provider={provider} fetchImpl={fetchImpl}>
      <MemoryRouter>
        <CancellationPolicyDrawer onClose={() => undefined} onSaved={onSaved} />
      </MemoryRouter>
    </AuthProviderBoundary>,
  );
}

function policy(
  handler: (url: string, init?: RequestInit) => Response = () =>
    new Response('not found', { status: 404 }),
): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/appointments/settings' && (init?.method ?? 'GET') === 'GET') {
      return new Response(JSON.stringify({ noticeHours: 24, unfitFeeFils: 15000 }), {
        status: 200,
      });
    }
    return handler(url, init);
  }) as unknown as typeof fetch;
}

describe('CancellationPolicyDrawer', () => {
  it('opens on the figures the practice actually holds', async () => {
    mount(policy());
    expect(
      ((await screen.findByLabelText(/Notice a household must give/)) as HTMLInputElement).value,
    ).toBe('24');
    // Through the one money formatter, so 15000 fils reads as a price and not
    // as a number of anything else.
    expect((screen.getByLabelText(/Call-out fee \(AED\)/) as HTMLInputElement).value).toBe(
      '150.00',
    );
  });

  it('will not save an unchanged policy, or a change with no reason', async () => {
    mount(policy());
    await screen.findByLabelText(/Notice a household must give/);
    const save = () => screen.getByRole('button', { name: 'Save policy' }) as HTMLButtonElement;
    expect(save().disabled).toBe(true);
    expect(screen.getByText('Change a figure first.')).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/Notice a household must give/), {
      target: { value: '48' },
    });
    expect(save().disabled).toBe(true);
    expect(screen.getByText('Say why it is changing first.')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Why is it changing?'), {
      target: { value: 'The founder asked for two days.' },
    });
    expect(save().disabled).toBe(false);
  });

  it('refuses a notice period that is not a whole number of hours in range', async () => {
    mount(policy());
    await screen.findByLabelText(/Notice a household must give/);
    fireEvent.change(screen.getByLabelText(/Notice a household must give/), {
      target: { value: '400' },
    });
    expect(screen.getByText('A whole number of hours, from 0 to 336.')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Save policy' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('sends both figures in fils, with the reason on the request', async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    const onSaved = vi.fn();
    mount(
      policy((url, init) => {
        seen.push({ url, init });
        return new Response(JSON.stringify({ noticeHours: 48, unfitFeeFils: 20000 }), {
          status: 200,
        });
      }),
      onSaved,
    );
    await screen.findByLabelText(/Notice a household must give/);
    fireEvent.change(screen.getByLabelText(/Notice a household must give/), {
      target: { value: '48' },
    });
    fireEvent.change(screen.getByLabelText(/Call-out fee \(AED\)/), {
      target: { value: '200.00' },
    });
    fireEvent.change(screen.getByLabelText('Why is it changing?'), {
      target: { value: 'The founder asked for two days.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save policy' }));

    expect(await screen.findByText('The cancellation policy is saved.')).toBeTruthy();
    expect(onSaved).toHaveBeenCalled();
    const patch = seen.find((entry) => entry.init?.method === 'PATCH');
    expect(patch?.url).toBe('/api/appointments/settings');
    // Money crosses as integer fils and never as a decimal.
    expect(JSON.parse(String(patch?.init?.body))).toEqual({
      noticeHours: 48,
      unfitFeeFils: 20000,
    });
    expect(new Headers(patch?.init?.headers).get('x-reason')).toBe(
      'The founder asked for two days.',
    );
  });

  it('says plainly when changing the policy is not this person’s to do', async () => {
    mount(policy(() => new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 })));
    await screen.findByLabelText(/Notice a household must give/);
    fireEvent.change(screen.getByLabelText(/Notice a household must give/), {
      target: { value: '48' },
    });
    fireEvent.change(screen.getByLabelText('Why is it changing?'), {
      target: { value: 'The founder asked for two days.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save policy' }));
    expect(
      await screen.findByText('Changing the cancellation policy is the owner’s or an admin’s.'),
    ).toBeTruthy();
  });

  it('says so when the policy cannot be read at all', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('nope', { status: 500 }),
    ) as unknown as typeof fetch;
    mount(fetchImpl);
    await waitFor(() =>
      expect(screen.getByText(/cancellation policy could not be read/)).toBeTruthy(),
    );
    expect(screen.queryByRole('button', { name: 'Save policy' })).toBeNull();
  });
});
