// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProviderBoundary } from '../../shell/auth/AuthContext';
import type { AuthProvider } from '../../shell/auth/types';
import type { Location } from '../../api/clients/record-schema';
import { VerifyPinForm } from './VerifyPinForm';

afterEach(cleanup);

const provider: AuthProvider = {
  kind: 'development',
  signIn: async () => undefined,
  signOut: async () => undefined,
  getAccessToken: async () => null,
  onChange: () => () => undefined,
};

const CLIENT_ID = '00000008-0000-4000-8000-0000000000b1';
const location: Location = {
  id: '00000008-0000-4000-8000-0000000000b2',
  label: 'home',
  emirate: 'DXB',
  makaniNumber: null,
  entranceLng: 55.27,
  entranceLat: 25.2,
  hasParkingPoint: false,
  hasCommunityGate: false,
  displayAddress: null,
  accessNotes: null,
  isPrimary: true,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function mount(status = 200) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const onSaved = vi.fn();
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return status === 200 ? json({ id: location.id }) : json({ error: 'forbidden' }, status);
  }) as unknown as typeof fetch;
  render(
    <AuthProviderBoundary provider={provider} fetchImpl={fetchImpl}>
      <VerifyPinForm
        clientId={CLIENT_ID}
        location={location}
        onSaved={onSaved}
        onCancel={vi.fn()}
      />
    </AuthProviderBoundary>,
  );
  return { calls, onSaved };
}

/**
 * "Verify pin" without a map library (task brief item 4): the form starts on
 * the point already on file, an edited point posts to the existing
 * verify-pin route, and a refusal says so in plain words.
 */
describe('VerifyPinForm', () => {
  it('starts on the point on file and posts the edited one', async () => {
    const { calls, onSaved } = mount();
    expect((screen.getByLabelText('Latitude') as HTMLInputElement).value).toBe('25.2');
    expect((screen.getByLabelText('Longitude') as HTMLInputElement).value).toBe('55.27');

    fireEvent.change(screen.getByLabelText('Latitude'), { target: { value: '25.2048' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save pin' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const call = calls.find((c) => c.url.endsWith('/verify-pin'));
    expect(call?.url).toBe(`/api/clients/${CLIENT_ID}/locations/${location.id}/verify-pin`);
    expect(call?.init?.method).toBe('POST');
    expect(JSON.parse(String(call?.init?.body))).toEqual({ lat: 25.2048, lng: 55.27 });
  });

  it('names the refusal rather than failing quietly', async () => {
    const { onSaved } = mount(403);
    fireEvent.click(screen.getByRole('button', { name: 'Save pin' }));
    expect(
      await screen.findByText("You don't have permission to change this client's locations."),
    ).toBeTruthy();
    expect(onSaved).not.toHaveBeenCalled();
  });
});
