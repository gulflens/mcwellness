// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProviderBoundary } from '../../shell/auth/AuthContext';
import type { AuthProvider } from '../../shell/auth/types';
import { UpdateClientBody, type ClientRecordResponse } from '../../api/clients/record-schema';
import { IdentityForm } from './IdentityForm';

afterEach(cleanup);

const provider: AuthProvider = {
  kind: 'development',
  signIn: async () => undefined,
  signOut: async () => undefined,
  getAccessToken: async () => null,
  onChange: () => () => undefined,
};

const CLIENT_ID = '00000008-0000-4000-8000-0000000000c1';

// Only the fields the form reads; the rest of the record is not this form's business.
const record = {
  id: CLIENT_ID,
  mrn: 'MW-000099',
  givenName: 'Alpha',
  familyName: 'Synthetic',
  givenNameAr: null,
  familyNameAr: null,
  dateOfBirth: null,
  sexAtBirth: null,
  referralSource: null,
  status: 'lead',
} as unknown as ClientRecordResponse;

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
    return json({ id: CLIENT_ID }, status);
  }) as unknown as typeof fetch;
  render(
    <AuthProviderBoundary provider={provider} fetchImpl={fetchImpl}>
      <IdentityForm clientId={CLIENT_ID} record={record} onSaved={onSaved} onCancel={vi.fn()} />
    </AuthProviderBoundary>,
  );
  return { calls, onSaved };
}

describe('IdentityForm', () => {
  it('sends only what changed, parsed by the route’s own schema', async () => {
    const { calls, onSaved } = mount();
    fireEvent.change(screen.getByLabelText('Date of birth'), { target: { value: '1990-03-12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(calls[0]?.url).toBe(`/api/clients/${CLIENT_ID}`);
    expect(calls[0]?.init?.method).toBe('PATCH');
    const body = JSON.parse(String(calls[0]?.init?.body));
    expect(body).toEqual({ dateOfBirth: '1990-03-12' });
    expect(UpdateClientBody.safeParse(body).success).toBe(true);
  });

  it('refuses a date of birth in the future before sending anything', async () => {
    const { calls } = mount();
    fireEvent.change(screen.getByLabelText('Date of birth'), { target: { value: '2999-01-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it('says so when the person may not edit this record', async () => {
    mount(403);
    fireEvent.change(screen.getByLabelText('Given name'), { target: { value: 'Alef' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/permission/);
  });
});
